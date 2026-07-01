import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  queryByIndex,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { PurchaseOrder, POStatus, ProformaStatus, AdvanceSide, Debtor, Vendor, Profile, DocMeta } from "../types/index.js";

const router = Router();

// ── GET /api/purchase-orders (proformas) ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);

    // Preload lookup maps to avoid N+1 GetItem calls
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS);
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES);
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    const enriched = orders
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map((po) => ({
        ...po,
        debtor: po.debtor_id ? debtorMap.get(po.debtor_id) : undefined,
        vendor: po.vendor_id ? vendorMap.get(po.vendor_id) : undefined,
        client: po.client_id ? profileMap.get(po.client_id) : undefined,
      }));

    res.json(enriched);
  } catch (err) {
    console.error("Get purchase orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/purchase-orders/by-po/:poNumber ──
router.get("/by-po/:poNumber", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const side = req.query.side as string | undefined;
    // Use GSI for efficient lookup by po_number
    const orders = await queryByIndex<PurchaseOrder>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": req.params.poNumber });

    const filtered = side ? orders.filter((o) => o.side === side) : orders;

    // Get advances for these POs
    const pfIds = filtered.map((o) => o.id);
    let advances: any[] = [];
    if (pfIds.length > 0) {
      for (const pfId of pfIds) {
        const advs = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid",
          expressionAttributeValues: { ":poid": pfId },
        });
        advances.push(...advs);
      }
    }

    res.json({ proformas: filtered, advances });
  } catch (err) {
    console.error("Get PO by number error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders ──
const createSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  po_number: z.string().min(1).max(80),
  proforma_number: z.string().min(1).max(80).optional(),
  proforma_date: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().optional().default("USD"),
  notes: z.string().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
});

router.post("/", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const proformaDate = parsed.proforma_date || now.slice(0, 10);

    const po: PurchaseOrder = {
      id,
      client_id: req.user!.id,
      side: parsed.side as AdvanceSide,
      debtor_id: parsed.debtor_id || null,
      vendor_id: parsed.vendor_id || null,
      po_number: parsed.po_number,
      proforma_number: parsed.proforma_number || null,
      proforma_date: proformaDate,
      amount: parsed.amount,
      currency: parsed.currency,
      issue_date: proformaDate,
      expected_date: null,
      status: "proforma",
      proforma_status: "pending_review",
      proforma_review_comments: null,
      proforma_reviewed_at: null,
      proforma_reviewed_by: null,
      proforma_funded_amount: null,
      proforma_funded_at: null,
      proforma_funded_by: null,
      proforma_funding_reference: null,
      notes: parsed.notes || null,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.PURCHASE_ORDERS, po as any);
    res.status(201).json(po);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/purchase-orders/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Purchase order not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/purchase-orders/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.PURCHASE_ORDERS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/batch ── (mass import from Excel)
const batchProformaSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  items: z.array(z.object({
    proforma_number: z.string().min(1).max(80),
    proforma_date: z.string().min(1),
    po_number: z.string().min(1).max(80),
    amount: z.number().positive(),
  })).min(1),
});

router.post("/batch", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchProformaSchema.parse(req.body);
    const now = nowISO();
    const created: PurchaseOrder[] = [];
    const errors: Array<{ proforma_number: string; error: string }> = [];

    const ordersToCreate: PurchaseOrder[] = [];
    for (const item of parsed.items) {
      try {
        const id = generateId();
        const proformaDate = item.proforma_date || now.slice(0, 10);

        const po: PurchaseOrder = {
          id,
          client_id: req.user!.id,
          side: parsed.side as AdvanceSide,
          debtor_id: parsed.side === "sales" ? parsed.debtor_id || null : null,
          vendor_id: parsed.side === "purchase" ? parsed.vendor_id || null : null,
          po_number: item.po_number,
          proforma_number: item.proforma_number,
          proforma_date: proformaDate,
          amount: item.amount,
          currency: "USD",
          issue_date: proformaDate,
          expected_date: null,
          status: "proforma",
          proforma_status: "pending_review",
          proforma_review_comments: null,
          proforma_reviewed_at: null,
          proforma_reviewed_by: null,
          proforma_funded_amount: null,
          proforma_funded_at: null,
          proforma_funded_by: null,
          proforma_funding_reference: null,
          notes: null,
          documents: [],
          created_at: now,
          updated_at: now,
        };

        ordersToCreate.push(po);
      } catch (err) {
        errors.push({ proforma_number: item.proforma_number, error: "Invalid proforma data" });
        console.error(`Batch build error for ${item.proforma_number}:`, err);
      }
    }

    // Write all proformas in batches of 25
    if (ordersToCreate.length > 0) {
      const dbItems = ordersToCreate.map((po) => po as unknown as Record<string, unknown>);
      try {
        await batchPutItems(TABLES.PURCHASE_ORDERS, dbItems);
        created.push(...ordersToCreate);
      } catch (err) {
        console.error("Batch write failed, falling back to individual writes:", err);
        for (const po of ordersToCreate) {
          try {
            await putItem(TABLES.PURCHASE_ORDERS, po as any);
            created.push(po);
          } catch (innerErr) {
            errors.push({ proforma_number: po.proforma_number || "", error: "Failed to create" });
            console.error(`Batch fallback error for ${po.proforma_number}:`, innerErr);
          }
        }
      }
    }

    res.status(201).json({ created: created.length, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create proformas error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/review ──
router.post("/:id/review", requireAuth, requireAnyWriteAccess("purchase-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const { decision, comments } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      res.status(400).json({ error: "Decision must be 'approved' or 'rejected'" });
      return;
    }

    const updated = await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, {
      proforma_status: decision,
      proforma_reviewed_by: req.user!.id,
      proforma_reviewed_at: nowISO(),
      proforma_review_comments: comments || null,
      updated_at: nowISO(),
    });

    res.json(updated);
  } catch (err) {
    console.error("Review purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/fund ──
router.post("/:id/fund", requireAuth, requireAnyWriteAccess("purchase-orders", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reference, advance_date } = req.body;
    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be > 0" });
      return;
    }

    const po = await getItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }) as PurchaseOrder | undefined;
    if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

    // Update PO
    await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, {
      proforma_status: "funded",
      proforma_funded_by: req.user!.id,
      proforma_funded_at: nowISO(),
      proforma_funded_amount: Number(amount),
      proforma_funding_reference: reference || null,
      updated_at: nowISO(),
    });

    // Create advance record
    const advanceId = generateId();
    const advance = {
      id: advanceId,
      client_id: po.client_id,
      side: po.side,
      purchase_order_id: po.id,
      amount: Number(amount),
      advance_date: advance_date || new Date().toISOString().slice(0, 10),
      reference: reference || po.proforma_number || po.po_number,
      status: "open",
      created_at: nowISO(),
      updated_at: nowISO(),
      invoice_id: null,
      purchase_invoice_id: null,
      notes: null,
    };
    await putItem(TABLES.ADVANCES, advance as any);

    res.json({ success: true, advance });
  } catch (err) {
    console.error("Fund purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
