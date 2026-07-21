import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { Expense, DocMeta } from "../types/index.js";

const router = Router();

// ── GET /api/expenses ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await scanTable<Expense>(TABLES.EXPENSES, getCompanyFilter(req.user!));

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    const invoiceMap = new Map(allInvoices.map((i) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p) => [p.id, p]));

    const enriched = expenses
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
      .map((e) => {
        let invoice, purchase;
        if (e.invoice_id) {
          const inv = invoiceMap.get(e.invoice_id);
          if (inv) invoice = { invoice_number: inv.invoice_number };
        }
        if (e.purchase_invoice_id) {
          const pi = piMap.get(e.purchase_invoice_id);
          if (pi) purchase = { invoice_number: pi.invoice_number };
        }
        return { ...e, invoice, purchase };
      });

    res.json(enriched);
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/expenses ──
const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().nullable().optional(),
  amount: z.number(),
  expense_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  invoice_id: z.string().nullable().optional(),
  purchase_invoice_id: z.string().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
});

router.post("/", requireAuth, requireWriteAccess("expenses"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    const expense: Expense = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      category: parsed.category,
      description: parsed.description || null,
      amount: parsed.amount,
      expense_date: parsed.expense_date,
      invoice_id: parsed.invoice_id || null,
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.EXPENSES, expense as any);
    res.status(201).json(expense);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create expense error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/expenses/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("expenses"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.EXPENSES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete expense error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
