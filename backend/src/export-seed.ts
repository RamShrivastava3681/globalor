#!/usr/bin/env node
/**
 * export-seed.ts
 * ──────────────
 * Standalone script that scans every DynamoDB table and writes a self-contained
 * seed TypeScript file (seed-data.ts) containing all the data.
 *
 * Usage:
 *   cd backend && npx tsx src/export-seed.ts
 *
 * The generated file exports a `SEED_DATA` record keyed by table name, plus a
 * `seedAllTables()` async function that writes every item back using BatchWrite.
 * Run the generated file with:
 *   cd backend && npx tsx src/seed-data.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TABLES, scanTable } from "./db/client.js";

// ── Table list (same order as schema.ts) ──
const ALL_TABLES = [
  "COMPANIES",
  "USERS",
  "PROFILES",
  "USER_ROLES",
  "EMAIL_REGISTRY",
  "DEBTORS",
  "VENDORS",
  "SUPPLIERS",
  "INVOICES",
  "PURCHASE_INVOICES",
  "PURCHASE_ORDERS",
  "ADVANCES",
  "EXPENSES",
  "STOCK_MOVEMENTS",
  "INVENTORY_ITEMS",
  "ALERTS",
  "CREDIT_DEBIT_NOTES",
  "PAYMENTS",
  "CHART_OF_ACCOUNTS",
  "JOURNAL_ENTRIES",
  "BALANCE_SHEET_ITEMS",
] as const;

type TableName = (typeof ALL_TABLES)[number];

async function main() {
  console.log("🔍 Scanning all DynamoDB tables...\n");

  const seedData: Record<string, Record<string, unknown>[]> = {};

  for (const tableName of ALL_TABLES) {
    const dynamoKey = TABLES[tableName as keyof typeof TABLES];
    if (!dynamoKey) {
      console.log(`  ⚠️  ${tableName} — no mapping in TABLES, skipping`);
      continue;
    }

    try {
      const items = await scanTable(dynamoKey);
      seedData[tableName] = items;
      console.log(`  ✅ ${tableName} (${dynamoKey}) — ${items.length} items`);
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") {
        console.log(`  ⚠️  ${tableName} — table does not exist, skipping`);
        seedData[tableName] = [];
      } else {
        console.error(`  ❌ ${tableName} — error: ${err.message}`);
        seedData[tableName] = [];
      }
    }
  }

  // ── Build the output file ──
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * seed-data.ts`);
  lines.push(` * ───────────`);
  lines.push(` * Auto-generated seed data. Do not edit manually.`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` *`);
  lines.push(` * Usage:  cd backend && npx tsx src/seed-data.ts`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";`);
  lines.push(`import { ddbClient, TABLES } from "./db/client.js";`);
  lines.push(``);
  lines.push(`// ── Seed data ──`);
  lines.push(`export const SEED_DATA: Record<string, Record<string, unknown>[]> = {`);

  let totalItems = 0;
  for (const tableName of ALL_TABLES) {
    const items = seedData[tableName] || [];
    totalItems += items.length;
    lines.push(`  ${tableName}: ${JSON.stringify(items, null, 4).split("\n").join("\n  ")},`);
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`// ── Batch write helper (25 items per batch, retries unprocessed) ──`);
  lines.push(`async function batchPut(tableName: string, items: Record<string, unknown>[]) {`);
  lines.push(`  const chunkSize = 25;`);
  lines.push(`  for (let i = 0; i < items.length; i += chunkSize) {`);
  lines.push(`    const chunk = items.slice(i, i + chunkSize);`);
  lines.push(`    let retries = 0;`);
  lines.push(`    let pending = chunk;`);
  lines.push(`    while (pending.length > 0 && retries <= 3) {`);
  lines.push(`      const result = await ddbClient.send(new BatchWriteCommand({`);
  lines.push(`        RequestItems: { [tableName]: pending.map((item) => ({ PutRequest: { Item: item } })) },`);
  lines.push(`      }));`);
  lines.push(`      const unprocessed = result.UnprocessedItems?.[tableName];`);
  lines.push(`      if (unprocessed && unprocessed.length > 0) {`);
  lines.push(`        pending = unprocessed.map((u) => u.PutRequest!.Item as Record<string, unknown>);`);
  lines.push(`        retries++;`);
  lines.push(`        await new Promise((r) => setTimeout(r, 100 * Math.pow(2, retries)));`);
  lines.push(`      } else {`);
  lines.push(`        pending = [];`);
  lines.push(`      }`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// ── Seed all tables ──`);
  lines.push(`export async function seedAllTables(): Promise<void> {`);
  lines.push(`  const tableOrder: (keyof typeof TABLES)[] = [`);
  lines.push(`    "COMPANIES", "USERS", "PROFILES", "USER_ROLES", "EMAIL_REGISTRY",`);
  lines.push(`    "DEBTORS", "VENDORS", "SUPPLIERS",`);
  lines.push(`    "INVOICES", "PURCHASE_INVOICES", "PURCHASE_ORDERS",`);
  lines.push(`    "ADVANCES", "EXPENSES", "STOCK_MOVEMENTS", "INVENTORY_ITEMS",`);
  lines.push(`    "ALERTS", "CREDIT_DEBIT_NOTES", "PAYMENTS",`);
  lines.push(`    "CHART_OF_ACCOUNTS", "JOURNAL_ENTRIES", "BALANCE_SHEET_ITEMS",`);
  lines.push(`  ];`);
  lines.push(``);
  lines.push(`  for (const key of tableOrder) {`);
  lines.push(`    const items = SEED_DATA[key] ?? [];`);
  lines.push(`    if (items.length === 0) {`);
  lines.push(`      console.log(\`  ⏭️  \${key} — 0 items, skipping\`);`);
  lines.push(`      continue;`);
  lines.push(`    }`);
  lines.push(`    console.log(\`  📥 \${key} — writing \${items.length} items...\`);`);
  lines.push(`    try {`);
  lines.push(`      await batchPut(TABLES[key], items);`);
  lines.push(`      console.log(\`  ✅ \${key} — done\`);`);
  lines.push(`    } catch (err: any) {`);
  lines.push(`      console.error(\`  ❌ \${key} — error: \${err.message}\`);`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// Run directly: npx tsx src/seed-data.ts`);
  lines.push(`if (process.argv[1]?.endsWith("seed-data.ts") || process.argv[1]?.endsWith("seed-data.js")) {`);
  lines.push(`  seedAllTables()`);
  lines.push(`    .then(() => {`);
  lines.push(`      console.log("\\n🎉 Seed complete!");`);
  lines.push(`      process.exit(0);`);
  lines.push(`    })`);
  lines.push(`    .catch((err) => {`);
  lines.push(`      console.error("\\n❌ Seed failed:", err);`);
  lines.push(`      process.exit(1);`);
  lines.push(`    });`);
  lines.push(`}`);

  const outputPath = join(process.cwd(), "src", "seed-data.ts");
  writeFileSync(outputPath, lines.join("\n"), "utf-8");

  console.log(`\n📦 Total: ${totalItems} items across ${ALL_TABLES.length} tables`);
  console.log(`📄 Seed file written to: ${outputPath}`);
  console.log(`\nTo run the seed:  cd backend && npx tsx src/seed-data.ts`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
