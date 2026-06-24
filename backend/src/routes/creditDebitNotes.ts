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
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { CreditDebitNote, Invoice, PurchaseInvoice } from "../types/index.js";

const router = Router();

// ── GET /api/credit-debit-notes ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const notes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);

    const enriched = await Promise.all(
      notes
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(async (note) => {
          let linkedInvoice: { invoice_number: string; amount: number; status: string } | null = null;
          if (note.linked_invoice_id) {
            const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
            const inv = await getItem(table, { id: note.linked_invoice_id }) as any;
            if (inv) {
              linkedInvoice = {
                invoice_number: inv.invoice_number,
                amount: inv.amount,
                status: inv.status,
              };
            }
          }
          return { ...note, linkedInvoice };
        }),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get credit/debit notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/credit-debit-notes ──
const createSchema = z.object({
  type: z.enum(["credit", "debit"]),
  note_number: z.string().min(1).max(80),
  date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  amount: z.number().positive(),
  debtor_supplier_name: z.string().max(200).nullable().optional(),
  linked_invoice_id: z.string().nullable().optional(),
  linked_invoice_type: z.enum(["sales", "purchase"]).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    // Validate linked invoice exists if provided
    if (parsed.linked_invoice_id) {
      const table = parsed.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
      const inv = await getItem(table, { id: parsed.linked_invoice_id });
      if (!inv) {
        res.status(400).json({ error: "Linked invoice not found" });
        return;
      }
    }

    const note: CreditDebitNote = {
      id,
      client_id: req.user!.id,
      type: parsed.type,
      note_number: parsed.note_number,
      date: parsed.date || new Date().toISOString().slice(0, 10),
      amount: parsed.amount,
      debtor_supplier_name: parsed.debtor_supplier_name || null,
      linked_invoice_id: parsed.linked_invoice_id || null,
      linked_invoice_type: parsed.linked_invoice_type || null,
      reason: parsed.reason || null,
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      settled_at: null,
      settled_by: null,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.CREDIT_DEBIT_NOTES, note as any);

    createActivityAlert({
      client_id: req.user!.id,
      type: "invoice_created",
      severity: "info",
      message: `${parsed.type === "credit" ? "Credit" : "Debit"} note ${parsed.note_number} created for $${parsed.amount.toLocaleString()} — pending review`,
    });

    res.status(201).json(note);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/credit-debit-notes/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }) as CreditDebitNote | undefined;
    if (!note) {
      res.status(404).json({ error: "Credit/debit note not found" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };

    // ── Checker approval / rejection ──
    if (req.body.status === "approved" || req.body.status === "rejected") {
      if (note.status !== "pending") {
        res.status(400).json({ error: `Note is already ${note.status}, cannot change to ${req.body.status}` });
        return;
      }
      updates.status = req.body.status;
      updates.reviewed_at = nowISO();
      updates.reviewed_by = req.user!.id;
    }

    // ── Funding queue settlement (mark received for credit, mark paid for debit) ──
    if (req.body.status === "received" || req.body.status === "paid") {
      if (note.status !== "approved") {
        res.status(400).json({ error: `Note must be approved first, current status: ${note.status}` });
        return;
      }
      
      // For credit notes, only "received" is valid; for debit notes, only "paid" is valid
      if (note.type === "credit" && req.body.status !== "received") {
        res.status(400).json({ error: "Credit notes must be marked as received" });
        return;
      }
      if (note.type === "debit" && req.body.status !== "paid") {
        res.status(400).json({ error: "Debit notes must be marked as paid" });
        return;
      }

      updates.status = req.body.status;
      updates.settled_at = nowISO();
      updates.settled_by = req.user!.id;

      // ── Update linked invoice amount ──
      if (note.linked_invoice_id) {
        const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
        const inv = await getItem(table, { id: note.linked_invoice_id }) as (Invoice | PurchaseInvoice) | undefined;

        if (inv) {
          let currentAmount = Number(inv.amount);
          const noteAmount = Number(note.amount);
          let newAmount: number;

          if (note.type === "credit") {
            // Credit note received → deduct from invoice
            newAmount = Math.max(0, currentAmount - noteAmount);
          } else {
            // Debit note paid → add to invoice
            newAmount = currentAmount + noteAmount;
          }

          await updateItem(table, { id: note.linked_invoice_id }, {
            amount: newAmount,
            updated_at: nowISO(),
          } as any);

          createActivityAlert({
            client_id: inv.client_id || note.client_id,
            type: "payment_received",
            severity: "info",
            message: `${note.type === "credit" ? "Credit" : "Debit"} note ${note.note_number} settled — invoice amount ${note.type === "credit" ? "reduced" : "increased"} from $${currentAmount.toLocaleString()} to $${newAmount.toLocaleString()}`,
          });
        }
      }
    }

    // Apply updates (allow partial updates from req.body)
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== "id" && key !== "created_at" && key !== "type") {
        if (key === "status") continue; // Already handled above
        updates[key] = value;
      }
    }

    const updated = await updateItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Credit/debit note not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/credit-debit-notes/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }) as CreditDebitNote | undefined;
    if (!note) {
      res.status(404).json({ error: "Credit/debit note not found" });
      return;
    }
    if (note.status !== "pending") {
      res.status(400).json({ error: "Cannot delete a note that has been reviewed or settled" });
      return;
    }
    await deleteItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
