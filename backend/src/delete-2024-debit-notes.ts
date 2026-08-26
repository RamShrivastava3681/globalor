/**
 * delete-2024-debit-notes.ts
 *
 * Scans the credit_debit_notes table, finds every DEBIT note whose date
 * or created_at falls in calendar year 2024, and batch-deletes them.
 *
 * Usage:  npx tsx src/delete-2024-debit-notes.ts
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";
import type { CreditDebitNote } from "./types/index.js";

async function main() {
  console.log("🔍 Scanning credit/debit notes for year 2024…\n");

  const allNotes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);
  console.log(`   Total credit/debit notes in table: ${allNotes.length}`);

  const toDelete = allNotes.filter((n) => {
    const dateYear = (n.date ?? "").slice(0, 4);
    const createdYear = (n.created_at ?? "").slice(0, 4);
    const is2024 = dateYear === "2024" || createdYear === "2024";
    return is2024 && n.type === "debit";
  });

  console.log(`   Matched for deletion (year 2024, type debit): ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log("   Nothing to delete — exiting.");
    return;
  }

  console.log("   Sample matched notes:");
  for (const n of toDelete.slice(0, 10)) {
    console.log(`     • ${n.note_number} | type: ${n.type} | amount: ${n.amount} | date: ${n.date} | status: ${n.status}`);
  }
  if (toDelete.length > 10) {
    console.log(`     … and ${toDelete.length - 10} more`);
  }
  console.log();

  const keys = toDelete.map((n) => ({ id: n.id }));
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    try {
      await batchDeleteItems(TABLES.CREDIT_DEBIT_NOTES, chunk);
      deleted += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deleted}/${keys.length} …\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Batch delete failed at offset ${i}:`, err.message || err);
    }
  }

  console.log(`\n\n✅ Done — deleted ${deleted} debit notes from year 2024.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
