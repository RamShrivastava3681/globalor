import { Router, Response } from "express";
import { z } from "zod";
import {
  getItem,
  putItem,
  updateItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireAnyWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { Invoice, CreditDebitNote, PaymentRecord } from "../types/index.js";

const router = Router();

// ── Helper: compute late payment days ──
function computeLateDays(dueDate: string | null, closeDate: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.round((new Date(closeDate).getTime() - new Date(dueDate).getTime()) / 86400000));
}

// ── Helper: outstanding balance of an invoice ──
function outstandingBalance(inv: Invoice): number {
  return inv.amount_received != null
    ? Math.max(0, Number(inv.amount) - Number(inv.amount_received))
    : Number(inv.amount);
}

// ── Helper: close a single invoice fully ──
async function closeInvoice(inv: Invoice, closeDate: string, now: string) {
  const lateDays = computeLateDays(inv.due_date, closeDate);
  const balance = outstandingBalance(inv);
  const newReceived = (inv.amount_received ?? 0) + balance;

  await updateItem(TABLES.INVOICES, { id: inv.id }, {
    status: "paid",
    amount_received: newReceived,
    paid_date: closeDate,
    receipt_date: closeDate,
    late_days: lateDays,
    updated_at: now,
  });
}

// ── Helper: partially pay a single invoice ──
async function partiallyPayInvoice(inv: Invoice, amount: number, now: string) {
  const newReceived = (inv.amount_received ?? 0) + amount;
  await updateItem(TABLES.INVOICES, { id: inv.id }, {
    amount_received: newReceived,
    updated_at: now,
  });
}

// ── POST /api/bulk-payments/process ──
const processSchema = z.object({
  debtor_id: z.string().min(1),
  payment_date: z.string().min(1),
  amount: z.number().positive(),
  use_balance: z.boolean().optional().default(false),
  mode: z.enum(["manual", "fifo", "two_pass_fifo"]),
  selected_invoice_ids: z.array(z.string()).optional().default([]),
  settle_credit_note_ids: z.array(z.string()).optional().default([]),
});

