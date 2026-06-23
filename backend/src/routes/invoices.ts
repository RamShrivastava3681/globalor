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
import { generateId, generateNoaToken, nowISO } from "../utils/helpers.js";
import { config } from "../config.js";
import { sendNoaEmail } from "../utils/email.js";
import type { Invoice, Debtor, Profile, PurchaseInvoice, Vendor, DocMeta } from "../types/index.js";
import type { StockMovement, MovementDirection } from "../types/index.js";
import { createActivityAlert } from "../utils/alerts.js";

const router = Router();

// ── GET /api/invoices ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    let invoices = await scanTable<Invoice>(TABLES.INVOICES);

    // Enrich with relations
    const enriched = await Promise.all(
      invoices.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(async (inv) => {
        const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
        const client = await getItem(TABLES.PROFILES, { id: inv.client_id }) as Profile | undefined;
        let purchases: (PurchaseInvoice & { vendor?: Vendor })[] | undefined;
        if (inv.purchase_invoice_ids && inv.purchase_invoice_ids.length > 0) {
          const results = await Promise.all(
            inv.purchase_invoice_ids.map(async (piId) => {
              const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: piId }) as PurchaseInvoice | undefined;
              if (pi?.vendor_id) {
                (pi as any).vendor = await getItem(TABLES.VENDORS, { id: pi.vendor_id }) as Vendor | undefined;
              }
              return pi;
            }),
          );
          purchases = results.filter(Boolean) as (PurchaseInvoice & { vendor?: Vendor })[];
        }
        return { ...inv, debtor, client, purchases };
      }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/mini ── (minimal list for dropdowns)
