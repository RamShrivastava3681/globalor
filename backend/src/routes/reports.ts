import { Router, Response } from "express";
import { requireAuth, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { scanTable, TABLES } from "../db/client.js";
import { diffDaysUTC } from "../utils/helpers.js";
import { computeCreditNoteTotals } from "../utils/creditNotes.js";
import type {
  Invoice, Debtor, Profile, PurchaseInvoice, Vendor,
  PurchaseOrder, Advance, Expense, CreditDebitNote, InventoryItem,
} from "../types/index.js";

const router = Router();

// ── Status filter helpers (mirrors frontend logic) ──
const SALES_OPEN_STATUSES = ["draft", "submitted", "approved", "advanced", "overdue", "disputed"];
const SALES_CLOSED_STATUSES = ["funded", "paid"];
const PURCHASE_OPEN_STATUSES = ["draft", "submitted", "approved", "advanced", "overdue", "disputed"];
const PURCHASE_CLOSED_STATUSES = ["funded", "paid"];

function applyStatusFilter<T extends { status?: string }>(
  items: T[],
  statusFilter: string,
  openStatuses: string[],
  closedStatuses: string[],
): T[] {
  if (!statusFilter || statusFilter === "all") return items;
  return items.filter((item) => {
    const rowStatus = (item.status ?? "").toLowerCase();
    if (statusFilter === "open") {
      return openStatuses.includes(rowStatus);
    } else if (statusFilter === "closed") {
      return closedStatuses.includes(rowStatus);
    } else {
      return rowStatus === statusFilter;
    }
  });
}

// ── Date range filter helper ──
function dateRangeFilter(req: AuthRequest) {
  const from = (req.query.from as string) || "";
  const to = (req.query.to as string) || "";
  const isInRange = (dateStr: string | null | undefined): boolean => {
    if (!from && !to) return true;
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  return { from, to, isInRange };
}

// ── GET /api/reports/sales-invoices ── (paginated)
router.get("/sales-invoices", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let invoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    if (from || to) {
      invoices = invoices.filter((inv) => isInRange(inv.issue_date));
    }
    invoices.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    // Preload all debtors, profiles, vendors, and purchase invoices into lookup maps
    // to avoid N+1 GetItem calls during enrichment (which caused timeouts with 2400+ invoices)
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
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
      const allPis = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
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
      const closed = inv.status === "paid" || inv.status === "funded";
      const outstanding = closed ? 0 : Number(inv.amount) - (Number(inv.amount_received) || 0);
      return { ...inv, debtor, client, purchases, outstanding };
    };

    // Server-side search filter (applied before pagination)
    const search = (req.query.search as string) || "";
    let filtered = search
      ? invoices.filter((inv) => {
          const searchable = JSON.stringify(Object.values({ ...inv, debtor: debtorMap.get(inv.debtor_id), client: profileMap.get(inv.client_id) })).toLowerCase();
          return searchable.includes(search.toLowerCase());
        })
      : invoices;

    // Server-side buyer (debtor) filter
    const buyerId = (req.query.buyer_id as string) || "";
    if (buyerId) {
      filtered = filtered.filter((inv) => inv.debtor_id === buyerId);
    }

    // Server-side status filter (applied before pagination, after search)
    const statusFilter = (req.query.status as string) || "";
    if (statusFilter) {
      filtered = applyStatusFilter(filtered, statusFilter, SALES_OPEN_STATUSES, SALES_CLOSED_STATUSES);
    }

    // Server-side payment_type filter
    const paymentTypeFilter = (req.query.payment_type as string) || "";
    if (paymentTypeFilter) {
      const types = paymentTypeFilter.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        filtered = filtered.filter((inv) => {
          const pt = inv.payment_type ?? "manual_pay";
          return types.includes(pt);
        });
      }
    }

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
    const { from, to, isInRange } = dateRangeFilter(req);
    let invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    if (from || to) {
      invoices = invoices.filter((pi) => isInRange(pi.issue_date));
    }
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
    let filtered = search
      ? invoices.filter((pi) => {
          const searchable = JSON.stringify(Object.values({ ...pi, vendor: vendorMap.get(pi.vendor_id), client: profileMap.get(pi.client_id) })).toLowerCase();
          return searchable.includes(search.toLowerCase());
        })
      : invoices;

    // Server-side status filter (applied before pagination, after search)
    const statusFilter = (req.query.status as string) || "";
    if (statusFilter) {
      filtered = applyStatusFilter(filtered, statusFilter, PURCHASE_OPEN_STATUSES, PURCHASE_CLOSED_STATUSES);
    }

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
router.get("/proformas", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS, getCompanyFilter(req.user!));
    if (from || to) {
      orders = orders.filter((po) => isInRange(po.proforma_date ?? po.created_at));
    }

    // Preload lookup maps to avoid N+1 GetItem calls
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!));
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

