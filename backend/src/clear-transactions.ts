/**
 * clear-transactions.ts
 * 
 * Scans specified transaction tables and deletes all items.
 * Preserves users, roles, profiles, email registry, companies, catalogue settings, and chart of accounts.
 * 
 * Usage: npx tsx src/clear-transactions.ts
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";

async function clearTable(tableName: string): Promise<number> {
  const items = await scanTable(tableName);
  if (items.length === 0) return 0;

  const keys = items.map((item) => {
    // All tables use "id" as the partition key
    return { id: (item as any).id };
  });

  await batchDeleteItems(tableName, keys);
  return keys.length;
}

async function main() {
  console.log("🧹 Clearing transaction tables…\n");

  const tablesToClear = [
    TABLES.DEBTORS,
    TABLES.VENDORS,
    TABLES.SUPPLIERS,
    TABLES.INVOICES,
    TABLES.PURCHASE_INVOICES,
    TABLES.PURCHASE_ORDERS,
    TABLES.ADVANCES,
    TABLES.EXPENSES,
    TABLES.STOCK_MOVEMENTS,
    TABLES.INVENTORY_ITEMS,
    TABLES.ALERTS,
    TABLES.CREDIT_DEBIT_NOTES,
    TABLES.PAYMENTS,
    TABLES.JOURNAL_ENTRIES,
    TABLES.GOODS_PURCHASE_ORDERS,
    TABLES.GOODS_RECEIPTS,
    TABLES.GOODS_SALES_ORDERS,
    TABLES.GOODS_DISPATCHES,
    TABLES.QUOTATIONS,
    TABLES.PRODUCTS,
    TABLES.FORECAST_VARIABLES,
  ];

  for (const tableName of tablesToClear) {
    try {
      const count = await clearTable(tableName);
      console.log(`   ✔ ${tableName}: deleted ${count} items`);
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") {
        console.log(`   ⏭ ${tableName}: does not exist (skipped)`);
      } else {
        console.error(`   ❌ ${tableName}: failed –`, err.message || err);
      }
    }
  }

  console.log("\n✅ Transaction database cleanup complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
