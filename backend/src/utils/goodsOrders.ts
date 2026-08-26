import { getItem, updateItem, updateItemConditional, scanTable, TABLES } from "../db/client.js";
import { nowISO } from "./helpers.js";
import type {
  GoodsPurchaseOrder, GoodsPurchaseOrderLine, GoodsPurchaseOrderStatus, GoodsReceipt,
  PurchaseInvoice, PurchaseInvoiceLine,
} from "../types/index.js";

/** Round quantities to 3 decimal places (per the platform's precision rule). */
export function roundQty(n: number): number {
  return Math.round(Number(n) * 1000) / 1000;
}

/**
 * Derived PO status from the manual status + received quantities.
 * `partially/fully_received` are never set by hand — they fall out of GRNs.
 */
export function poDerivedStatus(
  manualStatus: GoodsPurchaseOrder["manual_status"],
  lines: GoodsPurchaseOrderLine[],
): GoodsPurchaseOrderStatus {
  if (manualStatus === "cancelled") return "cancelled";
  const ordered = lines.reduce((s, l) => s + Number(l.ordered_qty || 0), 0);
  const received = lines.reduce((s, l) => s + Number(l.received_qty || 0), 0);
  if (ordered > 0 && received >= ordered) return "fully_received";
  if (received > 0) return "partially_received";
  return manualStatus;
}

export function computeOrderTotals(
  lines: { ordered_qty: number; unit_price: number; gst_rate: number | null }[],
  freight: number,
): { subtotal: number; gst_total: number; grand_total: number } {
  const subtotal = Math.round(lines.reduce((s, l) => s + Number(l.ordered_qty) * Number(l.unit_price), 0) * 100) / 100;
  const gstTotal = Math.round(lines.reduce((s, l) => s + Number(l.ordered_qty) * Number(l.unit_price) * (Number(l.gst_rate) || 0) / 100, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + gstTotal + (Number(freight) || 0)) * 100) / 100;
  return { subtotal, gst_total: gstTotal, grand_total: grandTotal };
}

/**
 * Recompute a PO's received quantities from ALL confirmed GRNs and fold them
 * back with a version-guarded conditional write (bounded retry).
 *
 * Why recompute instead of "received += accepted": the incremental fold races —
 * two concurrent GRN confirms both read the same PO, both add their own
 * accepted qty, and the last write wins, losing one GRN's contribution. The
 * recompute is a pure function of confirmed GRNs, so it is idempotent and
 * convergent: confirming includes the new GRN, cancelling drops it (it is no
 * longer "confirmed"). The version guard closes the read-modify-write window;
 * on a lost race we re-read and retry, falling back to a plain write only
 * after the retries are exhausted (safe — the recompute is convergent).
 */
export async function recomputePoReceivedQuantities(poId: string): Promise<GoodsPurchaseOrder | null> {
  const compute = async (po: GoodsPurchaseOrder) => {
    const confirmedGrns = await scanTable<GoodsReceipt>(TABLES.GOODS_RECEIPTS, {
      filterExpression: "#po = :po AND #status = :confirmed",
      expressionAttributeNames: { "#po": "goods_purchase_order_id", "#status": "status" },
      expressionAttributeValues: { ":po": poId, ":confirmed": "confirmed" },
    });
    const lines: GoodsPurchaseOrderLine[] = po.lines.map((pl) => {
      let received = 0;
      for (const grn of confirmedGrns) {
        for (const gl of grn.lines) {
          if (gl.sku === pl.sku || gl.name === pl.name) received += Number(gl.accepted_qty || 0);
        }
      }
      return { ...pl, received_qty: roundQty(received) };
    });
    return { lines, status: poDerivedStatus(po.manual_status, lines) };
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const po = (await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: poId })) as GoodsPurchaseOrder | undefined;
    if (!po) return null;
    const version = Number(po.version ?? 0);
    const { lines, status } = await compute(po);
    const updated = await updateItemConditional(
      TABLES.GOODS_PURCHASE_ORDERS,
      { id: poId },
      { lines, status, updated_at: nowISO(), version: version + 1 },
      "(attribute_not_exists(#version) OR #version = :v)",
      { "#version": "version" },
      { ":v": version },
    );
    if (updated) return updated as unknown as GoodsPurchaseOrder;
    // Lost the race to a concurrent writer — re-read and retry.
  }

  // Retries exhausted: plain recompute write (convergent, last-writer-wins).
  const po = (await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: poId })) as GoodsPurchaseOrder | undefined;
  if (!po) return null;
  const { lines, status } = await compute(po);
  const updated = await updateItem(TABLES.GOODS_PURCHASE_ORDERS, { id: poId }, { lines, status, updated_at: nowISO() });
  return updated as unknown as GoodsPurchaseOrder;
}

