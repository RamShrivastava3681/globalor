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
import { computeSalesTotals } from "../utils/goodsSales.js";
import type {
  GoodsSalesOrder, GoodsSalesOrderLine,
  Product, Debtor,
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

/** Debtor id → {name, contact, address, payment terms} (customer master). */
async function buildDebtorMap(companyId: string | null): Promise<Map<string, Debtor>> {
  const debtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter({ company_id: companyId }));
  return new Map(debtors.map((d) => [d.id, d]));
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
    const [orders, debtorMap] = await Promise.all([
      scanTable<GoodsSalesOrder>(TABLES.GOODS_SALES_ORDERS, getCompanyFilter(req.user!)),
      buildDebtorMap(req.user!.company_id),
    ]);
    const enriched = orders
      .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || "") || (b.created_at || "").localeCompare(a.created_at || ""))
      .map((so) => ({
        ...so,
        customer_name: so.customer_name ?? (so.customer_id ? debtorMap.get(so.customer_id)?.name ?? null : null),
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

    const debtor = parsed.customer_id ? (await buildDebtorMap(req.user!.company_id)).get(parsed.customer_id) : undefined;
    const customerName = parsed.customer_id ? (debtor?.name ?? null) : null;

    const soNumber = generateDocNumber("SO");
    const so: GoodsSalesOrder = {
      id: generateId(),
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      so_number: soNumber,
      order_date: parsed.order_date,
      customer_id: parsed.customer_id || null,
      customer_name: customerName,
      contact_person: parsed.contact_person ?? debtor?.contact_name ?? null,
      billing_address: parsed.billing_address ?? debtor?.registered_address ?? null,
      delivery_address: parsed.delivery_address ?? debtor?.registered_address ?? null,
      salesperson_name: parsed.salesperson_name ?? req.user!.email,
      linked_quotation_id: parsed.linked_quotation_id || null,
      linked_quotation_number: parsed.linked_quotation_number || null,
      payment_terms: parsed.payment_terms ?? (debtor?.payment_terms_days ? `Net ${debtor.payment_terms_days}` : null),
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
    if (existing.manual_status !== "draft" && existing.manual_status !== "confirmed") {
      res.status(400).json({ error: `Sales orders can only be edited while draft or confirmed (current: ${existing.status})` });
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

// ── POST /api/goods-sales-orders/:id/confirm ── (draft → confirmed — maker action)
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
    res.json(updated);
  } catch (err) {
    console.error("Cancel goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/goods-sales-orders/:id ── (drafts only)
router.delete("/:id", requireAuth, requireWriteAccess("goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id }) as GoodsSalesOrder | undefined;
    if (!existing) { res.status(404).json({ error: "Sales order not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(400).json({ error: `Only draft sales orders can be deleted (current: ${existing.status})` });
      return;
    }
    await deleteItem(TABLES.GOODS_SALES_ORDERS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete goods sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
