import { Router, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { scanTable, TABLES } from "../db/client.js";
import { diffDaysUTC } from "../utils/helpers.js";
import type {
  Invoice, Debtor, Profile, PurchaseInvoice, Vendor,
  PurchaseOrder, Advance, Expense, CreditDebitNote, InventoryItem,
} from "../types/index.js";

const router = Router();

// ── Status filter helpers (mirrors frontend logic) ──
const SALES_OPEN_STATUSES = ["pending", "approved", "advanced", "overdue", "disputed"];
const SALES_CLOSED_STATUSES = ["funded", "paid"];
const PURCHASE_OPEN_STATUSES = ["pending", "approved", "advanced", "overdue", "disputed"];
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

// ── GET /api/reports/aging ── (buyer-wise)
router.get("/aging", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const [invoices, allDebtors] = await Promise.all([
      scanTable<Invoice>(TABLES.INVOICES),
      scanTable<Debtor>(TABLES.DEBTORS),
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
router.get("/debtors", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const [debtors, invoices] = await Promise.all([
      scanTable<Debtor>(TABLES.DEBTORS),
      scanTable<Invoice>(TABLES.INVOICES),
    ]);

    const SALES_OPEN = new Set(["pending", "approved", "advanced", "overdue", "disputed"]);
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
router.get("/suppliers", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    // NOTE: "Suppliers" on the frontend refers to the vendor list (vendors you buy from).
    // The legacy TABLES.SUPPLIERS contains factor-managed supplier data, not your actual suppliers.
    const vendors = await scanTable<Vendor>(TABLES.VENDORS);
    res.json(vendors.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
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

// ── P&L category mapping helpers ──

/** Categories that belong to Cost of Sales */
const COST_OF_SALES_CATEGORIES = new Set([
  "logistics-and-procurement-cost",
  "principal-cost",
  "referral-fees",
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

  const otherSalesIncome = 0;

  const salesReturns = creditDebitNotes
    .filter((n) => n.type === "credit" && n.linked_invoice_type === "sales" && isInRange(n.date))
    .reduce((sum, n) => sum + Number(n.amount), 0);

  const totalTurnover = grossSales + otherSalesIncome - salesReturns;

  // ── Cost of Sales ──
  const grossPurchases = purchaseInvoices
    .filter((pi) => isInRange(pi.issue_date))
    .reduce((sum, pi) => sum + Number(pi.amount), 0);

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

  const customsDuties = 0;
  const freightCharges = 0;
  const otherDirectCosts = 0;

  const totalCostOfSales =
    grossPurchases +
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
    salesReturns,
    totalTurnover,

    // Cost of Sales
    grossPurchases,
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

    const invoices = await scanTable<Invoice>(TABLES.INVOICES);

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
    const [invoices, purchaseInvoices, expenses, creditDebitNotes, advances] = await Promise.all([
      scanTable<Invoice>(TABLES.INVOICES),
      scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES),
      scanTable<Expense>(TABLES.EXPENSES),
      scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES),
      scanTable<Advance>(TABLES.ADVANCES),
    ]);

    const report = computePnL({ invoices, purchaseInvoices, expenses, creditDebitNotes, advances }, from, to);

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

// ── GET /api/reports/inventory-tracking ──
router.get("/inventory-tracking", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const items = await scanTable<InventoryItem>(TABLES.INVENTORY_ITEMS);
    const userItems = items
      .filter((i) => i.client_id === req.user!.id)
      .sort((a, b) => a.item.localeCompare(b.item));

    res.json(userItems);
  } catch (err) {
    console.error("Reports inventory-tracking error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
