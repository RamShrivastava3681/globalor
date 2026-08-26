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
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import {
  normalizeMovement,
  generateMovementNumber,
  computeLiveStock,
} from "../utils/stock.js";
import { triggerForecastRecompute } from "../utils/forecast.js";
import type { StockMovement, StockMovementWithRelations, MovementDirection, Product } from "../types/index.js";

const router = Router();

// ── Shared enrichment ──

/** Build a tiny product projection map for movement enrichment. */
async function buildProductMap(companyId: string | null) {
  const products = await scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter({ company_id: companyId }));
  return new Map(
    products.map((p) => [
      p.id,
      { id: p.id, name: p.name, sku: p.sku, image_url: p.image_url, reorder_level: p.reorder_level, unit_of_measure: p.unit_of_measure },
    ]),
  );
}

// ── GET /api/stock-movements ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const movements = await scanTable<StockMovement>(TABLES.STOCK_MOVEMENTS, getCompanyFilter(req.user!));

    // Preload lookup maps to avoid N+1 GetItem calls
    const [allInvoices, allPurchaseInvoices, productMap] = await Promise.all([
      scanTable<any>(TABLES.INVOICES, getCompanyFilter(req.user!)),
      scanTable<any>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!)),
      buildProductMap(req.user!.company_id),
    ]);
    const invoiceMap = new Map(allInvoices.map((i) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p) => [p.id, p]));

    const enriched: StockMovementWithRelations[] = movements
      .sort((a, b) => (b.movement_date || "").localeCompare(a.movement_date || "") || (b.created_at || "").localeCompare(a.created_at || ""))
      .map((m) => {
        const n = normalizeMovement(m);
        let invoice, purchase, product;
        if (n.invoice_id) {
          const inv = invoiceMap.get(n.invoice_id);
          if (inv) invoice = { id: inv.id, invoice_number: inv.invoice_number };
        }
        if (n.purchase_invoice_id) {
          const pi = piMap.get(n.purchase_invoice_id);
          if (pi) purchase = { id: pi.id, invoice_number: pi.invoice_number };
        }
        if (n.product_id) {
          product = productMap.get(n.product_id);
        }
        return { ...n, invoice, purchase, product };
      });

    res.json(enriched);
  } catch (err) {
    console.error("Get stock movements error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/stock-movements/summary ── (server-derived live stock)
router.get("/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [movements, products] = await Promise.all([
      scanTable<StockMovement>(TABLES.STOCK_MOVEMENTS, getCompanyFilter(req.user!)),
      scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!)),
    ]);
    res.json(computeLiveStock(movements, products));
  } catch (err) {
    console.error("Get stock summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Validation ──

const movementReasons = [
  "opening_stock", "stock_adjustment", "damage", "samples",
  "customer_return", "supplier_return", "goods_receipt", "dispatch",
] as const;

const createSchema = z.object({
  direction: z.enum(["in", "out"]),
  product_id: z.string().max(200).nullable().optional(),
  item_name: z.string().trim().min(1, "Item name is required").max(200).optional(),
  sku: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().positive("Quantity must be > 0"),
  unit: z.string().trim().max(40).optional(),
  unit_cost: z.number().min(0).nullable().optional(),
  reason: z.enum(movementReasons, { message: "Select a valid movement reason" }),
  warehouse: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
  movement_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  /** Manual entries start as drafts; only confirmed movements touch stock. */
  status: z.enum(["draft", "confirmed"]).optional().default("draft"),
});

router.post("/", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    // Snapshot from the catalogue when a product is picked; otherwise the
    // free-text legacy path is used (item_name/sku/unit typed by the user).
    let itemName = parsed.item_name?.trim();
    let sku = parsed.sku?.trim() || null;
    let unit = parsed.unit?.trim() || "unit";
    let unitCost = parsed.unit_cost ?? null;

    if (parsed.product_id) {
      const product = await getItem(TABLES.PRODUCTS, { id: parsed.product_id }) as Product | undefined;
      if (!product) {
        res.status(400).json({ error: "Selected product not found" });
        return;
      }
      if (req.user!.company_id && product.company_id !== req.user!.company_id) {
        res.status(400).json({ error: "Selected product not found" });
        return;
      }
      itemName = product.name;
      sku = product.sku;
      unit = product.unit_of_measure || unit;
      unitCost = unitCost ?? product.unit_cost ?? null;
    }

    if (!itemName) {
      res.status(400).json({ error: "Item name is required" });
      return;
    }

    const movement: StockMovement = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      direction: parsed.direction as MovementDirection,
      item_name: itemName,
      sku,
      quantity: parsed.quantity,
      unit,
      unit_cost: unitCost,
      notes: parsed.notes || null,
      invoice_id: parsed.invoice_id || null,
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      movement_date: parsed.movement_date,
      product_id: parsed.product_id || null,
      status: parsed.status,
      reason: parsed.reason,
      warehouse: parsed.warehouse || null,
      movement_number: generateMovementNumber(),
      is_system: false,
      created_by: req.user!.id,
      confirmed_by: parsed.status === "confirmed" ? req.user!.id : null,
      confirmed_at: parsed.status === "confirmed" ? now : null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
    triggerForecastRecompute(req.user!.company_id, req.user!.id);

    const directionLabel = parsed.direction === "in" ? "Stock-in" : "Stock-out";
    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "stock_movement_created",
      severity: "info",
      message: `${directionLabel}: ${parsed.quantity} ${unit} of "${itemName}"${sku ? ` (${sku})` : ""} recorded as ${parsed.status}`,
      created_by: req.user!.id,
    });

    res.status(201).json(normalizeMovement(movement));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/stock-movements/:id/confirm ── (draft → confirmed, race-safe)
router.post("/:id/confirm", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id }) as StockMovement | undefined;
    if (!existing) { res.status(404).json({ error: "Movement not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Movement not found" });
      return;
    }

    const n = normalizeMovement(existing);
    if (n.is_system) {
      res.status(400).json({ error: "System-created movements are immutable — manage them from their source document" });
      return;
    }
    if (n.status !== "draft") {
      res.status(400).json({ error: `Only draft movements can be confirmed (current status: ${n.status})` });
      return;
    }

    // Atomic conditional flip: exactly one concurrent confirm wins.
    const updated = await updateItemConditional(
      TABLES.STOCK_MOVEMENTS,
      { id: req.params.id },
      { status: "confirmed", confirmed_by: req.user!.id, confirmed_at: nowISO(), updated_at: nowISO() },
      "#status = :draft",
      { "#status": "status" },
      { ":draft": "draft" },
    );

    if (!updated) {
      res.status(409).json({ error: "This movement was already confirmed by someone else" });
      return;
    }
    triggerForecastRecompute(req.user!.company_id, req.user!.id);
    res.json(normalizeMovement(updated as unknown as StockMovement));
  } catch (err) {
    console.error("Confirm stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/stock-movements/:id/cancel ── (confirmed → cancelled, race-safe)
router.post("/:id/cancel", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id }) as StockMovement | undefined;
    if (!existing) { res.status(404).json({ error: "Movement not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Movement not found" });
      return;
    }

    const n = normalizeMovement(existing);
    if (n.is_system) {
      res.status(400).json({ error: "System-created movements are immutable — manage them from their source document" });
      return;
    }
    if (n.status !== "confirmed") {
      res.status(400).json({ error: `Only confirmed movements can be cancelled (current status: ${n.status})` });
      return;
    }

    // Cancelling a confirmed movement drops it out of the live balance —
    // no reversal entry is created.
    const updated = await updateItemConditional(
      TABLES.STOCK_MOVEMENTS,
      { id: req.params.id },
      { status: "cancelled", cancelled_by: req.user!.id, cancelled_at: nowISO(), updated_at: nowISO() },
      "#status = :confirmed",
      { "#status": "status" },
      { ":confirmed": "confirmed" },
    );

    if (!updated) {
      res.status(409).json({ error: "This movement was already cancelled by someone else" });
      return;
    }
    triggerForecastRecompute(req.user!.company_id, req.user!.id);
    res.json(normalizeMovement(updated as unknown as StockMovement));
  } catch (err) {
    console.error("Cancel stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/stock-movements/:id ── (edit drafts + manual confirmed)
const updateSchema = createSchema.partial();

router.patch("/:id", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id }) as StockMovement | undefined;
    if (!existing) { res.status(404).json({ error: "Movement not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Movement not found" });
      return;
    }

    const n = normalizeMovement(existing);
    if (n.is_system) {
      res.status(400).json({ error: "System-created movements are immutable — manage them from their source document" });
      return;
    }
    if (n.status === "cancelled") {
      res.status(400).json({ error: "Cancelled movements cannot be edited" });
      return;
    }
    // Flipping the direction of an already-confirmed movement would silently
    // invert an already-credited balance — disallow it.
    if (n.status === "confirmed" && parsed.direction && parsed.direction !== existing.direction) {
      res.status(400).json({ error: "Cannot change the direction of a confirmed movement — cancel it and create a new one" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    delete updates.status; // status changes go through confirm/cancel only

    const updated = await updateItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Movement not found" }); return; }
    triggerForecastRecompute(req.user!.company_id, req.user!.id);
    res.json(normalizeMovement(updated as unknown as StockMovement));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/stock-movements/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id }) as StockMovement | undefined;
    if (!existing) { res.status(404).json({ error: "Movement not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Movement not found" });
      return;
    }

    const n = normalizeMovement(existing);
    if (n.is_system) {
      res.status(400).json({ error: "System-created movements are immutable — manage them from their source document" });
      return;
    }
    if (n.status !== "draft" && n.status !== "cancelled") {
      res.status(400).json({ error: `Only draft or cancelled movements can be deleted (current status: ${n.status}). Cancel confirmed entries instead.` });
      return;
    }

    await deleteItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id });
    triggerForecastRecompute(req.user!.company_id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
