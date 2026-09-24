import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  queryByIndex,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { ProductSku, ProductSkuStatus, UnitOfMeasure } from "../types/index.js";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────

/** Colour options surfaced by the UI (controlled vocabulary). */
export const COLOUR_OPTIONS = [
  "BLK", "WHT", "RED", "GRN", "GRY", "BLU", "NAV", "YLW", "ORG", "PNK", "PUR", "BRN",
] as const;
export type ColourOption = (typeof COLOUR_OPTIONS)[number];

/** Systematic colour code → human label. */
export function colourLabel(code: string): string {
  const map: Record<string, string> = {
    BLK: "Black", WHT: "White", RED: "Red", GRN: "Green", GRY: "Grey",
    BLU: "Blue", NAV: "Navy Blue", YLW: "Yellow", ORG: "Orange", PNK: "Pink",
    PUR: "Purple", BRN: "Brown",
  };
  return map[code] ?? code;
}

const uomOptions: UnitOfMeasure[] = [
  "Piece", "Kg", "Litre", "Box", "Set", "Pair", "Carton", "Dozen", "Bottle", "Roll", "Meter", "Gram",
];

// ── Validation ────────────────────────────────────────────────────────────

const segmentSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9.\-_]{1,40}$/, "Must be letters, digits, dot, dash or underscore (≤ 40 chars)");

const statusEnum = z.enum(["ACTIVE", "INACTIVE"] as const);

const baseSkuFields = z.object({
  brand: segmentSchema.optional(),
  gender: segmentSchema.optional(),
  category: segmentSchema.optional(),
  modelNumber: segmentSchema.optional(),
  hsnCode: z.string().trim().max(30).optional().nullable(),
  taxPercent: z.number().min(0, "Tax % must be >= 0").max(100, "Tax % must be <= 100"),
  unitOfMeasure: z.string().trim().min(1, "Unit of measure is required").max(40),
  unitCost: z.number().min(0, "Unit cost must be >= 0"),
  unitPrice: z.number().min(0, "Unit price must be >= 0"),
  colourCode: segmentSchema.optional(),
  status: statusEnum.optional(),
});

const masterSchema = baseSkuFields.extend({
  productName: z.string().trim().min(1, "Product name is required").max(200),
  itemNumber: z.string().trim().min(1, "Item number is required").max(120),
  skuPrefix: z.string().trim().regex(/^[A-Z]{2}$/, "Brand prefix must be exactly 2 letters (e.g. AD)"),
  productType: z.literal("MASTER"),
});

const colourSchema = baseSkuFields.extend({
  parentProductId: z.string().min(1, "Parent product is required"),
  colourCode: segmentSchema,
  colourName: z.string().trim().min(1, "Colour name is required").max(80),
  colourSku: z.string().trim().max(120),
  productType: z.literal("COLOUR"),
});

