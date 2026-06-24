import { Router, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { scanTable, getItem, TABLES } from "../db/client.js";
import type {
  Invoice, Debtor, Profile, PurchaseInvoice, Vendor,
  PurchaseOrder, Advance, Expense, Supplier,
} from "../types/index.js";

const router = Router();

// ── Helper: enrich an invoice with related entities ──
async function enrichInvoice(inv: Invoice) {
  const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
  const client = await getItem(TABLES.PROFILES, { id: inv.client_id }) as Profile | undefined;
  let purchases: (PurchaseInvoice & { vendor?: Vendor })[] | undefined;
  if (inv.purchase_invoice_ids && inv.purchase_invoice_ids.length > 0) {
    const results = await Promise.all(
      inv.purchase_invoice_ids.map(async (piId) => {
        const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: piId }) as any;
        if (pi?.vendor_id) {
          pi.vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as Vendor | undefined;
        }
        return pi;
      }),
    );
    purchases = results.filter(Boolean);
  }
  return { ...inv, debtor, client, purchases };
}

// ── Helper: enrich a purchase invoice with vendor ──
async function enrichPurchaseInvoice(pi: PurchaseInvoice) {
  const vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as Vendor | undefined;
  const client = await getItem(TABLES.PROFILES, { id: pi.client_id }) as Profile | undefined;
  return { ...pi, vendor, client };
}

// ── Helper: enrich a purchase order/proforma with parties ──
async function enrichProforma(po: PurchaseOrder) {
  let debtor, vendor, client;
  if (po.debtor_id) debtor = await getItem(TABLES.DEBTORS, { id: po.debtor_id }) as Debtor | undefined;
  if (po.vendor_id) vendor = await getItem(TABLES.VENDORS, { id: po.vendor_id }) as Vendor | undefined;
  if (po.client_id) client = await getItem(TABLES.PROFILES, { id: po.client_id }) as Profile | undefined;
  return { ...po, debtor, vendor, client };
}

// ── Helper: enrich an advance ──
async function enrichAdvance(a: Advance) {
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
      let d, v;
      if (po.debtor_id) d = await getItem(TABLES.DEBTORS, { id: po.debtor_id }) as any;
      if (po.vendor_id) v = await getItem(TABLES.VENDORS, { id: po.vendor_id }) as any;
      order = { po_number: po.po_number, amount: po.amount, status: po.status, debtor: d ? { name: d.name } : undefined, vendor: v ? { name: v.name } : undefined };
    }
  }
  return { ...a, invoice, purchase, order };
}

// ── GET /api/reports/sales-invoices ──
router.get("/sales-invoices", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    const enriched = await Promise.all(
      invoices.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrichInvoice),
    );
    res.json(enriched);
  } catch (err) {
    console.error("Reports sales-invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/purchase-invoices ──
router.get("/purchase-invoices", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
    const enriched = await Promise.all(
      invoices.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrichPurchaseInvoice),
    );
    res.json(enriched);
  } catch (err) {
    console.error("Reports purchase-invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/proformas ──
router.get("/proformas", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);
    const enriched = await Promise.all(
      orders.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrichProforma),
    );
    res.json(enriched);
  } catch (err) {
    console.error("Reports proformas error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/aging ──
router.get("/aging", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    const now = new Date();

    const aging = invoices
      .filter((inv) => inv.status !== "paid" && inv.status !== "rejected" && inv.due_date != null)
      .map((inv) => {
        const due = new Date(inv.due_date!);
        const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        const agingDays = diffDays > 0 ? diffDays : 0;
        let aging_bucket = "Current";
        if (agingDays > 0 && agingDays <= 30) aging_bucket = "1–30 days";
        else if (agingDays <= 60) aging_bucket = "31–60 days";
        else if (agingDays <= 90) aging_bucket = "61–90 days";
        else if (agingDays > 90) aging_bucket = "90+ days";
        return {
          ...inv,
          aging_days: agingDays,
          days_remaining: diffDays <= 0 ? Math.abs(diffDays) : 0,
          is_overdue: diffDays > 0,
          aging_bucket,
        };
      })
      .sort((a, b) => b.aging_days - a.aging_days);

    // Enrich with debtor/client names
    const enriched = await Promise.all(
      aging.map(async (item) => {
        const debtor = await getItem(TABLES.DEBTORS, { id: item.debtor_id }) as Debtor | undefined;
        const client = await getItem(TABLES.PROFILES, { id: item.client_id }) as Profile | undefined;
        return { ...item, debtor_name: debtor?.name, client_name: client?.company_name };
      }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Reports aging error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/debtors ──
router.get("/debtors", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const debtors = await scanTable<Debtor>(TABLES.DEBTORS);
    res.json(debtors.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    console.error("Reports debtors error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/suppliers ──
router.get("/suppliers", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const suppliers = await scanTable<Supplier>(TABLES.SUPPLIERS);
    res.json(suppliers.sort((a, b) => a.company_name.localeCompare(b.company_name)));
  } catch (err) {
    console.error("Reports suppliers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/advances ──
router.get("/advances", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const advances = await scanTable<Advance>(TABLES.ADVANCES);
    const enriched = await Promise.all(
      advances.sort((a, b) => b.advance_date.localeCompare(a.advance_date)).map(enrichAdvance),
    );
    res.json(enriched);
  } catch (err) {
    console.error("Reports advances error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/expenses ──
router.get("/expenses", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const expenses = await scanTable<any>(TABLES.EXPENSES);
    const enriched = await Promise.all(
      expenses
        .sort((a: any, b: any) => b.expense_date.localeCompare(a.expense_date))
        .map(async (e: any) => {
          let invoice, purchase;
          if (e.invoice_id) {
            const inv = await getItem(TABLES.INVOICES, { id: e.invoice_id }) as any;
            if (inv) invoice = { invoice_number: inv.invoice_number };
          }
          if (e.purchase_invoice_id) {
            const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: e.purchase_invoice_id }) as any;
            if (pi) purchase = { invoice_number: pi.invoice_number };
          }
          return { ...e, invoice, purchase };
        }),
    );
    res.json(enriched);
  } catch (err) {
    console.error("Reports expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
