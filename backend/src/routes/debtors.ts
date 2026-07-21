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
import type { Debtor } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";

const router = Router();

// ── GET /api/debtors ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const debtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    res.json(debtors.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    console.error("Get debtors error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/debtors/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const debtor = await getItem(TABLES.DEBTORS, { id: req.params.id }) as Debtor | undefined;
    if (!debtor) { res.status(404).json({ error: "Debtor not found" }); return; }
    res.json(debtor);
  } catch (err) {
    console.error("Get debtor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/debtors ──
const createDebtorSchema = z.object({
  name: z.string().min(1).max(200),
  legal_entity_name: z.string().max(200).nullable().optional(),
  registration_no: z.string().max(100).nullable().optional(),
  relationship_since: z.string().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),

  registered_address: z.string().max(500).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("debtors"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createDebtorSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const debtor: Debtor = {
      id,
      company_id: req.user!.company_id,
      name: parsed.name,
      legal_entity_name: parsed.legal_entity_name || null,
      registration_no: parsed.registration_no || null,
      relationship_since: parsed.relationship_since || null,
      industry: parsed.industry || null,

      registered_address: parsed.registered_address || null,
      postal_code: parsed.postal_code || null,
      phone: parsed.phone || null,
      website: parsed.website || null,
      contact_name: parsed.contact_name || null,
      contact_email: parsed.contact_email || null,
      contact_designation: parsed.contact_designation || null,
      contact_phone: parsed.contact_phone || null,
      notes: parsed.notes || null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.DEBTORS, debtor as any);

    // Create activity alert
    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: id,
      type: "debtor_created",
      severity: "info",
      message: `Debtor "${parsed.name}" added to the ledger`,
      created_by: req.user!.id,
    });

    res.status(201).json(debtor);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create debtor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/debtors/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("debtors"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.DEBTORS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Debtor not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update debtor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/debtors/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("debtors"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.DEBTORS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete debtor error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
