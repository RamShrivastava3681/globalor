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
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateDocNumber, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { poDerivedStatus, computeOrderTotals } from "../utils/goodsOrders.js";
import type {
  GoodsPurchaseOrder, GoodsPurchaseOrderLine,
  PurchaseOrder, PurchaseInvoice, Product, Supplier, Vendor,
} from "../types/index.js";

const router = Router();

// ── Helpers ──

/** Match an edited line against the existing PO lines — product first, then sku, then name. */
function matchExistingLine(
  existing: GoodsPurchaseOrderLine[],
  nl: { product_id?: string | null; sku?: string | null; name?: string },
): GoodsPurchaseOrderLine | undefined {
  if (nl.product_id) return existing.find((l) => l.product_id === nl.product_id);
  if (nl.sku) return existing.find((l) => l.sku === nl.sku);
  return existing.find((l) => l.name === nl.name);
}

/** Merged supplier+vendor id → display-name map (same as every procurement dropdown). */
async function buildSupplierMap(companyId: string | null): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const filter = getCompanyFilter({ company_id: companyId });
  const [suppliers, vendors] = await Promise.all([
    scanTable<Supplier>(TABLES.SUPPLIERS, filter),
    scanTable<Vendor>(TABLES.VENDORS, filter),
  ]);
  for (const s of suppliers) map.set(s.id, s.company_name);
  for (const v of vendors) map.set(v.id, v.name);
  return map;
}

