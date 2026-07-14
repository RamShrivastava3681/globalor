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
import { generateId, nowISO } from "../utils/helpers.js";
import type { PurchaseInvoice, Vendor, Profile, Debtor, DocMeta } from "../types/index.js";
import type { StockMovement } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";

const router = Router();

// ── GET /api/purchase-invoices ── (paginated when page/limit provided, legacy array otherwise)
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

    let invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);

    // Preload all vendors, profiles, debtors, and invoices into lookup maps
    // to avoid N+1 GetItem calls during enrichment
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allSalesInvoices = await scanTable<any>(TABLES.INVOICES);
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const salesInvMap = new Map(allSalesInvoices.map((si) => [si.id, si]));

    // Fast synchronous enrichment
    const enrichPi = (pi: PurchaseInvoice) => {
      const vendor = vendorMap.get(pi.vendor_id);
      const client = profileMap.get(pi.client_id);
      let linkedSales: any[] | undefined;
      if (pi.linked_sales_invoice_ids && pi.linked_sales_invoice_ids.length > 0) {
        linkedSales = pi.linked_sales_invoice_ids
          .filter((sId): sId is string => !!sId)
          .map((sId) => {
            const si = salesInvMap.get(sId);
            if (si) {
              return { ...si, debtor: debtorMap.get(si.debtor_id) };
            }
            return null;
          })
          .filter(Boolean);
      }
      return { ...pi, vendor, client, linkedSales };
    };

    // Server-side search filtering (including vendor name)
    const searchQuery = (req.query.search as string || "").toLowerCase().trim();
    if (searchQuery) {
      invoices = invoices.filter((pi) => {
        const q = searchQuery;
        const vendorName = (vendorMap.get(pi.vendor_id)?.name ?? "").toLowerCase();
        const visibleUid = pi.id.slice(-8).toLowerCase();
        return (
          pi.invoice_number?.toLowerCase().includes(q) ||
          pi.po_number?.toLowerCase().includes(q) ||
          pi.status?.toLowerCase().includes(q) ||
          pi.id.toLowerCase().includes(q) ||
          visibleUid.includes(q) ||
          vendorName.includes(q)
        );
      });
    }

    // Date range filters
    const issueDateFrom = req.query.issueDateFrom as string | undefined;
    const issueDateTo = req.query.issueDateTo as string | undefined;
    if (issueDateFrom) {
      invoices = invoices.filter((pi) => pi.issue_date && pi.issue_date >= issueDateFrom);
    }
    if (issueDateTo) {
      invoices = invoices.filter((pi) => pi.issue_date && pi.issue_date <= issueDateTo);
    }

    const createdFrom = req.query.createdFrom as string | undefined;
    const createdTo = req.query.createdTo as string | undefined;
    if (createdFrom) {
      invoices = invoices.filter((pi) => pi.created_at && pi.created_at.slice(0, 10) >= createdFrom);
    }
    if (createdTo) {
      invoices = invoices.filter((pi) => pi.created_at && pi.created_at.slice(0, 10) <= createdTo);
    }

    // Server-side sorting
    const sortOrder = req.query.sort === "asc" ? 1 : -1;
    const sortField = (req.query.sortField as string) || "created";
    invoices.sort((a, b) => {
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

    if (hasPagination) {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
      const total = invoices.length;
      const totalPages = Math.ceil(total / limit);
      const startIdx = (page - 1) * limit;
      const pageItems = invoices.slice(startIdx, startIdx + limit);
      const enriched = pageItems.map(enrichPi);
      res.json({ data: enriched, total, page, limit, totalPages });
    } else {
      const enriched = invoices.map(enrichPi);
      res.json(enriched);
    }
  } catch (err) {
    console.error("Get purchase invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/purchase-invoices/mini ──
router.get("/mini", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
    res.json(
      invoices
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .map((i) => ({ id: i.id, invoice_number: i.invoice_number, amount: i.amount })),
    );
  } catch (err) {
    console.error("Get purchase invoices mini error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/purchase-invoices/:id ── (single enriched purchase invoice)
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.PURCHASE_INVOICES, { id: req.params.id }) as PurchaseInvoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Purchase invoice not found" }); return; }

    const vendor = invoice.vendor_id ? await getItem(TABLES.VENDORS, { id: invoice.vendor_id }) as Vendor | undefined : undefined;
    const client = invoice.client_id ? await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined : undefined;

    // Enrich linked sales invoices
    let linkedSales: any[] | undefined;
    if (invoice.linked_sales_invoice_ids && invoice.linked_sales_invoice_ids.length > 0) {
      const results = await Promise.all(
        invoice.linked_sales_invoice_ids.map(async (sId) => {
          const si = await getItem(TABLES.INVOICES, { id: sId }) as any;
          if (si?.debtor_id) {
            si.debtor = await getItem(TABLES.DEBTORS, { id: si.debtor_id }) as Debtor | undefined;
          }
          return si;
        }),
      );
      linkedSales = results.filter(Boolean);
    }

    res.json({ ...invoice, vendor, client, linkedSales });
  } catch (err) {
    console.error("Get purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-invoices ──
const createSchema = z.object({
  vendor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number(),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
  linked_sales_invoice_ids: z.array(z.string()).optional().default([]),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
});

router.post("/", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const termsDays = parsed.payment_terms_days;
    const due_date = parsed.due_date !== null
      ? (parsed.due_date || (() => {
          const base = parsed.due_date_source === "bl" && parsed.bl_date ? new Date(parsed.bl_date) : new Date(parsed.issue_date);
          const d = new Date(base);
          d.setDate(d.getDate() + termsDays);
          return d.toISOString().slice(0, 10);
        })())
      : null;

    const invoice: PurchaseInvoice = {
      id,
      client_id: req.user!.id,
      vendor_id: parsed.vendor_id,
      invoice_number: parsed.invoice_number,
      amount: parsed.amount,
      advance_rate: 0,
      po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      issue_date: parsed.issue_date,
      due_date,
      paid_date: null,
      funded_date: null,
      advance_paid_date: null,
      paid_note: null,
      payment_terms_days: parsed.payment_terms_days,
      bl_date: parsed.bl_date || null,
      due_date_source: parsed.due_date_source,
      has_contractual_due_date: parsed.has_contractual_due_date || false,
      notes: parsed.notes || null,
      status: "draft",
      documents: parsed.documents as DocMeta[],
      purchase_order_id: null,
      linked_sales_invoice_ids: parsed.linked_sales_invoice_ids || [],
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.PURCHASE_INVOICES, invoice as any);

    // Link open advances to this purchase invoice and mark as applied
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      const purchaseOrders = orders.filter((o: any) => o.side === "purchase");
      for (const po of purchaseOrders) {
        const advances = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid AND #status = :status",
          expressionAttributeNames: { "#status": "status" },
          expressionAttributeValues: { ":poid": po.id, ":status": "open" },
        });
        for (const adv of advances) {
          await updateItem(TABLES.ADVANCES, { id: adv.id }, { status: "applied", purchase_invoice_id: id });
        }
      }
    }

    // Create inventory movements if enabled
    if (parsed.inventory_items && parsed.inventory_items.length > 0) {
      for (const item of parsed.inventory_items) {
        const movement: StockMovement = {
          id: generateId(),
          client_id: req.user!.id,
          direction: "in",
          item_name: item.item_name,
          sku: item.sku || null,
          quantity: item.quantity,
          unit: item.unit || "unit",
          unit_cost: item.unit_cost || null,
          notes: null,
          invoice_id: null,
          purchase_invoice_id: id,
          movement_date: parsed.issue_date,
          created_at: now,
          updated_at: now,
        };
        await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      }
    }

    // Create activity alert
    const vendor = await getItem(TABLES.VENDORS, { id: parsed.vendor_id }) as Vendor | undefined;
    createActivityAlert({
      client_id: req.user!.id,
      type: "purchase_invoice_created",
      severity: "info",
      message: `Purchase invoice ${parsed.invoice_number} created for $${parsed.amount.toLocaleString()}${vendor ? ` — ${vendor.name}` : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/purchase-invoices/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("purchase-invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.PURCHASE_INVOICES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Purchase invoice not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/purchase-invoices/:id ──
// ── POST /api/purchase-invoices/batch ── (mass import from Excel)
const batchPurchaseInvoiceSchema = z.object({
  vendor_id: z.string().min(1),
  payment_terms_days: z.number().min(0).optional().default(30),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  has_contractual_due_date: z.boolean().optional().default(false),
  bl_date: z.string().nullable().optional(),
  po_number: z.string().max(80).nullable().optional().default(null),
  po_date: z.string().nullable().optional().default(null),
  invoices: z.array(z.object({
    invoice_number: z.string().min(1).max(80),
    amount: z.number(),
    issue_date: z.string().min(1),
  })).min(1),
});

router.post("/batch", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchPurchaseInvoiceSchema.parse(req.body);
    const now = nowISO();
    const created: PurchaseInvoice[] = [];
    const errors: Array<{ invoice_number: string; error: string }> = [];

    // Build all invoice objects first
    const invoicesToCreate: PurchaseInvoice[] = [];
    for (const item of parsed.invoices) {
      try {
        const id = generateId();

        const termsDays = parsed.payment_terms_days;
        const baseDate = parsed.due_date_source === "bl" && parsed.bl_date
          ? new Date(parsed.bl_date)
          : new Date(item.issue_date);
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + termsDays);

        const invoice: PurchaseInvoice = {
          id,
          client_id: req.user!.id,
          vendor_id: parsed.vendor_id,
          invoice_number: item.invoice_number,
          amount: item.amount,
          advance_rate: 0,
          po_number: parsed.po_number || null,
          po_date: parsed.po_date || null,
          issue_date: item.issue_date,
          due_date: dueDate.toISOString().slice(0, 10),
          paid_date: null,
          funded_date: null,
          advance_paid_date: null,
          paid_note: null,
          payment_terms_days: parsed.payment_terms_days,
          bl_date: parsed.bl_date || null,
          due_date_source: parsed.due_date_source,
          has_contractual_due_date: parsed.has_contractual_due_date || false,
          notes: null,
          status: "draft",
          documents: [],
          purchase_order_id: null,
          linked_sales_invoice_ids: [],
          created_at: now,
          updated_at: now,
        };

        invoicesToCreate.push(invoice);
      } catch (err) {
        errors.push({ invoice_number: item.invoice_number, error: "Invalid invoice data" });
        console.error(`Batch build error for purchase invoice ${item.invoice_number}:`, err);
      }
    }

    // Write all invoices in batches of 25 using BatchWriteCommand
    if (invoicesToCreate.length > 0) {
      const dbItems = invoicesToCreate.map((inv) => inv as unknown as Record<string, unknown>);
      try {
        await batchPutItems(TABLES.PURCHASE_INVOICES, dbItems);
        created.push(...invoicesToCreate);
      } catch (err) {
        console.error("Batch write failed, falling back to individual writes:", err);
        // Fallback: write individually with timeout resilience
        for (const inv of invoicesToCreate) {
          try {
            await putItem(TABLES.PURCHASE_INVOICES, inv as any);
            created.push(inv);
          } catch (innerErr) {
            errors.push({ invoice_number: inv.invoice_number, error: "Failed to create" });
            console.error(`Batch fallback error for purchase invoice ${inv.invoice_number}:`, innerErr);
          }
        }
      }
    }

    createActivityAlert({
      client_id: req.user!.id,
      type: "purchase_invoice_created",
      severity: "info",
      message: `Batch imported ${created.length} purchase invoice${created.length !== 1 ? "s" : ""}${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json({ created, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create purchase invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-invoices/batch-close ── (mass close payments from import)
const batchCloseSchema = z.object({
  items: z.array(z.object({
    invoice_number: z.string().min(1),
    date_received: z.string().min(1),
    amount_received: z.number().min(0),
    paid_note: z.string().nullable().optional().default(null),
  })).min(1),
});

router.post("/batch-close", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCloseSchema.parse(req.body);
    const now = nowISO();

    // Scan all purchase invoices and build lookup by invoice_number
    const allInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
    const invoiceByNumber = new Map<string, PurchaseInvoice>();
    for (const inv of allInvoices) {
      invoiceByNumber.set(inv.invoice_number, inv);
    }

    const eligibleStatuses = new Set(["draft", "submitted", "approved", "advanced", "funded", "overdue"]);
    const closed: Array<{ invoice_number: string; amount_received: number }> = [];
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

        const updateFields: Record<string, any> = {
          status: "paid",
          paid_date: item.date_received,
          paid_note: item.paid_note || null,
          updated_at: now,
        };

        await updateItem(TABLES.PURCHASE_INVOICES, { id: invoice.id }, updateFields);

        closed.push({
          invoice_number: item.invoice_number,
          amount_received: item.amount_received,
        });
      } catch (err) {
        console.error(`Batch close error for purchase invoice ${item.invoice_number}:`, err);
        errors.push({ invoice_number: item.invoice_number, error: "Failed to close" });
      }
    }

    res.json({ closed, not_found, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch close purchase invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-invoices/bulk-search ── (search purchase invoices by uploaded Excel invoice numbers)
router.post("/bulk-search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceNumbers } = z.object({
      invoiceNumbers: z.array(z.string().min(1)).min(1).max(10000),
    }).parse(req.body);

    // Normalize input invoice numbers for case-insensitive matching
    const searchSet = new Set(invoiceNumbers.map((n) => n.toLowerCase().trim()));

    // Preload all purchase invoices, vendors, and profiles
    const [allPi, allVendors, allProfiles] = await Promise.all([
      scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES),
      scanTable<Vendor>(TABLES.VENDORS),
      scanTable<Profile>(TABLES.PROFILES),
    ]);

    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    // Separate invoices into found vs not-in-excel
    const found: Array<PurchaseInvoice & { vendor?: Vendor; client?: Profile }> = [];
    const platformInvoiceNumbers = new Set<string>();
    const platformInvoices: Array<{ id: string; invoice_number: string; amount: number; issue_date: string | null; vendor_id: string | null }> = [];

    for (const inv of allPi) {
      const normalized = inv.invoice_number.toLowerCase().trim();
      platformInvoiceNumbers.add(normalized);
      platformInvoices.push({
        id: inv.id,
        invoice_number: inv.invoice_number,
        amount: inv.amount,
        issue_date: inv.issue_date,
        vendor_id: inv.vendor_id,
      });

      if (searchSet.has(normalized)) {
        found.push({
          ...inv,
          vendor: inv.vendor_id ? vendorMap.get(inv.vendor_id) : undefined,
          client: inv.client_id ? profileMap.get(inv.client_id) : undefined,
        });
      }
    }

    // Invoice numbers in the Excel that were NOT found in the platform
    const notFoundInPlatform = invoiceNumbers.filter((n) => !platformInvoiceNumbers.has(n.toLowerCase().trim()));

    // Platform invoices NOT in the Excel (limit to 500 for performance)
    const notInExcel: Array<{ id: string; invoice_number: string; amount: number; issue_date: string | null; vendor_name: string | null }> = [];
    let notInExcelTotal = 0;

    for (const pi of platformInvoices) {
      if (!searchSet.has(pi.invoice_number.toLowerCase().trim())) {
        notInExcelTotal++;
        if (notInExcel.length < 500) {
          notInExcel.push({
            ...pi,
            vendor_name: pi.vendor_id ? (vendorMap.get(pi.vendor_id)?.name ?? null) : null,
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
    console.error("Bulk purchase invoice search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-invoices/:id/submit ── (draft → submitted)
router.post("/:id/submit", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.PURCHASE_INVOICES, { id: req.params.id }) as PurchaseInvoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Purchase invoice not found" }); return; }
    if (invoice.status !== "draft") {
      res.status(400).json({ error: `Cannot submit invoice with status "${invoice.status}". Only draft invoices can be submitted.` });
      return;
    }
    const updated = await updateItem(TABLES.PURCHASE_INVOICES, { id: req.params.id }, { status: "submitted", updated_at: nowISO() });
    res.json(updated);
  } catch (err) {
    console.error("Submit purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.PURCHASE_INVOICES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
