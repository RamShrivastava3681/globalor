import { Router, Response, Request } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  updateItemConditional,
  deleteItem,
  scanTable,
  queryByIndex,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateNoaToken, generateDocNumber, nowISO } from "../utils/helpers.js";
import { generateMovementNumber } from "../utils/stock.js";
import { config } from "../config.js";
import { sendNoaEmail, sendReminderEmail } from "../utils/email.js";
import type { Invoice, InvoiceLine, Debtor, Profile, PurchaseInvoice, Vendor, DocMeta, GoodsSalesOrder, ReminderEntry } from "../types/index.js";
import type { StockMovement, MovementDirection } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";
import { getFileStream } from "../s3/client.js";
import { Readable } from "stream";

// ── Lazy-loading helpers for CJS modules in ESM context ──
let _PDFParseClass: any = null;
async function getPDFParse() {
  if (!_PDFParseClass) {
    const mod = await import("pdf-parse");
    _PDFParseClass = mod.PDFParse;
  }
  return _PDFParseClass;
}

let _tesseract: any = null;
async function getTesseract() {
  if (!_tesseract) {
    // tesseract.js v5+ has ESM support — use named import
    const mod = await import("tesseract.js");
    _tesseract = mod.default || mod;
  }
  return _tesseract;
}

/** Check if a file is a raster image that needs OCR */
function isImageFile(contentType: string | undefined, filePath: string): boolean {
  const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff", "image/webp"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"];
  if (contentType && imageTypes.some((t) => contentType.includes(t))) return true;
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  return imageExts.includes(ext);
}

const router = Router();

