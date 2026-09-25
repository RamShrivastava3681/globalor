import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
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

// ── Colour vocabulary ────────────────────────────────────────────────────────

export const COLOUR_OPTIONS = [
  "BLK", "WHT", "RED", "GRN", "GRY", "BLU", "NVY", "YLW", "ORG", "PNK", "PUR", "BRN",
] as const;
export type ColourOption = (typeof COLOUR_OPTIONS)[number];

const colourNameToCode: Record<string, string> = {
  black: "BLK", white: "WHT", red: "RED", green: "GRN", grey: "GRY", gray: "GRY",
  blue: "BLU", "navy blue": "NVY", navy: "NVY", yellow: "YLW", orange: "ORG",
  pink: "PNK", purple: "PUR", brown: "BRN",
  blk: "BLK", wht: "WHT", grn: "GRN", gry: "GRY", blu: "BLU", nvy: "NVY", nav: "NVY",
  ylw: "YLW", org: "ORG", pnk: "PNK", pur: "PUR", brn: "BRN",
};

export function colourLabel(code: string): string {
  const map: Record<string, string> = {
    BLK: "Black", WHT: "White", RED: "Red", GRN: "Green", GRY: "Grey",
    BLU: "Blue", NVY: "Navy Blue", YLW: "Yellow", ORG: "Orange", PNK: "Pink",
    PUR: "Purple", BRN: "Brown",
  };
  return map[code.toUpperCase()] ?? code;
}

export function resolveColourCode(input: string): string {
  const k = input.trim().toLowerCase();
  return colourNameToCode[k] ?? input.trim().toUpperCase().slice(0, 3);
}

// ── SKU helpers ─────────────────────────────────────────────────────────────

const genderCodeMap: Record<string, string> = {
  male: "M", m: "M", female: "F", f: "F", unisex: "U", u: "U",
  kids: "K", boys: "M", girls: "F", infant: "I",
};

const categoryCodeMap: Record<string, string> = {
  "t-shirt": "TS", tshirt: "TS", ts: "TS", shirt: "SH", jeans: "JN",
  trousers: "TR", dress: "DR", jacket: "JK", saree: "SR", kurta: "KR",
};

function toGenderCode(v: string): string {
  const k = v.trim().toLowerCase();
  if (genderCodeMap[k]) return genderCodeMap[k];
  return v.trim().charAt(0).toUpperCase() || "U";
}

function toCategoryCode(v: string): string {
  const k = v.trim().toLowerCase().replace(/\s+/g, "");
  if (categoryCodeMap[k]) return categoryCodeMap[k];
  // fallback: first 2 letters uppercased, alphanumeric only
  const cleaned = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned.slice(0, 2) || "GN").padEnd(2, "X");
}

function padModelNumber(v: string): string {
  const digits = v.replace(/\D/g, "");
  if (digits) return digits.padStart(3, "0").slice(-3);
  return v.trim().toUpperCase().padStart(3, "0").slice(-3) || "001";
}

export function buildMasterSku(brand: string, gender: string, category: string, modelNumber: string): string {
  const b = (brand.trim().toUpperCase().slice(0, 2) || "AD").padEnd(2, "X");
  const g = toGenderCode(gender);
  const c = toCategoryCode(category);
  const m = padModelNumber(modelNumber);
  return `${b}-${g}-${c}-${m}`;
}

function nextAvailableMasterSku(baseSku: string, existingSkus: string[]): string {
  if (!existingSkus.includes(baseSku)) return baseSku;
  const prefix = baseSku.slice(0, -3);
  const nums = existingSkus
    .filter((s) => s.startsWith(prefix))
    .map((s) => parseInt(s.slice(-3), 10))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : parseInt(baseSku.slice(-3), 10);
  const next = String(max + 1).padStart(3, "0");
  return `${prefix}${next}`;
}

function calcMargin(cost: number, price: number): number {
  if (price <= 0) return 0;
  return Math.round(((price - cost) / price) * 10000) / 100;
}

