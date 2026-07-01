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

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES);
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES);
    const allPurchaseOrders = await scanTable<any>(TABLES.PURCHASE_ORDERS);
    const allDebtors = await scanTable<any>(TABLES.DEBTORS);
    const allVendors = await scanTable<any>(TABLES.VENDORS);
    const invoiceMap = new Map(allInvoices.map((i) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p) => [p.id, p]));
    const poMap = new Map(allPurchaseOrders.map((p) => [p.id, p]));
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

    const enriched = advances
      .sort((a, b) => b.advance_date.localeCompare(a.advance_date))
      .map((a) => {
        let invoice, purchase, order;

        if (a.invoice_id) {
          const inv = invoiceMap.get(a.invoice_id);
          if (inv) {
            const debtor = debtorMap.get(inv.debtor_id);
            invoice = { invoice_number: inv.invoice_number, amount: inv.amount, debtor: debtor ? { name: debtor.name } : undefined };
          }
        }

        if (a.purchase_invoice_id) {
          const pi = piMap.get(a.purchase_invoice_id);
          if (pi) {
            const vendor = vendorMap.get(pi.vendor_id);
            purchase = { invoice_number: pi.invoice_number, amount: pi.amount, vendor: vendor ? { name: vendor.name } : undefined };
          }
        }

        if (a.purchase_order_id) {
          const po = poMap.get(a.purchase_order_id);
          if (po) {
            const debtor = po.debtor_id ? debtorMap.get(po.debtor_id) : undefined;
            const vendor = po.vendor_id ? vendorMap.get(po.vendor_id) : undefined;
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
      });

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
  purchase_order_id: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
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

// ── POST /api/advances/batch ── (mass import from Excel)
const batchCreateSchema = z.object({
  items: z.array(z.object({
    amount: z.number().positive(),
    invoice_number: z.string().min(1).max(80),
    advance_date: z.string().min(1),
    reference: z.string().nullable().optional(),
  })).min(1),
});

router.post("/batch", requireAuth, requireWriteAccess("advances"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCreateSchema.parse(req.body);
    const now = nowISO();

    // Scan invoices and build lookup by invoice_number
    const allInvoices = await scanTable<any>(TABLES.INVOICES);
    const invoiceByNumber = new Map<string, any>();
    for (const inv of allInvoices) {
      invoiceByNumber.set(inv.invoice_number, inv);
    }

    const created: Advance[] = [];
    const matched: Array<{ invoice_number: string; invoice_id: string }> = [];
    const not_found: string[] = [];
    const errors: Array<{ invoice_number: string; error: string }> = [];

    for (const item of parsed.items) {
      try {
        const invoice = invoiceByNumber.get(item.invoice_number);
        if (!invoice) {
          not_found.push(item.invoice_number);
          continue;
        }

        const id = generateId();
        const advance: Advance = {
          id,
          client_id: req.user!.id,
          side: "sales" as AdvanceSide,
          amount: item.amount,
          advance_date: item.advance_date,
          reference: item.reference || null,
          notes: null,
          purchase_order_id: null,
          invoice_id: invoice.id,
          purchase_invoice_id: null,
          status: "open",
          created_at: now,
          updated_at: now,
        };

        await putItem(TABLES.ADVANCES, advance as any);
        created.push(advance);
        matched.push({ invoice_number: item.invoice_number, invoice_id: invoice.id });
      } catch (err) {
        errors.push({ invoice_number: item.invoice_number, error: "Failed to create advance" });
        console.error(`Batch advance create error for ${item.invoice_number}:`, err);
      }
    }

    res.status(201).json({ created, matched, not_found, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create advances error:", err);
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
