import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  updateItemConditional,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateDocNumber, nowISO } from "../utils/helpers.js";
import { generateMovementNumber } from "../utils/stock.js";
import { createActivityAlert } from "../utils/alerts.js";
import { recomputePoReceivedQuantities, syncPurchaseInvoiceFromGrns } from "../utils/goodsOrders.js";
import { triggerForecastRecompute } from "../utils/forecast.js";
import type { GoodsReceipt, GoodsReceiptLine, GoodsPurchaseOrder, PurchaseInvoice, StockMovement } from "../types/index.js";

const router = Router();

// ── Helpers ──

function isOverRider(roles: string[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

function computeLineValue(line: { accepted_qty: number; unit_cost: number }): number {
  return Math.round(Number(line.accepted_qty) * Number(line.unit_cost) * 100) / 100;
}

/**
 * Back-fill every purchase invoice that bills this PO (GRNs linked to that PI
 * or unlinked). Used after a GRN confirm/cancel so the PI reflects its
 * receipts even when the GRN was created without an explicit PI link.
 */
async function syncPurchaseInvoicesForPo(poId: string) {
  const pis = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, {
    filterExpression: "#po = :po",
    expressionAttributeNames: { "#po": "goods_purchase_order_id" },
    expressionAttributeValues: { ":po": poId },
  });
  for (const pi of pis) {
    await syncPurchaseInvoiceFromGrns(pi.id).catch((err) =>
      console.error(`   ⚠️ Purchase-invoice GRN back-fill failed for ${pi.id}:`, err));
  }
}

// ── Validation ──

const receiptLineSchema = z.object({
  product_id: z.string().trim().max(200).nullable().optional(),
  sku: z.string().trim().max(64),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(40).optional(),
  ordered_qty: z.number().min(0),
  received_qty: z.number().min(0),
  accepted_qty: z.number().min(0),
  rejected_qty: z.number().min(0),
  unit_cost: z.number().min(0),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const createSchema = z.object({
  goods_purchase_order_id: z.string().min(1),
  received_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  challan_number: z.string().trim().max(80).nullable().optional(),
  received_by: z.string().trim().max(120).nullable().optional(),
  warehouse: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(receiptLineSchema).min(1, "Add at least one line"),
  purchase_invoice_id: z.string().nullable().optional(),
});

const confirmSchema = z.object({
  allow_over_receipt: z.boolean().optional().default(false),
});

// ── GET /api/goods-receipts ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const receipts = await scanTable<GoodsReceipt>(TABLES.GOODS_RECEIPTS, getCompanyFilter(req.user!));
    res.json(
      receipts
        .sort((a, b) => (b.received_date || "").localeCompare(a.received_date || "") || (b.created_at || "").localeCompare(a.created_at || "")),
    );
  } catch (err) {
    console.error("Get goods receipts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const grn = await getItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }) as GoodsReceipt | undefined;
    if (!grn) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    if (req.user!.company_id && grn.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    res.json(grn);
  } catch (err) {
    console.error("Get goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-receipts ── (draft)
router.post("/", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    const po = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: parsed.goods_purchase_order_id }) as GoodsPurchaseOrder | undefined;
    if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && po.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (po.status === "cancelled") {
      res.status(400).json({ error: "Cannot receive goods against a cancelled purchase order" });
      return;
    }

    // An optional purchase-invoice link must be in-scope and bill THIS PO.
    if (parsed.purchase_invoice_id) {
      const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: parsed.purchase_invoice_id }) as PurchaseInvoice | undefined;
      if (!pi || (req.user!.company_id && pi.company_id !== req.user!.company_id)) {
        res.status(400).json({ error: "Linked purchase invoice not found" });
        return;
      }
      if (pi.goods_purchase_order_id && pi.goods_purchase_order_id !== po.id) {
        res.status(400).json({ error: "The linked purchase invoice does not bill this purchase order" });
        return;
      }
    }

    const lines: GoodsReceiptLine[] = parsed.lines.map((l) => ({
      product_id: l.product_id || null,
      sku: l.sku,
      name: l.name.trim(),
      unit: l.unit?.trim() || "unit",
      ordered_qty: l.ordered_qty,
      received_qty: l.received_qty,
      accepted_qty: l.accepted_qty,
      rejected_qty: l.rejected_qty,
      unit_cost: Math.round(l.unit_cost * 100) / 100,
      gst_rate: l.gst_rate ?? null,
      line_value: computeLineValue(l),
      notes: l.notes || null,
    }));

    const grn: GoodsReceipt = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      receipt_number: generateDocNumber("GRN"),
      goods_purchase_order_id: po.id,
      po_number: po.po_number,
      supplier_name: po.supplier_name,
      warehouse: parsed.warehouse || po.warehouse || null,
      received_date: parsed.received_date,
      challan_number: parsed.challan_number || null,
      received_by: parsed.received_by || req.user!.email,
      notes: parsed.notes || null,
      lines,
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      status: "draft",
      created_by: req.user!.id,
      confirmed_by: null,
      cancelled_by: null,
      confirmed_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.GOODS_RECEIPTS, grn as any);

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "stock_movement_created",
      severity: "info",
      message: `Goods receipt ${grn.receipt_number} drafted against ${po.po_number} — confirm it to credit stock`,
      created_by: req.user!.id,
    });

    res.status(201).json(grn);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-receipts/:id/confirm ── (the money step — race-safe)
