import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  updateItemConditional,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { config } from "../config.js";
import { generateId, generateDocNumber, generateNoaToken, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { effectiveUnitPrice, computeQuotationTotals, isQuotationExpired, withExpiry } from "../utils/quotations.js";
import { computeSalesTotals } from "../utils/goodsSales.js";
import { sendQuotationEmail, sendQuotationDebtorEmail } from "../utils/email.js";
import type {
  Quotation, QuotationLine,
  GoodsSalesOrder, GoodsSalesOrderLine,
  Product, Debtor,
} from "../types/index.js";

const router = Router();

// ── Helpers ──

async function buildDebtorMap(companyId: string | null): Promise<Map<string, Debtor>> {
  const debtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter({ company_id: companyId }));
  return new Map(debtors.map((d) => [d.id, d]));
}

function isAdmin(roles: string[]): boolean {
  return roles.includes("factor_admin");
}

function isApprover(roles: string[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

function lineSummary(q: Quotation): string {
  const items = q.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ");
  return items ? `Includes: ${items}.` : "";
}

// ── Validation ──

const quotationLineSchema = z.object({
  product_id: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().min(1, "Line item name is required").max(200),
  sku: z.string().trim().max(64).nullable().optional(),
  unit: z.string().trim().max(40).optional(),
  quantity: z.number().positive("Quantity must be > 0"),
  unit_price: z.number().min(0, "Unit price must be >= 0"),
  updated_unit_price: z.number().min(0).nullable().optional(),
  discount_type: z.enum(["pct", "amount", "none"]).optional().default("none"),
  discount_value: z.number().min(0).optional().default(0),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const createSchema = z.object({
  quotation_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  valid_until: z.string().nullable().optional(),
  customer_id: z.string().trim().max(200).nullable().optional(),
  prospect_name: z.string().trim().max(200).nullable().optional(),
  contact_person: z.string().trim().max(120).nullable().optional(),
  billing_address: z.string().trim().max(500).nullable().optional(),
  delivery_address: z.string().trim().max(500).nullable().optional(),
  salesperson_name: z.string().trim().max(120).nullable().optional(),
  payment_terms: z.string().trim().max(60).nullable().optional(),
  expected_delivery_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  freight: z.number().min(0).nullable().optional(),
  lines: z.array(quotationLineSchema).min(1, "Add at least one line"),
});

// ── GET /api/quotations ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [quotes, debtorMap] = await Promise.all([
      scanTable<Quotation>(TABLES.QUOTATIONS, getCompanyFilter(req.user!)),
      buildDebtorMap(req.user!.company_id),
    ]);
    const enriched = quotes
      .sort((a, b) => (b.quotation_date || "").localeCompare(a.quotation_date || "") || (b.created_at || "").localeCompare(a.created_at || ""))
      .map((q) => {
        const customer = q.customer_id ? debtorMap.get(q.customer_id) : undefined;
        return withExpiry({
          ...q,
          customer_name: q.customer_name ?? q.prospect_name ?? customer?.name ?? null,
          contact_person: q.contact_person ?? customer?.contact_name ?? null,
        });
      });
    res.json(enriched);
  } catch (err) {
    console.error("Get quotations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/quotations/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    res.json(withExpiry(q));
  } catch (err) {
    console.error("Get quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations ──
router.post("/", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    // Snapshot product info from the catalogue where a product is picked.
    const productIds = parsed.lines.map((l) => l.product_id).filter(Boolean) as string[];
    const products = productIds.length
      ? await scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!))
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const lines: QuotationLine[] = parsed.lines.map((l) => {
      const product = l.product_id ? productMap.get(l.product_id) : undefined;
      const sku = product?.sku ?? l.sku ?? `SKU-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const name = product?.name ?? l.name.trim();
      const unit = product?.unit_of_measure ?? (l.unit?.trim() || "unit");
      const unitPrice = product ? (l.unit_price > 0 ? l.unit_price : product.unit_price ?? 0) : l.unit_price;
      return {
        product_id: l.product_id || null,
        sku,
        name,
        unit,
        quantity: l.quantity,
        unit_price: Math.round(unitPrice * 100) / 100,
        updated_unit_price: l.updated_unit_price != null ? Math.round(l.updated_unit_price * 100) / 100 : null,
        discount_type: l.discount_type,
        discount_value: Math.round(l.discount_value * 100) / 100,
        gst_rate: l.gst_rate ?? product?.gst_rate ?? null,
        notes: l.notes || null,
      };
    });

    const { subtotal, total_discount, gst_total, grand_total } = computeQuotationTotals(lines, parsed.freight ?? 0);
    const hasRevisedPrices = lines.some((l) => l.updated_unit_price != null);

    const debtor = parsed.customer_id ? (await buildDebtorMap(req.user!.company_id)).get(parsed.customer_id) : undefined;

    const quote: Quotation = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      quotation_number: generateDocNumber("QT"),
      quotation_date: parsed.quotation_date,
      valid_until: parsed.valid_until || null,
      customer_id: parsed.customer_id || null,
      prospect_name: parsed.prospect_name || null,
      customer_name: debtor?.name ?? null,
      contact_person: parsed.contact_person ?? debtor?.contact_name ?? null,
      billing_address: parsed.billing_address ?? debtor?.registered_address ?? null,
      delivery_address: parsed.delivery_address ?? debtor?.registered_address ?? null,
      salesperson_name: parsed.salesperson_name ?? req.user!.email,
      payment_terms: parsed.payment_terms ?? (debtor?.payment_terms_days ? `Net ${debtor.payment_terms_days}` : null),
      expected_delivery_date: parsed.expected_delivery_date || null,
      notes: parsed.notes || null,
      lines,
      subtotal,
      total_discount,
      gst_total,
      freight: parsed.freight ?? null,
      grand_total,
      status: "draft",
      // No revised prices → review not needed. Revised prices require checker approval.
      approval_status: hasRevisedPrices ? "pending_review" : "none",
      approval_comments: null,
      approved_by: null,
      approved_at: null,
      debtor_status: "pending",
      debtor_comments: null,
      debtor_token: null,
      debtor_sent_at: null,
      debtor_responded_at: null,
      converted_to_so_id: null,
      converted_to_so_number: null,
      converted_at: null,
      documents: [],
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.QUOTATIONS, quote as any);

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "quotation_created",
      severity: "info",
      message: `Quotation ${quote.quotation_number} created — ${quote.grand_total.toLocaleString()}${hasRevisedPrices ? " (prices pending checker review)" : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json(quote);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/quotations/:id ── (draft/sent; locked once pricing is approved)
const updateSchema = createSchema.partial();

router.patch("/:id", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!existing) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (existing.status !== "draft" && existing.status !== "sent") {
      res.status(400).json({ error: `Only draft or sent quotations can be edited (current: ${existing.status})` });
      return;
    }
    if (existing.approval_status === "approved") {
      res.status(400).json({ error: "Approved pricing is locked — edits need a new review cycle" });
      return;
    }
    if (isQuotationExpired(existing)) {
      res.status(400).json({ error: "This quotation has expired and can no longer be edited" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };

    if (parsed.lines) {
      const lines: QuotationLine[] = parsed.lines.map((l) => ({
        product_id: l.product_id || null,
        sku: l.sku?.trim() || "",
        name: l.name.trim(),
        unit: l.unit?.trim() || "unit",
        quantity: l.quantity,
        unit_price: Math.round(l.unit_price * 100) / 100,
        updated_unit_price: l.updated_unit_price != null ? Math.round(l.updated_unit_price * 100) / 100 : null,
        discount_type: l.discount_type,
        discount_value: Math.round(l.discount_value * 100) / 100,
        gst_rate: l.gst_rate ?? null,
        notes: l.notes || null,
      }));
      const { subtotal, total_discount, gst_total, grand_total } = computeQuotationTotals(lines, Number(parsed.freight ?? existing.freight ?? 0));
      updates.lines = lines;
      updates.subtotal = subtotal;
      updates.total_discount = total_discount;
      updates.gst_total = gst_total;
      updates.grand_total = grand_total;
      // Editing prices invalidates any prior (rejected) review — back to needing review.
      const hasRevised = lines.some((l) => l.updated_unit_price != null);
      updates.approval_status = hasRevised ? "pending_review" : "none";
      updates.approval_comments = null;
    } else if (parsed.freight !== undefined) {
      const { subtotal, total_discount, gst_total, grand_total } = computeQuotationTotals(existing.lines, parsed.freight ?? 0);
      updates.subtotal = subtotal;
      updates.total_discount = total_discount;
      updates.gst_total = gst_total;
      updates.grand_total = grand_total;
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && k !== "lines") updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    delete updates.status;
    // NOTE: approval_status is NOT deleted — the lines branch sets it to
    // pending_review/none so editing invalidates any prior review. It can't
    // arrive via the generic loop (not in createSchema), so this is safe.

    const updated = await updateItem(TABLES.QUOTATIONS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Quotation not found" }); return; }
    res.json(withExpiry(updated as unknown as Quotation));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations/:id/submit ── (maker submits prices for checker review)
router.post("/:id/submit", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.approval_status === "approved") {
      res.status(400).json({ error: "Pricing is already approved" });
      return;
    }
    if (q.approval_status === "pending_review") {
      res.status(400).json({ error: "Already awaiting checker review" });
      return;
    }
    if (q.status !== "draft" && q.status !== "sent") {
      res.status(400).json({ error: `Only draft or sent quotations can be submitted for review (current: ${q.status})` });
      return;
    }
    if (isQuotationExpired(q)) {
      res.status(400).json({ error: "This quotation has expired" });
      return;
    }
    const updated = await updateItem(TABLES.QUOTATIONS, { id: req.params.id }, {
      approval_status: "pending_review",
      approval_comments: null,
      updated_at: nowISO(),
    });
    res.json(withExpiry(updated as unknown as Quotation));
  } catch (err) {
    console.error("Submit quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations/:id/review ── (checker/admin — segregation of duties)
const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comments: z.string().trim().max(2000).nullable().optional(),
});

router.post("/:id/review", requireAuth, requireAnyWriteAccess("quotations", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = reviewSchema.parse(req.body);
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.approval_status !== "pending_review") {
      res.status(400).json({ error: `Only quotations awaiting review can be reviewed (current: ${q.approval_status})` });
      return;
    }
    // Segregation of duties — a maker cannot approve their own revised prices.
    if (q.created_by === req.user!.id && !isAdmin(req.user!.roles)) {
      res.status(403).json({ error: "You cannot review a quotation you created — segregation of duties" });
      return;
    }
    const updated = await updateItem(TABLES.QUOTATIONS, { id: req.params.id }, {
      approval_status: parsed.decision,
      approval_comments: parsed.comments || null,
      approved_by: parsed.decision === "approved" ? req.user!.id : null,
      approved_at: parsed.decision === "approved" ? nowISO() : null,
      updated_at: nowISO(),
    });
    res.json(withExpiry(updated as unknown as Quotation));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Review quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations/:id/send ── (send to customer — idempotent, email failure never rolls back)
router.post("/:id/send", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.status !== "draft" && q.status !== "sent") {
      res.status(400).json({ error: `Only draft or sent quotations can be sent (current: ${q.status})` });
      return;
    }
    if (isQuotationExpired(q)) {
      res.status(400).json({ error: "This quotation has expired" });
      return;
    }

    const updated = await updateItem(TABLES.QUOTATIONS, { id: req.params.id }, {
      status: "sent",
      updated_at: nowISO(),
    });

    // Fire-and-forget email — a failure must never roll back the status.
    const debtor = q.customer_id ? (await buildDebtorMap(q.company_id)).get(q.customer_id) : undefined;
    const to = debtor?.contact_email;
    if (to) {
      sendQuotationEmail({
        to,
        customerName: q.customer_name ?? q.prospect_name ?? "Customer",
        contactName: q.contact_person,
        quotationNumber: q.quotation_number,
        amount: q.grand_total,
        companyName: req.user!.email,
        validUntil: q.valid_until,
        linesSummary: lineSummary(q),
      });
    }

    res.json(withExpiry(updated as unknown as Quotation));
  } catch (err) {
    console.error("Send quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations/:id/send-to-debtor ── (one-time secure-token approval email)
router.post("/:id/send-to-debtor", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.status !== "sent") {
      res.status(400).json({ error: "Send the quotation to the customer first (mark sent)" });
      return;
    }
    if (isQuotationExpired(q)) {
      res.status(400).json({ error: "This quotation has expired" });
      return;
    }
    if (q.debtor_status === "approved") {
      res.status(400).json({ error: "The debtor already approved this quotation" });
      return;
    }

    const debtor = q.customer_id ? (await buildDebtorMap(q.company_id)).get(q.customer_id) : undefined;
    const to = debtor?.contact_email;
    if (!to) {
      res.status(400).json({ error: "This debtor has no contact email — add one to enable secure approval" });
      return;
    }

    const token = generateNoaToken();
    const updated = await updateItem(TABLES.QUOTATIONS, { id: req.params.id }, {
      debtor_token: token,
      debtor_status: "pending",
      debtor_comments: null,
      debtor_sent_at: nowISO(),
      updated_at: nowISO(),
    });

    sendQuotationDebtorEmail({
      to,
      customerName: q.customer_name ?? q.prospect_name ?? "Customer",
      contactName: q.contact_person,
      quotationNumber: q.quotation_number,
      amount: q.grand_total,
      companyName: req.user!.email,
      approvalUrl: `${config.appUrl}/approvals/${token}`,
    });

    res.json(withExpiry(updated as unknown as Quotation));
  } catch (err) {
    console.error("Send quotation to debtor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/quotations/:id/convert ── (approved pricing + sent/accepted → Goods SO)
router.post("/:id/convert", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.status === "converted_to_so") {
      res.status(400).json({ error: "This quotation was already converted" });
      return;
    }
    if (q.approval_status !== "approved") {
      res.status(400).json({ error: "Checker approval of the pricing is required before converting to a sales order" });
      return;
    }
    if (q.status !== "sent" && q.status !== "accepted") {
      res.status(400).json({ error: `Only sent or accepted quotations can be converted (current: ${q.status})` });
      return;
    }
    if (isQuotationExpired(q)) {
      res.status(400).json({ error: "This quotation has expired" });
      return;
    }

    const now = nowISO();

    // Convert lines — effective price; `amount` discounts become a discount %.
    const lines: GoodsSalesOrderLine[] = q.lines.map((l) => {
      const price = effectiveUnitPrice(l);
      const gross = (Number(l.quantity) || 0) * price;
      let discountPct = 0;
      if (l.discount_type === "pct") discountPct = Math.min(100, Math.max(0, Number(l.discount_value) || 0));
      else if (l.discount_type === "amount" && gross > 0) {
        discountPct = Math.min(100, Math.max(0, (Math.min(Number(l.discount_value) || 0, gross) / gross) * 100));
      }
      return {
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        ordered_qty: l.quantity,
        unit_price: Math.round(price * 100) / 100,
        discount_pct: Math.round(discountPct * 100) / 100,
        gst_rate: l.gst_rate,
        dispatched_qty: 0,
        line_total: Math.round(l.quantity * price * (1 - discountPct / 100) * 100) / 100,
      };
    });

    const { subtotal, total_discount, gst_total, grand_total } = computeSalesTotals(lines, q.freight ?? 0);

    const so: GoodsSalesOrder = {
      id: generateId(),
      client_id: q.client_id,
      company_id: q.company_id,
      so_number: generateDocNumber("SO"),
      order_date: now.slice(0, 10),
      customer_id: q.customer_id,
      customer_name: q.customer_name,
      contact_person: q.contact_person,
      billing_address: q.billing_address,
      delivery_address: q.delivery_address,
      salesperson_name: q.salesperson_name,
      linked_quotation_id: q.id,
      linked_quotation_number: q.quotation_number,
      payment_terms: q.payment_terms,
      expected_dispatch_date: null,
      expected_delivery_date: q.expected_delivery_date,
      notes: q.notes ? `${q.notes} (from quotation ${q.quotation_number})` : `Created from quotation ${q.quotation_number}`,
      lines,
      subtotal,
      total_discount,
      gst_total,
      freight: q.freight,
      grand_total,
      manual_status: "draft",
      status: "draft",
      documents: [],
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.GOODS_SALES_ORDERS, so as any);

    // Race-safe: exactly one concurrent convert wins the flip; a loser deletes
    // the SO it just created and reports the conflict.
    const flipped = await updateItemConditional(
      TABLES.QUOTATIONS,
      { id: q.id },
      {
        status: "converted_to_so",
        converted_to_so_id: so.id,
        converted_to_so_number: so.so_number,
        converted_at: now,
        updated_at: now,
      },
      "#status = :expected",
      { "#status": "status" },
      { ":expected": q.status },
    );
    if (!flipped) {
      await deleteItem(TABLES.GOODS_SALES_ORDERS, { id: so.id });
      res.status(409).json({ error: "This quotation was converted by someone else — refresh" });
      return;
    }

    createActivityAlert({
      client_id: q.client_id,
      company_id: q.company_id,
      type: "sales_order_created",
      severity: "info",
      message: `Quotation ${q.quotation_number} converted to ${so.so_number} — no stock impact (only a confirmed dispatch debits inventory)`,
      created_by: req.user!.id,
    });

    res.json({ ...withExpiry(q), converted_so: so });
  } catch (err) {
    console.error("Convert quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/quotations/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("quotations"), async (req: AuthRequest, res: Response) => {
  try {
    const q = await getItem(TABLES.QUOTATIONS, { id: req.params.id }) as Quotation | undefined;
    if (!q) { res.status(404).json({ error: "Quotation not found" }); return; }
    if (req.user!.company_id && q.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    if (q.status !== "draft") {
      res.status(400).json({ error: `Only draft quotations can be deleted (current: ${q.status})` });
      return;
    }
    await deleteItem(TABLES.QUOTATIONS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete quotation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
