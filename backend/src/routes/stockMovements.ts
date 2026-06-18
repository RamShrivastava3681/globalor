import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { StockMovement, MovementDirection } from "../types/index.js";

const router = Router();

// ── GET /api/stock-movements ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const movements = await scanTable<StockMovement>(TABLES.STOCK_MOVEMENTS);

    const enriched = await Promise.all(
      movements
        .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
        .map(async (m) => {
          let invoice, purchase;
          if (m.invoice_id) {
            const inv = await getItem(TABLES.INVOICES, { id: m.invoice_id }) as any;
            if (inv) invoice = { invoice_number: inv.invoice_number };
          }
          if (m.purchase_invoice_id) {
            const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: m.purchase_invoice_id }) as any;
            if (pi) purchase = { invoice_number: pi.invoice_number };
          }
          return { ...m, invoice, purchase };
        }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get stock movements error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/stock-movements ──
const createSchema = z.object({
  direction: z.enum(["in", "out"]),
  item_name: z.string().min(1),
  sku: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional().default("unit"),
  unit_cost: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
  movement_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
});

router.post("/", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    const movement: StockMovement = {
      id: generateId(),
      client_id: req.user!.id,
      direction: parsed.direction as MovementDirection,
      item_name: parsed.item_name,
      sku: parsed.sku || null,
      quantity: parsed.quantity,
      unit: parsed.unit,
      unit_cost: parsed.unit_cost || null,
      notes: parsed.notes || null,
      invoice_id: parsed.invoice_id || null,
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      movement_date: parsed.movement_date,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
    res.status(201).json(movement);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/stock-movements/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.STOCK_MOVEMENTS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete stock movement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
