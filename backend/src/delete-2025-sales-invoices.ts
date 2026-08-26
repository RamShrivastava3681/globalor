/**
 * delete-2025-sales-invoices.ts
 *
 * Scans the invoices (sales) table, finds every invoice whose issue_date
 * or created_at falls in calendar year 2025, and batch-deletes them.
 *
 * Usage:  npx tsx src/delete-2025-sales-invoices.ts
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";
import type { Invoice } from "./types/index.js";

async function main() {
  console.log("🔍 Scanning sales invoices for year 2025…\n");

  const allInv = await scanTable<Invoice>(TABLES.INVOICES);
  console.log(`   Total sales invoices in table: ${allInv.length}`);

  const toDelete = allInv.filter((inv) => {
    const issueYear = (inv.issue_date ?? "").slice(0, 4);
    const createdYear = (inv.created_at ?? "").slice(0, 4);
    return issueYear === "2025" || createdYear === "2025";
  });

  console.log(`   Matched for deletion (year 2025): ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log("   Nothing to delete — exiting.");
    return;
  }

  console.log("   Sample matched invoices:");
  for (const inv of toDelete.slice(0, 10)) {
    console.log(`     • ${inv.invoice_number} | amount: ${inv.amount} | issue: ${inv.issue_date} | status: ${inv.status}`);
  }
  if (toDelete.length > 10) {
    console.log(`     … and ${toDelete.length - 10} more`);
  }
  console.log();

  const keys = toDelete.map((inv) => ({ id: inv.id }));
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    try {
      await batchDeleteItems(TABLES.INVOICES, chunk);
      deleted += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deleted}/${keys.length} …\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Batch delete failed at offset ${i}:`, err.message || err);
    }
  }

  console.log(`\n\n✅ Done — deleted ${deleted} sales invoices from year 2025.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