router.post("/:id/confirm", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const { allow_over_receipt } = confirmSchema.parse(req.body ?? {});
    const grn = await getItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }) as GoodsReceipt | undefined;
    if (!grn) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    if (req.user!.company_id && grn.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    if (grn.status !== "draft") {
      res.status(400).json({ error: `Only draft goods receipts can be confirmed (current: ${grn.status})` });
      return;
    }

    // Re-validate against the LIVE purchase order.
    const po = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: grn.goods_purchase_order_id }) as GoodsPurchaseOrder | undefined;
    if (!po) { res.status(404).json({ error: "Linked purchase order not found" }); return; }
    if (po.status === "cancelled") {
      res.status(400).json({ error: "Cannot receive goods against a cancelled purchase order" });
      return;
    }
    if (po.status === "draft" || po.status === "approved") {
      res.status(400).json({ error: "Approve and send the purchase order before receiving goods" });
      return;
    }
    if (po.status === "fully_received") {
      res.status(400).json({ error: "This purchase order is already fully received" });
      return;
    }

    // Over-receipt requires admin/checker + an explicit flag.
    const overRider = isOverRider(req.user!.roles);
    for (const line of grn.lines) {
      const poLine = po.lines.find((l) => l.sku === line.sku || l.name === line.name);
      const receivedSoFar = poLine?.received_qty ?? 0;
      if (receivedSoFar + line.accepted_qty > (poLine?.ordered_qty ?? 0) && !(overRider && allow_over_receipt)) {
        res.status(400).json({
          error: `Over-receipt on "${line.name}" (${receivedSoFar} + ${line.accepted_qty} > ${poLine?.ordered_qty ?? 0}). Requires a checker/admin with the over-receipt override.`,
        });
        return;
      }
    }

    // Atomic conditional flip — exactly one concurrent confirm wins.
    const confirmed = await updateItemConditional(
      TABLES.GOODS_RECEIPTS,
      { id: grn.id },
      { status: "confirmed", confirmed_by: req.user!.id, confirmed_at: nowISO(), updated_at: nowISO() },
      "#status = :draft",
      { "#status": "status" },
      { ":draft": "draft" },
    );
    if (!confirmed) {
      res.status(409).json({ error: "This goods receipt was already confirmed by someone else" });
      return;
    }

    // Create confirmed stock-IN movements for the accepted quantity.
    const now = nowISO();
    const createdMovements: StockMovement[] = [];
    for (const line of grn.lines) {
      if (line.accepted_qty <= 0) continue;
      const movement: StockMovement = {
        id: generateId(),
        client_id: grn.client_id,
        company_id: grn.company_id,
        direction: "in",
        item_name: line.name,
        sku: line.sku,
        quantity: line.accepted_qty,
        unit: line.unit,
        unit_cost: line.unit_cost,
        notes: line.notes || `Goods receipt ${grn.receipt_number}`,
        invoice_id: null,
        purchase_invoice_id: grn.purchase_invoice_id || null,
        movement_date: grn.received_date,
        product_id: line.product_id,
        status: "confirmed",
        reason: "goods_receipt",
        warehouse: grn.warehouse,
        movement_number: generateMovementNumber(),
        linked_document_type: "GRN",
        linked_document_number: grn.receipt_number,
        goods_receipt_id: grn.id,
        is_system: true,
        created_by: grn.created_by,
        confirmed_by: req.user!.id,
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      createdMovements.push(movement);
    }

    // Fold accepted qty into the PO lines and recompute its status.
    // Recompute-from-confirmed-GRNs + version guard → race-safe & convergent
    // (this GRN is now "confirmed", so the recompute includes it).
    await recomputePoReceivedQuantities(po.id);

    // Back-fill every purchase invoice that bills this PO (grn_received_qty per
    // line + the confirmed-GRN id list). Failure must never fail the confirm —
    // the daily sweep / a later confirm will converge.
    await syncPurchaseInvoicesForPo(po.id);
    triggerForecastRecompute(grn.company_id, grn.client_id);

    createActivityAlert({
      client_id: grn.client_id,
      company_id: grn.company_id,
      type: "stock_movement_created",
      severity: "info",
      message: `GRN ${grn.receipt_number} confirmed — ${createdMovements.reduce((s, m) => s + m.quantity, 0)} units credited to stock against ${po.po_number}`,
      created_by: req.user!.id,
    });

    res.json({ ...confirmed, movements_created: createdMovements.length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Confirm goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-receipts/:id/cancel ── (confirmed → cancelled; reverses stock)
router.post("/:id/cancel", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const grn = await getItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }) as GoodsReceipt | undefined;
    if (!grn) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    if (req.user!.company_id && grn.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    if (grn.status !== "confirmed") {
      res.status(400).json({ error: `Only confirmed goods receipts can be cancelled (current: ${grn.status})` });
      return;
    }

    const cancelled = await updateItemConditional(
      TABLES.GOODS_RECEIPTS,
      { id: grn.id },
      { status: "cancelled", cancelled_by: req.user!.id, cancelled_at: nowISO(), updated_at: nowISO() },
      "#status = :confirmed",
      { "#status": "status" },
      { ":confirmed": "confirmed" },
    );
    if (!cancelled) {
      res.status(409).json({ error: "This goods receipt was already cancelled by someone else" });
      return;
    }

    // Reversing stock-OUT movements — the credited quantities leave the balance.
    const now = nowISO();
    const reversalMovements: StockMovement[] = [];
    for (const line of grn.lines) {
      if (line.accepted_qty <= 0) continue;
      const movement: StockMovement = {
        id: generateId(),
        client_id: grn.client_id,
        company_id: grn.company_id,
        direction: "out",
        item_name: line.name,
        sku: line.sku,
        quantity: line.accepted_qty,
        unit: line.unit,
        unit_cost: line.unit_cost,
        notes: `Reversal of ${grn.receipt_number}`,
        invoice_id: null,
        purchase_invoice_id: grn.purchase_invoice_id || null,
        movement_date: now.slice(0, 10),
        product_id: line.product_id,
        status: "confirmed",
        reason: "goods_receipt",
        warehouse: grn.warehouse,
        movement_number: generateMovementNumber(),
        linked_document_type: "GRN",
        linked_document_number: grn.receipt_number,
        goods_receipt_id: grn.id,
        is_system: true,
        created_by: grn.created_by,
        confirmed_by: req.user!.id,
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      reversalMovements.push(movement);
    }

    // Revoke the PO received qty and recompute its status — the cancelled GRN
    // is no longer "confirmed", so the recompute naturally drops its quantity.
    await recomputePoReceivedQuantities(grn.goods_purchase_order_id);

    // Detach the cancelled GRN from the purchase invoices billing this PO
    // (clears its grn_received_qty contributions and receipt links).
    await syncPurchaseInvoicesForPo(grn.goods_purchase_order_id);
    // The reversal movements are stock-affecting — refresh the forecast so the
    // snapshot reflects the revoked stock (reversals never count as demand).
    triggerForecastRecompute(grn.company_id, grn.client_id);

    res.json({ ...cancelled, reversal_movements: reversalMovements.length });
  } catch (err) {
    console.error("Cancel goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/goods-receipts/:id ── (drafts only)
const updateSchema = createSchema.partial();

router.patch("/:id", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }) as GoodsReceipt | undefined;
    if (!existing) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: "Only draft goods receipts can be edited" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };
    if (parsed.lines) {
      updates.lines = parsed.lines.map((l) => ({
        ...l,
        line_value: computeLineValue({ accepted_qty: l.accepted_qty, unit_cost: l.unit_cost }),
      }));
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && k !== "lines") updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    delete updates.status;
    delete updates.goods_purchase_order_id; // PO link is fixed at creation

    const updated = await updateItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/goods-receipts/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_RECEIPTS, { id: req.params.id }) as GoodsReceipt | undefined;
    if (!existing) { res.status(404).json({ error: "Goods receipt not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: "Only draft goods receipts can be deleted" });
      return;
    }
    await deleteItem(TABLES.GOODS_RECEIPTS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete goods receipt error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
