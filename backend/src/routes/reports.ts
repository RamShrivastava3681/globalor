import { Router, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { scanTable, TABLES } from "../db/client.js";
import type {
  Invoice, Debtor, Profile, PurchaseInvoice, Vendor,
  PurchaseOrder, Advance, Expense, Supplier,
} from "../types/index.js";

const router = Router();

// ── GET /api/reports/sales-invoices ── (paginated)
router.get("/sales-invoices", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    invoices.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    // Preload all debtors, profiles, vendors, and purchase invoices into lookup maps
    // to avoid N+1 GetItem calls during enrichment (which caused timeouts with 2400+ invoices)
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

    // Preload referenced purchase invoices
    const referencedPiIds = new Set<string>();
    for (const inv of invoices) {
      if (inv.purchase_invoice_ids) {
        for (const piId of inv.purchase_invoice_ids) {
          if (piId) referencedPiIds.add(piId);
        }
      }
    }
    const purchaseInvoiceMap = new Map<string, PurchaseInvoice & { vendor?: Vendor }>();
    if (referencedPiIds.size > 0) {
      const allPis = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
      for (const pi of allPis) {
        if (referencedPiIds.has(pi.id)) {
          if (pi.vendor_id) {
            (pi as any).vendor = vendorMap.get(pi.vendor_id);
          }
          purchaseInvoiceMap.set(pi.id, pi);
        }
      }
    }

    // Fast enrichment using lookup maps (synchronous, no DB calls)
    const enrichInvoiceFast = (inv: Invoice) => {
      const debtor = debtorMap.get(inv.debtor_id);
      const client = profileMap.get(inv.client_id);
      let purchases: (PurchaseInvoice & { vendor?: Vendor })[] | undefined;
      if (inv.purchase_invoice_ids && inv.purchase_invoice_ids.length > 0) {
        purchases = inv.purchase_invoice_ids
          .filter((piId): piId is string => !!piId)
          .map((piId) => purchaseInvoiceMap.get(piId))
          .filter(Boolean) as (PurchaseInvoice & { vendor?: Vendor })[];
      }
      return { ...inv, debtor, client, purchases };
    };

    // Server-side search filter (applied before pagination)
    const search = (req.query.search as string) || "";
    const filtered = search
      ? invoices.filter((inv) => {
          const searchable = JSON.stringify(Object.values({ ...inv, debtor: debtorMap.get(inv.debtor_id), client: profileMap.get(inv.client_id) })).toLowerCase();
          return searchable.includes(search.toLowerCase());
        })
      : invoices;

    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    if (hasPagination) {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      const startIdx = (page - 1) * limit;
      const pageItems = filtered.slice(startIdx, startIdx + limit);
      const enriched = pageItems.map(enrichInvoiceFast);
      res.json({ data: enriched, total, page, limit, totalPages });
    } else {
      const enriched = filtered.map(enrichInvoiceFast);
      res.json(enriched);
    }
  } catch (err) {
    console.error("Reports sales-invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/purchase-invoices ── (paginated)
router.get("/purchase-invoices", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
    invoices.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    // Preload vendors and profiles into lookup maps
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    const enrichPiFast = (pi: PurchaseInvoice) => ({
      ...pi,
      vendor: vendorMap.get(pi.vendor_id),
      client: profileMap.get(pi.client_id),
    });

    // Server-side search filter (applied before pagination)
    const search = (req.query.search as string) || "";
    const filtered = search
      ? invoices.filter((pi) => {
          const searchable = JSON.stringify(Object.values({ ...pi, vendor: vendorMap.get(pi.vendor_id), client: profileMap.get(pi.client_id) })).toLowerCase();
          return searchable.includes(search.toLowerCase());
        })
      : invoices;

    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    if (hasPagination) {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      const startIdx = (page - 1) * limit;
      const pageItems = filtered.slice(startIdx, startIdx + limit);
      const enriched = pageItems.map(enrichPiFast);
      res.json({ data: enriched, total, page, limit, totalPages });
    } else {
      const enriched = filtered.map(enrichPiFast);
      res.json(enriched);
    }
  } catch (err) {
    console.error("Reports purchase-invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/proformas ──
router.get("/proformas", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);

    // Preload lookup maps to avoid N+1 GetItem calls
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    const enriched = orders
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map((po) => ({
        ...po,
        debtor: po.debtor_id ? debtorMap.get(po.debtor_id) : undefined,
        vendor: po.vendor_id ? vendorMap.get(po.vendor_id) : undefined,
        client: po.client_id ? profileMap.get(po.client_id) : undefined,
      }));

    res.json(enriched);
  } catch (err) {
    console.error("Reports proformas error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/aging ── (paginated)
router.get("/aging", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    const now = new Date();

    // Preload debtors and profiles into lookup maps
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

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

    // Fast enrichment using lookup maps
    const enrichAgingItem = (item: any) => {
      const debtor = debtorMap.get(item.debtor_id);
      const client = profileMap.get(item.client_id);
      return { ...item, debtor_name: debtor?.name, client_name: client?.company_name };
    };

    // Server-side search filter (applied before pagination)
    // Inline enrichment to make debtor/client names searchable
    const search = (req.query.search as string) || "";
    const filtered = search
      ? aging.filter((item) => {
          const enriched = {
            ...item,
            debtor_name: debtorMap.get(item.debtor_id)?.name,
            client_name: profileMap.get(item.client_id)?.company_name,
          };
          const searchable = JSON.stringify(Object.values(enriched)).toLowerCase();
          return searchable.includes(search.toLowerCase());
        })
      : aging;

    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    if (hasPagination) {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      const startIdx = (page - 1) * limit;
      const pageItems = filtered.slice(startIdx, startIdx + limit);
      const enriched = pageItems.map(enrichAgingItem);
      res.json({ data: enriched, total, page, limit, totalPages });
    } else {
      const enriched = filtered.map(enrichAgingItem);
      res.json(enriched);
    }
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
      .sort((a, b) => (b.advance_date ?? '').localeCompare(a.advance_date ?? ''))
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
    console.error("Reports advances error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/expenses ──
router.get("/expenses", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const expenses = await scanTable<any>(TABLES.EXPENSES);

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES);
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES);
    const invoiceMap = new Map(allInvoices.map((i) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p) => [p.id, p]));

    const enriched = expenses
      .sort((a: any, b: any) => (b.expense_date ?? '').localeCompare(a.expense_date ?? ''))
      .map((e: any) => {
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
    console.error("Reports expenses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