function productSkuKey(sku: ProductSku): { id: string; masterSku: string } {
  return { id: sku.id, masterSku: sku.masterSku };
}

async function findProductSkuById(req: AuthRequest, id: string): Promise<ProductSku | undefined> {
  const companyFilter = getCompanyFilter(req.user!);
  const rows = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, {
    ...companyFilter,
    filterExpression: `${companyFilter.filterExpression ? `${companyFilter.filterExpression} AND ` : ""}id = :id`,
    expressionAttributeValues: {
      ...(companyFilter.expressionAttributeValues ?? {}),
      ":id": id,
    },
  });
  return rows[0];
}

const uomOptions: UnitOfMeasure[] = [
  "Piece", "Kg", "Litre", "Box", "Set", "Pair", "Carton", "Dozen", "Bottle", "Roll", "Meter", "Gram",
];

// ── Validation ──────────────────────────────────────────────────────────────

const hsnSchema = z.string().trim().regex(/^[0-9]{4,8}$/, "HSN Code must be 4-8 digits");

const statusEnum = z.enum(["ACTIVE", "INACTIVE"] as const);

const baseSkuFields = z.object({
  brand: z.string().trim().min(1, "Brand is required").max(60),
  gender: z.string().trim().min(1, "Gender is required").max(40),
  category: z.string().trim().min(1, "Category is required").max(100),
  modelNumber: z.string().trim().min(1, "Model Number is required").max(40),
  hsnCode: hsnSchema,
  taxPercent: z.number().min(0, "Tax % must be >= 0").max(100, "Tax % must be <= 100"),
  unitOfMeasure: z.string().trim().min(1, "Unit of measure is required").max(40),
  unitCost: z.number().min(0, "Unit cost must be >= 0"),
  unitPrice: z.number().positive("Unit price must be greater than 0"),
  status: statusEnum.optional(),
});

const masterCreateSchema = baseSkuFields.extend({
  productName: z.string().trim().min(1, "Product name is required").max(200),
  itemNumber: z.string().trim().min(1, "Item number is required").max(120),
});

const colourCreateSchema = z.object({
  parentProductId: z.string().min(1, "Parent product is required"),
  colourName: z.string().trim().min(1, "Colour name is required").max(80),
  colourCode: z.string().trim().max(10).optional(),
  unitCost: z.number().min(0).optional(),
  unitPrice: z.number().positive().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  hsnCode: z.string().trim().regex(/^[0-9]{4,8}$/, "HSN Code must be 4-8 digits").optional().nullable(),
  status: statusEnum.optional(),
});

// ── GET /api/product-skus ─────────────────────────────────────────────────

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const filter = getCompanyFilter(req.user!);
    const items = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, filter);
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

