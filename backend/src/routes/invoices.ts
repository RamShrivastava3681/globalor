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
        let purchase: (PurchaseInvoice & { vendor?: Vendor }) | undefined;
        if (inv.purchase_invoice_id) {
          purchase = await getItem(TABLES.PURCHASE_INVOICES, { id: inv.purchase_invoice_id }) as any;
          if (purchase?.vendor_id) {
            purchase.vendor = await getItem(TABLES.VENDORS, { id: purchase.vendor_id }) as Vendor | undefined;
          }
        }
        return { ...inv, debtor, client, purchase };
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
    const invoices = await scanTable<Invoice>(TABLES.INVOICES, {
      filterExpression: "purchase_invoice_id = :piid",
      expressionAttributeValues: { ":piid": req.params.purchaseInvoiceId },
    });

    const enriched = await Promise.all(
      invoices.map(async (inv) => {
        const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          amount: inv.amount,
          status: inv.status,
          purchase_invoice_id: inv.purchase_invoice_id,
          debtor: debtor ? { name: debtor.name } : undefined,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get invoices by purchase error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/invoices ──
const createInvoiceSchema = z.object({
  debtor_id: z.string().uuid(),
  invoice_number: z.string().min(1).max(80),
  amount: z.number().positive(),
  advance_rate: z.number().min(0).max(100).optional().default(80),
  fee_rate: z.number().min(0).optional().default(0),
  issue_date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  due_date: z.string().optional(),
  po_number: z.string().max(80).nullable().optional(),
  po_date: z.string().nullable().optional(),
  purchase_invoice_id: z.string().uuid().nullable().optional(),
  documents: z.array(z.any()).optional().default([]),
  inventory: z.object({
    enabled: z.boolean(),
    item_name: z.string().optional(),
    sku: z.string().nullable().optional(),
    quantity: z.number().positive().optional(),
    unit: z.string().optional(),
    unit_cost: z.number().nullable().optional(),
  }).optional(),
});

router.post("/", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createInvoiceSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const noa_token = generateNoaToken();

    // Lookup debtor for payment terms
    const debtor = await getItem(TABLES.DEBTORS, { id: parsed.debtor_id }) as Debtor | undefined;
    const termsDays = debtor?.payment_terms_days ?? 30;
    const dueDate = parsed.due_date || (() => {
      const d = new Date(parsed.issue_date);
      d.setDate(d.getDate() + termsDays);
      return d.toISOString().slice(0, 10);
    })();

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
      purchase_invoice_id: parsed.purchase_invoice_id || null,
      purchase_order_id: null,
      documents: parsed.documents as DocMeta[],
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.INVOICES, invoice as any);

    // Apply open advances for matching PO (sales side)
    if (parsed.po_number) {
      const orders = await queryByIndex<any>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": parsed.po_number });
      const salesOrders = orders.filter((o: any) => o.side === "sales");
      for (const po of salesOrders) {
        const advances = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid AND #status = :status",
          expressionAttributeNames: { "#status": "status" },
          expressionAttributeValues: { ":poid": po.id, ":status": "open" },
        });
        for (const adv of advances) {
          await updateItem(TABLES.ADVANCES, { id: adv.id }, { status: "applied" });
        }
      }
    }

    // Create inventory movement if enabled
    const inv = parsed.inventory;
    if (inv?.enabled && inv.item_name && inv.quantity && inv.quantity > 0) {
      const movement: StockMovement = {
        id: generateId(),
        client_id: req.user!.id,
        direction: "out",
        item_name: inv.item_name,
        sku: inv.sku || null,
        quantity: inv.quantity,
        unit: inv.unit || "unit",
        unit_cost: inv.unit_cost || null,
        notes: null,
        invoice_id: id,
        purchase_invoice_id: null,
        movement_date: parsed.issue_date,
        created_at: now,
        updated_at: now,
      };
      await putItem(TABLES.STOCK_MOVEMENTS, movement as any);
    }

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