/** True when the actor can approve POs / allow over-receipts (checker gates). */
function isApprover(roles: string[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

// ── Validation ──

const poLineSchema = z.object({
  product_id: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().min(1, "Line item name is required").max(200),
  sku: z.string().trim().max(64).nullable().optional(),
  unit: z.string().trim().max(40).optional(),
  ordered_qty: z.number().positive("Ordered qty must be > 0"),
  unit_price: z.number().min(0, "Unit price must be >= 0"),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
});

const createSchema = z.object({
  po_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  supplier_id: z.string().trim().max(200).nullable().optional(),
  warehouse: z.string().trim().max(120).nullable().optional(),
  expected_delivery_date: z.string().nullable().optional(),
  payment_terms: z.string().trim().max(60).nullable().optional(),
  buyer_name: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  freight: z.number().min(0).nullable().optional(),
  lines: z.array(poLineSchema).min(1, "Add at least one line"),
  /** Create a supplier proforma or purchase invoice in the same call. */
  also_create: z.enum(["proforma", "purchase_invoice"]).nullable().optional().default(null),
});

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [orders, supplierMap] = await Promise.all([
      scanTable<GoodsPurchaseOrder>(TABLES.GOODS_PURCHASE_ORDERS, getCompanyFilter(req.user!)),
      buildSupplierMap(req.user!.company_id),
    ]);
    const enriched = orders
      .sort((a, b) => (b.po_date || "").localeCompare(a.po_date || "") || (b.created_at || "").localeCompare(a.created_at || ""))
      .map((po) => ({
        ...po,
        supplier_name: po.supplier_name ?? (po.supplier_id ? supplierMap.get(po.supplier_id) ?? null : null),
      }));
    res.json(enriched);
  } catch (err) {
    console.error("Get goods purchase orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/last-prices", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const filter = getCompanyFilter(req.user!);
    const [receipts, orders] = await Promise.all([
      scanTable<any>(TABLES.GOODS_RECEIPTS, filter),
      scanTable<GoodsPurchaseOrder>(TABLES.GOODS_PURCHASE_ORDERS, filter),
    ]);
    // Most recent first; first hit wins → the latest confirmed GRN price,
    // else the latest PO price, for each product.
    const lastPrice = new Map<string, number>();
    const consider = (productId: string | null | undefined, price: number | null | undefined) => {
      if (!productId || price == null) return;
      if (!lastPrice.has(productId)) lastPrice.set(productId, price);
    };
    [...receipts]
      .sort((a: any, b: any) => (b.confirmed_at || b.created_at || "").localeCompare(a.confirmed_at || a.created_at || ""))
      .forEach((r: any) => (r.lines ?? []).forEach((l: any) => consider(l.product_id, l.unit_cost)));
    [...orders]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .forEach((po) => po.lines.forEach((l) => consider(l.product_id, l.unit_price)));
    res.json(Object.fromEntries(lastPrice));
  } catch (err) {
    console.error("Get last prices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const po = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && po.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    res.json(po);
  } catch (err) {
    console.error("Get goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const now = nowISO();

    // Snapshot product info from the catalogue where a product is picked.
    const productIds = parsed.lines.map((l) => l.product_id).filter(Boolean) as string[];
    const products = productIds.length
      ? await scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!))
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const lines: GoodsPurchaseOrderLine[] = parsed.lines.map((l) => {
      const product = l.product_id ? productMap.get(l.product_id) : undefined;
      const sku = product?.sku ?? l.sku ?? `SKU-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const name = product?.name ?? l.name.trim();
      const unit = product?.unit_of_measure ?? (l.unit?.trim() || "unit");
      const unitPrice = product ? (l.unit_price > 0 ? l.unit_price : product.unit_cost ?? 0) : l.unit_price;
      return {
        product_id: l.product_id || null,
        sku,
        name,
        unit,
        ordered_qty: l.ordered_qty,
        unit_price: Math.round(unitPrice * 100) / 100,
        gst_rate: l.gst_rate ?? product?.gst_rate ?? null,
        received_qty: 0,
        line_total: Math.round(l.ordered_qty * unitPrice * 100) / 100,
      };
    });

    const { subtotal, gst_total, grand_total } = computeOrderTotals(lines, parsed.freight ?? 0);
    const supplierName = parsed.supplier_id ? (await buildSupplierMap(req.user!.company_id)).get(parsed.supplier_id) ?? null : null;

    const id = generateId();
    const poNumber = generateDocNumber("PO");
    const po: GoodsPurchaseOrder = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      po_number: poNumber,
      po_date: parsed.po_date,
      supplier_id: parsed.supplier_id || null,
      supplier_name: supplierName,
      warehouse: parsed.warehouse || null,
      expected_delivery_date: parsed.expected_delivery_date || null,
      payment_terms: parsed.payment_terms || null,
      buyer_name: parsed.buyer_name || req.user!.email,
      notes: parsed.notes || null,
      freight: parsed.freight ?? null,
      lines,
      subtotal,
      gst_total,
      grand_total,
      manual_status: "draft",
      status: "draft",
      documents: [],
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.GOODS_PURCHASE_ORDERS, po as any);

    // ── One-modal extras ──
    let createdProforma: PurchaseOrder | null = null;
    let createdInvoice: PurchaseInvoice | null = null;

    if (parsed.also_create === "proforma") {
      const proformaNumber = generateDocNumber("PF");
      createdProforma = {
        id: generateId(),
        client_id: req.user!.id,
        company_id: req.user!.company_id,
        side: "purchase",
        debtor_id: null,
        vendor_id: parsed.supplier_id || null,
        po_number: poNumber,
        proforma_number: proformaNumber,
        proforma_date: now.slice(0, 10),
        amount: grand_total,
        currency: "USD",
        issue_date: now.slice(0, 10),
        expected_date: parsed.expected_delivery_date || null,
        status: "proforma",
        proforma_status: "pending_review",
        proforma_review_comments: null,
        proforma_reviewed_at: null,
        proforma_reviewed_by: null,
        proforma_funded_amount: null,
        proforma_funded_at: null,
        proforma_funded_by: null,
        proforma_funding_reference: null,
        converted_to: null,
        converted_document_number: null,
        converted_at: null,
        notes: parsed.notes || `Created from ${poNumber}`,
        documents: [],
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.PURCHASE_ORDERS, createdProforma as any);
    } else if (parsed.also_create === "purchase_invoice") {
      if (!parsed.supplier_id) {
        // A purchase invoice is a supplier payable — it needs a vendor to bill.
        await deleteItem(TABLES.GOODS_PURCHASE_ORDERS, { id });
        res.status(400).json({ error: "Pick a supplier to also create a purchase invoice" });
        return;
      }
      createdInvoice = {
        id: generateId(),
        client_id: req.user!.id,
        company_id: req.user!.company_id,
        vendor_id: parsed.supplier_id,
        invoice_number: `PI-${poNumber}`,
        amount: grand_total,
        amount_paid: null,
        advance_rate: 0,
        po_number: poNumber,
        po_date: parsed.po_date,
        issue_date: now.slice(0, 10),
        due_date: null,
        paid_date: null,
        funded_date: null,
        advance_paid_date: null,
        paid_note: null,
        notes: parsed.notes || `Created from ${poNumber}`,
        status: "draft",
        documents: [],
        purchase_order_id: null,
        goods_purchase_order_id: id,
        // Snapshot the PO lines so the invoice shows what was ordered; what the
        // supplier actually billed (invoice_qty) stays editable, and confirmed
        // GRNs back-fill grn_received_qty on the first receipt.
        lines: lines.map((l) => ({
          product_id: l.product_id,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          ordered_qty: l.ordered_qty,
          grn_received_qty: 0,
          invoice_qty: 0,
          unit_price: l.unit_price,
          po_unit_price: l.unit_price,
          gst_rate: l.gst_rate,
          line_total: 0,
        })),
        linked_goods_receipt_ids: [],
        version: 0,
        linked_sales_invoice_ids: [],
        payment_terms_days: 30,
        bl_date: null,
        due_date_source: "invoice",
        has_contractual_due_date: false,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.PURCHASE_INVOICES, createdInvoice as any);
    }

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "purchase_order_created",
      severity: "info",
      message: `Purchase order ${poNumber} created — ${lines.length} line${lines.length !== 1 ? "s" : ""}, ${lines.reduce((s, l) => s + l.ordered_qty, 0)} units, ${grand_total.toLocaleString()} total`,
      created_by: req.user!.id,
    });

    res.status(201).json({ ...po, created_proforma: createdProforma, created_invoice: createdInvoice });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/goods-purchase-orders/:id ── (editable only while draft/approved)
const updateSchema = createSchema.omit({ also_create: true }).partial();

router.patch("/:id", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const existing = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (existing.manual_status !== "draft" && existing.manual_status !== "approved") {
      res.status(400).json({ error: `Purchase orders can only be edited while draft or approved (current: ${existing.status})` });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };

    if (parsed.lines) {
      // Lines that already have received qty can't be removed or reduced below received.
      for (const newLine of parsed.lines) {
        const old = matchExistingLine(existing.lines, newLine);
        if (old && newLine.ordered_qty != null && newLine.ordered_qty < old.received_qty) {
          res.status(400).json({ error: `Cannot reduce "${old.name}" below its received quantity (${old.received_qty})` });
          return;
        }
      }
      const removed = existing.lines.filter((l) => !parsed.lines!.some((nl) => matchExistingLine(existing.lines, nl) === l));
      if (removed.some((l) => l.received_qty > 0)) {
        res.status(400).json({ error: "Cannot remove a line that already has received quantity" });
        return;
      }
      // Recompute totals + preserve received quantities (product → sku → name matching).
      const mergedLines: GoodsPurchaseOrderLine[] = parsed.lines.map((nl) => {
        const old = matchExistingLine(existing.lines, nl);
        const sku = nl.sku ?? old?.sku ?? "";
        return {
          product_id: nl.product_id ?? old?.product_id ?? null,
          sku,
          name: nl.name.trim(),
          unit: (nl.unit ?? old?.unit)?.trim() || "unit",
          ordered_qty: nl.ordered_qty ?? old?.ordered_qty ?? 0,
          unit_price: nl.unit_price ?? old?.unit_price ?? 0,
          gst_rate: nl.gst_rate != null ? nl.gst_rate : (old?.gst_rate ?? null),
          received_qty: old?.received_qty ?? 0,
          line_total: Math.round((nl.ordered_qty ?? old?.ordered_qty ?? 0) * (nl.unit_price ?? old?.unit_price ?? 0) * 100) / 100,
        };
      });
      const { subtotal, gst_total, grand_total } = computeOrderTotals(mergedLines, Number(parsed.freight ?? existing.freight ?? 0));
      updates.lines = mergedLines;
      updates.subtotal = subtotal;
      updates.gst_total = gst_total;
      updates.grand_total = grand_total;
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && k !== "lines") updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    const updated = await updateItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Purchase order not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-purchase-orders/:id/approve ── (checker/admin only)
router.post("/:id/approve", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    if (!isApprover(req.user!.roles)) {
      res.status(403).json({ error: "Only a checker or admin can approve purchase orders" });
      return;
    }
    const existing = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (existing.manual_status !== "draft") {
      res.status(400).json({ error: `Only draft purchase orders can be approved (current: ${existing.status})` });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }, {
      manual_status: "approved",
      status: "approved",
      updated_at: nowISO(),
    });
    res.json(updated);
  } catch (err) {
    console.error("Approve goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-purchase-orders/:id/send ──
router.post("/:id/send", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (existing.manual_status !== "approved") {
      res.status(400).json({ error: `Only approved purchase orders can be marked sent (current: ${existing.status})` });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }, {
      manual_status: "sent",
      status: "sent",
      updated_at: nowISO(),
    });
    res.json(updated);
  } catch (err) {
    console.error("Send goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/goods-purchase-orders/:id/cancel ──
router.post("/:id/cancel", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (existing.status === "cancelled") {
      res.status(400).json({ error: "Purchase order is already cancelled" });
      return;
    }
    const received = existing.lines.reduce((s, l) => s + Number(l.received_qty || 0), 0);
    if (received > 0) {
      res.status(400).json({ error: "Cannot cancel a purchase order with received goods — reverse the GRNs first" });
      return;
    }
    const updated = await updateItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }, {
      manual_status: "cancelled",
      status: "cancelled",
      updated_at: nowISO(),
    });
    res.json(updated);
  } catch (err) {
    console.error("Cancel goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/goods-purchase-orders/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id }) as GoodsPurchaseOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: `Only draft purchase orders can be deleted (current: ${existing.status})` });
      return;
    }
    await deleteItem(TABLES.GOODS_PURCHASE_ORDERS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete goods purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
