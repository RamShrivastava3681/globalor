/**
 * ── Delete 2025 Credit Notes Migration ──
 *
 * Deletes every credit note where the date falls in 2025.
 * Debit notes and credit notes from other years are NOT touched.
 *
 * For each credit note that was linked to an invoice and had already
 * adjusted the invoice amount (settled_at_creation), the script
 * reverses that adjustment before deleting the note — keeping the
 * books consistent.
 *
 * Usage:
 *   cd backend && npx tsx src/migrate-delete-2025-credit-notes.ts --dry-run   (preview only)
 *   cd backend && npx tsx src/migrate-delete-2025-credit-notes.ts --execute   (actually delete)
 */

import { scanTable, getItem, updateItem, deleteItem, TABLES } from "./db/client.js";
import { nowISO } from "./utils/helpers.js";
import type { CreditDebitNote, Invoice, PurchaseInvoice } from "./types/index.js";

const DRY_RUN = !process.argv.includes("--execute");

async function main() {
  console.log(`\n═══ Delete 2025 Credit Notes ${DRY_RUN ? "(DRY RUN)" : "(EXECUTE)"} ═══\n`);

  // 1. Fetch all credit/debit notes
  const allNotes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);
  console.log(`Total credit/debit notes in database: ${allNotes.length}`);

  // 2. Filter: type === "credit" AND date starts with "2025"
  const targets = allNotes.filter(
    (n) => n.type === "credit" && n.date && n.date.startsWith("2025"),
  );

  console.log(`Credit notes from 2025 to delete: ${targets.length}`);
  console.log(`Debit notes: ${allNotes.filter((n) => n.type === "debit").length} (will NOT be touched)`);
  console.log(`Credit notes from other years: ${allNotes.filter((n) => n.type === "credit" && (!n.date || !n.date.startsWith("2025"))).length} (will NOT be touched)\n`);

  if (targets.length === 0) {
    console.log("Nothing to delete. Exiting.");
    return;
  }

  // 3. List each note that will be deleted
  let reversedCount = 0;
  let skippedReverseCount = 0;

  for (const note of targets) {
    const hasInvoice = note.linked_invoice_id && note.linked_invoice_type;
    const wasApplied = note.status !== "pending" && note.settled_at_creation === true;
    const needsReverse = hasInvoice && wasApplied;

    console.log(`  • [${note.id}] ${note.note_number} | $${Number(note.amount).toLocaleString()} | date: ${note.date} | status: ${note.status} | linked: ${note.linked_invoice_type ?? "none"}/${note.linked_invoice_id ?? "none"}${needsReverse ? " → REVERSE invoice" : ""}`);

    if (needsReverse) {
      reversedCount++;
    } else {
      skippedReverseCount++;
    }
  }

  console.log(`\nSummary: ${targets.length} notes to delete, ${reversedCount} invoice adjustments to reverse, ${skippedReverseCount} with no invoice link to reverse\n`);

  if (DRY_RUN) {
    console.log("── DRY RUN complete. No changes were made. ──");
    console.log("To execute, run:  npx tsx src/migrate-delete-2025-credit-notes.ts --execute\n");
    return;
  }

  // 4. Execute: reverse invoice adjustments and delete notes
  let deleted = 0;
  let errors = 0;
  const affectedInvoices: Array<{ invoiceId: string; invoiceType: string; amountChange: number }> = [];

  for (const note of targets) {
    try {
      // Reverse invoice adjustment if the note had applied one
      if (note.linked_invoice_id && note.linked_invoice_type && note.status !== "pending" && note.settled_at_creation === true) {
        const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
        const inv = await getItem(table, { id: note.linked_invoice_id }) as (Invoice | PurchaseInvoice) | undefined;
        if (inv) {
          const noteAmount = Number(note.amount);
          // Credit note reduced the invoice → add it back
          const newAmount = Number(inv.amount) + noteAmount;
          await updateItem(table, { id: note.linked_invoice_id }, { amount: newAmount, updated_at: nowISO() } as any);
          affectedInvoices.push({ invoiceId: note.linked_invoice_id, invoiceType: note.linked_invoice_type, amountChange: noteAmount });
          console.log(`  ↩ Reversed invoice ${inv.invoice_number}: $${Number(inv.amount).toLocaleString()} → $${newAmount.toLocaleString()} (+$${noteAmount.toLocaleString()})`);
        }
      }

      // Delete the credit note
      await deleteItem(TABLES.CREDIT_DEBIT_NOTES, { id: note.id });
      deleted++;
      console.log(`  ✓ Deleted credit note ${note.note_number}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ Failed to delete ${note.note_number} (${note.id}):`, err);
    }
  }

  console.log(`\n═══ Done ═══`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Invoice adjustments reversed: ${affectedInvoices.length}`);
  console.log(`Errors: ${errors}`);

  if (affectedInvoices.length > 0) {
    console.log(`\nAffected invoices:`);
    for (const ai of affectedInvoices) {
      console.log(`  • ${ai.invoiceType} invoice ${ai.invoiceId}: +$${ai.amountChange.toLocaleString()}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
