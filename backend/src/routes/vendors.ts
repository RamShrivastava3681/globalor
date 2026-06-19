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
import type { Vendor } from "../types/index.js";

const router = Router();

// ── GET /api/vendors ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const vendors = await scanTable<Vendor>(TABLES.VENDORS);
    res.json(vendors.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    console.error("Get vendors error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/vendors ──
const createVendorSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(100).nullable().optional(),
  address_line: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
});

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createVendorSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const vendor: Vendor = {
      id,
      client_id: req.user!.id,
      name: parsed.name,
      industry: parsed.industry || null,
      address_line: parsed.address_line || null,
      city: parsed.city || null,
      country: parsed.country || null,
      postal_code: parsed.postal_code || null,
      phone: parsed.phone || null,
      website: parsed.website || null,
      contact_name: parsed.contact_name || null,
      contact_email: parsed.contact_email || null,
      contact_designation: parsed.contact_designation || null,
      contact_phone: parsed.contact_phone || null,
      notes: null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.VENDORS, vendor as any);
    res.status(201).json(vendor);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create vendor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/vendors/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("vendors"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.VENDORS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Vendor not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update vendor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
// ── DELETE /api/vendors/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("vendors"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.VENDORS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete vendor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
