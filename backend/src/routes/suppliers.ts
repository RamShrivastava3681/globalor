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
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { Supplier } from "../types/index.js";

const router = Router();

// ── GET /api/suppliers ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const suppliers = await scanTable<Supplier>(TABLES.SUPPLIERS);
    res.json(suppliers.sort((a, b) => a.company_name.localeCompare(b.company_name)));
  } catch (err) {
    console.error("Get suppliers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/suppliers ──
const createSupplierSchema = z.object({
  company_name: z.string().min(1).max(200),
  industry: z.string().max(100).nullable().optional(),
  website: z.string().url().nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional(),
  address_line: z.string().max(300).nullable().optional(),
  address_line2: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_phone: z.string().max(40).nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  advance_rate: z.number().min(0).max(1).optional().default(0.8),
  fee_rate: z.number().min(0).max(1).optional().default(0.025),
  notes: z.string().nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("suppliers"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSupplierSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const supplier: Supplier = {
      id,
      company_name: parsed.company_name,
      industry: parsed.industry || null,
      website: parsed.website || null,
      phone: parsed.phone || null,
      address_line: parsed.address_line || null,
      address_line2: parsed.address_line2 || null,
      city: parsed.city || null,
      country: parsed.country || null,
      postal_code: parsed.postal_code || null,
      contact_name: parsed.contact_name || null,
      contact_designation: parsed.contact_designation || null,
      contact_email: parsed.contact_email || null,
      contact_phone: parsed.contact_phone || null,
      payment_terms_days: parsed.payment_terms_days,
      advance_rate: parsed.advance_rate,
      fee_rate: parsed.fee_rate,
      notes: parsed.notes || null,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.SUPPLIERS, supplier as any);
    res.status(201).json(supplier);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/suppliers/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("suppliers"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.SUPPLIERS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Supplier not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/suppliers/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("suppliers"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.SUPPLIERS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
