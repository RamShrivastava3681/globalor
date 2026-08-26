import { getItem, updateItem, updateItemConditional, scanTable, TABLES } from "../db/client.js";
import { nowISO } from "./helpers.js";
import type {
  GoodsSalesOrder,
  GoodsSalesOrderLine,
  GoodsSalesOrderStatus,
  GoodsDispatch,
} from "../types/index.js";

/** Round quantities to 3 decimal places (per the platform's precision rule). */
export function roundQty(n: number): number {
  return Math.round(Number(n) * 1000) / 1000;
}

/**
 * Derived SO status from the manual status + dispatched quantities.
 * `partially/fully_dispatched` are never set by hand — they fall out of
 * confirmed dispatches.
 */
export function soDerivedStatus(
  manualStatus: GoodsSalesOrder["manual_status"],
  lines: GoodsSalesOrderLine[],
): GoodsSalesOrderStatus {
  if (manualStatus === "cancelled") return "cancelled";
  const ordered = lines.reduce((s, l) => s + Number(l.ordered_qty || 0), 0);
  const dispatched = lines.reduce((s, l) => s + Number(l.dispatched_qty || 0), 0);
  if (ordered > 0 && dispatched >= ordered) return "fully_dispatched";
  if (dispatched > 0) return "partially_dispatched";
  return manualStatus;
}

export function computeSalesTotals(
  lines: { ordered_qty: number; unit_price: number; discount_pct: number; gst_rate: number | null }[],
  freight: number,
): { subtotal: number; total_discount: number; gst_total: number; grand_total: number } {
  let subtotal = 0;
  let totalDiscount = 0;
  let gstTotal = 0;
  for (const l of lines) {
    const qty = Number(l.ordered_qty) || 0;
    const price = Number(l.unit_price) || 0;
    const discountPct = Math.min(100, Math.max(0, Number(l.discount_pct) || 0));
    const lineGross = qty * price;
    const lineDiscount = (lineGross * discountPct) / 100;
    const taxable = lineGross - lineDiscount;
    subtotal += lineGross;
    totalDiscount += lineDiscount;
    gstTotal += (taxable * (Number(l.gst_rate) || 0)) / 100;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  totalDiscount = Math.round(totalDiscount * 100) / 100;
  gstTotal = Math.round(gstTotal * 100) / 100;
  const grandTotal = Math.round((subtotal - totalDiscount + gstTotal + (Number(freight) || 0)) * 100) / 100;
  return { subtotal, total_discount: totalDiscount, gst_total: gstTotal, grand_total: grandTotal };
}

/**
 * Recompute an SO's dispatched quantities from its ACTIVE confirmed dispatches
 * (confirmed / partially_delivered / delivered / returned) and fold them back
 * with a version-guarded conditional write (bounded retry).
 *
 * `dispatched_qty` per SO line = Σ over active dispatches of
 * (dispatched_qty − returned_qty). Returned/cancelled dispatch quantities are
 * revoked so the SO can be re-dispatched; the recompute is a pure function of
 * dispatch rows, so it is idempotent and convergent under concurrency — the
 * version guard closes the read-modify-write window exactly like the PO fold.
 */
export async function recomputeSoDispatchedQuantities(soId: string): Promise<GoodsSalesOrder | null> {
  const ACTIVE = new Set(["confirmed", "partially_delivered", "delivered", "returned"]);

  const compute = async (so: GoodsSalesOrder) => {
    const dispatches = await scanTable<GoodsDispatch>(TABLES.GOODS_DISPATCHES, {
      filterExpression: "#so = :so",
      expressionAttributeNames: { "#so": "goods_sales_order_id" },
      expressionAttributeValues: { ":so": soId },
    });
    const lines: GoodsSalesOrderLine[] = so.lines.map((sl) => {
      let dispatched = 0;
      for (const d of dispatches) {
        if (!ACTIVE.has(d.status)) continue;
        for (const dl of d.lines) {
          if (dl.sku === sl.sku || dl.name === sl.name) {
            dispatched += Number(dl.dispatched_qty || 0) - Number(dl.returned_qty || 0);
          }
        }
      }
      return { ...sl, dispatched_qty: roundQty(Math.max(0, dispatched)) };
    });
    return { lines, status: soDerivedStatus(so.manual_status, lines) };
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const so = (await getItem(TABLES.GOODS_SALES_ORDERS, { id: soId })) as GoodsSalesOrder | undefined;
    if (!so) return null;
    const version = Number(so.version ?? 0);
    const { lines, status } = await compute(so);
    const updated = await updateItemConditional(
      TABLES.GOODS_SALES_ORDERS,
      { id: soId },
      { lines, status, updated_at: nowISO(), version: version + 1 },
      "(attribute_not_exists(#version) OR #version = :v)",
      { "#version": "version" },
      { ":v": version },
    );
    if (updated) return updated as unknown as GoodsSalesOrder;
    // Lost the race to a concurrent writer — re-read and retry.
  }

  // Retries exhausted: plain recompute write (convergent, last-writer-wins).
  const so = (await getItem(TABLES.GOODS_SALES_ORDERS, { id: soId })) as GoodsSalesOrder | undefined;
  if (!so) return null;
  const { lines, status } = await compute(so);
  const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: soId }, { lines, status, updated_at: nowISO() });
  return updated as unknown as GoodsSalesOrder;
}
