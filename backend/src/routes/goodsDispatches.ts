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
import { generateMovementNumber, computeLiveStock } from "../utils/stock.js";
import { recomputeSoDispatchedQuantities, roundQty } from "../utils/goodsSales.js";
import { triggerForecastRecompute } from "../utils/forecast.js";
import { createActivityAlert } from "../utils/alerts.js";
import type {
  GoodsDispatch, GoodsDispatchLine, GoodsDispatchStatus,
  GoodsSalesOrder, StockMovement, Product,
} from "../types/index.js";

const router = Router();

// ── Helpers ──

function isOverRider(roles: string[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

/**
 * Live stock context for the confirm's soft checks:
 * - `available`: sku/product → live confirmed qty (soft stock check, never blocks)
 * - `costs`: sku/product → catalogue unit cost (stock-out movements are valued
 *   at purchase cost, NOT selling price — otherwise the ledger's "latest unit
 *   cost" valuation would be skewed by a dispatch arriving after the GRN).
 */
async function buildStockContext(companyId: string | null): Promise<{
  available: Map<string, number>;
  costs: Map<string, number>;
}> {
  const filter = getCompanyFilter({ company_id: companyId });
  const [movements, products] = await Promise.all([
    scanTable<StockMovement>(TABLES.STOCK_MOVEMENTS, filter),
    scanTable<Product>(TABLES.PRODUCTS, filter),
  ]);
  const summary = computeLiveStock(movements, products);
  const available = new Map<string, number>();
  const costs = new Map<string, number>();
  for (const row of summary.rows) {
    if (row.product_id) available.set(`p:${row.product_id}`, row.quantity);
    if (row.sku) available.set(`s:${row.sku}`, row.quantity);
  }
  for (const p of products) {
    if (p.id) costs.set(`p:${p.id}`, Number(p.unit_cost) || 0);
    if (p.sku) costs.set(`s:${p.sku}`, Number(p.unit_cost) || 0);
  }
  return { available, costs };
}

function deriveDeliveryStatus(lines: GoodsDispatchLine[]): GoodsDispatchStatus {
  const allDelivered = lines.every((l) => Number(l.delivered_qty || 0) >= Number(l.dispatched_qty || 0));
  const anyDelivered = lines.some((l) => Number(l.delivered_qty || 0) > 0);
  if (allDelivered) return "delivered";
  if (anyDelivered) return "partially_delivered";
  return "confirmed";
}

// ── Validation ──

const dispatchLineSchema = z.object({
  product_id: z.string().trim().max(200).nullable().optional(),
  sku: z.string().trim().max(64),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(40).optional(),
  ordered_qty: z.number().min(0),
  dispatched_qty: z.number().positive("Dispatched qty must be > 0"),
  unit_price: z.number().min(0),
  discount_pct: z.number().min(0).max(100),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const createSchema = z.object({
  goods_sales_order_id: z.string().min(1),
  dispatch_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  transporter_name: z.string().trim().max(120).nullable().optional(),
  tracking_number: z.string().trim().max(120).nullable().optional(),
  delivery_challan_number: z.string().trim().max(120).nullable().optional(),
  warehouse: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(dispatchLineSchema).min(1, "Add at least one line"),
});

const confirmSchema = z.object({
  allow_over_dispatch: z.boolean().optional().default(false),
});

const deliverSchema = z.object({
  delivery_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  lines: z.array(z.object({
    sku: z.string(),
    delivered_qty: z.number().min(0),
  })).min(1),
});

const returnSchema = z.object({
  lines: z.array(z.object({
    sku: z.string(),
    /** Blank/absent = full return of the line's remaining dispatched qty. */
    returned_qty: z.number().min(0).nullable().optional(),
  })).optional(),
});

// ── GET /api/goods-dispatches ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dispatches = await scanTable<GoodsDispatch>(TABLES.GOODS_DISPATCHES, getCompanyFilter(req.user!));
    res.json(
      dispatches.sort(
        (a, b) => (b.dispatch_date || "").localeCompare(a.dispatch_date || "") || (b.created_at || "").localeCompare(a.created_at || ""),
      ),
    );
  } catch (err) {
    console.error("Get goods dispatches error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/goods-dispatches/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dispatch = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!dispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && dispatch.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    res.json(dispatch);
  } catch (err) {
    console.error("Get goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-dispatches ── (draft)
router.post("/", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    const so = await getItem(TABLES.GOODS_SALES_ORDERS, { id: parsed.goods_sales_order_id }) as GoodsSalesOrder | undefined;
    if (!so) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && so.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (so.status === "cancelled") {
      res.status(400).json({ error: "Cannot dispatch against a cancelled sales order" });
      return;
    }
    if (so.status === "draft") {
      res.status(400).json({ error: "Confirm the sales order before dispatching goods" });
      return;
    }
    if (so.status === "fully_dispatched") {
      res.status(400).json({ error: "This sales order is already fully dispatched" });
      return;
    }

    const lines: GoodsDispatchLine[] = parsed.lines.map((l) => ({
      product_id: l.product_id || null,
      sku: l.sku,
      name: l.name.trim(),
      unit: l.unit?.trim() || "unit",
      ordered_qty: l.ordered_qty,
      dispatched_qty: roundQty(l.dispatched_qty),
      delivered_qty: 0,
      returned_qty: 0,
      unit_price: Math.round(l.unit_price * 100) / 100,
      discount_pct: Math.min(100, Math.max(0, l.discount_pct)),
      gst_rate: l.gst_rate ?? null,
      line_value: Math.round(l.dispatched_qty * l.unit_price * (1 - Math.min(100, Math.max(0, l.discount_pct)) / 100) * 100) / 100,
      notes: l.notes || null,
    }));

    const dispatch: GoodsDispatch = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      dispatch_number: generateDocNumber("DSP"),
      goods_sales_order_id: so.id,
      so_number: so.so_number,
      customer_name: so.customer_name,
      contact_person: so.contact_person,
      delivery_address: so.delivery_address,
      warehouse: parsed.warehouse || null,
      dispatch_date: parsed.dispatch_date,
      transporter_name: parsed.transporter_name || null,
      tracking_number: parsed.tracking_number || null,
      delivery_challan_number: parsed.delivery_challan_number || null,
      linked_customer_proforma_id: null,
      linked_customer_proforma_number: null,
      linked_sales_invoice_id: null,
      linked_sales_invoice_number: null,
      dispatched_by: req.user!.email,
      notes: parsed.notes || null,
      lines,
      delivery_date: null,
      status: "draft",
      created_by: req.user!.id,
      confirmed_by: null,
      cancelled_by: null,
      returned_by: null,
      confirmed_at: null,
      cancelled_at: null,
      returned_at: null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.GOODS_DISPATCHES, dispatch as any);

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "stock_movement_created",
      severity: "info",
      message: `Dispatch ${dispatch.dispatch_number} drafted against ${so.so_number} — confirm it to dispatch stock`,
      created_by: req.user!.id,
    });

    res.status(201).json(dispatch);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-dispatches/:id/confirm ── (the money step — race-safe)
router.post("/:id/confirm", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const { allow_over_dispatch } = confirmSchema.parse(req.body ?? {});
    const dispatch = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!dispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && dispatch.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (dispatch.status !== "draft") {
      res.status(400).json({ error: `Only draft dispatches can be confirmed (current: ${dispatch.status})` });
      return;
    }

    // Re-validate against the LIVE sales order.
    const so = await getItem(TABLES.GOODS_SALES_ORDERS, { id: dispatch.goods_sales_order_id }) as GoodsSalesOrder | undefined;
    if (!so) { res.status(404).json({ error: "Linked sales order not found" }); return; }
    if (so.status === "cancelled") {
      res.status(400).json({ error: "Cannot dispatch against a cancelled sales order" });
      return;
    }
    if (so.status === "draft") {
      res.status(400).json({ error: "Confirm the sales order before dispatching goods" });
      return;
    }
    if (so.status === "fully_dispatched") {
      res.status(400).json({ error: "This sales order is already fully dispatched" });
      return;
    }

    // Over-dispatch requires admin/checker + an explicit flag.
    const overRider = isOverRider(req.user!.roles);
    for (const line of dispatch.lines) {
      const soLine = so.lines.find((l) => l.sku === line.sku || l.name === line.name);
      const pending = (soLine?.ordered_qty ?? 0) - (soLine?.dispatched_qty ?? 0);
      if (line.dispatched_qty > pending && !(overRider && allow_over_dispatch)) {
        res.status(400).json({
          error: `Over-dispatch on \"${line.name}\" (${line.dispatched_qty} > ${pending} pending). Requires a checker/admin with the over-dispatch override.`,
        });
        return;
      }
    }

    // Soft stock check — warn, never block.
    const { available, costs } = await buildStockContext(dispatch.company_id);
    let stockWarning: string | null = null;
    for (const line of dispatch.lines) {
      const qty = available.get(line.product_id ? `p:${line.product_id}` : `s:${line.sku}`);
      if (qty != null && line.dispatched_qty > qty) {
        stockWarning = `\"${line.name}\" exceeds live available stock (${qty.toLocaleString()} in stock vs ${line.dispatched_qty.toLocaleString()} dispatched). Stock can go negative — dispatch anyway?`;
        break;
      }
    }

    // Atomic conditional flip — exactly one concurrent confirm wins.
    const confirmed = await updateItemConditional(
      TABLES.GOODS_DISPATCHES,
      { id: dispatch.id },
      { status: "confirmed", confirmed_by: req.user!.id, confirmed_at: nowISO(), updated_at: nowISO() },
      "#status = :draft",
      { "#status": "status" },
      { ":draft": "draft" },
    );
    if (!confirmed) {
      res.status(409).json({ error: "This dispatch was already confirmed by someone else" });
      return;
    }

    // Create confirmed stock-OUT movements for the dispatched quantity.
    const now = nowISO();
    const createdMovements: StockMovement[] = [];
    for (const line of dispatch.lines) {
      if (line.dispatched_qty <= 0) continue;
      const movement: StockMovement = {
        id: generateId(),
        client_id: dispatch.client_id,
        company_id: dispatch.company_id,
        direction: "out",
        item_name: line.name,
        sku: line.sku,
        quantity: line.dispatched_qty,
        unit: line.unit,
        // Value stock-out at purchase cost, not selling price (keeps valuation sane).
        unit_cost: costs.get(line.product_id ? `p:${line.product_id}` : `s:${line.sku}`) ?? line.unit_price,
        notes: line.notes || `Dispatch ${dispatch.dispatch_number}`,
        invoice_id: null,
        purchase_invoice_id: null,
        movement_date: dispatch.dispatch_date,
        product_id: line.product_id,
        status: "confirmed",
        reason: "dispatch",
        warehouse: dispatch.warehouse,
        movement_number: generateMovementNumber(),
        linked_document_type: "Dispatch",
        linked_document_number: dispatch.dispatch_number,
        goods_dispatch_id: dispatch.id,
        is_system: true,
        created_by: dispatch.created_by,
        confirmed_by: req.user!.id,
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      createdMovements.push(movement);
    }

    // Fold dispatched qty into the SO and recompute its status (race-safe recompute).
    await recomputeSoDispatchedQuantities(so.id);
    triggerForecastRecompute(dispatch.company_id, dispatch.client_id);

    createActivityAlert({
      client_id: dispatch.client_id,
      company_id: dispatch.company_id,
      type: "dispatch_confirmed",
      severity: "info",
      message: `Dispatch ${dispatch.dispatch_number} confirmed — ${createdMovements.reduce((s, m) => s + m.quantity, 0)} units dispatched against ${so.so_number}`,
      created_by: req.user!.id,
    });

    res.json({ ...confirmed, movements_created: createdMovements.length, stock_warning: stockWarning });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Confirm goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-dispatches/:id/deliver ── (no stock impact — already debited)
router.post("/:id/deliver", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = deliverSchema.parse(req.body);
    const existing = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!existing) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (existing.status !== "confirmed" && existing.status !== "partially_delivered") {
      res.status(400).json({ error: `Only confirmed dispatches can be marked delivered (current: ${existing.status})` });
      return;
    }

    const lines: GoodsDispatchLine[] = existing.lines.map((l) => {
      const delivered = parsed.lines.find((d) => d.sku === l.sku);
      if (!delivered) return l;
      const next = Math.min(Number(l.delivered_qty || 0) + delivered.delivered_qty, Number(l.dispatched_qty || 0));
      return { ...l, delivered_qty: roundQty(next) };
    });

    // Race-safe accumulate — guard on the state we read so two concurrent
    // deliver calls can't both add from the same delivered_qty (lost update).
    const updated = await updateItemConditional(
      TABLES.GOODS_DISPATCHES,
      { id: req.params.id },
      {
        lines,
        delivery_date: parsed.delivery_date,
        status: deriveDeliveryStatus(lines),
        updated_at: nowISO(),
      },
      "#status = :expected",
      { "#status": "status" },
      { ":expected": existing.status },
    );
    if (!updated) {
      res.status(409).json({ error: "This dispatch changed state — refresh and retry" });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Deliver goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-dispatches/:id/return ── (credits stock back IN + revokes SO qty)
router.post("/:id/return", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = returnSchema.parse(req.body ?? {});
    const existing = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!existing) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (existing.status !== "confirmed" && existing.status !== "partially_delivered" && existing.status !== "delivered") {
      res.status(400).json({ error: `Only confirmed/delivered dispatches can record returns (current: ${existing.status})` });
      return;
    }

    const bySku = new Map((parsed.lines ?? []).map((l) => [l.sku, l.returned_qty]));
    const lines: GoodsDispatchLine[] = existing.lines.map((l) => {
      const requested = bySku.get(l.sku);
      // Blank/absent → full return of the remaining dispatched qty.
      const remaining = Math.max(0, Number(l.dispatched_qty || 0) - Number(l.returned_qty || 0));
      const returning = requested == null ? remaining : Math.min(requested, remaining);
      return { ...l, returned_qty: roundQty(Number(l.returned_qty || 0) + returning) };
    });

    const flipped = await updateItemConditional(
      TABLES.GOODS_DISPATCHES,
      { id: existing.id },
      { lines, status: "returned", returned_by: req.user!.id, returned_at: nowISO(), updated_at: nowISO() },
      "#status = :expected",
      { "#status": "status" },
      { ":expected": existing.status },
    );
    if (!flipped) {
      res.status(409).json({ error: "This dispatch changed state — refresh and retry" });
      return;
    }

    // Credit stock back IN (reason "Customer return") for the newly returned qty.
    // Valued at purchase cost (same as the original dispatch debit) so the
    // ledger's latest-unit-cost valuation isn't skewed by sale-price returns.
    const now = nowISO();
    const { costs: returnCosts } = await buildStockContext(existing.company_id);
    const createdMovements: StockMovement[] = [];
    for (let i = 0; i < existing.lines.length; i++) {
      const returnedQty = Number(lines[i].returned_qty || 0) - Number(existing.lines[i].returned_qty || 0);
      if (returnedQty <= 0) continue;
      const movement: StockMovement = {
        id: generateId(),
        client_id: existing.client_id,
        company_id: existing.company_id,
        direction: "in",
        item_name: lines[i].name,
        sku: lines[i].sku,
        quantity: roundQty(returnedQty),
        unit: lines[i].unit,
        unit_cost: returnCosts.get(lines[i].product_id ? `p:${lines[i].product_id}` : `s:${lines[i].sku}`) ?? lines[i].unit_price,
        notes: `Customer return on ${existing.dispatch_number}`,
        invoice_id: null,
        purchase_invoice_id: null,
        movement_date: now.slice(0, 10),
        product_id: lines[i].product_id,
        status: "confirmed",
        reason: "customer_return",
        warehouse: existing.warehouse,
        movement_number: generateMovementNumber(),
        linked_document_type: "Dispatch",
        linked_document_number: existing.dispatch_number,
        goods_dispatch_id: existing.id,
        is_system: true,
        created_by: existing.created_by,
        confirmed_by: req.user!.id,
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      createdMovements.push(movement);
    }

    // Revoke the SO dispatched qty so it can be re-dispatched.
    await recomputeSoDispatchedQuantities(existing.goods_sales_order_id);
    triggerForecastRecompute(existing.company_id, existing.client_id);

    res.json({ ...flipped, movements_created: createdMovements.length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Return goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-dispatches/:id/cancel ──
router.post("/:id/cancel", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!existing) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (existing.status !== "draft" && existing.status !== "confirmed" && existing.status !== "partially_delivered") {
      res.status(400).json({ error: `Only draft/confirmed dispatches can be cancelled (current: ${existing.status})` });
      return;
    }

    const cancelled = await updateItemConditional(
      TABLES.GOODS_DISPATCHES,
      { id: existing.id },
      { status: "cancelled", cancelled_by: req.user!.id, cancelled_at: nowISO(), updated_at: nowISO() },
      "#status = :expected",
      { "#status": "status" },
      { ":expected": existing.status },
    );
    if (!cancelled) {
      res.status(409).json({ error: "This dispatch changed state — refresh and retry" });
      return;
    }

    // If stock was already debited (confirmed), reverse with stock-in movements
    // valued at purchase cost (mirror of the original dispatch debit).
    const now = nowISO();
    const { costs: cancelCosts } = await buildStockContext(existing.company_id);
    const reversalMovements: StockMovement[] = [];
    if (existing.status !== "draft") {
      for (const line of existing.lines) {
        const qty = Number(line.dispatched_qty || 0) - Number(line.returned_qty || 0);
        if (qty <= 0) continue;
        const movement: StockMovement = {
          id: generateId(),
          client_id: existing.client_id,
          company_id: existing.company_id,
          direction: "in",
          item_name: line.name,
          sku: line.sku,
          quantity: roundQty(qty),
          unit: line.unit,
          unit_cost: cancelCosts.get(line.product_id ? `p:${line.product_id}` : `s:${line.sku}`) ?? line.unit_price,
          notes: `Reversal of ${existing.dispatch_number}`,
          invoice_id: null,
          purchase_invoice_id: null,
          movement_date: now.slice(0, 10),
          product_id: line.product_id,
          status: "confirmed",
          reason: "dispatch",
          warehouse: existing.warehouse,
          movement_number: generateMovementNumber(),
          linked_document_type: "Dispatch",
          linked_document_number: existing.dispatch_number,
          goods_dispatch_id: existing.id,
          is_system: true,
          created_by: existing.created_by,
          confirmed_by: req.user!.id,
          confirmed_at: now,
          created_at: now,
          updated_at: now,
        };
        await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
        reversalMovements.push(movement);
      }
    }

    // Revoke the SO dispatched qty.
    await recomputeSoDispatchedQuantities(existing.goods_sales_order_id);
    triggerForecastRecompute(existing.company_id, existing.client_id);

    res.json({ ...cancelled, reversal_movements: reversalMovements.length });
  } catch (err) {
    console.error("Cancel goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/goods-dispatches/:id ── (drafts only)
const updateSchema = createSchema.partial();

router.patch("/:id", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!existing) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: "Only draft dispatches can be edited" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };
    if (parsed.lines) {
      updates.lines = parsed.lines.map((l) => ({
        ...l,
        delivered_qty: 0,
        returned_qty: 0,
        line_value: Math.round(l.dispatched_qty * l.unit_price * (1 - Math.min(100, Math.max(0, l.discount_pct)) / 100) * 100) / 100,
      }));
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && k !== "lines") updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    delete updates.status;
    delete updates.goods_sales_order_id; // SO link is fixed at creation

    const updated = await updateItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Dispatch not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/goods-dispatches/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_DISPATCHES, { id: req.params.id }) as GoodsDispatch | undefined;
    if (!existing) { res.status(404).json({ error: "Dispatch not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Dispatch not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: `Only draft dispatches can be deleted (current: ${existing.status})` });
      return;
    }
    await deleteItem(TABLES.GOODS_DISPATCHES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete goods dispatch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