router.get("/mini", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    res.json(
      invoices
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((i) => ({ id: i.id, invoice_number: i.invoice_number, amount: i.amount })),
    );
  } catch (err) {
    console.error("Get invoices mini error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/invoices/by-purchase/:purchaseInvoiceId ──
router.get("/by-purchase/:purchaseInvoiceId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: req.params.purchaseInvoiceId }) as PurchaseInvoice | undefined;
    if (!pi || !pi.linked_sales_invoice_ids || pi.linked_sales_invoice_ids.length === 0) {
      res.json([]);
      return;
    }

    const invoices = await Promise.all(
      pi.linked_sales_invoice_ids.map(async (invId) => {
        const inv = await getItem(TABLES.INVOICES, { id: invId }) as Invoice | undefined;
        if (!inv) return null;
        const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          amount: inv.amount,
          status: inv.status,
          debtor: debtor ? { name: debtor.name } : undefined,
        };
      }),
    );

    res.json(invoices.filter(Boolean));
  } catch (err) {
    console.error("Get invoices by purchase error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices ──
const createInvoiceSchema = z.object({
  debtor_id: z.string().min(1),
  invoice_number: z.string().min(1).max(80),
  amount: z.number().positive(),
  advance_rate: z.number().min(0).max(100).optional().default(0),
  fee_rate: z.number().min(0).optional().default(0),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().nullable().optional(),
  payment_terms_days: z.number().min(0).optional().default(30),
  bl_date: z.string().nullable().optional(),
  due_date_source: z.enum(["invoice", "bl"]).optional().default("invoice"),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  purchase_invoice_ids: z.array(z.string()).optional().default([]),
  documents: z.array(z.any()).optional().default([]),
  inventory_items: z.array(z.object({
    item_name: z.string().min(1),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().default("unit"),
    unit_cost: z.number().nullable().optional(),
  })).optional(),
});

router.post("/", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createInvoiceSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const noa_token = generateNoaToken();

    const termsDays = parsed.payment_terms_days;
    const dueDate = parsed.due_date !== null
      ? (parsed.due_date || (() => {
          const base = parsed.due_date_source === "bl" && parsed.bl_date ? new Date(parsed.bl_date) : new Date(parsed.issue_date);
          const d = new Date(base);
          d.setDate(d.getDate() + termsDays);
          return d.toISOString().slice(0, 10);
        })())
      : null;

    const invoice: Invoice = {
      id,
      client_id: req.user!.id,
      debtor_id: parsed.debtor_id,
      supplier_id: null,
      invoice_number: parsed.invoice_number,
      amount: parsed.amount,
      advance_rate: parsed.advance_rate,
      fee_rate: parsed.fee_rate,
      amount_received: null,
      issue_date: parsed.issue_date,
      due_date: dueDate,
      paid_date: null,
      receipt_date: null,
      advance_received_date: null,
      short_payment: null,
      late_days: null,
      status: "pending",
      noa_status: "not_sent",
      noa_token,
      noa_sent_at: null,
      noa_responded_at: null,
      noa_comments: null,
      po_number: parsed.po_number || null,
      po_date: parsed.po_date || null,
      purchase_invoice_ids: parsed.purchase_invoice_ids || [],
      purchase_order_id: null,
      payment_terms_days: parsed.payment_terms_days,
      bl_date: parsed.bl_date || null,
      due_date_source: parsed.due_date_source,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    // ── Deduct open advances from invoice amount ──
    let openAdvances: any[] = [];
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      const salesOrders = orders.filter((o: any) => o.side === "sales");
      for (const po of salesOrders) {
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

    await putItem(TABLES.INVOICES, invoice as any);

    // Link open advances to this invoice and mark as applied
    for (const adv of openAdvances) {
      await updateItem(TABLES.ADVANCES, { id: adv.id }, { status: "applied", invoice_id: id });
    }

    // Create inventory movements if enabled
    if (parsed.inventory_items && parsed.inventory_items.length > 0) {
      for (const item of parsed.inventory_items) {
        const movement: StockMovement = {
          id: generateId(),
          client_id: req.user!.id,
          direction: "out",
          item_name: item.item_name,
          sku: item.sku || null,
          quantity: item.quantity,
          unit: item.unit || "unit",
          unit_cost: item.unit_cost || null,
          notes: null,
          invoice_id: id,
          purchase_invoice_id: null,
          movement_date: parsed.issue_date,
          created_at: now,
          updated_at: now,
        };
        await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
      }
    }

    // Create activity alert
    const debtor = await getItem(TABLES.DEBTORS, { id: parsed.debtor_id }) as Debtor | undefined;
    createActivityAlert({
      client_id: req.user!.id,
      debtor_id: parsed.debtor_id,
      invoice_id: id,
      type: "invoice_created",
      severity: "info",
      message: `Invoice ${parsed.invoice_number} created for $${parsed.amount.toLocaleString()}${debtor ? ` — ${debtor.name}` : ""}`,
    });

    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/invoices/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.INVOICES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/invoices/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.INVOICES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices/:id/send-noa ──
router.post("/:id/send-noa", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await getItem(TABLES.INVOICES, { id: req.params.id }) as Invoice | undefined;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    // Lookup debtor for email
    const debtor = await getItem(TABLES.DEBTORS, { id: invoice.debtor_id }) as Debtor | undefined;
    const client = await getItem(TABLES.PROFILES, { id: invoice.client_id }) as Profile | undefined;
    const companyName = client?.company_name || "A client";

    await updateItem(TABLES.INVOICES, { id: req.params.id }, {
      noa_status: "sent",
      noa_sent_at: nowISO(),
      updated_at: nowISO(),
    });

    const link = `/noa/${invoice.noa_token}`;
    const fullUrl = `${config.appUrl}${link}`;

    // Send NOA email to debtor (non-blocking)
    if (debtor?.contact_email) {
      sendNoaEmail({
        to: debtor.contact_email,
        debtorName: debtor.name,
        debtorContactName: debtor.contact_name,
        invoiceNumber: invoice.invoice_number,
        amount: invoice.amount,
        companyName,
        noaUrl: fullUrl,
      });
    } else {
      console.warn(`   ⚠️ No contact email for debtor "${debtor?.name ?? invoice.debtor_id}" — NOA not emailed.`);
    }

    res.json({ noa_status: "sent", noa_link: link });
  } catch (err) {
    console.error("Send NOA error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