// ── GET /api/product-skus/validate-sku ────────────────────────────────────
router.get("/validate-sku", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const sku = String(req.query.sku ?? "").trim().toUpperCase();
    if (!sku) { res.status(400).json({ error: "sku query param required" }); return; }
    const all = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, getCompanyFilter(req.user!));
    const exists = all.some((r) => r.masterSku === sku || r.colourSku === sku);
    if (exists) {
      const suggestion = nextAvailableMasterSku(sku, all.map((r) => r.masterSku).filter(Boolean) as string[]);
      res.json({ exists: true, sku, suggestion });
      return;
    }
    res.json({ exists: false, sku });
  } catch (err) {
    console.error("Validate SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/product-skus/next-sku ────────────────────────────────────────
router.get("/next-sku", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { brand = "AD", gender = "Male", category = "T-Shirt", modelNumber = "001" } = req.query as Record<string, string>;
    const base = buildMasterSku(brand, gender, category, modelNumber);
    const all = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, getCompanyFilter(req.user!));
    const sku = nextAvailableMasterSku(base, all.map((r) => r.masterSku).filter(Boolean) as string[]);
    res.json({ sku, base, available: sku === base });
  } catch (err) {
    console.error("Next SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/product-skus/master/:masterId ───────────────────────────────

router.get("/master/:masterId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const master = await findProductSkuById(req, String(req.params.masterId));
    if (!master) { res.status(404).json({ error: "Master product not found" }); return; }
    if (req.user!.company_id && master.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Master product not found" });
      return;
    }
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
    res.json({ master, variants: variants.filter((v: any) => v.productType === "COLOUR") });
  } catch (err) {
    console.error("Get master product SKUs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/product-skus/:id ─────────────────────────────────────────────

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const sku = await findProductSkuById(req, String(req.params.id));
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

// ── POST /api/product-skus ── (create Master OR Colour variant) ──────────

router.post("/", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const now = nowISO();
    const clientId = req.user!.id;
    const companyId = req.user!.company_id;
    const allSkuRows = await scanTable<ProductSku>(TABLES.PRODUCT_SKUS, getCompanyFilter(req.user!));

    // Colour variant if parentProductId present
    const isColour = !!req.body?.parentProductId && !req.body?.isMaster;

    if (!isColour) {
      // ── Master ──
      const parsed = masterCreateSchema.parse(req.body);
      const masterSku = buildMasterSku(parsed.brand, parsed.gender, parsed.category, parsed.modelNumber);

      if (allSkuRows.some((r) => r.masterSku === masterSku)) {
        const suggestion = nextAvailableMasterSku(masterSku, allSkuRows.map((r) => r.masterSku).filter(Boolean) as string[]);
        res.status(409).json({ error: `Master SKU "${masterSku}" is already in use`, suggestion });
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
        brand: parsed.brand.trim().toUpperCase(),
        gender: parsed.gender.trim(),
        category: parsed.category.trim(),
        modelNumber: padModelNumber(parsed.modelNumber),
        hsnCode: parsed.hsnCode.trim(),
        taxPercent: parsed.taxPercent,
        unitOfMeasure: parsed.unitOfMeasure.trim(),
        unitCost: Math.round(parsed.unitCost * 100) / 100,
        unitPrice: Math.round(parsed.unitPrice * 100) / 100,
        grossMargin: calcMargin(parsed.unitCost, parsed.unitPrice),
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
    const parsed = colourCreateSchema.parse(req.body);
    const master = allSkuRows.find((row) => row.id === parsed.parentProductId);
    if (!master) { res.status(404).json({ error: "Master product not found" }); return; }
    if (master.productType !== "MASTER") { res.status(400).json({ error: "Parent record is not a master product" }); return; }
    if (master.company_id && master.company_id !== companyId) {
      res.status(404).json({ error: "Master product not found" });
      return;
    }

    const code = resolveColourCode(parsed.colourCode || parsed.colourName);
    const colourName = parsed.colourName.trim();
    const colourSku = `${master.masterSku}-${code}`;

    if (allSkuRows.some((r) => r.parentId === master.id && r.colourSku === colourSku)) {
      res.status(409).json({ error: `Colour SKU "${colourSku}" already exists on this master product` });
      return;
    }
    if (allSkuRows.some((r) => r.parentId === master.id && (r.colourCode ?? "").toUpperCase() === code)) {
      res.status(409).json({ error: `Colour "${code}" is already added to this master product` });
      return;
    }

    const unitCost = parsed.unitCost != null ? parsed.unitCost : master.unitCost;
    const unitPrice = parsed.unitPrice != null ? parsed.unitPrice : master.unitPrice;
    const taxPercent = parsed.taxPercent != null ? parsed.taxPercent : master.taxPercent;
    const hsnCode = parsed.hsnCode != null && parsed.hsnCode.trim() !== "" ? parsed.hsnCode.trim() : master.hsnCode;

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
      hsnCode,
      taxPercent,
      unitOfMeasure: master.unitOfMeasure,
      unitCost: Math.round(unitCost * 100) / 100,
      unitPrice: Math.round(unitPrice * 100) / 100,
      grossMargin: calcMargin(unitCost, unitPrice),
      productType: "COLOUR" as const,
      status: parsed.status ?? "ACTIVE",
      colourCode: code,
      colourName,
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
    const existing = await findProductSkuById(req, String(req.params.id));
    if (!existing) { res.status(404).json({ error: "Product SKU not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product SKU not found" });
      return;
    }

    // Block system fields — never editable via PATCH
    const blocked = ["masterSku", "colourSku", "grossMargin", "parentId", "parentSku", "productType", "id", "created_at", "created_by", "masterSku ", "brand", "gender", "category", "modelNumber"];
    for (const k of blocked) delete (req.body as any)[k];

    const isMaster = existing.productType === "MASTER";

    if (isMaster) {
      const schema = z.object({
        productName: z.string().trim().min(1).max(200).optional(),
        itemNumber: z.string().trim().min(1).max(120).optional(),
        hsnCode: hsnSchema.optional(),
        taxPercent: z.number().min(0).max(100).optional(),
        unitOfMeasure: z.string().trim().min(1).max(40).optional(),
        unitCost: z.number().min(0).optional(),
        unitPrice: z.number().positive().optional(),
        status: statusEnum.optional(),
      });
      const parsed = schema.parse(req.body);
      if (Object.keys(parsed).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }
      const updates: Record<string, unknown> = { updated_at: nowISO() };
      for (const [k, v] of Object.entries(parsed)) updates[k] = v;
      // recompute margin if pricing changed
      const newCost = (parsed.unitCost ?? existing.unitCost) as number;
      const newPrice = (parsed.unitPrice ?? existing.unitPrice) as number;
      if (parsed.unitCost != null || parsed.unitPrice != null) {
        (updates as any).grossMargin = calcMargin(newCost, newPrice);
        if (parsed.unitCost != null) (updates as any).unitCost = Math.round(newCost * 100) / 100;
        if (parsed.unitPrice != null) (updates as any).unitPrice = Math.round(newPrice * 100) / 100;
      }
      const updated = await updateItem(TABLES.PRODUCT_SKUS, productSkuKey(existing), updates);
      res.json(updated);
      return;
    }

    // COLOUR patch
    const schema = z.object({
      colourName: z.string().trim().min(1).max(80).optional(),
      unitCost: z.number().min(0).optional(),
      unitPrice: z.number().positive().optional(),
      taxPercent: z.number().min(0).max(100).optional(),
      status: statusEnum.optional(),
      hsnCode: z.string().trim().regex(/^[0-9]{4,8}$/).optional().nullable(),
    });
    const parsed = schema.parse(req.body);
    if (Object.keys(parsed).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }
    const updates: Record<string, unknown> = { updated_at: nowISO() };
    for (const [k, v] of Object.entries(parsed)) (updates as any)[k] = v;
    const newCost = (parsed.unitCost ?? existing.unitCost) as number;
    const newPrice = (parsed.unitPrice ?? existing.unitPrice) as number;
    if (parsed.unitCost != null || parsed.unitPrice != null) {
      (updates as any).grossMargin = calcMargin(newCost, newPrice);
      if (parsed.unitCost != null) (updates as any).unitCost = Math.round(newCost * 100) / 100;
      if (parsed.unitPrice != null) (updates as any).unitPrice = Math.round(newPrice * 100) / 100;
    }
    const updated = await updateItem(TABLES.PRODUCT_SKUS, productSkuKey(existing), updates);
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
    const existing = await findProductSkuById(req, String(req.params.id));
    if (!existing) { res.status(404).json({ error: "Product SKU not found" }); return; }
    if (req.user!.company_id && existing.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Product SKU not found" });
      return;
    }
    await deleteItem(TABLES.PRODUCT_SKUS, productSkuKey(existing));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete product SKU error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
