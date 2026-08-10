/**
 * ── Credit/Debit Note Immediate-Settlement Migration ──
 *
 * Credit/debit notes no longer go through the checker → funding-queue
 * workflow: new entries are created already settled ("received" for credit,
 * "paid" for debit) and their linked invoice amount is adjusted immediately.
 *
 * This script brings EXISTING pending/approved notes in line with the new
 * behavior so the whole history is consistent:
 *   1. Marks each pending/approved note as received/paid (settled_at_creation).
 *   2. Adjusts the linked invoice amount exactly as creation now does
 *      (credit → reduce, debit → increase; credit clamped at 0).
 *
 * **Safety guarantees:**
 * - Idempotent — already-settled notes (received/paid) are skipped.
 * - Never touches rejected notes.
 * - Does not delete any data.
 * - Notes referenced by a bulk-payment record (`PAYMENTS.credit_note_ids`)
 *   are marked settled but their invoice is NOT adjusted, matching the
 *   established bulk-settlement semantics (the reports already deduct those).
 *
 * Run:  cd backend && npx tsx src/migrate-settle-credit-notes.ts
 */

import { scanTable, getItem, updateItem, TABLES } from "./db/client.js";
import { nowISO } from "./utils/helpers.js";
import type { CreditDebitNote, Invoice, PurchaseInvoice } from "./types/index.js";

async function main() {
  const [notes, payments] = await Promise.all([
    scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES),
    scanTable<{ credit_note_ids?: string[] | null }>(TABLES.PAYMENTS),
  ]);

  const bulkSettledIds = new Set<string>();
  for (const p of payments) {
    for (const id of p.credit_note_ids ?? []) bulkSettledIds.add(id);
  }

  const candidates = notes.filter((n) => n.status === "pending" || n.status === "approved");
  console.log(`Found ${candidates.length} pending/approved credit/debit note(s) to settle.`);

  let settled = 0;
  let adjusted = 0;
  let skippedBulk = 0;
  let errors = 0;

  for (const note of candidates) {
    try {
      const terminalStatus: "received" | "paid" = note.type === "credit" ? "received" : "paid";

      // Bulk-settled notes never had their invoice reduced by settlement, so the
      // reports still deduct them. Adjusting the invoice here would double-count.
      const isBulkSettled = bulkSettledIds.has(note.id);

      if (!isBulkSettled && note.linked_invoice_id && note.linked_invoice_type) {
        const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
        const inv = await getItem(table, { id: note.linked_invoice_id }) as (Invoice | PurchaseInvoice) | undefined;
        if (inv) {
          const currentAmount = Number(inv.amount);
          const noteAmount = Number(note.amount);
          const newAmount = note.type === "credit"
            ? Math.max(0, currentAmount - noteAmount)
            : currentAmount + noteAmount;
          await updateItem(table, { id: note.linked_invoice_id }, { amount: newAmount, updated_at: nowISO() } as any);
          adjusted++;
          console.log(`  • ${note.type === "credit" ? "Credit" : "Debit"} ${note.note_number} → invoice ${inv.invoice_number}: ${currentAmount.toLocaleString()} → ${newAmount.toLocaleString()}`);
        }
      } else if (isBulkSettled) {
        skippedBulk++;
        console.log(`  • ${note.type === "credit" ? "Credit" : "Debit"} ${note.note_number} → settled (bulk-payment note, invoice left untouched)`);
      }

      // Only notes whose invoice was actually adjusted may be deleted later
      // with automatic reversal. Bulk-settled notes were NOT adjusted here, so
      // they must not allow reversal (which would wrongly move their invoice).
      await updateItem(TABLES.CREDIT_DEBIT_NOTES, { id: note.id }, {
        status: terminalStatus,
        settled_at: nowISO(),
        settled_by: "migration",
        settled_at_creation: !isBulkSettled,
        updated_at: nowISO(),
      } as any);
      settled++;
    } catch (err) {
      errors++;
      console.error(`  ✗ Failed to settle ${note.note_number} (${note.id}):`, err);
    }
  }

  console.log(`\nDone. Settled: ${settled}, invoices adjusted: ${adjusted}, bulk-skipped: ${skippedBulk}, errors: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
