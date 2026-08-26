/**
 * delete-2025-purchase-invoices.ts
 *
 * Scans the purchase-invoices table, finds every invoice whose issue_date
 * or created_at falls in calendar year 2025, and batch-deletes them.
 *
 * Usage:  npx tsx src/delete-2025-purchase-invoices.ts
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";
import type { PurchaseInvoice } from "./types/index.js";

async function main() {
  console.log("🔍 Scanning purchase invoices for year 2025…\n");

  const allPI = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
  console.log(`   Total purchase invoices in table: ${allPI.length}`);

  // Filter: issue_date starts with "2025" OR created_at starts with "2025"
  const toDelete = allPI.filter((pi) => {
    const issueYear = (pi.issue_date ?? "").slice(0, 4);
    const createdYear = (pi.created_at ?? "").slice(0, 4);
    return issueYear === "2025" || createdYear === "2025";
  });

  console.log(`   Matched for deletion (year 2025): ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log("   Nothing to delete — exiting.");
    return;
  }

  // Show a sample
  console.log("   Sample matched invoices:");
  for (const pi of toDelete.slice(0, 10)) {
    console.log(`     • ${pi.invoice_number} | amount: ${pi.amount} | issue: ${pi.issue_date} | status: ${pi.status}`);
  }
  if (toDelete.length > 10) {
    console.log(`     … and ${toDelete.length - 10} more`);
  }
  console.log();

  // Batch delete in chunks of 25 (DynamoDB limit)
  const keys = toDelete.map((pi) => ({ id: pi.id }));
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    try {
      await batchDeleteItems(TABLES.PURCHASE_INVOICES, chunk);
      deleted += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deleted}/${keys.length} …\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Batch delete failed at offset ${i}:`, err.message || err);
    }
  }

  console.log(`\n\n✅ Done — deleted ${deleted} purchase invoices from year 2025.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
