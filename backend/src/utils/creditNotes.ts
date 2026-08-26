import type { CreditDebitNote } from "../types/index.js";

export interface CreditNoteTotals {
  /** Total credit notes in range — deducted from gross sales. */
  creditNoteTotal: number;
  /** Total debit notes in range — sales adjustments (reduce turnover). */
  debitNoteTotal: number;
  /** Number of credit notes in range. */
  creditNotesCount: number;
  /** Number of debit notes in range. */
  debitNotesCount: number;
}

/**
 * Credit-note totals for the P&L report:
 *
 * - `creditNoteTotal`: all credit notes in range — deducted from gross sales.
 * - `debitNoteTotal`: all debit notes in range — sales adjustments (reduce turnover).
 *
 * Neither affects cost of sales or any other calculation beyond turnover.
 */
export function computeCreditNoteTotals(
  notes: CreditDebitNote[],
  _payments: Array<{ credit_note_ids?: string[] | null }>,
  isInRange: (dateStr: string | null | undefined) => boolean,
): CreditNoteTotals {
  const inRange = notes.filter((n) => isInRange(n.date));

  const creditNoteTotal = inRange
    .filter((n) => n.type === "credit")
    .reduce((sum, n) => sum + Number(n.amount), 0);

  const debitNoteTotal = inRange
    .filter((n) => n.type === "debit")
    .reduce((sum, n) => sum + Number(n.amount), 0);

  const creditNotesCount = inRange.filter((n) => n.type === "credit").length;
  const debitNotesCount = inRange.filter((n) => n.type === "debit").length;

  return {
    creditNoteTotal,
    debitNoteTotal,
    creditNotesCount,
    debitNotesCount,
  };
}

/**
 * @deprecated Use computeCreditNoteTotals instead. This function is kept for
 * backward compatibility but returns zero for all values.
 */
export function computePurchaseCreditNoteDeduction(
  _notes: CreditDebitNote[],
  _payments: Array<{ credit_note_ids?: string[] | null }>,
  _isInRange: (dateStr: string | null | undefined) => boolean,
): { applicableNotes: CreditDebitNote[]; unappliedNotes: CreditDebitNote[]; deduction: number } {
  return { applicableNotes: [], unappliedNotes: [], deduction: 0 };
}