/**
 * Snapshot a goods PO's lines into a purchase invoice that has none yet
 * (e.g. the one-modal "PO + purchase invoice" flow, or legacy PIs created
 * before lines existed). `invoice_qty` starts at 0 — what the supplier
 * actually billed is editable and is never assumed from the PO.
 */
function snapshotPoLinesToInvoice(po: GoodsPurchaseOrder): PurchaseInvoiceLine[] {
  return po.lines.map((l) => ({
    product_id: l.product_id,
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    ordered_qty: l.ordered_qty,
    grn_received_qty: 0,
    invoice_qty: 0,
    unit_price: l.unit_price,
    po_unit_price: l.unit_price,
    gst_rate: l.gst_rate,
    line_total: 0,
  }));
}

/**
 * Recompute a purchase invoice's GRN back-fill from its linked goods PO:
 *  - `linked_goods_receipt_ids` = the ids of every CONFIRMED GRN on that PO
 *  - each line's `grn_received_qty` = Σ accepted qty from those GRNs
 *  - lines are snapshotted from the PO when the invoice has none
 * Version-guarded conditional write (bounded retry) — same convergent pattern
 * as `recomputePoReceivedQuantities`, so confirming a GRN folds it in and
 * cancelling one drops it.
 *
 * Returns the updated PI, or `null` when the PI has no goods-PO link (in
 * which case there is nothing to sync).
 */
export async function syncPurchaseInvoiceFromGrns(piId: string): Promise<PurchaseInvoice | null> {
  const compute = async (pi: PurchaseInvoice) => {
    const poId = pi.goods_purchase_order_id;
    if (!poId) return null;
    const po = (await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: poId })) as GoodsPurchaseOrder | undefined;
    if (!po) return null;
    const confirmedGrns = await scanTable<GoodsReceipt>(TABLES.GOODS_RECEIPTS, {
      filterExpression: "#po = :po AND #status = :confirmed",
      expressionAttributeNames: { "#po": "goods_purchase_order_id", "#status": "status" },
      expressionAttributeValues: { ":po": poId, ":confirmed": "confirmed" },
    });
    // Only GRNs that belong to THIS invoice count — GRNs explicitly linked to
    // a different PI (or not linked at all when this PO has several PIs) must
    // not double-count against this one. Unlinked GRNs fall through to the
    // PO's invoice(s).
    const thisPisGrns = confirmedGrns.filter(
      (g) => !g.purchase_invoice_id || g.purchase_invoice_id === piId,
    );
    const baseLines = (pi.lines && pi.lines.length > 0 ? pi.lines : snapshotPoLinesToInvoice(po));
    const lines: PurchaseInvoiceLine[] = baseLines.map((l) => {
      let received = 0;
      for (const g of thisPisGrns) {
        for (const gl of g.lines) {
          if (gl.sku === l.sku || gl.name === l.name) received += Number(gl.accepted_qty || 0);
        }
      }
      return { ...l, grn_received_qty: roundQty(received) };
    });
    return { lines, linked_goods_receipt_ids: thisPisGrns.map((g) => g.id) };
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const pi = (await getItem(TABLES.PURCHASE_INVOICES, { id: piId })) as PurchaseInvoice | undefined;
    if (!pi) return null;
    const computed = await compute(pi);
    if (!computed) return pi; // no goods-PO link — nothing to sync
    const version = Number(pi.version ?? 0);
    const updated = await updateItemConditional(
      TABLES.PURCHASE_INVOICES,
      { id: piId },
      {
        lines: computed.lines,
        linked_goods_receipt_ids: computed.linked_goods_receipt_ids,
        updated_at: nowISO(),
        version: version + 1,
      },
      "(attribute_not_exists(#version) OR #version = :v)",
      { "#version": "version" },
      { ":v": version },
    );
    if (updated) return updated as unknown as PurchaseInvoice;
    // Lost the race to a concurrent writer — re-read and retry.
  }

  // Retries exhausted: plain convergent write (last-writer-wins).
  const pi = (await getItem(TABLES.PURCHASE_INVOICES, { id: piId })) as PurchaseInvoice | undefined;
  if (!pi) return null;
  const computed = await compute(pi);
  if (!computed) return pi;
  const updated = await updateItem(
    TABLES.PURCHASE_INVOICES,
    { id: piId },
    { lines: computed.lines, linked_goods_receipt_ids: computed.linked_goods_receipt_ids, updated_at: nowISO() },
  );
  return updated as unknown as PurchaseInvoice;
}