// ── GET /api/invoices/check-duplicates ── (find duplicate invoice numbers across sales & purchase invoices)
router.get("/check-duplicates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Scan both sales and purchase invoices
    const salesInvoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const purchaseInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));

    // Preload debtors, vendors, and profiles for enrichment
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!));
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    // Group all invoices by invoice_number
    const byNumber = new Map<string, Array<{
      type: "sales" | "purchase";
      id: string;
      invoice_number: string;
      amount: number;
      status: string;
      client_id: string;
      debtor_id?: string;
      vendor_id?: string;
      issue_date?: string;
      created_at?: string;
    }>>();

    for (const inv of salesInvoices) {
      const key = inv.invoice_number?.toLowerCase().trim();
      if (!key) continue;
      const entry = byNumber.get(key) || [];
      entry.push({
        type: "sales",
        id: inv.id,
        invoice_number: inv.invoice_number,
        amount: inv.amount,
        status: inv.status,
        client_id: inv.client_id,
        debtor_id: inv.debtor_id,
        issue_date: inv.issue_date,
        created_at: inv.created_at,
      });
      byNumber.set(key, entry);
    }

    for (const inv of purchaseInvoices) {
      const key = inv.invoice_number?.toLowerCase().trim();
      if (!key) continue;
      const entry = byNumber.get(key) || [];
      entry.push({
        type: "purchase",
        id: inv.id,
        invoice_number: inv.invoice_number,
        amount: inv.amount,
        status: inv.status,
        client_id: inv.client_id,
        vendor_id: inv.vendor_id,
        issue_date: inv.issue_date,
        created_at: inv.created_at,
      });
      byNumber.set(key, entry);
    }

    // Filter to only duplicates (invoice numbers that appear more than once)
    const duplicates: Array<{
      invoice_number: string;
      count: number;
      entries: Array<{
        type: "sales" | "purchase";
        id: string;
        invoice_number: string;
        amount: number;
        status: string;
        client?: { company_name?: string; contact_name?: string };
        debtor?: { name?: string };
        vendor?: { name?: string };
        issue_date?: string;
        created_at?: string;
      }>;
    }> = [];

    for (const [key, entries] of byNumber) {
      if (entries.length > 1) {
        duplicates.push({
          invoice_number: entries[0].invoice_number, // use the original casing
          count: entries.length,
          entries: entries.map((e) => ({
            ...e,
            client: profileMap.get(e.client_id)
              ? { company_name: profileMap.get(e.client_id)?.company_name, contact_name: profileMap.get(e.client_id)?.contact_name ?? undefined }
              : undefined,
            debtor: e.debtor_id ? debtorMap.get(e.debtor_id) : undefined,
            vendor: e.vendor_id ? vendorMap.get(e.vendor_id) : undefined,
          })),
        });
      }
    }

    res.json(duplicates);
  } catch (err) {
    console.error("Check duplicate invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices ── (paginated when page/limit provided, legacy array otherwise)
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

    const invoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));

    // Preload all debtors, profiles, vendors, and purchase invoices into lookup maps
    // to avoid N+1 GetItem calls during enrichment
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const allPurchaseInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const piMap = new Map(allPurchaseInvoices.map((pi) => [pi.id, pi]));

    // Fast synchronous enrichment function
    const enrichInv = (inv: Invoice) => {
      const debtor = inv.debtor_id ? debtorMap.get(inv.debtor_id) : undefined;
      const client = inv.client_id ? profileMap.get(inv.client_id) : undefined;
      let purchases: (PurchaseInvoice & { vendor?: Vendor })[] | undefined;
      if (inv.purchase_invoice_ids && inv.purchase_invoice_ids.length > 0) {
        purchases = inv.purchase_invoice_ids
          .filter((piId): piId is string => !!piId)
          .map((piId) => {
            const pi = piMap.get(piId);
            if (pi && (pi as any).vendor_id) {
              return { ...pi, vendor: vendorMap.get((pi as any).vendor_id) } as PurchaseInvoice & { vendor?: Vendor };
            }
            return pi;
          })
          .filter(Boolean) as (PurchaseInvoice & { vendor?: Vendor })[];
      }
      return { ...inv, debtor, client, purchases };
    };

    // Server-side search filtering (including debtor name and visible UID)
    const searchQuery = (req.query.search as string || "").toLowerCase().trim();
    let filteredInvoices = invoices;
    if (searchQuery) {
      filteredInvoices = invoices.filter((inv) => {
        const q = searchQuery;
        const debtorName = (debtorMap.get(inv.debtor_id)?.name ?? "").toLowerCase();
        const visibleUid = inv.id.slice(-8).toLowerCase();
        return (
          inv.invoice_number?.toLowerCase().includes(q) ||
          inv.po_number?.toLowerCase().includes(q) ||
          inv.status?.toLowerCase().includes(q) ||
          inv.id.toLowerCase().includes(q) ||
          visibleUid.includes(q) ||
          debtorName.includes(q)
        );
      });
    }

    // Status filter (all / open / close)
    const statusFilter = (req.query.filter as string) || "all";
    if (statusFilter === "open") {
      filteredInvoices = filteredInvoices.filter((inv) => inv.status === "draft" || inv.status === "submitted" || inv.status === "approved");
    } else if (statusFilter === "close") {
      filteredInvoices = filteredInvoices.filter((inv) => inv.status === "funded" || inv.status === "paid");
    }

    // Date range filter
    const issueDateFrom = req.query.issueDateFrom as string | undefined;
    const issueDateTo = req.query.issueDateTo as string | undefined;
    if (issueDateFrom) {
      filteredInvoices = filteredInvoices.filter((inv) => inv.issue_date && inv.issue_date >= issueDateFrom);
    }
    if (issueDateTo) {
      filteredInvoices = filteredInvoices.filter((inv) => inv.issue_date && inv.issue_date <= issueDateTo);
    }

    // Server-side sorting
    const sortOrder = req.query.sort === "asc" ? 1 : -1;
    const sortField = (req.query.sortField as string) || "created";
    filteredInvoices.sort((a, b) => {
      let aVal: string, bVal: string;
      if (sortField === "issue") {
        aVal = a.issue_date ?? "9999";
        bVal = b.issue_date ?? "9999";
      } else if (sortField === "due") {
        aVal = a.due_date ?? "9999";
        bVal = b.due_date ?? "9999";
      } else {
        aVal = a.created_at ?? "";
        bVal = b.created_at ?? "";
      }
      return sortOrder * aVal.localeCompare(bVal);
    });

    // Pagination params (only used when explicitly provided)
    if (hasPagination) {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));

      const total = filteredInvoices.length;
      const totalPages = Math.ceil(total / limit);
      const startIdx = (page - 1) * limit;
      const pageItems = filteredInvoices.slice(startIdx, startIdx + limit);

      const enriched = pageItems.map(enrichInv);
      res.json({ data: enriched, total, page, limit, totalPages });
    } else if (searchQuery) {
      const enriched = filteredInvoices.map(enrichInv);
      res.json(enriched);
    } else {
      // Legacy mode: return all invoices enriched (for admin/checker/dashboard pages)
      const enriched = invoices.map(enrichInv);
      res.json(enriched);
    }
  } catch (err) {
    console.error("Get invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/mini ── (minimal list for dropdowns)
router.get("/mini", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const sortOrder = req.query.sort === "asc" ? 1 : -1;
    res.json(
      invoices
        .sort((a, b) => sortOrder * ((a.created_at || "").localeCompare(b.created_at || "")) )
        .map((i) => ({ id: i.id, invoice_number: i.invoice_number, amount: i.amount })),
    );
  } catch (err) {
    console.error("Get invoices mini error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/by-purchase/:purchaseInvoiceId ──
router.get("/by-purchase/:purchaseInvoiceId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: req.params.purchaseInvoiceId }) as PurchaseInvoice | undefined;
    if (!pi || !pi.linked_sales_invoice_ids || pi.linked_sales_invoice_ids.length === 0) {
      res.json([]);
      return;
    }

    const invoices = await Promise.all(
      pi.linked_sales_invoice_ids.map(async (invId) => {
        const inv = await getItem(TABLES.INVOICES, { id: invId }) as Invoice | undefined;
        if (!inv) return null;
        const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          amount: inv.amount,
          status: inv.status,
          debtor: debtor ? { name: debtor.name } : undefined,
        };
      }),
    );

    res.json(invoices.filter(Boolean));
  } catch (err) {
    console.error("Get invoices by purchase error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices ──
const createInvoiceSchema = z.object({
  debtor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number(),
  advance_rate: z.number().min(0).max(100).optional().default(0),
  fee_rate: z.number().min(0).optional().default(0),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  purchase_invoice_ids: z.array(z.string()).optional().default([]),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
});

// ── POST /api/invoices/from-so ── (goods invoice from a confirmed sales order)
// Billing after dispatch: every line is validated against the live SO and the
// invoice NEVER reduces stock — only a confirmed dispatch does.
const fromSoLineSchema = z.object({
  product_id: z.string().nullable().optional(),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  unit: z.string().max(40).optional().default("unit"),
  quantity: z.number().positive("Quantity must be > 0"),
  unit_price: z.number().min(0, "Unit price must be >= 0"),
  discount_pct: z.number().min(0).max(100).optional().default(0),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
});

const fromSoSchema = z.object({
  goods_sales_order_id: z.string().min(1),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).max(365).optional().default(30),
  /** Agreed funding advance % — used with received advances for the deduction. */
  advance_rate: z.number().min(0).max(100).optional().default(0),
  freight: z.number().min(0).nullable().optional().default(0),
  /** Customer proforma reference — advances against it are deducted. */
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
  lines: z.array(fromSoLineSchema).min(1, "Add at least one line"),
});

const CONFIRMED_SO_STATUSES = ["confirmed", "partially_dispatched", "fully_dispatched"];

router.post("/from-so", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = fromSoSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const noa_token = generateNoaToken();

    // 1. The SO must exist, be in-scope, and be CONFIRMED (or beyond).
    const so = await getItem(TABLES.GOODS_SALES_ORDERS, { id: parsed.goods_sales_order_id }) as GoodsSalesOrder | undefined;
    if (!so) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && so.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (!CONFIRMED_SO_STATUSES.includes(so.status)) {
      res.status(400).json({ error: `Only confirmed sales orders can be invoiced (current: ${so.status})` });
      return;
    }
    if (!so.customer_id) {
      res.status(400).json({ error: "This sales order has no customer — assign a debtor before invoicing" });
      return;
    }

    // 2. Every line must be on the SO and within the ordered quantity — and the
    //    same goods can't be billed twice: sum what invoices linked to this SO
    //    already billed per line, so re-invoicing can't exceed ordered qty.
    const linkedInvoices = await scanTable<any>(TABLES.INVOICES, {
      filterExpression: "goods_sales_order_id = :soid",
      expressionAttributeValues: { ":soid": so.id },
    });
    const invoicedByLine = new Map<string, number>();
    for (const inv of linkedInvoices) {
      for (const l of (inv.lines ?? []) as any[]) {
        const key = l.sku || l.name || "";
        invoicedByLine.set(key, (invoicedByLine.get(key) ?? 0) + Number(l.quantity || 0));
      }
    }
    for (const line of parsed.lines) {
      const soLine = so.lines.find((l) => l.sku === line.sku || l.name === line.name);
      if (!soLine) {
        res.status(400).json({ error: `"${line.name}" is not on sales order ${so.so_number}` });
        return;
      }
      const alreadyInvoiced = invoicedByLine.get(line.sku || line.name) ?? 0;
      if (line.quantity + alreadyInvoiced > soLine.ordered_qty) {
        const remaining = Math.max(0, soLine.ordered_qty - alreadyInvoiced);
        res.status(400).json({ error: `Quantity on "${line.name}" (${line.quantity}) exceeds the remaining orderable quantity (${remaining}) — ${alreadyInvoiced} already invoiced against ${so.so_number}` });
        return;
      }
    }

    // 3. Totals (money rounded to 2dp).
    let subtotal = 0, totalDiscount = 0, gstTotal = 0;
    const lines: InvoiceLine[] = parsed.lines.map((l) => {
      const gross = Number(l.quantity) * Number(l.unit_price);
      const lineDiscount = (gross * Math.min(100, Math.max(0, l.discount_pct))) / 100;
      subtotal += gross;
      totalDiscount += lineDiscount;
      gstTotal += ((gross - lineDiscount) * (Number(l.gst_rate) || 0)) / 100;
      return {
        product_id: l.product_id ?? null,
        sku: l.sku,
        name: l.name,
        unit: l.unit || "unit",
        quantity: l.quantity,
        unit_price: Math.round(l.unit_price * 100) / 100,
        discount_pct: l.discount_pct,
        gst_rate: l.gst_rate ?? null,
        line_total: Math.round((gross - lineDiscount) * 100) / 100,
      };
    });
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const grandTotal = round2(subtotal - totalDiscount + gstTotal + (parsed.freight ?? 0));

    // 4. Advance deduction — computed server-side, never trusted from the client.
    // deduct = max(advances actually applied to THIS invoice,
    //             remaining agreed advance % across the linked proformas).
    // Each mechanism is consumed ONLY for what this invoice actually uses:
    //  (a) received advances — applied one-by-one in date order; an advance is
    //      applied only when it fits entirely within the deduction, so a lump
    //      sum larger than the invoice stays OPEN for a later invoice (advance
    //      value is never destroyed and never double-counted), and
    //  (b) the agreed advance % — tracked per proforma (`advance_deducted`),
    //      so a second invoice against the same proforma can't deduct it twice.
    const salesProformas: any[] = [];
    const openAdvances: any[] = [];
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      // Company-scoped: a client's proforma number must never match another
      // company's proforma (tenant isolation).
      const matched = orders.filter(
        (o: any) => o.side === "sales" && (!req.user!.company_id || o.company_id === req.user!.company_id)
      );
      salesProformas.push(...matched);
      for (const pf of matched) {
        const advs = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid AND #status = :status",
          expressionAttributeNames: { "#status": "status" },
          expressionAttributeValues: { ":poid": pf.id, ":status": "open" },
        });
        openAdvances.push(...advs);
      }
    }
    openAdvances.sort((a: any, b: any) => (a.advance_date || "").localeCompare(b.advance_date || ""));
    // (a) The advances this invoice can actually consume — greedy in date
    //     order, skipping any advance larger than the remaining deduction.
    let appliable = 0;
    for (const adv of openAdvances) {
      const remaining = round2(grandTotal - appliable);
      if (remaining <= 0) break;
      const amount = Number(adv.amount || 0);
      if (amount > 0 && amount <= remaining) appliable = round2(appliable + amount);
    }
    // (b) Remaining agreed allowance: Σ per proforma max(0, amount × rate% − used).
    const agreedAllowance = salesProformas.reduce((s, pf) => {
      const pfTotal = Number(pf.amount || 0);
      const used = Number(pf.advance_deducted ?? 0);
      const allowance = pfTotal > 0 ? (pfTotal * parsed.advance_rate) / 100 : 0;
      return s + Math.max(0, allowance - used);
    }, 0);
    const advanceDeducted = round2(Math.min(grandTotal, Math.max(appliable, agreedAllowance)));
    const netReceivable = round2(grandTotal - advanceDeducted);
    // How much of the deduction is backed by real received advances vs the
    // agreed allowance (the part charged to the per-proforma ledger).
    const fromReceived = round2(Math.min(advanceDeducted, appliable));
    const fromAgreed = round2(advanceDeducted - fromReceived);

    // 5. Create the invoice — `amount` is the NET receivable (what funding reads).
    const invoice: Invoice = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: so.customer_id,
      supplier_id: null,
      invoice_number: generateDocNumber("INV"),
      amount: netReceivable,
      advance_rate: parsed.advance_rate,
      fee_rate: 0,
      amount_received: null,
      issue_date: parsed.issue_date,
      due_date: parsed.due_date || null,
      paid_date: null,
      receipt_date: null,
      advance_received_date: null,
      short_payment: null,
      late_days: null,
      paid_note: null,
      status: "draft",
      payment_type: "manual_pay",
      noa_status: "not_sent",
      noa_token,
      noa_sent_at: null,
      noa_responded_at: null,
      noa_comments: null,
      last_overdue_reminder_date: null,
      reminder_log: [],
      po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      purchase_invoice_ids: [],
      purchase_order_id: null,
      payment_terms_days: parsed.payment_terms_days,
      bl_date: null,
      due_date_source: "invoice",
      has_contractual_due_date: false,
      goods_sales_order_id: so.id,
      goods_sales_order_number: so.so_number,
      lines,
      subtotal_goods: round2(subtotal),
      total_discount: round2(totalDiscount),
      gst_total: round2(gstTotal),
      freight: parsed.freight ?? null,
      grand_total: grandTotal,
      advance_deducted: advanceDeducted,
      net_receivable: netReceivable,
      customer_contact: so.contact_person,
      billing_address: so.billing_address,
      delivery_address: so.delivery_address,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    // 6. Apply the received advances that back this deduction BEFORE the
    //    invoice is written, so a concurrent invoice can never claim the same
    //    advance twice. An advance is applied only when it fits entirely
    //    (oversized lump sums stay open for a later invoice). If any expected
    //    application fails (someone else claimed it first) the advances
    //    already applied are rolled back and the request is rejected — no
    //    invoice, no lost advance value.
    const appliedAdvanceIds: string[] = [];
    const rollbackAppliedAdvances = async () => {
      for (const advId of appliedAdvanceIds) {
        // Conditional reverse — never clobber an advance that a concurrent
        // invoice may have already claimed.
        await updateItemConditional(
          TABLES.ADVANCES,
          { id: advId },
          { status: "open", invoice_id: null, updated_at: now },
          "#status = :applied",
          { "#status": "status" },
          { ":applied": "applied" },
        );
      }
    };
    let toApply = fromReceived;
    for (const adv of openAdvances) {
      if (toApply <= 0) break;
      const amount = Number(adv.amount || 0);
      if (amount <= 0 || amount > toApply) continue; // oversized → stays open
      const applied = await updateItemConditional(
        TABLES.ADVANCES,
        { id: adv.id },
        { status: "applied", invoice_id: id, updated_at: now },
        "#status = :expected",
        { "#status": "status" },
        { ":expected": "open" },
      );
      if (!applied) {
        await rollbackAppliedAdvances();
        res.status(409).json({ error: "An advance was already applied by another invoice — refresh and retry" });
        return;
      }
      appliedAdvanceIds.push(adv.id);
      toApply = round2(toApply - amount);
    }

    // 7. Charge the agreed-allowance portion to the proforma ledger BEFORE the
    //    invoice is written, so two concurrent invoices can't both deduct the
    //    same agreed % — the conditional guard means only one wins; the loser
    //    rolls its advances back and is rejected with 409.
    let toConsume = fromAgreed;
    for (const pf of salesProformas) {
      if (toConsume <= 0) break;
      const pfTotal = Number(pf.amount || 0);
      if (pfTotal <= 0) continue;
      const allowance = (pfTotal * parsed.advance_rate) / 100;
      const used = Number(pf.advance_deducted ?? 0);
      const consume = round2(Math.min(toConsume, Math.max(0, allowance - used)));
      if (consume <= 0) continue;
      const consumed = await updateItemConditional(
        TABLES.PURCHASE_ORDERS,
        { id: pf.id },
        { advance_deducted: round2(used + consume), updated_at: now },
        "(attribute_not_exists(#ad) OR #ad = :used)",
        { "#ad": "advance_deducted" },
        { ":used": used },
      );
      if (!consumed) {
        await rollbackAppliedAdvances();
        res.status(409).json({ error: "Another invoice already claimed this proforma's advance — refresh and retry" });
        return;
      }
      toConsume = round2(toConsume - consume);
    }

    await putItem(TABLES.INVOICES, invoice as any);

    // No stock movements — only a confirmed dispatch debits inventory.

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: so.customer_id,
      invoice_id: id,
      type: "invoice_created",
      severity: "info",
      message: `Invoice ${invoice.invoice_number} created from ${so.so_number} — goods $${grandTotal.toLocaleString()}, net $${netReceivable.toLocaleString()} after $${advanceDeducted.toLocaleString()} advance`,
      created_by: req.user!.id,
    });

    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create invoice from SO error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createInvoiceSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const noa_token = generateNoaToken();

    const termsDays = parsed.payment_terms_days;
    const dueDate = parsed.due_date !== null
      ? (parsed.due_date || (() => {
          const base = parsed.due_date_source === "bl" && parsed.bl_date ? new Date(parsed.bl_date) : new Date(parsed.issue_date);
          const d = new Date(base);
          d.setDate(d.getDate() + termsDays);
          return d.toISOString().slice(0, 10);
        })())
      : null;

    const invoice: Invoice = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: parsed.debtor_id,
      supplier_id: null,
      invoice_number: parsed.invoice_number,
      amount: parsed.amount,
      advance_rate: parsed.advance_rate,
      fee_rate: parsed.fee_rate,
      amount_received: null,
      issue_date: parsed.issue_date,
      due_date: dueDate,
      paid_date: null,
      receipt_date: null,
      advance_received_date: null,
      short_payment: null,
      late_days: null,
      paid_note: null,
      status: "draft",
      payment_type: "manual_pay",          noa_status: "not_sent",
          noa_token,
          noa_sent_at: null,
          noa_responded_at: null,
          noa_comments: null,
          last_overdue_reminder_date: null,
          reminder_log: [],
          po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      purchase_invoice_ids: parsed.purchase_invoice_ids || [],
      purchase_order_id: null,
      payment_terms_days: parsed.payment_terms_days,
      bl_date: parsed.bl_date || null,
      due_date_source: parsed.due_date_source,
      has_contractual_due_date: parsed.has_contractual_due_date,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.INVOICES, invoice as any);

    // Link open advances to this invoice and mark as applied
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      const salesOrders = orders.filter((o: any) => o.side === "sales");
      for (const po of salesOrders) {
        const advances = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid AND #status = :status",
          expressionAttributeNames: { "#status": "status" },
          expressionAttributeValues: { ":poid": po.id, ":status": "open" },
        });
        for (const adv of advances) {
          await updateItem(TABLES.ADVANCES, { id: adv.id }, { status: "applied", invoice_id: id });
        }
      }
    }

    // Create inventory movements if enabled
    if (parsed.inventory_items && parsed.inventory_items.length > 0) {
      for (const item of parsed.inventory_items) {
        const movement: StockMovement = {
          id: generateId(),
          client_id: req.user!.id,
          company_id: req.user!.company_id,
          direction: "out",
          item_name: item.item_name,
          sku: item.sku || null,
          quantity: item.quantity,
          unit: item.unit || "unit",
          unit_cost: item.unit_cost || null,
          notes: null,
          invoice_id: id,
          purchase_invoice_id: null,
          movement_date: parsed.issue_date,
          product_id: null,
          status: "confirmed",
          reason: "sale",
          warehouse: null,
          movement_number: generateMovementNumber(),
          linked_document_type: "Invoice",
          linked_document_number: parsed.invoice_number,
          is_system: true,
          created_by: req.user!.id,
          confirmed_by: req.user!.id,
          confirmed_at: now,
          created_at: now,
          updated_at: now,
        };
        await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      }
    }

    // Create activity alert
    const debtor = await getItem(TABLES.DEBTORS, { id: parsed.debtor_id }) as Debtor | undefined;
    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: parsed.debtor_id,
      invoice_id: id,
      type: "invoice_created",
      severity: "info",
      message: `Invoice ${parsed.invoice_number} created for $${parsed.amount.toLocaleString()}${debtor ? ` — ${debtor.name}` : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/:id ── (single enriched invoice)
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const debtor = invoice.debtor_id ? await getItem(TABLES.DEBTORS, { id: invoice.debtor_id }) as Debtor | undefined : undefined;
    const client = invoice.client_id ? await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined : undefined;
    const salesOrder = invoice.goods_sales_order_id
      ? await getItem(TABLES.GOODS_SALES_ORDERS, { id: invoice.goods_sales_order_id }) as GoodsSalesOrder | undefined
      : undefined;
    let purchases: (PurchaseInvoice & { vendor?: Vendor })[] | undefined;
    if (invoice.purchase_invoice_ids && invoice.purchase_invoice_ids.length > 0) {
      const results = await Promise.all(
        invoice.purchase_invoice_ids.map(async (piId) => {
          if (!piId) return null;
          const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: piId }) as PurchaseInvoice | undefined;
          if (pi?.vendor_id) {
            (pi as any).vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as Vendor | undefined;
          }
          return pi;
        }),
      );
      purchases = results.filter(Boolean) as (PurchaseInvoice & { vendor?: Vendor })[];
    }

    res.json({ ...invoice, debtor, client, purchases, sales_order: salesOrder });
  } catch (err) {
    console.error("Get invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/:id/submit ── (draft → submitted, sends to checker)
router.post("/:id/submit", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: `Cannot submit invoice with status "${invoice.status}". Only draft invoices can be submitted.` });
      return;
    }

    // SO-linked invoices stay honest: the linked sales order must still be live.
    if (invoice.goods_sales_order_id) {
      const so = await getItem(TABLES.GOODS_SALES_ORDERS, { id: invoice.goods_sales_order_id }) as GoodsSalesOrder | undefined;
      if (!so || (so.status !== "confirmed" && so.status !== "partially_dispatched" && so.status !== "fully_dispatched")) {
        res.status(400).json({ error: "This invoice is linked to a sales order that is no longer open for invoicing" });
        return;
      }
    }

    const updated = await updateItem(TABLES.INVOICES, { id: req.params.id }, {
      status: "submitted",
      updated_at: nowISO(),
    });

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: invoice.debtor_id,
      invoice_id: invoice.id,
      type: "invoice_created",
      severity: "info",
      message: `Invoice ${invoice.invoice_number} submitted for checker review — $${invoice.amount.toLocaleString()}`,
      created_by: req.user!.id,
    });

    res.json(updated);
  } catch (err) {
    console.error("Submit invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/invoices/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.INVOICES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/invoices/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.INVOICES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/bulk-delete ──
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

router.post("/bulk-delete", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = bulkDeleteSchema.parse(req.body);
    const deleted: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of parsed.ids) {
      try {
        await deleteItem(TABLES.INVOICES, { id });
        deleted.push(id);
      } catch (err) {
        errors.push({ id, error: "Failed to delete" });
        console.error(`Bulk delete error for invoice ${id}:`, err);
      }
    }

    res.json({ deleted, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Bulk delete invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/batch ── (mass import from Excel)
const batchInvoiceSchema = z.object({
  debtor_id: z.string().min(1),
  payment_terms_days: z.number().min(0).optional().default(30),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  bl_date: z.string().nullable().optional(),
  has_contractual_due_date: z.boolean().optional().default(false),
  po_number: z.string().max(80).nullable().optional().default(null),
  po_date: z.string().nullable().optional().default(null),
  advance_rate: z.number().min(0).max(100).optional().default(0),
  fee_rate: z.number().min(0).optional().default(0),
  invoices: z.array(z.object({
    invoice_number: z.string().min(1).max(80),
    amount: z.number(),
    issue_date: z.string().min(1),
  })).min(1),
});

router.post("/batch", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchInvoiceSchema.parse(req.body);
    const now = nowISO();
    const created: Invoice[] = [];
    const errors: Array<{ invoice_number: string; error: string }> = [];

    // Build all invoice objects first
    const invoicesToCreate: Invoice[] = [];
    for (const item of parsed.invoices) {
      try {
        const id = generateId();
        const noa_token = generateNoaToken();

        const termsDays = parsed.payment_terms_days;
        const baseDate = parsed.due_date_source === "bl" && parsed.bl_date
          ? new Date(parsed.bl_date)
          : new Date(item.issue_date);
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + termsDays);

        const invoice: Invoice = {
          id,
          client_id: req.user!.id,
          company_id: req.user!.company_id,
          debtor_id: parsed.debtor_id,
          supplier_id: null,
          invoice_number: item.invoice_number,
          amount: item.amount,
          advance_rate: parsed.advance_rate,
          fee_rate: parsed.fee_rate,
          amount_received: null,
          issue_date: item.issue_date,
          due_date: dueDate.toISOString().slice(0, 10),
          paid_date: null,
          receipt_date: null,
          advance_received_date: null,
          short_payment: null,
          late_days: null,
          paid_note: null,
          status: "draft",
          payment_type: "mass_upload",
      noa_status: "not_sent",
      noa_token,
      noa_sent_at: null,
      noa_responded_at: null,
      noa_comments: null,
      last_overdue_reminder_date: null,
      reminder_log: [],
      po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      purchase_invoice_ids: [],
          purchase_order_id: null,
          payment_terms_days: parsed.payment_terms_days,
          bl_date: parsed.bl_date || null,
          due_date_source: parsed.due_date_source,
          has_contractual_due_date: parsed.has_contractual_due_date,
          documents: [],
          created_at: now,
          updated_at: now,
        };

        invoicesToCreate.push(invoice);
      } catch (err) {
        errors.push({ invoice_number: item.invoice_number, error: "Invalid invoice data" });
        console.error(`Batch build error for ${item.invoice_number}:`, err);
      }
    }

    // Write all invoices in batches of 25 using BatchWriteCommand
    if (invoicesToCreate.length > 0) {
      const dbItems = invoicesToCreate.map((inv) => inv as unknown as Record<string, unknown>);
      try {
        await batchPutItems(TABLES.INVOICES, dbItems);
        created.push(...invoicesToCreate);
      } catch (err) {
        console.error("Batch write failed, falling back to individual writes:", err);
        // Fallback: write individually with timeout resilience
        for (const inv of invoicesToCreate) {
          try {
            await putItem(TABLES.INVOICES, inv as any);
            created.push(inv);
          } catch (innerErr) {
            errors.push({ invoice_number: inv.invoice_number, error: "Failed to create" });
            console.error(`Batch fallback error for ${inv.invoice_number}:`, innerErr);
          }
        }
      }
    }

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: parsed.debtor_id,
      type: "invoice_created",
      severity: "info",
      message: `Batch imported ${created.length} invoice${created.length !== 1 ? "s" : ""}${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json({ created, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/batch-close ── (mass close from funding queue)
const batchCloseSchema = z.object({
  paid_note: z.string().nullable().optional().default(null),
  items: z.array(z.object({
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
    paid_note: z.string().nullable().optional().default(null),
  })).min(1),
});

router.post("/batch-close", requireAuth, requireWriteAccess("funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCloseSchema.parse(req.body);
    const now = nowISO();

    // Scan all invoices and build lookup by invoice_number
    const allInvoices = await scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const invoiceByNumber = new Map<string, Invoice>();
    for (const inv of allInvoices) {
      invoiceByNumber.set(inv.invoice_number, inv);
    }

    const eligibleStatuses = new Set(["approved", "funded", "advanced", "overdue"]);
    const closed: Array<{ invoice_number: string; amount_received: number; short_payment: number; late_days: number }> = [];
    const not_found: string[] = [];
    const errors: Array<{ invoice_number: string; error: string }> = [];

    for (const item of parsed.items) {
      try {
        const invoice = invoiceByNumber.get(item.invoice_number);
        if (!invoice) {
          not_found.push(item.invoice_number);
          continue;
        }

        if (!eligibleStatuses.has(invoice.status)) {
          errors.push({ invoice_number: item.invoice_number, error: `Invoice status is "${invoice.status}", cannot close` });
          continue;
        }

        const amount = Number(invoice.amount);
        const amountReceived = Number(item.amount_received);
        const shortPayment = Math.max(0, +(amount - amountReceived).toFixed(2));
        const lateDays = invoice.due_date
          ? Math.max(0, Math.round((new Date(item.date_received).getTime() - new Date(invoice.due_date).getTime()) / 86400000))
          : 0;

        const note = item.paid_note || parsed.paid_note || null;
        const updateFields: Record<string, any> = {
          status: "paid",
          paid_date: item.date_received,
          receipt_date: item.date_received,
          amount_received: amountReceived,
          short_payment: shortPayment,
          late_days: lateDays,
          paid_note: note,
          payment_type: "treasury_pay",
          updated_at: now,
        };

        await updateItem(TABLES.INVOICES, { id: invoice.id }, updateFields);

        closed.push({
          invoice_number: item.invoice_number,
          amount_received: amountReceived,
          short_payment: shortPayment,
          late_days: lateDays,
        });
      } catch (err) {
        console.error(`Batch close error for ${item.invoice_number}:`, err);
        errors.push({ invoice_number: item.invoice_number, error: "Failed to close" });
      }
    }

    res.json({ closed, not_found, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch close invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/bulk-pay ── (mark invoices as paid from debtor bulk payment modal)
const bulkPaySchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
  })).min(1),
});

router.post("/bulk-pay", requireAuth, requireAnyWriteAccess("invoices", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = bulkPaySchema.parse(req.body);
    const now = nowISO();

    const eligibleStatuses = new Set(["pending", "approved", "funded", "advanced", "overdue"]);
    const paid: Array<{ id: string; invoice_number: string; amount_received: number; short_payment: number; late_days: number }> = [];
    const not_found: string[] = [];
    const errors: Array<{ id: string; invoice_number: string; error: string }> = [];

    for (const item of parsed.items) {
      try {
        const invoice = await getItem(TABLES.INVOICES, { id: item.id }) as Invoice | undefined;
        if (!invoice) {
          not_found.push(item.invoice_number);
          continue;
        }

        if (!eligibleStatuses.has(invoice.status)) {
          errors.push({ id: item.id, invoice_number: item.invoice_number, error: `Invoice status is "${invoice.status}", cannot pay` });
          continue;
        }

        const amount = Number(invoice.amount);
        const amountReceived = Number(item.amount_received);
        const shortPayment = Math.max(0, +(amount - amountReceived).toFixed(2));
        const lateDays = invoice.due_date
          ? Math.max(0, Math.round((new Date(item.date_received).getTime() - new Date(invoice.due_date).getTime()) / 86400000))
          : 0;

        const updateFields: Record<string, any> = {
          status: "paid",
          paid_date: item.date_received,
          receipt_date: item.date_received,
          amount_received: amountReceived,
          short_payment: shortPayment,
          late_days: lateDays,
          payment_type: "bulk_pay",
          updated_at: now,
        };

        await updateItem(TABLES.INVOICES, { id: item.id }, updateFields);

        paid.push({
          id: item.id,
          invoice_number: item.invoice_number,
          amount_received: amountReceived,
          short_payment: shortPayment,
          late_days: lateDays,
        });
      } catch (err) {
        console.error(`Bulk pay error for ${item.invoice_number}:`, err);
        errors.push({ id: item.id, invoice_number: item.invoice_number, error: "Failed to mark as paid" });
      }
    }

    res.json({ paid, not_found, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Bulk pay invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/parse-invoice ── (parse uploaded PDF invoice and extract fields)
router.post("/parse-invoice", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { filePath } = z.object({
      filePath: z.string().min(1),
    }).parse(req.body);

    // Download the file from S3
    const s3Response = await getFileStream(filePath);
    if (!s3Response.Body) {
      res.status(404).json({ error: "File not found in storage" });
      return;
    }

    // Convert the S3 stream to a Buffer
    const stream = s3Response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    // ── Extract text: PDF → pdf-parse, Image → Tesseract OCR, else raw UTF-8 ──
    let extractedText = "";
    const contentType = s3Response.ContentType || "";
    const isPdf = contentType.includes("pdf") || filePath.endsWith(".pdf");
    const isImage = !isPdf && isImageFile(contentType, filePath);

    if (isPdf) {
      const PDFParseClass = await getPDFParse();
      const parser = new PDFParseClass({ data: fileBuffer });
      try {
        const result = await parser.getText();
        extractedText = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (isImage) {
      console.log(`   🔍 Running OCR on image: ${filePath} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);
      const Tesseract = await getTesseract();
      const { data } = await Tesseract.recognize(fileBuffer, "eng", {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            // Log progress every ~25%
            if (m.progress !== undefined && Math.round(m.progress * 4) !== Math.round((m.progress - 0.01) * 4)) {
              console.log(`   ⏳ OCR progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        },
      });
      extractedText = data.text || "";
      console.log(`   ✅ OCR complete — extracted ${extractedText.length} characters`);
    } else {
      // For non-PDF, non-image files, try to interpret as text
      extractedText = fileBuffer.toString("utf-8");
    }

    if (!extractedText.trim()) {
      res.status(400).json({ error: "Could not extract any text from the file. Please ensure the file contains selectable text or a clear image." });
      return;
    }

    // ── Parse invoice fields using regex patterns ──

    // Helper: find first match with cleanup
    const findField = (patterns: RegExp[], normalize?: (s: string) => string): string | null => {
      for (const pattern of patterns) {
        const match = extractedText.match(pattern);
        if (match?.[1]?.trim()) {
          let val = match[1].trim();
          if (normalize) val = normalize(val);
          return val || null;
        }
      }
      return null;
    };

    // Helper: find amount (remove currency symbols and commas)
    const findAmount = (patterns: RegExp[]): number | null => {
      const raw = findField(patterns, (s) => s.replace(/[$,€£\s]/g, ""));
      if (!raw) return null;
      const num = parseFloat(raw);
      return isNaN(num) ? null : num;
    };

    // ── Invoice number ──
    const invoiceNumber = findField([
      /(?:Invoice\s*(?:No|Number|#|№)\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-._]{2,50})/i,
      /(?:INV\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-._]{2,50})/i,
      /Invoice\s+#?\s*(\S{3,50})/i,
      /(?:INVOICE\s+N[O0]\s*[:.]?\s*)(\S+)/i,
    ]);

    // ── Invoice amount ──
    const amount = findAmount([
      /(?:Total\s*(?:Amount|Due|Invoice|)\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:Amount\s*(?:Due|Payable|Total)?\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:Grand\s*Total\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:Balance\s*(?:Due)?\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:TOTAL\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      /(?:Net\s*Total\s*[:.]?\s*)[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    ]);

    // ── Issue date ──
    const issueDate = findField([
      /(?:Invoice\s*Date\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
      /(?:Date\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
      /(?:Issue\s*Date\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
    ]);

    // ── Due date ──
    const dueDate = findField([
      /(?:Due\s*Date\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
      /(?:Payment\s*Due\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
      /(?:Due\s*By\s*[:.]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i,
    ]);

    // ── PO Number ──
    const poNumber = findField([
      /(?:PO\s*(?:Number|#|No)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-._]{2,30})/i,
      /(?:Purchase\s*Order\s*(?:Number|#|No)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-._]{2,30})/i,
      /(?:Order\s*(?:Number|#|No)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-._]{2,30})/i,
    ]);

    // ── Debtor / Bill-To company name ──
    let debtorName = findField([
      /(?:Bill\s*To\s*[:.]?\s*)\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,60})/i,
      /(?:Ship\s*To\s*[:.]?\s*)\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,60})/i,
      /(?:Customer\s*[:.]?\s*)\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,60})/i,
      /(?:Client\s*[:.]?\s*)\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,60})/i,
      /(?:Sold\s*To\s*[:.]?\s*)\n?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,60})/i,
    ]);

    // ── Debtor address (lines after company name) ──
    let debtorAddress = null;
    if (debtorName) {
      const escName = debtorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const addrPattern = new RegExp(`${escName}\\s*\\n\\s*([A-Za-z0-9\\s,.#'-]{5,100})`, 'i');
      const addrMatch = extractedText.match(addrPattern);
      if (addrMatch) {
        debtorAddress = addrMatch[1].trim();
      }
    }

    // ── Debtor email ──
    const contactEmail = findField([
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
    ]);

    // ── Debtor phone ──
    const contactPhone = findField([
      /(?:Phone|Tel|Telephone|Mobile|Call)\s*[:.]?\s*([+]?[\d\s\-()]{7,20})/i,
      /([+]\d{1,3}[\s-]?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{1,9})/,
      /(\d{3}[\s-]?\d{3}[\s-]?\d{4})/,
    ]);

    // ── Registration / Tax ID ──
    const registrationNo = findField([
      /(?:Registration\s*(?:No|Number|#)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-]{2,30})/i,
      /(?:Tax\s*(?:ID|No|Number)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-]{2,30})/i,
      /(?:VAT\s*(?:No|Number|#)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-]{2,30})/i,
      /(?:CR\s*(?:No|Number|#)?\s*[:.]?\s*)([A-Za-z0-9][A-Za-z0-9\/\-]{2,30})/i,
    ]);

    // Normalize date format to YYYY-MM-DD
    const normalizeDate = (dateStr: string | null): string | null => {
      if (!dateStr) return null;
      // Try MM/DD/YYYY or DD/MM/YYYY or YYYY-MM-DD
      let m = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      m = dateStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      return dateStr;
    };

    const result = {
      debtor: {
        name: debtorName || "",
        registered_address: debtorAddress || "",
        contact_email: contactEmail || "",
        contact_phone: contactPhone || "",
        registration_no: registrationNo || "",
      },
      invoice: {
        invoice_number: invoiceNumber || "",
        amount: amount || 0,
        issue_date: normalizeDate(issueDate) || new Date().toISOString().slice(0, 10),
        due_date: normalizeDate(dueDate) || "",
        po_number: poNumber || "",
      },
      raw_text_preview: extractedText.slice(0, 2000),
    };

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Parse invoice error:", err);
    res.status(500).json({ error: "Failed to parse invoice: " + (err instanceof Error ? err.message : "Unknown error") });
  }
});

// ── POST /api/invoices/bulk-search ── (search invoices by uploaded Excel invoice numbers)
router.post("/bulk-search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceNumbers } = z.object({
      invoiceNumbers: z.array(z.string().min(1)).min(1).max(10000),
    }).parse(req.body);

    // Normalize input invoice numbers for case-insensitive matching
    const searchSet = new Set(invoiceNumbers.map((n) => n.toLowerCase().trim()));

    // Preload all invoices, debtors, and profiles
    const [allInvoices, allDebtors, allProfiles] = await Promise.all([
      scanTable<Invoice>(TABLES.INVOICES, getCompanyFilter(req.user!)),
      scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!)),
      scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!)),
    ]);

    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    // Separate invoices into found vs not-in-excel
    const found: Array<Invoice & { debtor?: Debtor; client?: Profile }> = [];
    const platformInvoiceNumbers = new Set<string>();
    const platformInvoices: Array<{ id: string; invoice_number: string; amount: number; issue_date: string | null; debtor_id: string | null }> = [];

    for (const inv of allInvoices) {
      const normalized = inv.invoice_number.toLowerCase().trim();
      platformInvoiceNumbers.add(normalized);
      platformInvoices.push({
        id: inv.id,
        invoice_number: inv.invoice_number,
        amount: inv.amount,
        issue_date: inv.issue_date,
        debtor_id: inv.debtor_id,
      });

      if (searchSet.has(normalized)) {
        found.push({
          ...inv,
          debtor: inv.debtor_id ? debtorMap.get(inv.debtor_id) : undefined,
          client: inv.client_id ? profileMap.get(inv.client_id) : undefined,
        });
      }
    }

    // Invoice numbers in the Excel that were NOT found in the platform
    const notFoundInPlatform = invoiceNumbers.filter((n) => !platformInvoiceNumbers.has(n.toLowerCase().trim()));

    // Platform invoices NOT in the Excel (limit to 500 for performance)
    const notInExcel: Array<{ id: string; invoice_number: string; amount: number; issue_date: string | null; debtor_name: string | null }> = [];
    let notInExcelTotal = 0;

    for (const pi of platformInvoices) {
      if (!searchSet.has(pi.invoice_number.toLowerCase().trim())) {
        notInExcelTotal++;
        if (notInExcel.length < 500) {
          notInExcel.push({
            ...pi,
            debtor_name: pi.debtor_id ? (debtorMap.get(pi.debtor_id)?.name ?? null) : null,
          });
        }
      }
    }

    res.json({
      found,
      notFoundInPlatform,
      notInExcel,
      notInExcelTotal,
      summary: {
        excelCount: invoiceNumbers.length,
        foundCount: found.length,
        notFoundCount: notFoundInPlatform.length,
        platformCount: platformInvoiceNumbers.size,
        notInExcelCount: notInExcelTotal,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Bulk invoice search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/:id/send-noa ──
router.post("/:id/send-noa", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    // Lookup debtor for email
    const debtor = await getItem(TABLES.DEBTORS, { id: invoice.debtor_id }) as Debtor | undefined;
    const client = await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined;
    const companyName = client?.company_name || "A client";

    const noaEntry: ReminderEntry = {
      sent_at: nowISO(),
      type: "noa",
      to: debtor?.contact_email || "",
      note: debtor?.contact_email ? "Notice of Assignment sent" : "NOA sent — no debtor email on file",
    };
    const reminderLog = [...(invoice.reminder_log ?? []), noaEntry];
    await updateItem(TABLES.INVOICES, { id: req.params.id }, {
      noa_status: "sent",
      noa_sent_at: nowISO(),
      reminder_log: reminderLog,
      updated_at: nowISO(),
    });

    const link = `/noa/${invoice.noa_token}`;
    const fullUrl = `${config.appUrl}${link}`;

    // Send NOA email to debtor (non-blocking)
    if (debtor?.contact_email) {
      sendNoaEmail({
        to: debtor.contact_email,
        debtorName: debtor.name,
        debtorContactName: debtor.contact_name,
        invoiceNumber: invoice.invoice_number,
        amount: invoice.amount,
        companyName,
        noaUrl: fullUrl,
      });
    } else {
      console.warn(`   ⚠️ No contact email for debtor "${debtor?.name ?? invoice.debtor_id}" — NOA not emailed.`);
    }

    res.json({ noa_status: "sent", noa_link: link });
  } catch (err) {
    console.error("Send NOA error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/:id/payment ── (record a payment — accumulates amount_received)
// Treasury/admin action. Derives paid / late days / short payment, mirrors the
// batch-close derivation but for a single invoice, and freezes paid invoices.
const recordPaymentSchema = z.object({
  amount_received: z.number().positive("Amount must be > 0"),
  date_received: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  paid_note: z.string().max(500).nullable().optional().default(null),
});

router.post("/:id/payment", requireAuth, requireAnyWriteAccess("invoices", "funding-queue", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = recordPaymentSchema.parse(req.body);
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (req.user!.company_id && invoice.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid" || invoice.status === "rejected") {
      res.status(400).json({ error: `Cannot record payment on a ${invoice.status} invoice` });
      return;
    }

    const amount = Number(invoice.amount);
    const payment = Math.round(Number(parsed.amount_received) * 100) / 100;

    // Money step — never a blind read-modify-write. Conditional on the
    // previously-read `amount_received` with a bounded retry, so two concurrent
    // payments can't lose each other's contribution.
    let current = invoice;
    let updated: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const receivedSoFar = Number(current.amount_received ?? 0);
      const received = Math.round((receivedSoFar + payment) * 100) / 100;
      const isPaid = received >= amount;
      const shortPayment = Math.max(0, +(amount - received).toFixed(2));
      const lateDays = current.due_date
        ? Math.max(0, Math.round((new Date(parsed.date_received).getTime() - new Date(current.due_date).getTime()) / 86400000))
        : 0;

      const entry: ReminderEntry = {
        sent_at: nowISO(),
        type: "manual",
        to: req.user!.email || "",
        note: `Payment recorded: $${payment.toLocaleString()}${parsed.paid_note ? ` — ${parsed.paid_note}` : ""}`,
      };

      const updates: Record<string, any> = {
        amount_received: received,
        receipt_date: parsed.date_received,
        short_payment: isPaid ? shortPayment : null,
        late_days: lateDays,
        paid_note: parsed.paid_note ?? current.paid_note ?? null,
        payment_type: "treasury_pay",
        reminder_log: [...(current.reminder_log ?? []), entry],
        updated_at: nowISO(),
      };
      if (isPaid) {
        updates.status = "paid";
        updates.paid_date = parsed.date_received;
      }

      updated = await updateItemConditional(
        TABLES.INVOICES,
        { id: req.params.id },
        updates,
        "amount_received = :expected",
        undefined,
        { ":expected": current.amount_received ?? 0 },
      );
      if (updated) break;
      // Lost the race — re-read and retry with the fresh amount_received.
      const fresh = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
      if (!fresh) { res.status(404).json({ error: "Invoice not found" }); return; }
      current = fresh;
    }
    if (!updated) {
      res.status(409).json({ error: "Could not record payment — concurrent payment in progress, try again" });
      return;
    }

    createActivityAlert({
      client_id: invoice.client_id,
      company_id: invoice.company_id,
      debtor_id: invoice.debtor_id,
      invoice_id: invoice.id,
      type: "payment_received",
      severity: "info",
      message: updated.status === "paid"
        ? `Payment received for ${invoice.invoice_number}: $${updated.amount_received.toLocaleString()} (fully paid)`
        : `Partial payment for ${invoice.invoice_number}: $${payment.toLocaleString()} ($${updated.amount_received.toLocaleString()} of $${amount.toLocaleString()})`,
      created_by: req.user!.id,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Record payment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/:id/remind ── (manual reminder — admin/treasury action)
// Sends an overdue reminder email immediately and logs it. Idempotent-ish: a
// same-day manual reminder is allowed (it supersedes the daily sweep stamp).
router.post("/:id/remind", requireAuth, requireAnyWriteAccess("invoices", "funding-queue", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (req.user!.company_id && invoice.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid" || invoice.status === "rejected") {
      res.status(400).json({ error: `Cannot remind on a ${invoice.status} invoice` });
      return;
    }

    const debtor = await getItem(TABLES.DEBTORS, { id: invoice.debtor_id }) as Debtor | undefined;
    const client = await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined;
    if (!debtor?.contact_email) {
      res.status(400).json({ error: "This debtor has no contact email on file — add one before reminding" });
      return;
    }

    const daysOverdue = invoice.due_date
      ? Math.max(1, Math.round((Date.now() - new Date(invoice.due_date).getTime()) / 86400000))
      : 0;
    const invoiceUrl = `${config.appUrl}/noa/${invoice.noa_token}`;
    sendReminderEmail({
      to: debtor.contact_email,
      debtorName: debtor.name,
      debtorContactName: debtor.contact_name ?? null,
      invoiceNumber: invoice.invoice_number,
      amount: invoice.amount,
      dueDate: invoice.due_date,
      daysOverdue,
      companyName: client?.company_name || "A client",
      invoiceUrl,
    });

    const entry: ReminderEntry = {
      sent_at: nowISO(),
      type: "manual",
      to: debtor.contact_email,
      note: `Manual reminder sent (overdue ${daysOverdue} day${daysOverdue === 1 ? "" : "s"})`,
    };
    const updated = await updateItem(TABLES.INVOICES, { id: req.params.id }, {
      last_overdue_reminder_date: new Date().toISOString().slice(0, 10),
      reminder_log: [...(invoice.reminder_log ?? []), entry],
      updated_at: nowISO(),
    });

    createActivityAlert({
      client_id: invoice.client_id,
      company_id: invoice.company_id,
      debtor_id: invoice.debtor_id,
      invoice_id: invoice.id,
      type: "invoice_created",
      severity: "info",
      message: `Manual overdue reminder emailed for ${invoice.invoice_number}`,
      created_by: req.user!.id,
    });
    res.json(updated);
  } catch (err) {
    console.error("Send reminder error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/:id/remind-debtor/:token ── (public, token-authenticated)
// The link a reminder email points at: the debtor's one-time token verifies
// they can see this invoice's summary without a login (mirrors /api/noa/:token).
router.get("/:id/remind-debtor/:token", async (req: Request, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice || !invoice.noa_token || invoice.noa_token !== req.params.token) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.json({
      invoice_number: invoice.invoice_number,
      amount: invoice.amount,
      due_date: invoice.due_date,
      status: invoice.status,
      noa_status: invoice.noa_status,
    });
  } catch (err) {
    console.error("Reminder token lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
