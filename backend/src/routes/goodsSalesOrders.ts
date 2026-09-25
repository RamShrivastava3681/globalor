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
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateDocNumber, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { ensureTask, completeTasksForDoc, cancelTasksForDoc } from "../utils/workflowTasks.js";
import { defaultCustomerAddressFor } from "../utils/customerAddresses.js";
import { scanCustomersMerged } from "../utils/customers.js";
import { computeSalesTotals } from "../utils/goodsSales.js";
import type {
  GoodsSalesOrder, GoodsSalesOrderLine,
  Product, Customer,
} from "../types/index.js";

const router = Router();

// ── Helpers ──

/** Match an edited line against the existing SO lines — product first, then sku, then name. */
function matchExistingLine(
  existing: GoodsSalesOrderLine[],
  nl: { product_id?: string | null; sku?: string | null; name?: string },
): GoodsSalesOrderLine | undefined {
  if (nl.product_id) return existing.find((l) => l.product_id === nl.product_id);
  if (nl.sku) return existing.find((l) => l.sku === nl.sku);
  return existing.find((l) => l.name === nl.name);
}

/** Customer id → {name, contact, address, payment terms} (debtors master merged). */
async function buildCustomerMap(companyId: string | null): Promise<Map<string, Customer>> {
  const customers = await scanCustomersMerged(getCompanyFilter({ company_id: companyId }) as any);
  return new Map(customers.map((d) => [d.id, d]));
}

