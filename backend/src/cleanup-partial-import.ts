/**
 * cleanup-partial-import.ts
 * Deletes all invoices, purchase invoices, and credit/debit notes
 * (to clean up the partial import that failed due to noa_token NULL).
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";

async function clearTable(name: string) {
  const items = await scanTable(name);
  if (items.length === 0) return 0;
  const keys = items.map((i) => ({ id: (i as any).id }));
  await batchDeleteItems(name, keys);
  return keys.length;
}

async function main() {
  console.log("🧹 Cleaning up partial import data…\n");

  // Only clear sales invoices, purchase invoices, and credit/debit notes
  // (the 2024 credit/debit notes will be re-created if they existed)
  for (const table of [TABLES.INVOICES, TABLES.PURCHASE_INVOICES, TABLES.CREDIT_DEBIT_NOTES, TABLES.VENDORS, TABLES.DEBTORS]) {
    try {
      const count = await clearTable(table);
      console.log(`   ✔ ${table}: deleted ${count} items`);
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") {
        console.log(`   ⏭ ${table}: does not exist (skipped)`);
      } else {
        console.error(`   ❌ ${table}: failed –`, err.message || err);
      }
    }
  }

  console.log("\n✅ Cleanup done.");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
