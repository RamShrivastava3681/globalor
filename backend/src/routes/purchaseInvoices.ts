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
import type { PurchaseInvoice, Vendor, Profile, DocMeta } from "../types/index.js";
import type { StockMovement } from "../types/index.js";

const router = Router();

// ── GET /api/purchase-invoices ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);

    const enriched = await Promise.all(
      invoices.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(async (pi) => {
        const vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as Vendor | undefined;
        const client = await getItem(TABLES.PROFILES, { id: pi.client_id }) as Profile | undefined;
        return { ...pi, vendor, client };
      }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get purchase invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/purchase-invoices/mini ──
router.get("/mini", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
    res.json(
      invoices
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((i) => ({ id: i.id, invoice_number: i.invoice_number, amount: i.amount })),
    );
  } catch (err) {
    console.error("Get purchase invoices mini error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-invoices ──
const createSchema = z.object({
  vendor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number().positive(),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  notes: z.string().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
});

router.post("/", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    const termsDays = parsed.payment_terms_days;
    const due_date = parsed.due_date || (() => {
      const base = parsed.due_date_source === "bl" && parsed.bl_date ? new Date(parsed.bl_date) : new Date(parsed.issue_date);
      const d = new Date(base);
      d.setDate(d.getDate() + termsDays);
      return d.toISOString().slice(0, 10);
    })();

    const invoice: PurchaseInvoice = {
      id,
      client_id: req.user!.id,
      vendor_id: parsed.vendor_id,
      invoice_number: parsed.invoice_number,
      amount: parsed.amount,
      advance_rate: 0,
      po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      issue_date: parsed.issue_date,
      due_date,
      paid_date: null,
      funded_date: null,
      advance_paid_date: null,
      payment_terms_days: parsed.payment_terms_days,
      bl_date: parsed.bl_date || null,
      due_date_source: parsed.due_date_source,
      notes: parsed.notes || null,
      status: "pending",
      documents: parsed.documents as DocMeta[],
      purchase_order_id: null,
      created_at: now,
      updated_at: now,
    };

    // ── Deduct open advances from purchase invoice amount ──
    let openAdvances: any[] = [];
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      const purchaseOrders = orders.filter((o: any) => o.side === "purchase");
      for (const po of purchaseOrders) {
        const advances = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid AND #status = :status",
          expressionAttributeNames: { "#status": "status" },
          expressionAttributeValues: { ":poid": po.id, ":status": "open" },
        });
        openAdvances.push(...advances);
      }
    }

    const totalAdvanceDeduction = openAdvances.reduce((sum, a) => sum + Number(a.amount), 0);
    if (totalAdvanceDeduction > 0) {
      invoice.amount = Math.max(0, invoice.amount - totalAdvanceDeduction);
    }

    await putItem(TABLES.PURCHASE_INVOICES, invoice as any);

    // Link open advances to this purchase invoice and mark as applied
    for (const adv of openAdvances) {
      await updateItem(TABLES.ADVANCES, { id: adv.id }, { status: "applied", purchase_invoice_id: id });
    }

    // Create inventory movements if enabled
    if (parsed.inventory_items && parsed.inventory_items.length > 0) {
      for (const item of parsed.inventory_items) {
        const movement: StockMovement = {
          id: generateId(),
          client_id: req.user!.id,
          direction: "in",
          item_name: item.item_name,
          sku: item.sku || null,
          quantity: item.quantity,
          unit: item.unit || "unit",
          unit_cost: item.unit_cost || null,
          notes: null,
          invoice_id: null,
          purchase_invoice_id: id,
          movement_date: parsed.issue_date,
          created_at: now,
          updated_at: now,
        };
        await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      }
    }

    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/purchase-invoices/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("purchase-invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.PURCHASE_INVOICES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Purchase invoice not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/purchase-invoices/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("purchase-invoices"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.PURCHASE_INVOICES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete purchase invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