/** True when the actor can approve sales orders (checker gate). */
function isApprover(roles: string[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

// ── Validation ──

const soLineSchema = z.object({
  product_id: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().min(1, "Line item name is required").max(200),
  sku: z.string().trim().max(64).nullable().optional(),
  unit: z.string().trim().max(40).optional(),
  ordered_qty: z.number().positive("Ordered qty must be > 0"),
  unit_price: z.number().min(0, "Unit price must be >= 0"),
  discount_pct: z.number().min(0).max(100).optional().default(0),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
});

const createSchema = z.object({
  order_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  customer_id: z.string().trim().max(200).nullable().optional(),
  billing_customer_id: z.string().trim().max(200).nullable().optional(),
  shipping_customer_id: z.string().trim().max(200).nullable().optional(),
  contact_person: z.string().trim().max(120).nullable().optional(),
  billing_address: z.string().trim().max(500).nullable().optional(),
  delivery_address: z.string().trim().max(500).nullable().optional(),
  salesperson_name: z.string().trim().max(120).nullable().optional(),
  linked_quotation_id: z.string().trim().max(200).nullable().optional(),
  linked_quotation_number: z.string().trim().max(80).nullable().optional(),
  payment_terms: z.string().trim().max(60).nullable().optional(),
  expected_dispatch_date: z.string().nullable().optional(),
  expected_delivery_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  freight: z.number().min(0).nullable().optional(),
  lines: z.array(soLineSchema).min(1, "Add at least one line"),
});

// ── GET /api/goods-sales-orders ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [orders, customerMap] = await Promise.all([
      scanTable<GoodsSalesOrder>(TABLES.GOODS_SALES_ORDERS, getCompanyFilter(req.user!)),
      buildCustomerMap(req.user!.company_id),
    ]);
    const enriched = orders
      .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || "") || (b.created_at || "").localeCompare(a.created_at || ""))
      .map((so) => ({
        ...so,
        customer_name: so.customer_name ?? (so.customer_id ? customerMap.get(so.customer_id)?.name ?? null : null),
      }));
    res.json(enriched);
  } catch (err) {
    console.error("Get goods sales orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/goods-sales-orders/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const so = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!so) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && so.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    res.json(so);
  } catch (err) {
    console.error("Get goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders ──
router.post("/", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    // Snapshot product info from the catalogue where a product is picked.
    const productIds = parsed.lines.map((l) => l.product_id).filter(Boolean) as string[];
    const products = productIds.length
      ? await scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!))
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const lines: GoodsSalesOrderLine[] = parsed.lines.map((l) => {
      const product = l.product_id ? productMap.get(l.product_id) : undefined;
      const sku = product?.sku ?? l.sku ?? `SKU-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const name = product?.name ?? l.name.trim();
      const unit = product?.unit_of_measure ?? (l.unit?.trim() || "unit");
      const unitPrice = product ? (l.unit_price > 0 ? l.unit_price : product.unit_price ?? 0) : l.unit_price;
      const discountPct = Math.min(100, Math.max(0, l.discount_pct ?? 0));
      return {
        product_id: l.product_id || null,
        sku,
        name,
        unit,
        ordered_qty: l.ordered_qty,
        unit_price: Math.round(unitPrice * 100) / 100,
        discount_pct: discountPct,
        gst_rate: l.gst_rate ?? product?.gst_rate ?? null,
        dispatched_qty: 0,
        line_total: Math.round(l.ordered_qty * unitPrice * (1 - discountPct / 100) * 100) / 100,
      };
    });

    const { subtotal, total_discount, gst_total, grand_total } = computeSalesTotals(lines, parsed.freight ?? 0);

    const customerMap = await buildCustomerMap(req.user!.company_id);
    // Billing party defaults to the legacy customer_id; shipping falls back to billing.
    const billingId = parsed.billing_customer_id || parsed.customer_id || null;
    const shippingId = parsed.shipping_customer_id || billingId;
    const billingCustomer = billingId ? customerMap.get(billingId) : undefined;
    const shippingCustomer = shippingId && shippingId !== billingId ? customerMap.get(shippingId) : billingCustomer;
    const customer = billingCustomer;
    const customerName = billingCustomer?.name ?? null;

    const soNumber = generateDocNumber("SO");
    const so: GoodsSalesOrder = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      so_number: soNumber,
      order_date: parsed.order_date,
      customer_id: billingId,
      customer_name: customerName,
      billing_customer_id: billingId,
      billing_customer_name: billingCustomer?.name ?? null,
      shipping_customer_id: shippingId,
      shipping_customer_name: shippingCustomer?.name ?? null,
      contact_person: parsed.contact_person ?? billingCustomer?.contact_name ?? null,
      billing_address: parsed.billing_address ?? defaultCustomerAddressFor(billingCustomer, "billing"),
      delivery_address: parsed.delivery_address ?? defaultCustomerAddressFor(shippingCustomer, "shipping") ?? (parsed.billing_address ?? defaultCustomerAddressFor(billingCustomer, "billing")),
      salesperson_name: parsed.salesperson_name ?? req.user!.email,
      linked_quotation_id: parsed.linked_quotation_id || null,
      linked_quotation_number: parsed.linked_quotation_number || null,
      payment_terms: parsed.payment_terms ?? (customer?.payment_terms_days ? `Net ${customer.payment_terms_days}` : null),
      expected_dispatch_date: parsed.expected_dispatch_date || null,
      expected_delivery_date: parsed.expected_delivery_date || null,
      notes: parsed.notes || null,
      lines,
      subtotal,
      total_discount,
      gst_total,
      freight: parsed.freight ?? null,
      grand_total,
      manual_status: "draft",
      status: "draft",
      warehouse_review_comments: null,
      warehouse_reviewed_by: null,
      warehouse_reviewed_at: null,
      review_comments: null,
      reviewed_by: null,
      reviewed_at: null,
      approved_by: null,
      approved_at: null,
      documents: [],
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.GOODS_SALES_ORDERS, so as any);

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "sales_order_created",
      severity: "info",
      message: `Sales order ${soNumber} created — ${lines.length} line${lines.length !== 1 ? "s" : ""}, ${lines.reduce((s, l) => s + l.ordered_qty, 0)} units, ${grand_total.toLocaleString()} total`,
      created_by: req.user!.id,
    });

    // My Queue: open "send to warehouse" task.
    ensureTask(so.company_id, so.client_id, {
      workflow_type: "sales_order", stage: "submit", doc_type: "sales_order",
      doc_id: so.id, doc_number: so.so_number, counterparty: so.customer_name,
      doc_status: "draft", owner_role: "sales", assigned_user: so.created_by,
      required_action: `Send sales order ${so.so_number} to warehouse`,
      next_action: "Warehouse approval", amount: so.grand_total,
    });

    res.status(201).json(so);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/goods-sales-orders/:id ── (editable while draft/confirmed)
const updateSchema = createSchema.partial();

router.patch("/:id", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status === "pending_warehouse_approval" || existing.manual_status === "pending_checker_approval") {
      res.status(400).json({ error: "This sales order is awaiting approval and cannot be edited — ask the warehouse or checker to reject it back to draft" });
      return;
    }
    if (existing.manual_status !== "draft" && existing.manual_status !== "approved") {
      res.status(400).json({ error: `Sales orders can only be edited while draft or approved (current: ${existing.status})` });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };

    let mergedLines: GoodsSalesOrderLine[] | null = null;
    if (parsed.lines) {
      // Lines that already have dispatched qty can't be removed or reduced below dispatched.
      for (const newLine of parsed.lines) {
        const old = matchExistingLine(existing.lines, newLine);
        if (old && newLine.ordered_qty != null && newLine.ordered_qty < old.dispatched_qty) {
          res.status(400).json({ error: `Cannot reduce \"${old.name}\" below its dispatched quantity (${old.dispatched_qty})` });
          return;
        }
      }
      const removed = existing.lines.filter((l) => !parsed.lines!.some((nl) => matchExistingLine(existing.lines, nl) === l));
      if (removed.some((l) => l.dispatched_qty > 0)) {
        res.status(400).json({ error: "Cannot remove a line that already has dispatched quantity" });
        return;
      }
      // Recompute totals + preserve dispatched quantities (product → sku → name matching).
      mergedLines = parsed.lines.map((nl) => {
        const old = matchExistingLine(existing.lines, nl);
        const sku = nl.sku ?? old?.sku ?? "";
        const unitPrice = nl.unit_price ?? old?.unit_price ?? 0;
        const discountPct = nl.discount_pct ?? old?.discount_pct ?? 0;
        const orderedQty = nl.ordered_qty ?? old?.ordered_qty ?? 0;
        return {
          product_id: nl.product_id ?? old?.product_id ?? null,
          sku,
          name: nl.name.trim(),
          unit: (nl.unit ?? old?.unit)?.trim() || "unit",
          ordered_qty: orderedQty,
          unit_price: unitPrice,
          discount_pct: discountPct,
          gst_rate: nl.gst_rate != null ? nl.gst_rate : (old?.gst_rate ?? null),
          dispatched_qty: old?.dispatched_qty ?? 0,
          line_total: Math.round(orderedQty * unitPrice * (1 - discountPct / 100) * 100) / 100,
        };
      });
    }
    if (mergedLines || parsed.freight !== undefined) {
      const baseLines = mergedLines ?? existing.lines;
      const freight = parsed.freight !== undefined ? parsed.freight : (existing.freight ?? 0);
      const { subtotal, total_discount, gst_total, grand_total } = computeSalesTotals(baseLines, Number(freight ?? 0));
      if (mergedLines) updates.lines = mergedLines;
      updates.subtotal = subtotal;
      updates.total_discount = total_discount;
      updates.gst_total = gst_total;
      updates.grand_total = grand_total;
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && k !== "lines") updates[k] = v;
    }
    // Keep denormalized party names truthful when the bill/ship customer changes.
    if (parsed.billing_customer_id !== undefined || parsed.shipping_customer_id !== undefined || parsed.customer_id !== undefined) {
      const customerMap = await buildCustomerMap(req.user!.company_id);
      const billingId = (parsed.billing_customer_id as string | null | undefined)
        ?? (parsed.customer_id as string | null | undefined)
        ?? existing.billing_customer_id ?? existing.customer_id ?? null;
      const shippingId = ((parsed.shipping_customer_id as string | null | undefined)
        ?? existing.shipping_customer_id ?? billingId) || null;
      updates.customer_id = billingId;
      updates.billing_customer_id = billingId;
      updates.shipping_customer_id = shippingId;
      updates.customer_name = billingId ? customerMap.get(billingId)?.name ?? null : null;
      updates.billing_customer_name = updates.customer_name;
      updates.shipping_customer_name = shippingId ? customerMap.get(shippingId)?.name ?? null : null;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Sales order not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/submit ── (maker sends draft to the warehouse)
router.post("/:id/submit", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "draft") {
      res.status(400).json({ error: `Only draft sales orders can be sent for warehouse approval (current: ${existing.status})` });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "pending_warehouse_approval",
      status: "pending_warehouse_approval",
      warehouse_review_comments: null,
      warehouse_reviewed_by: null,
      warehouse_reviewed_at: null,
      review_comments: null,
      reviewed_by: null,
      reviewed_at: null,
      approved_by: null,
      approved_at: null,
      updated_at: nowISO(),
    });
    createActivityAlert({
      client_id: existing.client_id,
      company_id: existing.company_id,
      type: "sales_order_created",
      severity: "info",
      message: `Sales order ${existing.so_number} sent to warehouse for approval`,
      created_by: req.user!.id,
    });
    // My Queue: submit task done → warehouse approval task opens.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id, "submit");
    ensureTask(existing.company_id, existing.client_id, {
      workflow_type: "sales_order", stage: "warehouse_approve", doc_type: "sales_order",
      doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
      doc_status: "pending_warehouse_approval", owner_role: "warehouse",
      required_action: `Approve sales order ${existing.so_number} (warehouse)`,
      next_action: "Checker approval", amount: existing.grand_total,
    });
    res.json(updated);
  } catch (err) {
    console.error("Submit goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/warehouse-approve ── (warehouse sign-off, step 1)
router.post("/:id/warehouse-approve", requireAuth, requireAnyWriteAccess("goods-sales-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "pending_warehouse_approval") {
      res.status(400).json({ error: `Only sales orders awaiting warehouse approval can be signed off (current: ${existing.status})` });
      return;
    }
    const now = nowISO();
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "pending_checker_approval",
      status: "pending_checker_approval",
      warehouse_review_comments: null,
      warehouse_reviewed_by: req.user!.id,
      warehouse_reviewed_at: now,
      updated_at: now,
    });
    createActivityAlert({
      client_id: existing.client_id,
      company_id: existing.company_id,
      type: "sales_order_created",
      severity: "info",
      message: `Sales order ${existing.so_number} approved by warehouse — sent to checker for final approval`,
      created_by: req.user!.id,
    });
    // My Queue: warehouse task done → checker approval task opens.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id, "warehouse_approve");
    ensureTask(existing.company_id, existing.client_id, {
      workflow_type: "sales_order", stage: "checker_approve", doc_type: "sales_order",
      doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
      doc_status: "pending_checker_approval", owner_role: "checker",
      required_action: `Approve sales order ${existing.so_number} (checker)`,
      next_action: "Dispatch & invoice", amount: existing.grand_total,
    });
    res.json(updated);
  } catch (err) {
    console.error("Warehouse-approve goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/warehouse-reject ── (warehouse sends back to draft)
router.post("/:id/warehouse-reject", requireAuth, requireAnyWriteAccess("goods-sales-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body ?? {};
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "pending_warehouse_approval") {
      res.status(400).json({ error: `Only sales orders awaiting warehouse approval can be rejected (current: ${existing.status})` });
      return;
    }
    const now = nowISO();
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "draft",
      status: "draft",
      warehouse_review_comments: comments ? String(comments).slice(0, 2000) : null,
      warehouse_reviewed_by: req.user!.id,
      warehouse_reviewed_at: now,
      updated_at: now,
    });
    createActivityAlert({
      client_id: existing.client_id,
      company_id: existing.company_id,
      type: "sales_order_created",
      severity: "warning",
      message: `Sales order ${existing.so_number} rejected by warehouse — back to draft${comments ? `: ${String(comments).slice(0, 140)}` : ""}`,
      created_by: req.user!.id,
    });
    // My Queue: back to a draft submit task for the maker.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id);
    ensureTask(existing.company_id, existing.client_id, {
      workflow_type: "sales_order", stage: "submit", doc_type: "sales_order",
      doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
      doc_status: "draft", owner_role: "sales", assigned_user: existing.created_by,
      required_action: `Rework sales order ${existing.so_number} (warehouse rejected)`,
      next_action: "Warehouse approval", amount: existing.grand_total,
      latest_update: comments ? String(comments).slice(0, 500) : null,
    });
    res.json(updated);
  } catch (err) {
    console.error("Warehouse-reject goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/approve ── (checker only, step 2 — releases the order)
// Approving the SO is the final gate: dispatch and invoicing unblock immediately.
router.post("/:id/approve", requireAuth, requireAnyWriteAccess("goods-sales-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    if (!isApprover(req.user!.roles)) {
      res.status(403).json({ error: "Only a checker or admin can approve sales orders" });
      return;
    }
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "pending_checker_approval" && existing.manual_status !== "draft" && existing.manual_status !== "pending_warehouse_approval") {
      res.status(400).json({ error: `Only sales orders awaiting review can be approved (current: ${existing.status})` });
      return;
    }
    const now = nowISO();
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "approved",
      status: "approved",
      review_comments: null,
      reviewed_by: req.user!.id,
      reviewed_at: now,
      approved_by: req.user!.id,
      approved_at: now,
      updated_at: now,
    });
    createActivityAlert({
      client_id: existing.client_id,
      company_id: existing.company_id,
      type: "sales_order_created",
      severity: "info",
      message: `Sales order ${existing.so_number} approved by checker — goods can now be dispatched or invoiced`,
      created_by: req.user!.id,
    });
    // My Queue: review tasks done. Advance payment terms divert the flow into
    // the proforma/funding track (proforma → checker → treasury advance);
    // every other flow goes straight to dispatch/invoice.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id);
    const isAdvanceTerms = String(existing.payment_terms ?? "").trim().toLowerCase().replace(/\s+/g, "_") === "advance";
    if (isAdvanceTerms) {
      ensureTask(existing.company_id, existing.client_id, {
        workflow_type: "sales_order", stage: "create_proforma", doc_type: "sales_order",
        doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
        doc_status: "approved", owner_role: "sales",
        required_action: `Create proforma for sales order ${existing.so_number} (advance payment terms)`,
        next_action: "Checker approval", amount: existing.grand_total,
        due_date: existing.expected_delivery_date ?? null,
        linked_docs: [{ type: "sales_order", id: existing.id, number: existing.so_number }],
      });
    } else {
      ensureTask(existing.company_id, existing.client_id, {
        workflow_type: "sales_order", stage: "dispatch_invoice", doc_type: "sales_order",
        doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
        doc_status: "approved", owner_role: "sales",
        required_action: `Dispatch or invoice ${existing.so_number}`,
        next_action: "Create tax invoice", amount: existing.grand_total,
        due_date: existing.expected_delivery_date ?? null,
      });
    }
    res.json(updated);
  } catch (err) {
    console.error("Approve goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/reject ── (checker sends back to draft)
router.post("/:id/reject", requireAuth, requireAnyWriteAccess("goods-sales-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    if (!isApprover(req.user!.roles)) {
      res.status(403).json({ error: "Only a checker or admin can reject sales orders" });
      return;
    }
    const { comments } = req.body ?? {};
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "pending_checker_approval") {
      res.status(400).json({ error: `Only sales orders awaiting checker review can be rejected (current: ${existing.status})` });
      return;
    }
    const now = nowISO();
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "draft",
      status: "draft",
      review_comments: comments ? String(comments).slice(0, 2000) : null,
      reviewed_by: req.user!.id,
      reviewed_at: now,
      updated_at: now,
    });
    createActivityAlert({
      client_id: existing.client_id,
      company_id: existing.company_id,
      type: "sales_order_created",
      severity: "warning",
      message: `Sales order ${existing.so_number} rejected by checker — back to draft${comments ? `: ${String(comments).slice(0, 140)}` : ""}`,
      created_by: req.user!.id,
    });
    // My Queue: back to a draft submit task for the maker.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id);
    ensureTask(existing.company_id, existing.client_id, {
      workflow_type: "sales_order", stage: "submit", doc_type: "sales_order",
      doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
      doc_status: "draft", owner_role: "sales", assigned_user: existing.created_by,
      required_action: `Rework sales order ${existing.so_number} (checker rejected)`,
      next_action: "Warehouse approval", amount: existing.grand_total,
      latest_update: comments ? String(comments).slice(0, 500) : null,
    });
    res.json(updated);
  } catch (err) {
    console.error("Reject goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/confirm ── (legacy: draft → confirmed)
// Kept for orders created before the approval chain so old drafts are never
// stranded; new orders go through submit → warehouse → checker → approved.
router.post("/:id/confirm", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.manual_status !== "draft") {
      res.status(400).json({ error: `Only draft sales orders can be confirmed (current: ${existing.status})` });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "confirmed",
      status: "confirmed",
      updated_at: nowISO(),
    });
    // My Queue (legacy confirm): review tasks done → dispatch/invoice task opens.
    completeTasksForDoc(existing.company_id, "sales_order", existing.id, req.user!.id);
    ensureTask(existing.company_id, existing.client_id, {
      workflow_type: "sales_order", stage: "dispatch_invoice", doc_type: "sales_order",
      doc_id: existing.id, doc_number: existing.so_number, counterparty: existing.customer_name,
      doc_status: "confirmed", owner_role: "sales",
      required_action: `Dispatch or invoice ${existing.so_number}`,
      next_action: "Create tax invoice", amount: existing.grand_total,
      due_date: existing.expected_delivery_date ?? null,
    });
    res.json(updated);
  } catch (err) {
    console.error("Confirm goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-sales-orders/:id/cancel ──
router.post("/:id/cancel", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.status === "cancelled") {
      res.status(400).json({ error: "Sales order is already cancelled" });
      return;
    }
    if (existing.status === "fully_dispatched") {
      res.status(400).json({ error: "Cannot cancel a fully dispatched sales order" });
      return;
    }
    const dispatched = existing.lines.reduce((s, l) => s + Number(l.dispatched_qty || 0), 0);
    if (dispatched > 0) {
      res.status(400).json({ error: "Cannot cancel a sales order with dispatched goods — reverse the dispatches first" });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }, {
      manual_status: "cancelled",
      status: "cancelled",
      updated_at: nowISO(),
    });
    // My Queue: drop open tasks for the cancelled order.
    cancelTasksForDoc(existing.company_id, "sales_order", existing.id, "Sales order cancelled");
    res.json(updated);
  } catch (err) {
    console.error("Cancel goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/goods-sales-orders/:id ── (allowed regardless of status)
router.delete("/:id", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    await deleteItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id });
    // My Queue: drop open tasks for the deleted order regardless of status.
    cancelTasksForDoc(existing.company_id, "sales_order", existing.id, "Sales order deleted");
    res.json({ success: true });
  } catch (err) {
    console.error("Delete goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
