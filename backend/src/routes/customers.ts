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
import type { Customer } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";
import { scanCustomersMerged, getCustomerById } from "../utils/customers.js";

const router = Router();

// ── GET /api/customers ──
// Serves the debtors master (merged with customers for compat).
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const customers = await scanCustomersMerged(getCompanyFilter(req.user!) as any);
    res.json(customers.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
  } catch (err) {
    console.error("Get customers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/customers/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const customer = await getCustomerById(req.params.id as string);
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(customer);
  } catch (err) {
    console.error("Get customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/customers ──
const customerAddressSchema = z.object({
  id: z.string().max(100).nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  kind: z.enum(["billing", "shipping"]).optional().default("billing"),
  line1: z.string().max(300).nullable().optional(),
  line2: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  is_default: z.boolean().optional().default(false),
});

const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  legal_entity_name: z.string().max(200).nullable().optional(),
  registration_no: z.string().max(100).nullable().optional(),
  relationship_since: z.string().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),

  postal_code: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  addresses: z.array(customerAddressSchema).max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(120).nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal("")),
  contact_designation: z.string().max(120).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("customers"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createCustomerSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const customer: Customer = {
      id,
      company_id: req.user!.company_id,
      name: parsed.name,
      legal_entity_name: parsed.legal_entity_name || null,
      registration_no: parsed.registration_no || null,
      relationship_since: parsed.relationship_since || null,
      industry: parsed.industry || null,

      postal_code: parsed.postal_code || null,
      city: parsed.city || null,
      state: parsed.state || null,
      country: parsed.country || null,
      addresses: (parsed.addresses ?? []).map((a, i) => ({
        id: a.id || `addr-${Date.now()}-${i}`,
        label: a.label || null,
        kind: a.kind,
        line1: a.line1 || null,
        line2: a.line2 || null,
        city: a.city || null,
        state: a.state || null,
        country: a.country || null,
        postal_code: a.postal_code || null,
        is_default: !!a.is_default,
      })),
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

    await putItem(TABLES.DEBTORS, customer as any);
    // Mirror into CUSTOMERS so any code reading only the new table stays in sync.
    await putItem(TABLES.CUSTOMERS, customer as any).catch(() => {});

    // Create activity alert
    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      customer_id: id,
      type: "customer_created",
      severity: "info",
      message: `Customer "${parsed.name}" added to the ledger`,
      created_by: req.user!.id,
    });

    res.status(201).json(customer);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/customers/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("customers"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    // Primary store is DEBTORS; mirror to CUSTOMERS. Fall back across both.
    const cid = req.params.id as string;
    let updated = await updateItem(TABLES.DEBTORS, { id: cid }, updates).catch(() => null);
    if (!updated) {
      updated = await updateItem(TABLES.CUSTOMERS, { id: cid }, updates).catch(() => null);
    } else {
      await updateItem(TABLES.CUSTOMERS, { id: cid }, updates).catch(() => null);
    }
    if (!updated) {
      // Record may exist only in the other table — try a merged read to confirm.
      const existing = await getCustomerById(cid);
      if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
      res.json({ ...existing, ...updates });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("Update customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/customers/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("customers"), async (req: AuthRequest, res: Response) => {
  try {
    const cid = req.params.id as string;
    // Cascade: remove all orders, invoices and related data created on this party
    const { cascadeDeleteCustomer } = await import("../utils/partyCascade.js");
    await cascadeDeleteCustomer(req.user!.company_id, cid).catch((e) => console.error("Customer cascade delete error:", e));
    await deleteItem(TABLES.DEBTORS, { id: cid }).catch(() => {});
    await deleteItem(TABLES.CUSTOMERS, { id: cid }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error("Delete customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
