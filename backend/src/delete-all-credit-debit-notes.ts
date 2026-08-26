/**
 * delete-all-credit-debit-notes.ts
 *
 * Scans the credit_debit_notes table and deletes every record.
 *
 * Usage:  npx tsx src/delete-all-credit-debit-notes.ts
 */

import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";
import type { CreditDebitNote } from "./types/index.js";

async function main() {
  console.log("🔍 Scanning all credit/debit notes…\n");

  const allNotes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);
  console.log(`   Total credit/debit notes in table: ${allNotes.length}`);

  if (allNotes.length === 0) {
    console.log("\n✅ No credit/debit notes to delete.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < allNotes.length; i += 25) {
    const chunk = allNotes.slice(i, i + 25);
    const keys = chunk.map((n) => ({ id: n.id }));
    await batchDeleteItems(TABLES.CREDIT_DEBIT_NOTES, keys);
    deleted += chunk.length;
    process.stdout.write(`   🗑️  Deleted ${deleted}/${allNotes.length} notes…\r`);
  }

  console.log(`\n\n✅ Done — deleted ${deleted} credit/debit notes from the table.`);
}

main().catch(console.error);