// ── GET /api/product-skus ─────────────────────────────────────────────────

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const filter = getCompanyFilter(req.user!);
    const items = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, filter);
    // Sort: products first (MASTER), then by colour sku
    const sorted = [...items].sort((a, b) => {
      const ap = a.productType === "MASTER" ? 0 : 1;
      const bp = b.productType === "MASTER" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.masterSku ?? "").localeCompare(b.masterSku ?? "");
    });
    res.json(sorted);
  } catch (err) {
    console.error("Get product SKUs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/product-skus/:id ─────────────────────────────────────────────

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const sku = await getItem(TABLES.PRODUCT_SKUS, { id: req.params.id }) as ProductSku | undefined;
    if (!sku) { res.status(404).json({ error: "Product SKU not found" }); return; }
    if (req.user!.company_id && sku.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product SKU not found" });
      return;
    }
    res.json(sku);
  } catch (err) {
    console.error("Get product SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/product-skus/master/:masterId ───────────────────────────────

router.get("/master/:masterId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const master = await getItem(TABLES.PRODUCT_SKUS, { id: req.params.masterId }) as ProductSku | undefined;
    if (!master) { res.status(404).json({ error: "Master product not found" }); return; }
    if (req.user!.company_id && master.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Master product not found" });
      return;
    }
    // All variants (colour/size) for this master: query the masterSku-index.
    // filter: productType = COLOUR and masterSku = master's masterSku
    if (master.productType !== "MASTER") {
      res.status(400).json({ error: "This record is not a master product" });
      return;
    }
    const variants = await queryByIndex(
      TABLES.PRODUCT_SKUS,
      "parentId-index",
      "parentId = :pid",
      { ":pid": master.id },
    );
    res.json({ master, variants: variants.filter((v) => v.productType === "COLOUR") });
  } catch (err) {
    console.error("Get master product SKUs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/product-skus ── (create Master OR Colour variant) ──────────

router.post("/", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const isMaster = !!req.body?.isMaster;
    const now = nowISO();
    const clientId = req.user!.id;
    const companyId = req.user!.company_id;

    // Enforce company filter on reads by pre-loading ALL rows in company.
    const allSkuRows = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, getCompanyFilter(req.user!));

    if (isMaster) {
      const parsed = masterSchema.parse(req.body);
      const brandLower = parsed.brand?.toLowerCase() ?? "";
      const genderLower = parsed.gender?.toLowerCase() ?? "";
      const catLower = parsed.category?.toLowerCase() ?? "";
      const model = parsed.modelNumber?.trim() ?? "";

      const masterSku = `${parsed.skuPrefix}-${genderLower}-${catLower}-${model.padEnd(3, "0").toUpperCase()}`;

      // Uniqueness check: no other row may carry this masterSku.
      if (allSkuRows.some((r) => r.masterSku === masterSku && r.id !== req.body?.parentProductId)) {
        res.status(409).json({ error: `Master SKU "${masterSku}" is already in use` });
        return;
      }

      const product: ProductSku = {
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        masterSku,
        parentId: null,
        parentSku: null,
        productName: parsed.productName.trim(),
        itemNumber: parsed.itemNumber.trim(),
        brand: parsed.brand?.trim() || null,
        gender: parsed.gender?.trim() || null,
        category: parsed.category?.trim() || null,
        modelNumber: parsed.modelNumber?.trim() || null,
        hsnCode: parsed.hsnCode?.trim() || null,
        taxPercent: parsed.taxPercent,
        unitOfMeasure: parsed.unitOfMeasure.trim(),
        unitCost: Math.round(parsed.unitCost * 100) / 100,
        unitPrice: Math.round(parsed.unitPrice * 100) / 100,
        grossMargin: parsed.unitPrice > 0 ? Math.round(((parsed.unitPrice - parsed.unitCost) / parsed.unitPrice) * 10000) / 100 : 0,
        productType: "MASTER" as const,
        status: parsed.status ?? "ACTIVE",
        colourCode: null,
        colourName: null,
        colourSku: null,
        created_by: clientId,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.PRODUCT_SKUS, product as any);

      createActivityAlert({
        client_id: clientId,
        company_id: companyId,
        type: "product_created",
        severity: "info",
        message: `Master product "${product.productName}" (${product.masterSku}) created`,
        created_by: clientId,
      });

      res.status(201).json(product);
      return;
    }

    // ── Colour variant ──
    const parsed = colourSchema.parse(req.body);
    const master = await getItem(TABLES.PRODUCT_SKUS, { id: parsed.parentProductId }) as ProductSku | undefined;
    if (!master) { res.status(404).json({ error: "Master product not found" }); return; }
    if (master.productType !== "MASTER") { res.status(400).json({ error: "Parent record is not a master product" }); return; }
    if (master.company_id && master.company_id !== companyId) {
      res.status(404).json({ error: "Master product not found" });
      return;
    }

    const colourSku = `${master.masterSku}-${parsed.colourCode.toUpperCase()}`;

    // Colour uniqueness under THIS master.
    if (allSkuRows.some((r) => r.parentId === master.id && r.colourSku === colourSku)) {
      res.status(409).json({ error: `Colour SKU "${colourSku}" already exists on this master product` });
      return;
    }
    // Same colour code can't be added twice to the same master.
    if (allSkuRows.some((r) => r.parentId === master.id && r.colourCode === parsed.colourCode.toUpperCase())) {
      res.status(409).json({ error: `Colour "${parsed.colourCode.toUpperCase()}" is already added to this master product` });
      return;
    }

    const colour: ProductSku = {
      id: generateId(),
      client_id: clientId,
      company_id: companyId,
      masterSku: colourSku,
      parentId: master.id,
      parentSku: master.masterSku,
      productName: master.productName,
      itemNumber: master.itemNumber,
      brand: master.brand,
      gender: master.gender,
      category: master.category,
      modelNumber: master.modelNumber,
      hsnCode: parsed.hsnCode?.trim() || master.hsnCode,
      taxPercent: parsed.taxPercent,
      unitOfMeasure: master.unitOfMeasure,
      unitCost: Math.round(parsed.unitCost * 100) / 100,
      unitPrice: Math.round(parsed.unitPrice * 100) / 100,
      grossMargin: parsed.unitPrice > 0 ? Math.round(((parsed.unitPrice - parsed.unitCost) / parsed.unitPrice) * 10000) / 100 : 0,
      productType: "COLOUR" as const,
      status: parsed.status ?? "ACTIVE",
      colourCode: parsed.colourCode.toUpperCase(),
      colourName: parsed.colourName.trim(),
      colourSku,
      created_by: clientId,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.PRODUCT_SKUS, colour as any);

    createActivityAlert({
      client_id: clientId,
      company_id: companyId,
      type: "product_created",
      severity: "info",
      message: `Colour SKU "${colour.colourSku}" (${colour.colourName}) added to master "${master.masterSku}"`,
      created_by: clientId,
    });

    res.status(201).json(colour);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create product SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/product-skus/:id ──────────────────────────────────────────

router.patch("/:id", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.PRODUCT_SKUS, { id: req.params.id }) as ProductSku | undefined;
    if (!existing) { res.status(404).json({ error: "Product SKU not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product SKU not found" });
      return;
    }

    const parsed = z.object({
      colourName: z.string().trim().min(1).max(80).optional(),
      colourCode: z.string().trim().regex(/^[A-Z0-9.\-_]{1,40}$/).optional(),
      colourSku: z.string().trim().max(120).optional(),
      unitCost: z.number().min(0).optional(),
      unitPrice: z.number().min(0).optional(),
      taxPercent: z.number().min(0).max(100).optional(),
      status: statusEnum.optional(),
      hsnCode: z.string().trim().max(30).optional().nullable(),
    }).strict().partial();

    const update = parsed.parse(req.body);
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };
    for (const [k, v] of Object.entries(update)) { updates[k] = v; }
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    const updated = await updateItem(TABLES.PRODUCT_SKUS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Product SKU not found" }); return; }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update product SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/product-skus/:id ─────────────────────────────────────────

router.delete("/:id", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.PRODUCT_SKUS, { id: req.params.id }) as ProductSku | undefined;
    if (!existing) { res.status(404).json({ error: "Product SKU not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product SKU not found" });
      return;
    }
    await deleteItem(TABLES.PRODUCT_SKUS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete product SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
