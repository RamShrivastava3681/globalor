import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { Advance, AdvanceSide, DocMeta } from "../types/index.js";

const router = Router();

// ── GET /api/advances ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const advances = await scanTable<Advance>(TABLES.ADVANCES);

    const enriched = await Promise.all(
      advances
        .sort((a, b) => b.advance_date.localeCompare(a.advance_date))
        .map(async (a) => {
          let invoice, purchase, order;

          if (a.invoice_id) {
            const inv = await getItem(TABLES.INVOICES, { id: a.invoice_id }) as any;
            if (inv) {
              const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as any;
              invoice = { invoice_number: inv.invoice_number, amount: inv.amount, debtor: debtor ? { name: debtor.name } : undefined };
            }
          }

          if (a.purchase_invoice_id) {
            const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: a.purchase_invoice_id }) as any;
            if (pi) {
              const vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as any;
              purchase = { invoice_number: pi.invoice_number, amount: pi.amount, vendor: vendor ? { name: vendor.name } : undefined };
            }
          }

          if (a.purchase_order_id) {
            const po = await getItem(TABLES.PURCHASE_ORDERS, { id: a.purchase_order_id }) as any;
            if (po) {
              let debtor, vendor;
              if (po.debtor_id) debtor = await getItem(TABLES.DEBTORS, { id: po.debtor_id }) as any;
              if (po.vendor_id) vendor = await getItem(TABLES.VENDORS, { id: po.vendor_id }) as any;
              order = {
                po_number: po.po_number,
                amount: po.amount,
                status: po.status,
                debtor: debtor ? { name: debtor.name } : undefined,
                vendor: vendor ? { name: vendor.name } : undefined,
              };
            }
          }

          return { ...a, invoice, purchase, order };
        }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get advances error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/advances ──
const createSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  amount: z.number().positive(),
  advance_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  purchase_order_id: z.string().uuid().nullable().optional(),
  invoice_id: z.string().uuid().nullable().optional(),
  purchase_invoice_id: z.string().uuid().nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("advances"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const advance: Advance = {
      id,
      client_id: req.user!.id,
      side: parsed.side as AdvanceSide,
      amount: parsed.amount,
      advance_date: parsed.advance_date,
      reference: parsed.reference || null,
      notes: parsed.notes || null,
      purchase_order_id: parsed.purchase_order_id || null,
      invoice_id: parsed.invoice_id || null,
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      status: "open",
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.ADVANCES, advance as any);
    res.status(201).json(advance);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create advance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/advances/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("advances"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.ADVANCES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Advance not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update advance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/advances/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("advances"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.ADVANCES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete advance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
