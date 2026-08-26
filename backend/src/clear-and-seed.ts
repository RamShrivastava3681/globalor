/**
 * clear-and-seed.ts
 * 
 * 1. Scans every DynamoDB table and deletes all items.
 * 2. Runs the seed script to populate fresh data.
 * 
 * Usage:  npx tsx src/clear-and-seed.ts
 */
import { scanTable, batchDeleteItems, TABLES } from "./db/client.js";
import { seedAllTables } from "./seed-data.js";

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
  console.log("🧹 Clearing all tables…\n");

  const tableNames = Object.values(TABLES);

  for (const tableName of tableNames) {
    try {
      const count = await clearTable(tableName);
      console.log(`   ✔ ${tableName}: deleted ${count} items`);
    } catch (err: any) {
      // Table might not exist yet — that's fine
      if (err?.name === "ResourceNotFoundException") {
        console.log(`   ⏭ ${tableName}: does not exist (skipped)`);
      } else {
        console.error(`   ❌ ${tableName}: failed –`, err.message || err);
      }
    }
  }

  console.log("\n🌱 Seeding fresh data…\n");

  await seedAllTables();

  console.log("\n✅ Done — all tables cleared and re-seeded.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
