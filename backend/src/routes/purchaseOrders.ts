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
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { PurchaseOrder, POStatus, ProformaStatus, AdvanceSide, Debtor, Vendor, Profile } from "../types/index.js";

const router = Router();

// ── GET /api/purchase-orders (proformas) ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);

    const enriched = await Promise.all(
      orders
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(async (po) => {
          let debtor, vendor, client;
          if (po.debtor_id) debtor = await getItem(TABLES.DEBTORS, { id: po.debtor_id }) as Debtor | undefined;
          if (po.vendor_id) vendor = await getItem(TABLES.VENDORS, { id: po.vendor_id }) as Vendor | undefined;
          if (po.client_id) client = await getItem(TABLES.PROFILES, { id: po.client_id }) as Profile | undefined;
          return { ...po, debtor, vendor, client };
        }),
    );

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
  debtor_id: z.string().uuid().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  po_number: z.string().min(1).max(80),
  proforma_number: z.string().min(1).max(80).optional(),
  proforma_date: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().optional().default("USD"),
  notes: z.string().nullable().optional(),
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