router.post("/process", requireAuth, requireAnyWriteAccess("invoices", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = processSchema.parse(req.body);
    const now = nowISO();

    // ── 1. Determine available amount ──
    let availableAmount = parsed.amount;
    let consumedOldPayments: PaymentRecord[] = [];

    // If use_balance, scan previous payment records for this debtor with remaining > 0
    if (parsed.use_balance) {
      const prevPayments = await scanTable<PaymentRecord>(TABLES.PAYMENTS, {
        filterExpression: "debtor_id = :did AND #remaining > :zero",
        expressionAttributeNames: { "#remaining": "remaining" },
        expressionAttributeValues: { ":did": parsed.debtor_id, ":zero": 0 },
      });
      consumedOldPayments = prevPayments;
      const totalRemaining = prevPayments.reduce((s, p) => s + Number(p.remaining), 0);
      availableAmount += totalRemaining;
    }

    // ── 2. Fetch open invoices for this debtor ──
    const allInvoices = await scanTable<Invoice>(TABLES.INVOICES);
    const eligibleStatuses = new Set(["pending", "approved", "funded", "advanced", "overdue"]);
    let openInvoices = allInvoices
      .filter((i) => i.debtor_id === parsed.debtor_id && eligibleStatuses.has(i.status))
      .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"));

    // ── 3. Process by mode ──
    const closed: Array<{ id: string; invoice_number: string; amount: number; late_payment_days: number }> = [];
    const partiallyPaid: Array<{ id: string; invoice_number: string; amount_paid: number; remaining: number }> = [];
    const skipped: Array<{ id: string; invoice_number: string; reason: string }> = [];
    let remainingAfterProcessing = availableAmount;

    if (parsed.mode === "manual") {
      // Manual mode: process selected invoices in due_date order, allow partial payments
      const selected = openInvoices.filter((inv) => parsed.selected_invoice_ids.includes(inv.id));

      for (const inv of selected) {
        if (remainingAfterProcessing <= 0) break;
        const balance = outstandingBalance(inv);

        if (remainingAfterProcessing >= balance) {
          // Full payment — close the invoice
          await closeInvoice(inv, parsed.payment_date, now);
          const lateDays = computeLateDays(inv.due_date, parsed.payment_date);
          closed.push({ id: inv.id, invoice_number: inv.invoice_number, amount: balance, late_payment_days: lateDays });
          remainingAfterProcessing -= balance;
        } else {
          // Partial payment — reduce balance, keep open
          await partiallyPayInvoice(inv, remainingAfterProcessing, now);
          partiallyPaid.push({
            id: inv.id,
            invoice_number: inv.invoice_number,
            amount_paid: remainingAfterProcessing,
            remaining: balance - remainingAfterProcessing,
          });
          remainingAfterProcessing = 0;
        }
      }

      // Invoices not selected = skipped
      for (const inv of openInvoices) {
        if (!parsed.selected_invoice_ids.includes(inv.id)) {
          skipped.push({ id: inv.id, invoice_number: inv.invoice_number, reason: "Not selected" });
        }
      }
    } else if (parsed.mode === "fifo") {
      // Strict FIFO: no partial payments — only close if funds >= full balance, skip otherwise
      for (const inv of openInvoices) {
        if (remainingAfterProcessing <= 0) break;
        const balance = outstandingBalance(inv);

        if (remainingAfterProcessing >= balance) {
          await closeInvoice(inv, parsed.payment_date, now);
          const lateDays = computeLateDays(inv.due_date, parsed.payment_date);
          closed.push({ id: inv.id, invoice_number: inv.invoice_number, amount: balance, late_payment_days: lateDays });
          remainingAfterProcessing -= balance;
        } else {
          skipped.push({ id: inv.id, invoice_number: inv.invoice_number, reason: "Insufficient funds (FIFO strict)" });
        }
      }
    } else if (parsed.mode === "two_pass_fifo") {
      // Two-Pass FIFO: Pass 1 on overdue (due_date <= payment_date), Pass 2 on future
      const overdueInvoices = openInvoices.filter((inv) => inv.due_date != null && inv.due_date <= parsed.payment_date);
      const futureInvoices = openInvoices.filter((inv) => inv.due_date == null || inv.due_date > parsed.payment_date);

      // Pass 1: Standard FIFO on overdue invoices
      for (const inv of overdueInvoices) {
        if (remainingAfterProcessing <= 0) break;
        const balance = outstandingBalance(inv);

        if (remainingAfterProcessing >= balance) {
          await closeInvoice(inv, parsed.payment_date, now);
          const lateDays = computeLateDays(inv.due_date, parsed.payment_date);
          closed.push({ id: inv.id, invoice_number: inv.invoice_number, amount: balance, late_payment_days: lateDays });
          remainingAfterProcessing -= balance;
        } else {
          skipped.push({ id: inv.id, invoice_number: inv.invoice_number, reason: "Insufficient funds (Pass 1)" });
        }
      }

      // Pass 2: Future invoices — closed_date = due_date, so late_payment_days = 0
      for (const inv of futureInvoices) {
        if (remainingAfterProcessing <= 0) break;
        const balance = outstandingBalance(inv);

        if (remainingAfterProcessing >= balance) {
          // Future invoice: close with date = due_date (so late days = 0)
          const closeDate = inv.due_date ?? parsed.payment_date;
          const lateDays = computeLateDays(inv.due_date, closeDate); // will be 0 since closeDate === due_date
          await updateItem(TABLES.INVOICES, { id: inv.id }, {
            status: "paid",
            amount_received: (inv.amount_received ?? 0) + balance,
            paid_date: closeDate,
            receipt_date: closeDate,
            late_days: lateDays,
            updated_at: now,
          });
          closed.push({ id: inv.id, invoice_number: inv.invoice_number, amount: balance, late_payment_days: lateDays });
          remainingAfterProcessing -= balance;
        } else {
          skipped.push({ id: inv.id, invoice_number: inv.invoice_number, reason: "Insufficient funds (Pass 2)" });
        }
      }
    }

    // ── 4. Settle credit notes ──
    const settledCredits: string[] = [];
    const creditErrors: Array<{ id: string; error: string }> = [];

    for (const noteId of parsed.settle_credit_note_ids) {
      try {
        const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: noteId }) as CreditDebitNote | undefined;
        if (!note) {
          creditErrors.push({ id: noteId, error: "Credit note not found" });
          continue;
        }
        if (note.type !== "credit") {
          creditErrors.push({ id: noteId, error: "Only credit notes can be settled as credit" });
          continue;
        }
        if (note.status !== "approved") {
          creditErrors.push({ id: noteId, error: `Credit note status is "${note.status}", must be approved` });
          continue;
        }
        await updateItem(TABLES.CREDIT_DEBIT_NOTES, { id: noteId }, {
          status: "received",
          settled_at: now,
          settled_by: req.user!.id,
          updated_at: now,
        });
        settledCredits.push(noteId);
      } catch (err) {
        console.error(`Credit settlement error for ${noteId}:`, err);
        creditErrors.push({ id: noteId, error: "Failed to settle" });
      }
    }

    // ── 5. Create payment record with remaining balance ──
    const paymentRecord: PaymentRecord = {
      id: generateId(),
      client_id: req.user!.id,
      debtor_id: parsed.debtor_id,
      amount: parsed.amount,
      payment_date: parsed.payment_date,
      remaining: remainingAfterProcessing,
      invoices_closed: closed.length,
      closed_invoices: closed.map((c) => ({ id: c.id, invoice_number: c.invoice_number, amount: c.amount })),
      partial_invoices: partiallyPaid.map((p) => ({ id: p.id, invoice_number: p.invoice_number, amount_paid: p.amount_paid })),
      credit_note_ids: settledCredits,
      mode: parsed.mode,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.PAYMENTS, paymentRecord as any);

    // ── 6. Consume old remaining balances ──
    // Zero out the remaining on all old payment records that were consumed so they don't double-count
    for (const oldPay of consumedOldPayments) {
      await updateItem(TABLES.PAYMENTS, { id: oldPay.id }, {
        remaining: 0,
        updated_at: now,
      });
    }

    // ── 7. Activity alert ──
    const totalPaid = closed.reduce((s, c) => s + c.amount, 0);
    const totalPartiallyPaid = partiallyPaid.reduce((s, p) => s + p.amount_paid, 0);
    if (closed.length > 0 || partiallyPaid.length > 0) {
      createActivityAlert({
        client_id: req.user!.id,
        debtor_id: parsed.debtor_id,
        type: "payment_received",
        severity: "info",
        message: `Bulk payment of ${fmtMoneyShort(parsed.amount)} processed — ${closed.length} closed, ${partiallyPaid.length} partially paid, ${settledCredits.length} credits settled. Remaining balance: ${fmtMoneyShort(remainingAfterProcessing)}`,
        created_by: req.user!.id,
      });
    }

    res.json({
      payment_id: paymentRecord.id,
      amount: parsed.amount,
      remaining: remainingAfterProcessing,
      closed,
      partially_paid: partiallyPaid,
      skipped,
      settled_credits: settledCredits,
      credit_errors: creditErrors,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Bulk payment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/bulk-payments/balance/:debtorId ──
// Returns the total unapplied remaining balance from previous payment records.
router.get("/balance/:debtorId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const payments = await scanTable<PaymentRecord>(TABLES.PAYMENTS, {
      filterExpression: "debtor_id = :did AND #remaining > :zero",
      expressionAttributeNames: { "#remaining": "remaining" },
      expressionAttributeValues: { ":did": req.params.debtorId, ":zero": 0 },
    });
    const totalRemaining = payments.reduce((s, p) => s + Number(p.remaining), 0);
    res.json({ total_remaining: totalRemaining, payment_count: payments.length });
  } catch (err) {
    console.error("Get balance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/bulk-payments/history ──
// Returns payment records enriched with debtor names, optionally filtered by debtor_id.
router.get("/history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const debtorId = req.query.debtor_id as string | undefined;

    const payments = await scanTable<PaymentRecord>(TABLES.PAYMENTS);

    // Filter by debtor if specified
    let filtered = payments;
    if (debtorId) {
      filtered = payments.filter((p) => p.debtor_id === debtorId);
    }

    // Sort by created_at descending (most recent first)
    filtered.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    // Enrich with debtor names
    const allDebtors = await scanTable<{ id: string; name: string }>(TABLES.DEBTORS);
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d.name]));

    const enriched = filtered.map((p) => ({
      ...p,
      debtor_name: debtorMap.get(p.debtor_id) ?? "Unknown",
    }));

    // Calculate totals
    const totalRemaining = enriched.reduce((s, p) => s + Number(p.remaining), 0);
    const totalProcessed = enriched.reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      payments: enriched,
      totals: {
        total_payments: enriched.length,
        total_amount: totalProcessed,
        total_remaining: totalRemaining,
      },
    });
  } catch (err) {
    console.error("Get payment history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/bulk-payments/reverse/:paymentId ──
// Reverses a payment record: reopens the invoices that were closed, unresolves credit notes, and deletes the payment record.
router.post("/reverse/:paymentId", requireAuth, requireAnyWriteAccess("invoices", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const { paymentId } = req.params;
    const now = nowISO();

    // ── 1. Fetch the payment record ──
    const payment = await getItem(TABLES.PAYMENTS, { id: paymentId }) as PaymentRecord | undefined;
    if (!payment) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }

    const reversedInvoices: string[] = [];
    const reversalErrors: Array<{ id: string; error: string }> = [];
    const restoredCreditNotes: string[] = [];
    const creditNoteErrors: Array<{ id: string; error: string }> = [];

    // ── 2. Reverse closed invoices ──
    for (const ci of (payment.closed_invoices ?? [])) {
      try {
        const inv = await getItem(TABLES.INVOICES, { id: ci.id }) as Invoice | undefined;
        if (!inv) {
          reversalErrors.push({ id: ci.id, error: "Invoice not found" });
          continue;
        }

        // Subtract the paid amount from amount_received
        const prevReceived = inv.amount_received ?? 0;
        const newReceived = Math.max(0, prevReceived - ci.amount);

        if (newReceived <= 0) {
          // Fully reverse — set back to open status
          // Determine status: if due_date is in the past, set to "overdue", otherwise "approved"
          const isOverdue = inv.due_date != null && inv.due_date < now.slice(0, 10);
          await updateItem(TABLES.INVOICES, { id: inv.id }, {
            status: isOverdue ? "overdue" : "approved",
            amount_received: null,
            paid_date: null,
            receipt_date: null,
            late_days: null,
            updated_at: now,
          });
        } else {
          // Only partially reversed (shouldn't happen in full reverse, but handle gracefully)
          await updateItem(TABLES.INVOICES, { id: inv.id }, {
            amount_received: newReceived,
            updated_at: now,
          });
        }

        reversedInvoices.push(ci.id);
      } catch (err) {
        console.error(`Error reversing invoice ${ci.id}:`, err);
        reversalErrors.push({ id: ci.id, error: "Failed to reverse invoice" });
      }
    }

    // ── 3. Reverse partial payments ──
    for (const pi of (payment.partial_invoices ?? [])) {
      try {
        const inv = await getItem(TABLES.INVOICES, { id: pi.id }) as Invoice | undefined;
        if (!inv) {
          reversalErrors.push({ id: pi.id, error: "Invoice not found" });
          continue;
        }

        const prevReceived = inv.amount_received ?? 0;
        const newReceived = Math.max(0, prevReceived - pi.amount_paid);

        if (newReceived <= 0) {
          const isOverdue = inv.due_date != null && inv.due_date < now.slice(0, 10);
          await updateItem(TABLES.INVOICES, { id: inv.id }, {
            status: isOverdue ? "overdue" : "approved",
            amount_received: null,
            paid_date: null,
            receipt_date: null,
            late_days: null,
            updated_at: now,
          });
        } else {
          await updateItem(TABLES.INVOICES, { id: inv.id }, {
            amount_received: newReceived,
            updated_at: now,
          });
        }

        reversedInvoices.push(pi.id);
      } catch (err) {
        console.error(`Error reversing partial payment for invoice ${pi.id}:`, err);
        reversalErrors.push({ id: pi.id, error: "Failed to reverse partial payment" });
      }
    }

    // ── 4. Restore credit notes back to "approved" ──
    for (const noteId of (payment.credit_note_ids ?? [])) {
      try {
        const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: noteId }) as CreditDebitNote | undefined;
        if (!note) {
          creditNoteErrors.push({ id: noteId, error: "Credit note not found" });
          continue;
        }

        await updateItem(TABLES.CREDIT_DEBIT_NOTES, { id: noteId }, {
          status: "approved",
          settled_at: null,
          settled_by: null,
          updated_at: now,
        });

        restoredCreditNotes.push(noteId);
      } catch (err) {
        console.error(`Error restoring credit note ${noteId}:`, err);
        creditNoteErrors.push({ id: noteId, error: "Failed to restore credit note" });
      }
    }

    // ── 5. Delete the payment record ──
    await deleteItem(TABLES.PAYMENTS, { id: paymentId });

    // ── 6. Activity alert ──
    if (reversedInvoices.length > 0) {
      createActivityAlert({
        client_id: req.user!.id,
        debtor_id: payment.debtor_id,
        type: "payment_received",
        severity: "warning",
        message: `Bulk payment of ${fmtMoneyShort(payment.amount)} reversed — ${reversedInvoices.length} invoice(s) reopened, ${restoredCreditNotes.length} credit note(s) restored.`,
        created_by: req.user!.id,
      });
    }

    res.json({
      success: true,
      payment_id: paymentId,
      reversed_invoices: reversedInvoices,
      reversal_errors: reversalErrors,
      restored_credit_notes: restoredCreditNotes,
      credit_note_errors: creditNoteErrors,
    });
  } catch (err) {
    console.error("Reverse payment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function fmtMoneyShort(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export default router;
