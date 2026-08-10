import type { CreditDebitNote } from "../types/index.js";

export interface PurchaseCreditNoteResult {
  /** All purchase credit notes (linked to a purchase invoice or unlinked) in range. */
  applicableNotes: CreditDebitNote[];
  /** Notes whose amount has NOT already reduced their linked invoice's amount. */
  unappliedNotes: CreditDebitNote[];
  /** Sum of `unappliedNotes` amounts — the deduction to apply to cost of purchases. */
  deduction: number;
}

export interface CreditNoteTotals {
  /** Credit notes linked to a sales invoice — reduce turnover (sales returns). */
  salesReturns: number;
  /** Deduction to apply to cost of purchases (unapplied purchase credit notes). */
  purchaseReturns: number;
  /** Number of purchase credit notes that have not yet reduced an invoice amount. */
  unappliedNotesCount: number;
  /** Number of purchase credit notes in range (linked to purchase or unlinked). */
  applicableNotesCount: number;
}

/**
 * Credit-note totals for both sides of the P&L, computed with one shared
 * source of truth so the P&L report and the dashboard always agree:
 *
 * - `salesReturns`: every credit note linked to a sales invoice (reduces turnover).
 * - `purchaseReturns`: the deduction from `computePurchaseCreditNoteDeduction`
 *   (unapplied purchase credit notes, excluding PATCH-settled notes whose amount
 *   already reduced their linked purchase invoice).
 */
export function computeCreditNoteTotals(
  notes: CreditDebitNote[],
  payments: Array<{ credit_note_ids?: string[] | null }>,
  isInRange: (dateStr: string | null | undefined) => boolean,
): CreditNoteTotals {
  const { applicableNotes, unappliedNotes, deduction } = computePurchaseCreditNoteDeduction(
    notes,
    payments,
    isInRange,
  );

  const salesReturns = notes
    .filter((n) => n.type === "credit" && n.linked_invoice_type === "sales" && isInRange(n.date))
    .reduce((sum, n) => sum + Number(n.amount), 0);

  return {
    salesReturns,
    purchaseReturns: deduction,
    unappliedNotesCount: unappliedNotes.length,
    applicableNotesCount: applicableNotes.length,
  };
}

/**
 * Computes the credit-note deduction for purchase costs (P&L cost of sales and
 * balance sheet creditors).
 *
 * Credit notes reduce what we owe suppliers. There are two settlement paths
 * with different effects on the linked purchase invoice's amount:
 *
 * - Settled via the credit/debit-note PATCH flow (funding queue): the linked
 *   purchase invoice's `amount` is reduced at settlement time, so that note is
 *   already reflected inside the invoice amounts used elsewhere.
 * - Settled inside a bulk payment (`PAYMENTS.credit_note_ids`): only the note's
 *   status changes; the linked invoice amount is left untouched.
 *
 * Bulk-settled notes are detected via the payments table so that each credit
 * note nets against cost exactly once in both reports, regardless of how it
 * was settled.
 */
export function computePurchaseCreditNoteDeduction(
  notes: CreditDebitNote[],
  payments: Array<{ credit_note_ids?: string[] | null }>,
  isInRange: (dateStr: string | null | undefined) => boolean,
): PurchaseCreditNoteResult {
  const bulkSettledIds = new Set<string>();
  for (const p of payments) {
    for (const id of p.credit_note_ids ?? []) bulkSettledIds.add(id);
  }

  const applicableNotes = notes.filter(
    (n) =>
      n.type === "credit" &&
      (n.linked_invoice_type === "purchase" || !n.linked_invoice_type) &&
      isInRange(n.date),
  );

  const alreadyReflectedIds = new Set(
    applicableNotes
      .filter(
        (n) =>
          n.linked_invoice_type === "purchase" &&
          n.status === "received" &&
          !bulkSettledIds.has(n.id),
      )
      .map((n) => n.id),
  );

  const unappliedNotes = applicableNotes.filter((n) => !alreadyReflectedIds.has(n.id));
  const deduction = unappliedNotes.reduce((s, n) => s + Number(n.amount), 0);

  return { applicableNotes, unappliedNotes, deduction };
}
