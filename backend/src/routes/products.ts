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
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { triggerForecastRecompute } from "../utils/forecast.js";
import { generateSku, skuExists } from "../utils/catalogue.js";
import type { Product, Supplier, Vendor } from "../types/index.js";

const router = Router();

/**
 * Build id → display-name maps for suppliers AND vendors so the catalogue
 * UI can show which supplier a product is sourced from in one lookup.
 */
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

// ── Validation ──

const barcodeTypes = ["EAN-13", "UPC-A", "QR"] as const;

const productSchema = z.object({
  sku: z.string().trim().max(64).optional().nullable(),
  name: z.string().trim().min(1, "Product name is required").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  barcode: z.string().trim().max(64).optional().nullable(),
  barcode_type: z.enum(barcodeTypes).optional().nullable(),
  category: z.string().trim().max(100).optional().nullable(),
  subcategory: z.string().trim().max(100).optional().nullable(),
  brand: z.string().trim().max(120).optional().nullable(),
  gender: z.string().trim().max(40).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
  season: z.string().trim().max(40).optional().nullable(),
  image_url: z.string().trim().max(500).optional().nullable(),
  unit_price: z.number().min(0, "Unit price must be >= 0"),
  unit_cost: z.number().min(0, "Unit cost must be >= 0"),
  mrp: z.number().min(0).optional().nullable(),
  minimum_gross_margin_percentage: z
    .number()
    .min(0.01, "Margin must be between 1% and 99%")
    .max(0.99, "Margin must be between 1% and 99%")
    .optional()
    .nullable(),
  gst_rate: z.number().min(0, "GST rate must be >= 0").max(100, "GST rate must be <= 100").optional().nullable(),
  unit_of_measure: z.string().trim().min(1, "Unit of measure is required").max(40).optional(),
  units_per_carton: z.number().min(0).optional().nullable(),
  reorder_level: z.number().min(0).optional().nullable(),
  max_stock: z.number().min(0).optional().nullable(),
  lead_time_days: z.number().int().min(0).max(3650).optional(),
  safety_stock_days: z.number().int().min(0).max(3650).optional(),
  supplier_id: z.string().trim().max(200).optional().nullable(),
  supplier_product_code: z.string().trim().max(100).optional().nullable(),
  minimum_order_quantity: z.number().min(0).optional().nullable(),
  order_multiple: z.number().min(0).optional().nullable(),
  hsn_code: z.string().trim().max(30).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
});

const productUpdateSchema = productSchema.partial();

// ── GET /api/products ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [products, supplierMap] = await Promise.all([
      scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!)),
      buildSupplierMap(req.user!.company_id),
    ]);
    const enriched = products
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => ({ ...p, supplier_name: p.supplier_id ? supplierMap.get(p.supplier_id) ?? null : null }));
    res.json(enriched);
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/products/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const product = await getItem(TABLES.PRODUCTS, { id: req.params.id }) as Product | undefined;
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    if (req.user!.company_id && product.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(product);
  } catch (err) {
    console.error("Get product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/products ──
router.post("/", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = productSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    // SKU: explicit value or auto-generated; must be unique per company.
    const sku = (parsed.sku?.trim() || generateSku()).toUpperCase();
    if (await skuExists(sku, req.user!.company_id)) {
      res.status(409).json({ error: `SKU "${sku}" is already in use` });
      return;
    }

    const product: Product = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      sku,
      name: parsed.name.trim(),
      description: parsed.description?.trim() || null,
      barcode: parsed.barcode?.trim() || null,
      barcode_type: parsed.barcode_type || null,
      category: parsed.category?.trim() || null,
      subcategory: parsed.subcategory?.trim() || null,
      brand: parsed.brand?.trim() || null,
      gender: parsed.gender?.trim() || null,
      size: parsed.size?.trim() || null,
      color: parsed.color?.trim() || null,
      model: parsed.model?.trim() || null,
      season: parsed.season?.trim() || null,
      image_url: parsed.image_url?.trim() || null,
      unit_price: parsed.unit_price,
      unit_cost: parsed.unit_cost,
      mrp: parsed.mrp ?? null,
      minimum_gross_margin_percentage: parsed.minimum_gross_margin_percentage ?? null,
      gst_rate: parsed.gst_rate ?? null,
      unit_of_measure: parsed.unit_of_measure?.trim() || "piece",
      units_per_carton: parsed.units_per_carton ?? null,
      reorder_level: parsed.reorder_level ?? null,
      max_stock: parsed.max_stock ?? null,
      lead_time_days: parsed.lead_time_days ?? 30,
      safety_stock_days: parsed.safety_stock_days ?? 30,
      supplier_id: parsed.supplier_id?.trim() || null,
      supplier_product_code: parsed.supplier_product_code?.trim() || null,
      minimum_order_quantity: parsed.minimum_order_quantity ?? null,
      order_multiple: parsed.order_multiple ?? null,
      hsn_code: parsed.hsn_code?.trim() || null,
      status: parsed.status ?? "active",
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.PRODUCTS, product as any);

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "product_created",
      severity: "info",
      message: `Catalogue product "${product.name}" (${product.sku}) added`,
      created_by: req.user!.id,
    });

    res.status(201).json(product);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/products/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = productUpdateSchema.parse(req.body);
    const existing = await getItem(TABLES.PRODUCTS, { id: req.params.id }) as Product | undefined;
    if (!existing) { res.status(404).json({ error: "Product not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // SKU uniqueness re-check when the SKU is being changed.
    if (parsed.sku && parsed.sku.trim() && parsed.sku.trim().toUpperCase() !== existing.sku) {
      const newSku = parsed.sku.trim().toUpperCase();
      if (await skuExists(newSku, req.user!.company_id, existing.id)) {
        res.status(409).json({ error: `SKU "${newSku}" is already in use` });
        return;
      }
      parsed.sku = newSku;
    }

    // Only send provided keys (drop undefined); nulls explicitly clear fields.
    const updates: Record<string, unknown> = { updated_at: nowISO() };
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updates[k] = v;
    }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    const updated = await updateItem(TABLES.PRODUCTS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Product not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/products/:id ──
// Deleting a product cascades to its inventory movements and forecast
// snapshots (wired in the stock-ledger and forecasting phases). Documents
// keep their line-item snapshots, so old orders/invoices are never corrupted.
router.delete("/:id", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.PRODUCTS, { id: req.params.id }) as Product | undefined;
    if (!existing) { res.status(404).json({ error: "Product not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    // Delete cascade: drop its forecast snapshot, then refresh the batch.
    await deleteItem(TABLES.PRODUCTS, { id: req.params.id });
    await deleteItem(TABLES.FORECAST_VARIABLES, { id: `fc_${req.params.id}` }).catch(() => {});
    triggerForecastRecompute(req.user!.company_id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