// ── GET /api/reports/aging ── (buyer-wise)
router.get("/aging", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let allInvoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    if (from || to) {
      allInvoices = allInvoices.filter((inv) => isInRange(inv.issue_date));
    }
    const [invoices, allDebtors] = await Promise.all([
      Promise.resolve(allInvoices),
      scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!)),
    ]);

    const now = new Date();
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));

    // Group outstanding non-paid/non-rejected invoices by debtor
    const bucketsByDebtor = new Map<string, {
      current: number;
      bucket_1_30: number;
      bucket_31_60: number;
      bucket_61_90: number;
      bucket_91_120: number;
      bucket_over_120: number;
      total: number;
    }>();

    for (const inv of invoices) {
      if (inv.status === "paid" || inv.status === "rejected" || !inv.debtor_id) continue;

      const amount = Number(inv.amount);
      let bucket: keyof typeof bucketsByDebtor extends never ? string : "current" | "bucket_1_30" | "bucket_31_60" | "bucket_61_90" | "bucket_91_120" | "bucket_over_120" = "current";

      if (inv.due_date) {
        const due = new Date(inv.due_date);
        const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays >= 1 && diffDays <= 30) bucket = "bucket_1_30";
        else if (diffDays >= 31 && diffDays <= 60) bucket = "bucket_31_60";
        else if (diffDays >= 61 && diffDays <= 90) bucket = "bucket_61_90";
        else if (diffDays >= 91 && diffDays <= 120) bucket = "bucket_91_120";
        else if (diffDays > 120) bucket = "bucket_over_120";
        else bucket = "current";
      }

      let entry = bucketsByDebtor.get(inv.debtor_id);
      if (!entry) {
        entry = { current: 0, bucket_1_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_91_120: 0, bucket_over_120: 0, total: 0 };
        bucketsByDebtor.set(inv.debtor_id, entry);
      }

      entry[bucket] += amount;
      entry.total += amount;
    }

    // Build result array
    const result = Array.from(bucketsByDebtor.entries())
      .map(([debtorId, buckets]) => {
        const debtor = debtorMap.get(debtorId);
        return {
          buyer_name: debtor?.name ?? "Unknown",
          buyer_id: debtorId,
          current: buckets.current,
          bucket_1_30: buckets.bucket_1_30,
          bucket_31_60: buckets.bucket_31_60,
          bucket_61_90: buckets.bucket_61_90,
          bucket_91_120: buckets.bucket_91_120,
          bucket_over_120: buckets.bucket_over_120,
          total_outstanding: buckets.total,
        };
      })
      .sort((a, b) => b.total_outstanding - a.total_outstanding);

    res.json(result);
  } catch (err) {
    console.error("Reports aging error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/debtors ──
router.get("/debtors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let allInvoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    if (from || to) {
      allInvoices = allInvoices.filter((inv) => isInRange(inv.issue_date));
    }
    const [debtors, invoices] = await Promise.all([
      scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!)),
      Promise.resolve(allInvoices),
    ]);

    const SALES_OPEN = new Set(["draft", "submitted", "approved", "advanced", "overdue", "disputed"]);
    const SALES_CLOSED = new Set(["funded", "paid"]);

    // Group invoices by debtor_id
    const invoicesByDebtor = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      if (inv.debtor_id) {
        const list = invoicesByDebtor.get(inv.debtor_id) ?? [];
        list.push(inv);
        invoicesByDebtor.set(inv.debtor_id, list);
      }
    }

    const enriched = debtors.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')).map((d) => {
      const debtorInvoices = invoicesByDebtor.get(d.id) ?? [];
      const count = debtorInvoices.length;
      const closed = debtorInvoices.filter((inv) => SALES_CLOSED.has(inv.status)).length;
      const open = debtorInvoices.filter((inv) => SALES_OPEN.has(inv.status)).length;
      const totalInvoiced = debtorInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
      const outstanding = debtorInvoices
        .filter((inv) => inv.status !== "paid" && inv.status !== "rejected")
        .reduce((sum, inv) => sum + Number(inv.amount), 0);
      const totalPaid = debtorInvoices
        .filter((inv) => inv.status === "paid" && inv.amount_received != null)
        .reduce((sum, inv) => sum + Number(inv.amount_received), 0);

      // Pay days calculations (only for paid invoices with both dates)
      const payDays: number[] = [];
      for (const inv of debtorInvoices) {
        if (inv.status === "paid" && inv.issue_date && inv.paid_date) {
          const days = diffDaysUTC(inv.issue_date, inv.paid_date);
          if (days >= 0) payDays.push(days);
        }
      }
      payDays.sort((a, b) => a - b);

      const avgDays = payDays.length > 0
        ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length)
        : null;
      const medianDays = payDays.length > 0
        ? (payDays.length % 2 === 1
            ? payDays[Math.floor(payDays.length / 2)]
            : Math.round((payDays[payDays.length / 2 - 1] + payDays[payDays.length / 2]) / 2))
        : null;
      const maxDays = payDays.length > 0 ? payDays[payDays.length - 1] : null;
      const minDays = payDays.length > 0 ? payDays[0] : null;

      // Oldest outstanding invoice date (earliest issue_date among non-paid, non-rejected invoices)
      const outstandingInvs = debtorInvoices.filter(
        (inv) => inv.status !== "paid" && inv.status !== "rejected"
      );
      let oldestOutstandingInvoiceDate: string | null = null;
      for (const inv of outstandingInvs) {
        if (inv.issue_date && (!oldestOutstandingInvoiceDate || inv.issue_date < oldestOutstandingInvoiceDate)) {
          oldestOutstandingInvoiceDate = inv.issue_date;
        }
      }

      // Latest invoice date (most recent issue_date among all invoices)
      let latestInvoiceDate: string | null = null;
      for (const inv of debtorInvoices) {
        if (inv.issue_date && (!latestInvoiceDate || inv.issue_date > latestInvoiceDate)) {
          latestInvoiceDate = inv.issue_date;
        }
      }

      return {
        ...d,
        total_invoices: count,
        closed,
        open,
        outstanding,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        avg_days: avgDays,
        median_days: medianDays,
        max_days: maxDays,
        min_days: minDays,
        oldest_outstanding_invoice_date: oldestOutstandingInvoiceDate,
        latest_invoice_date: latestInvoiceDate,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("Reports debtors error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/suppliers ──
router.get("/suppliers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    // NOTE: "Suppliers" on the frontend refers to the vendor list (vendors you buy from).
    // The legacy TABLES.SUPPLIERS contains factor-managed supplier data, not your actual suppliers.
    let vendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    if (from || to) {
      vendors = vendors.filter((v) => isInRange(v.created_at));
    }
    res.json(vendors.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
  } catch (err) {
    console.error("Reports suppliers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/advances ──
router.get("/advances", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let advances = await scanTable<Advance>(TABLES.ADVANCES, getCompanyFilter(req.user!));
    if (from || to) {
      advances = advances.filter((a) => isInRange(a.advance_date));
    }

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    const allPurchaseOrders = await scanTable<any>(TABLES.PURCHASE_ORDERS, getCompanyFilter(req.user!));
    const allDebtors = await scanTable<any>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allVendors = await scanTable<any>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const invoiceMap = new Map(allInvoices.map((i: any) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p: any) => [p.id, p]));
    const poMap = new Map(allPurchaseOrders.map((p: any) => [p.id, p]));
    const debtorMap = new Map(allDebtors.map((d: any) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v: any) => [v.id, v]));

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
router.get("/expenses", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let expenses = await scanTable<any>(TABLES.EXPENSES, getCompanyFilter(req.user!));
    if (from || to) {
      expenses = expenses.filter((e: any) => isInRange(e.expense_date));
    }

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    const invoiceMap = new Map(allInvoices.map((i: any) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p: any) => [p.id, p]));

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

// ── P&L category mapping helpers ──

/** Categories that belong to Cost of Sales */
const COST_OF_SALES_CATEGORIES = new Set([
  "logistics-and-procurement-cost",
  "principal-cost",
  "referral-fees",
  "customs-duties",
  "freight-charges",
  "other-direct-costs",
]);

/** Categories that belong to Taxation */
const TAX_CATEGORIES = new Set([
  "corporation-tax",
  "deferred-tax",
  "other-taxes",
]);

/**
 * Compute aggregate amounts for each P&L section from the raw data
 * within the given date range.
 */
function computePnL(data: {
  invoices: Invoice[];
  purchaseInvoices: PurchaseInvoice[];
  expenses: Expense[];
  creditDebitNotes: CreditDebitNote[];
  advances: Advance[];
  payments: Array<{ credit_note_ids?: string[] | null }>;
}, fromDate: string, toDate: string) {
  const isInRange = (dateStr: string | null | undefined) => {
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    return d >= fromDate && d <= toDate;
  };

  const { invoices, purchaseInvoices, expenses, creditDebitNotes, advances } = data;

  // ── Turnover ──
  const grossSales = invoices
    .filter((inv) => isInRange(inv.issue_date))
    .reduce((sum, inv) => sum + Number(inv.amount), 0);

  const otherSalesIncome = expenses
    .filter((e) => e.category === "other-sales-income" && isInRange(e.expense_date))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  // Credit/debit note totals:
  //  - creditNoteTotal: deducted from turnover (sales adjustments)
  //  - debitNoteTotal: deducted from cost of sales (purchase returns)
  const { creditNoteTotal, debitNoteTotal } = computeCreditNoteTotals(
    creditDebitNotes,
    data.payments,
    isInRange,
  );

  // Turnover: gross sales minus debit notes only
  const totalTurnover = grossSales + otherSalesIncome - debitNoteTotal;

  // ── Cost of Sales ──
  const grossPurchases = purchaseInvoices
    .filter((pi) => isInRange(pi.issue_date))
    .reduce((sum, pi) => sum + Number(pi.amount), 0);

  // Cost of sales: gross purchases minus credit notes only
  const netPurchases = grossPurchases - creditNoteTotal;

  const costOfSalesExpenses = expenses.filter((e) => COST_OF_SALES_CATEGORIES.has(e.category) && isInRange(e.expense_date));

  const logisticsAndProcurement = costOfSalesExpenses
    .filter((e) => e.category === "logistics-and-procurement-cost")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const principalCostFromExpenses = costOfSalesExpenses
    .filter((e) => e.category === "principal-cost")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  // Principal cost: sum of advances in range + any "principal-cost" expense entries
  const advancesTotal = advances
    .filter((a) => isInRange(a.advance_date))
    .reduce((sum, a) => sum + Number(a.amount), 0);
  const principalCost = advancesTotal + principalCostFromExpenses;

  const referralFees = costOfSalesExpenses
    .filter((e) => e.category === "referral-fees")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const customsDuties = costOfSalesExpenses
    .filter((e) => e.category === "customs-duties")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const freightCharges = costOfSalesExpenses
    .filter((e) => e.category === "freight-charges")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const otherDirectCosts = costOfSalesExpenses
    .filter((e) => e.category === "other-direct-costs")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const totalCostOfSales =
    netPurchases +
    logisticsAndProcurement +
    principalCost +
    referralFees +
    customsDuties +
    freightCharges +
    otherDirectCosts;

  // ── Gross Profit ──
  const grossProfit = totalTurnover - totalCostOfSales;

  // ── Administrative Costs ──
  const adminExpenses = expenses.filter(
    (e) =>
      !COST_OF_SALES_CATEGORIES.has(e.category) &&
      !TAX_CATEGORIES.has(e.category) &&
      isInRange(e.expense_date),
  );

  const adminCostByCategory = new Map<string, number>();
  for (const e of adminExpenses) {
    const current = adminCostByCategory.get(e.category) ?? 0;
    adminCostByCategory.set(e.category, current + Number(e.amount));
  }

  const totalAdminCosts = Array.from(adminCostByCategory.values()).reduce((a, b) => a + b, 0);

  // ── Operating Profit ──
  const operatingProfit = grossProfit - totalAdminCosts;

  // ── Profit Before Taxation ──
  const profitBeforeTax = operatingProfit;

  // ── Taxation ──
  const taxExpenses = expenses.filter((e) => TAX_CATEGORIES.has(e.category) && isInRange(e.expense_date));

  const taxByCategory = new Map<string, number>();
  for (const e of taxExpenses) {
    const current = taxByCategory.get(e.category) ?? 0;
    taxByCategory.set(e.category, current + Number(e.amount));
  }

  const totalTaxation = Array.from(taxByCategory.values()).reduce((a, b) => a + b, 0);

  // ── Profit After Taxation ──
  const profitAfterTax = profitBeforeTax - totalTaxation;

  return {
    // Turnover
    grossSales,
    otherSalesIncome,
    creditNoteTotal,
    debitNoteTotal,
    totalTurnover,

    // Cost of Sales
    grossPurchases,
    netPurchases,
    logisticsAndProcurement,
    principalCost,
    referralFees,
    customsDuties,
    freightCharges,
    otherDirectCosts,
    totalCostOfSales,

    // Gross Profit
    grossProfit,

    // Administrative Costs
    adminCostByCategory: Object.fromEntries(adminCostByCategory),
    totalAdminCosts,

    // Operating Profit
    operatingProfit,

    // Profit Before Tax
    profitBeforeTax,

    // Taxation
    taxByCategory: Object.fromEntries(taxByCategory),
    totalTaxation,

    // Profit After Tax
    profitAfterTax,
  };
}

// ── GET /api/reports/portfolio ──
router.get("/portfolio", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const from = (req.query.from as string) || "1970-01-01";
    const to = (req.query.to as string) || "2099-12-31";

    const isInRange = (dateStr: string | null | undefined) => {
      if (!dateStr) return false;
      const d = dateStr.slice(0, 10);
      return d >= from && d <= to;
    };

    const invoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));

    // Filter by date range (issue_date)
    const filtered = from !== "1970-01-01" || to !== "2099-12-31"
      ? invoices.filter((inv) => isInRange(inv.issue_date))
      : invoices;

    const totalInvoices = filtered.length;

    // Unique buyers (debtors)
    const buyerIds = new Set<string>();
    for (const inv of filtered) {
      if (inv.debtor_id) buyerIds.add(inv.debtor_id);
    }

    const totalBuyers = buyerIds.size;

    // Total Invoice Value
    const totalInvoiceValue = filtered.reduce((sum, inv) => sum + Number(inv.amount), 0);

    // Collections Received: sum of amount_received for paid/funded invoices
    const totalCollections = filtered
      .filter((inv) => (inv.status === "paid" || inv.status === "funded") && inv.amount_received != null)
      .reduce((sum, inv) => sum + Number(inv.amount_received), 0);

    // Outstanding: sum of amounts for non-paid, non-rejected invoices
    const totalOutstanding = filtered
      .filter((inv) => inv.status !== "paid" && inv.status !== "rejected")
      .reduce((sum, inv) => sum + Number(inv.amount), 0);

    // Closed invoices: paid or funded
    const closedInvoices = filtered.filter(
      (inv) => inv.status === "paid" || inv.status === "funded"
    ).length;

    // Open invoices
    const openInvoices = filtered.filter(
      (inv) => inv.status !== "paid" && inv.status !== "funded" && inv.status !== "rejected"
    ).length;

    // Payment days: days between issue_date and paid_date for paid invoices
    const payDays: number[] = [];
    for (const inv of filtered) {
      if (inv.status === "paid" && inv.issue_date && inv.paid_date) {
        const days = diffDaysUTC(inv.issue_date, inv.paid_date);
        if (days >= 0) payDays.push(days);
      }
    }
    payDays.sort((a, b) => a - b);

    const avgPaymentDays = payDays.length > 0
      ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length)
      : null;

    const medianPaymentDays = payDays.length > 0
      ? (payDays.length % 2 === 1
          ? payDays[Math.floor(payDays.length / 2)]
          : Math.round((payDays[payDays.length / 2 - 1] + payDays[payDays.length / 2]) / 2))
      : null;

    const reviewPeriod = from !== "1970-01-01" || to !== "2099-12-31"
      ? `${from} — ${to}`
      : "All time";

    res.json([{
      review_period: reviewPeriod,
      total_buyers: totalBuyers,
      total_invoices: totalInvoices,
      total_invoice_value: totalInvoiceValue,
      total_collections: totalCollections,
      total_outstanding: totalOutstanding,
      closed_invoices: closedInvoices,
      open_invoices: openInvoices,
      avg_payment_days: avgPaymentDays,
      median_payment_days: medianPaymentDays,
    }]);
  } catch (err) {
    console.error("Reports portfolio error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/profit-loss ──
router.get("/profit-loss", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const from = (req.query.from as string) || "1970-01-01";
    const to = (req.query.to as string) || "2099-12-31";

    // Blind scan — DynamoDB doesn't support date-range queries natively
    const [invoices, purchaseInvoices, expenses, creditDebitNotes, advances, payments] = await Promise.all([
      scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!)),
      scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!)),
      scanTable<Expense>(TABLES.EXPENSES, getCompanyFilter(req.user!)),
      scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, getCompanyFilter(req.user!)),
      scanTable<Advance>(TABLES.ADVANCES, getCompanyFilter(req.user!)),
      scanTable<{ credit_note_ids?: string[] | null }>(TABLES.PAYMENTS, getCompanyFilter(req.user!)),
    ]);

    const report = computePnL({ invoices, purchaseInvoices, expenses, creditDebitNotes, advances, payments }, from, to);

    res.json({
      from,
      to,
      ...report,
    });
  } catch (err) {
    console.error("Reports profit-loss error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/credit-notes ──
router.get("/credit-notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const from = (req.query.from as string) || "1970-01-01";
    const to = (req.query.to as string) || "2099-12-31";

    const isInRange = (dateStr: string | null | undefined) => {
      if (!dateStr) return false;
      const d = dateStr.slice(0, 10);
      return d >= from && d <= to;
    };

    const [creditDebitNotes, payments] = await Promise.all([
      scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, getCompanyFilter(req.user!)),
      scanTable<{ credit_note_ids?: string[] | null }>(TABLES.PAYMENTS, getCompanyFilter(req.user!)),
    ]);

    const totals = computeCreditNoteTotals(creditDebitNotes, payments, isInRange);

    res.json({
      from,
      to,
      ...totals,
    });
  } catch (err) {
    console.error("Reports credit-notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/inventory-tracking ──
router.get("/inventory-tracking", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);
    let items = await scanTable<InventoryItem>(TABLES.INVENTORY_ITEMS, getCompanyFilter(req.user!));
    if (from || to) {
      items = items.filter((i) => isInRange(i.created_at));
    }
    items.sort((a, b) => a.item.localeCompare(b.item));

    res.json(items);
  } catch (err) {
    console.error("Reports inventory-tracking error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/reports/dashboard-summary ──
// Single endpoint that returns ALL data the main dashboard needs.
// Instead of 11+ separate API calls (each scanning multiple DynamoDB tables),
// this does all scans in parallel and returns pre-computed aggregates.
router.get("/dashboard-summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const filter = getCompanyFilter(req.user!);

    // ── Step 1: All DynamoDB scans in parallel ──
    const [invoices, purchaseInvoices, expenses, alerts, debtors, vendors, advances, creditDebitNotes, purchaseOrders, suppliers] =
      await Promise.all([
        scanTable<Invoice>(TABLES.INVOICES, filter),
        scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, filter),
        scanTable<Expense>(TABLES.EXPENSES, filter),
        scanTable<any>(TABLES.ALERTS, filter),
        scanTable<Debtor>(TABLES.DEBTORS, filter),
        scanTable<Vendor>(TABLES.VENDORS, filter),
        scanTable<Advance>(TABLES.ADVANCES, filter),
        scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, filter),
        scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS, filter),
        scanTable<any>(TABLES.SUPPLIERS, filter),
      ]);

    // ── Step 2: Build lookup maps ──
    const debtorMap = new Map(debtors.map((d) => [d.id, d]));
    const vendorMap = new Map(vendors.map((v) => [v.id, v]));

    // ── Step 3: Compute all aggregates in a single pass ──
    const now = new Date();
    const daysBetween = (a: string, b?: string | null): number => {
      if (!b) return 0;
      return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    };

    // --- Sales invoices ---
    const openSales = invoices.filter((i) => i.status !== "paid" && i.status !== "rejected");
    const paidSales = invoices.filter((i) => i.status === "paid");
    const totalSalesAmount = invoices.reduce((s, i) => s + Number(i.amount), 0);
    const totalOutstanding = openSales.reduce((s, i) => s + Number(i.amount), 0);
    const totalCollected = paidSales.reduce((s, i) => s + Number(i.amount), 0);
    const totalShortPayment = paidSales.reduce((s, i) => s + Number(i.short_payment ?? 0), 0);
    const shortPaidInvoices = paidSales.filter((i) => Number(i.short_payment ?? 0) > 0);

    // Sales payment days
    const paidSalesWithDates = paidSales.filter((i) => i.issue_date && i.paid_date);
    const avgSalesPayDays = paidSalesWithDates.length > 0
      ? Math.round(paidSalesWithDates.reduce((s, i) => s + daysBetween(i.issue_date!, i.paid_date!), 0) / paidSalesWithDates.length)
      : 0;

    // Sales aging buckets
    const salesAging = openSales.reduce(
      (acc, i) => {
        const dpd = i.due_date ? daysBetween(i.due_date) : 0;
        const amt = Number(i.amount);
        if (dpd <= 0) acc.current += amt;
        else if (dpd <= 30) acc.b1 += amt;
        else if (dpd <= 60) acc.b2 += amt;
        else if (dpd <= 90) acc.b3 += amt;
        else acc.b4 += amt;
        return acc;
      },
      { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }
    );

    // Invoice status counts
    const invoiceStatusCounts = new Map<string, number>();
    invoices.forEach((i) => {
      invoiceStatusCounts.set(i.status, (invoiceStatusCounts.get(i.status) ?? 0) + 1);
    });

    // --- Purchase invoices ---
    const totalPurchaseAmount = purchaseInvoices.reduce((s, p) => s + Number(p.amount), 0);
    const openPurchases = purchaseInvoices.filter((p) => p.status !== "paid");
    const paidPurchases = purchaseInvoices.filter((p) => p.status === "paid");
    const totalPayable = openPurchases.reduce((s, p) => s + Number(p.amount), 0);
    const totalPaidOut = paidPurchases.reduce((s, p) => s + Number(p.amount), 0);

    // Purchase payment days
    const paidPurchasesWithDates = paidPurchases.filter((p) => p.issue_date && p.paid_date);
    const avgPurchasePayDays = paidPurchasesWithDates.length > 0
      ? Math.round(paidPurchasesWithDates.reduce((s, p) => s + daysBetween(p.issue_date!, p.paid_date!), 0) / paidPurchasesWithDates.length)
      : 0;

    // --- Expenses ---
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const expenseByCategory = new Map<string, number>();
    expenses.forEach((e) => {
      const cat = e.category || "Other";
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + Number(e.amount));
    });

    // --- Credit/debit notes ---
    const { creditNoteTotal, debitNoteTotal } = computeCreditNoteTotals(
      creditDebitNotes,
      [], // payments param is unused by computeCreditNoteTotals
      () => true, // all time for dashboard
    );

    // --- Advances ---
    const salesAdvancesTotal = advances.filter((a) => a.side === "sales").reduce((s, a) => s + Number(a.amount), 0);
    const purchaseAdvancesTotal = advances.filter((a) => a.side === "purchase").reduce((s, a) => s + Number(a.amount), 0);

    // --- Monthly trend (last 6 months) ---
    const monthlyRevenue = new Map<string, number>();
    const monthlyCOGS = new Map<string, number>();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = d.toISOString().slice(0, 7);
      monthlyRevenue.set(key, 0);
      monthlyCOGS.set(key, 0);
    }
    invoices.forEach((i) => {
      if (!i.issue_date) return;
      const key = i.issue_date.slice(0, 7);
      const entry = monthlyRevenue.get(key);
      if (entry !== undefined) monthlyRevenue.set(key, entry + Number(i.amount));
    });
    purchaseInvoices.forEach((p) => {
      if (!p.issue_date) return;
      const key = p.issue_date.slice(0, 7);
      const entry = monthlyCOGS.get(key);
      if (entry !== undefined) monthlyCOGS.set(key, entry + Number(p.amount));
    });

    // --- Recent alerts (last 8) ---
    const recentAlerts = alerts.sort((a: any, b: any) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 8);

    // --- Concentration: top debtors by outstanding ---
    const debtorExposure = new Map<string, { name: string; outstanding: number; count: number }>();
    openSales.forEach((i) => {
      const did = i.debtor_id;
      const name = debtorMap.get(did)?.name ?? "Unknown";
      const existing = debtorExposure.get(did) ?? { name, outstanding: 0, count: 0 };
      existing.outstanding += Number(i.amount);
      existing.count += 1;
      debtorExposure.set(did, existing);
    });
    const topDebtors = [...debtorExposure.values()].sort((a, b) => b.outstanding - a.outstanding);

    // --- Supplier exposure ---
    const vendorPayable = new Map<string, { name: string; amount: number; count: number }>();
    openPurchases.forEach((p) => {
      const vid = p.vendor_id;
      const name = vendorMap.get(vid)?.name ?? "Unknown";
      const existing = vendorPayable.get(vid) ?? { name, amount: 0, count: 0 };
      existing.amount += Number(p.amount);
      existing.count += 1;
      vendorPayable.set(vid, existing);
    });
    const topVendors = [...vendorPayable.values()].sort((a, b) => b.amount - a.amount);

    // --- Proformas count ---
    const openProformas = purchaseOrders.filter((po) => po.status !== "cancelled").length;

    // --- Collection rate ---
    const collectionRate = totalSalesAmount > 0 ? +((totalCollected / totalSalesAmount) * 100).toFixed(2) : 0;

    // --- Working capital gap ---
    const workingCapitalGap = avgSalesPayDays - avgPurchasePayDays;

    // --- Financial health score ---
    const netSales = totalSalesAmount - debitNoteTotal;
    const gross = netSales - totalPurchaseAmount + creditNoteTotal;
    const net = gross - totalExpenses;
    const netMargin = netSales > 0 ? (net / netSales) * 100 : 0;
    const overdueTotal = salesAging.b1 + salesAging.b2 + salesAging.b3 + salesAging.b4;
    const highRiskAmount = salesAging.b4;

    const profitabilityScore = netMargin > 20 ? 25 : netMargin > 10 ? 20 : netMargin > 0 ? 15 : netMargin > -10 ? 8 : 0;
    const cashFlowScore = avgSalesPayDays <= 30 ? 20 : avgSalesPayDays <= 45 ? 16 : avgSalesPayDays <= 60 ? 12 : avgSalesPayDays <= 90 ? 8 : 4;
    const arRatio = totalOutstanding > 0 && netSales > 0 ? totalOutstanding / netSales : 0;
    const receivablesScore = arRatio < 0.15 ? 20 : arRatio < 0.25 ? 16 : arRatio < 0.40 ? 12 : arRatio < 0.60 ? 8 : 4;
    const collectionsScore = collectionRate >= 95 ? 15 : collectionRate >= 85 ? 12 : collectionRate >= 70 ? 9 : collectionRate >= 50 ? 6 : 3;
    const wcGap = Math.abs(workingCapitalGap);
    const workingCapitalScore = wcGap <= 15 ? 10 : wcGap <= 30 ? 8 : wcGap <= 50 ? 6 : wcGap <= 70 ? 4 : 2;
    const overdueRatio = totalOutstanding > 0 ? highRiskAmount / totalOutstanding : 0;
    const riskScore = overdueRatio < 0.05 ? 10 : overdueRatio < 0.10 ? 8 : overdueRatio < 0.20 ? 6 : overdueRatio < 0.35 ? 4 : 2;
    const financialHealthScore = Math.min(100, profitabilityScore + cashFlowScore + receivablesScore + collectionsScore + workingCapitalScore + riskScore);

    // ── Step 4: Return compact payload ──
    res.json({
      // Core financials
      salesTotal: totalSalesAmount,
      purchaseTotal: totalPurchaseAmount,
      expenseTotal: totalExpenses,
      salesReturns: debitNoteTotal,
      creditNoteTotal,
      debitNoteTotal,
      netSales,
      netPurchases: totalPurchaseAmount - creditNoteTotal,
      gross,
      net,
      netMargin: +netMargin.toFixed(1),
      grossMargin: netSales > 0 ? +((gross / netSales) * 100).toFixed(1) : 0,
      expenseRatio: netSales > 0 ? +((totalExpenses / netSales) * 100).toFixed(1) : 0,

      // Receivables
      totalOutstanding,
      collectedAmount: totalCollected,
      openInvoiceCount: openSales.length,
      paidCount: paidSales.length,
      totalInvoices: invoices.length,
      totalShortPayment,
      shortPaidInvoices: shortPaidInvoices.map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        amount: i.amount,
        short_payment: i.short_payment,
        debtor_id: i.debtor_id,
        debtor_name: debtorMap.get(i.debtor_id)?.name ?? "Unknown",
      })),

      // Payment days
      avgSalesPayDays,
      avgPurchasePayDays,
      collectionRate,
      workingCapitalGap,

      // Aging
      aging: salesAging,
      overdueTotal,
      highRiskAmount,

      // Status counts
      invoiceStatusCounts: Object.fromEntries(invoiceStatusCounts),

      // Expenses by category
      expenseCategories: [...expenseByCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, amount]) => ({ category, amount })),

      // Purchases
      totalPayable,
      totalPaidOut,
      totalPurchaseInvoices: purchaseInvoices.length,
      openPurchaseCount: openPurchases.length,
      paidPurchaseCount: paidPurchases.length,

      // Monthly trend
      monthlyRevenue: [...monthlyRevenue.entries()].map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        amount,
      })),
      monthlyCOGS: [...monthlyCOGS.entries()].map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        amount,
      })),

      // Top counterparties
      topDebtors: topDebtors.slice(0, 8),
      topVendors: topVendors.slice(0, 8),

      // Health score
      financialHealthScore,
      profitabilityScore,
      cashFlowScore,
      receivablesScore,
      collectionsScore,
      workingCapitalScore,
      riskScore,

      // Counts
      debtorCount: debtors.length,
      vendorCount: vendors.length,
      supplierCount: suppliers.length,
      openProformas,

      // Advances
      salesAdvancesTotal,
      purchaseAdvancesTotal,

      // Alerts
      recentAlerts,
    });
  } catch (err) {
    console.error("Reports dashboard-summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
