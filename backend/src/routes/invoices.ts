import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  queryByIndex,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateNoaToken, nowISO } from "../utils/helpers.js";
import { config } from "../config.js";
import { sendNoaEmail } from "../utils/email.js";
import type { Invoice, Debtor, Profile, PurchaseInvoice, Vendor, DocMeta } from "../types/index.js";
import type { StockMovement, MovementDirection } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";

const router = Router();

// ── GET /api/invoices/check-duplicates ── (find duplicate invoice numbers across sales & purchase invoices)
router.get("/check-duplicates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Scan both sales and purchase invoices
    const salesInvoices = await scanTable<Invoice>(TABLES.INVOICES);
    const purchaseInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);

    // Preload debtors, vendors, and profiles for enrichment
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
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
            debtor: e.debtor_id && debtorMap.get(e.debtor_id)
              ? { name: debtorMap.get(e.debtor_id)?.name }
              : undefined,
            vendor: e.vendor_id && vendorMap.get(e.vendor_id)
              ? { name: vendorMap.get(e.vendor_id)?.name }
              : undefined,
          })),
        });
      }
    }

    // Sort by invoice_number alphabetically
    duplicates.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number));

    res.json({ duplicates, totalDuplicates: duplicates.length });
  } catch (err) {
    console.error("Check duplicate invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices ── (paginated when page/limit provided, legacy array otherwise)
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

    const invoices = await scanTable<Invoice>(TABLES.INVOICES);

    // Preload all debtors, profiles, vendors, and purchase invoices into lookup maps
    // to avoid N+1 GetItem calls during enrichment
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allPurchaseInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
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
      filteredInvoices = filteredInvoices.filter((inv) => inv.status === "pending" || inv.status === "approved");
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
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
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
  amount: z.number().positive(),
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
      status: "pending",
      noa_status: "not_sent",
      noa_token,
      noa_sent_at: null,
      noa_responded_at: null,
      noa_comments: null,
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

    res.json({ ...invoice, debtor, client, purchases });
  } catch (err) {
    console.error("Get invoice error:", err);
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
    amount: z.number().positive(),
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
          status: "pending",
          noa_status: "not_sent",
          noa_token,
          noa_sent_at: null,
          noa_responded_at: null,
          noa_comments: null,
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
    const allInvoices = await scanTable<Invoice>(TABLES.INVOICES);
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

// ── POST /api/invoices/:id/send-noa ──
router.post("/:id/send-noa", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    // Lookup debtor for email
    const debtor = await getItem(TABLES.DEBTORS, { id: invoice.debtor_id }) as Debtor | undefined;
    const client = await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined;
    const companyName = client?.company_name || "A client";

    await updateItem(TABLES.INVOICES, { id: req.params.id }, {
      noa_status: "sent",
      noa_sent_at: nowISO(),
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

export default router;
