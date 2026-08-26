import { Router, Response } from "express";
import { z } from "zod";
import {
  deleteItem,
  scanTable,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireAnyWriteAccess, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { generateSku } from "../utils/catalogue.js";
import { recomputeAll } from "../utils/forecast.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { InventoryItem, Product } from "../types/index.js";

const router = Router();

// ── GET /api/inventory-items ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const items = await scanTable<InventoryItem>(TABLES.INVENTORY_ITEMS, getCompanyFilter(req.user!));
    res.json(
      items
        .sort((a, b) => (a.item || "").localeCompare(b.item || ""))
    );
  } catch (err) {
    console.error("Get inventory items error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/inventory-items/batch ──
// Mass import doubles as a catalogue bootstrap: every row creates (a) a legacy
// tracking item AND (b) a product catalogue entry. A row whose SKU already
// exists in the catalogue is LINKED to that product instead of duplicated.
// After the import the forecast batch is recomputed so the new SKUs show up on
// the forecasting page immediately.
const batchCreateSchema = z.object({
  items: z.array(z.object({
    item: z.string().min(1, "Item name is required"),
    description: z.string().optional().nullable().default(""),
    closing_quantity: z.number().min(0, "Closing quantity must be >= 0"),
    price_sale: z.number().min(0, "Price sale must be >= 0"),
    unit_cost: z.number().min(0, "Unit cost must be >= 0"),
    sku: z.string().trim().max(64).optional().nullable(),
    mrp: z.number().min(0, "MRP must be >= 0").optional().nullable(),
  })).min(1, "At least one item is required"),
});

/** Build a catalogue Product from an imported row (mirrors the products route). */
function buildProduct(
  item: {
    name: string;
    description?: string | null;
    price_sale: number;
    unit_cost: number;
    mrp?: number | null;
  },
  sku: string,
  now: string,
  clientId: string,
  companyId: string | null,
): Product {
  // unit_price is required on a product — prefer the sale price, else MRP, else cost.
  const unitPrice = item.price_sale > 0 ? item.price_sale : (item.mrp ?? item.unit_cost);
  return {
    id: generateId(),
    client_id: clientId,
    company_id: companyId,
    sku,
    name: item.name,
    description: item.description?.trim() || null,
    barcode: null,
    barcode_type: null,
    category: null,
    subcategory: null,
    brand: null,
    gender: null,
    size: null,
    color: null,
    model: null,
    season: null,
    image_url: null,
    unit_price: unitPrice,
    unit_cost: item.unit_cost,
    mrp: item.mrp ?? null,
    minimum_gross_margin_percentage: null,
    gst_rate: null,
    unit_of_measure: "piece",
    units_per_carton: null,
    reorder_level: null,
    max_stock: null,
    lead_time_days: 30,
    safety_stock_days: 30,
    supplier_id: null,
    supplier_product_code: null,
    minimum_order_quantity: null,
    order_multiple: null,
    hsn_code: null,
    status: "active",
    created_by: clientId,
    created_at: now,
    updated_at: now,
  };
}

router.post("/batch", requireAuth, requireAnyWriteAccess("stock-movements", "products"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCreateSchema.parse(req.body);
    const now = nowISO();
    const clientId = req.user!.id;
    const companyId = req.user!.company_id;

    // Existing catalogue products for this company, keyed by SKU, so rows whose
    // SKU already exists link to the live product instead of duplicating it.
    const existingProducts = await scanTable<Product>(TABLES.PRODUCTS, getCompanyFilter(req.user!));
    const productBySku = new Map<string, Product>(existingProducts.map((p) => [p.sku, p]));

    const newItems: InventoryItem[] = [];
    const newProducts: Product[] = [];
    // Products created earlier in THIS upload (repeat SKUs link to the first one).
    const skuToNewProduct = new Map<string, Product>();
    let linkedCount = 0;

    for (const item of parsed.items) {
      const name = item.item.trim();
      const providedSku = (item.sku?.trim() ?? "").toUpperCase();
      let sku = providedSku;
      let productId: string | null = null;

      if (sku) {
        const existing = productBySku.get(sku);
        if (existing) {
          // SKU already in the catalogue → link the tracking item to it.
          productId = existing.id;
          linkedCount += 1;
        } else if (skuToNewProduct.has(sku)) {
          // Duplicate SKU within the same upload → link to the first product.
          productId = skuToNewProduct.get(sku)!.id;
          linkedCount += 1;
        } else {
          const product = buildProduct({ ...item, name }, sku, now, clientId, companyId);
          newProducts.push(product);
          skuToNewProduct.set(sku, product);
          productId = product.id;
        }
      } else {
        // No SKU in the sheet → auto-generate one unique to the catalogue + this upload.
        do { sku = generateSku(); } while (productBySku.has(sku) || skuToNewProduct.has(sku));
        const product = buildProduct({ ...item, name }, sku, now, clientId, companyId);
        newProducts.push(product);
        skuToNewProduct.set(sku, product);
        productId = product.id;
      }

      newItems.push({
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        item: name,
        description: item.description?.trim() || null,
        sku,
        mrp: item.mrp ?? null,
        product_id: productId,
        closing_quantity: item.closing_quantity,
        price_sale: item.price_sale,
        extended_price: item.closing_quantity * item.price_sale,
        unit_cost: item.unit_cost,
        extended_cost: item.closing_quantity * item.unit_cost,
        created_at: now,
        updated_at: now,
      });
    }

    await batchPutItems(TABLES.INVENTORY_ITEMS, newItems as any);

    if (newProducts.length > 0) {
      await batchPutItems(TABLES.PRODUCTS, newProducts as any);
      // Recompute synchronously so the forecasting page shows the new SKUs
      // right away (same code path as the manual "Recompute" button). A
      // recompute failure must NOT fail the import — the writes already
      // succeeded and the daily sweep / manual button will catch up.
      try {
        await recomputeAll(companyId, clientId);
      } catch (err) {
        console.error("   ⚠️ Forecast recompute after batch import failed:", err);
      }
    }

    createActivityAlert({
      client_id: clientId,
      company_id: companyId,
      type: "product_created",
      severity: "info",
      message: `Mass import: ${newItems.length} tracking items · ${newProducts.length} catalogue products created · ${linkedCount} rows linked to existing catalogue products`,
      created_by: clientId,
    });

    res.status(201).json({
      created: newItems.length,
      products_created: newProducts.length,
      products_linked: linkedCount,
      errors: [],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create inventory items error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/inventory-items/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.INVENTORY_ITEMS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete inventory item error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
