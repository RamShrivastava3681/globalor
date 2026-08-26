/**
 * import-expenses.ts
 *
 * Reads expenses-report.xlsx and creates expense records in the expenses table.
 *
 * Excel format:
 *   Row 0-3: Title/header info (skip)
 *   Row 4: Header: ["ID","Category","Description","Amount","Date","Linked Invoice","Created"]
 *   Row 5+: Data rows
 *
 * Usage: npx tsx src/import-expenses.ts
 */
import XLSX from "xlsx";
import {
  putItem,
  scanTable,
  batchPutItems,
  TABLES,
} from "./db/client.js";
import {
  generateId,
  nowISO,
} from "./utils/helpers.js";
import type { Expense } from "./types/index.js";

const CLIENT_ID = "1781861412998-c880305f"; // arjun.jaiswal@whizunik.com
const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

/** Parse date string like "Aug 19, 2026" → "2026-08-19" */
function parseDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Parse amount string like "$8,990.4" or "-$5,190.7" → number */
function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/[$,]/g, "").trim();
  return Number(cleaned) || 0;
}

async function main() {
  const now = nowISO();

  console.log("📄 Reading expenses-report.xlsx...");
  const wb = XLSX.readFile("expenses-report.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  console.log(`   Total rows: ${raw.length}`);

  // Data starts at row 5 (row 4 is header)
  const expenses: Expense[] = [];
  let skippedCount = 0;

  for (let i = 5; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 5) continue;

    const id = String(row[0] ?? "").trim();
    if (!id) continue;

    const category = String(row[1] ?? "").trim();
    if (!category) continue;

    const description = String(row[2] ?? "").trim();
    const descValue = description === "—" || description === "-" ? null : description;

    const amountStr = String(row[3] ?? "").trim();
    const amount = parseAmount(amountStr);
    if (amount === 0) continue;

    const dateStr = String(row[4] ?? "").trim();
    const expenseDate = parseDate(dateStr);

    const linkedInvoice = String(row[5] ?? "").trim();
    const createdStr = String(row[6] ?? "").trim();
    const createdAt = createdStr ? new Date(createdStr).toISOString() : now;

    const expense: Expense = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      category,
      description: descValue,
      amount,
      expense_date: expenseDate,
      invoice_id: null,
      purchase_invoice_id: null,
      documents: [],
      created_at: createdAt,
      updated_at: now,
    };

    expenses.push(expense);
  }

  console.log(`   Found ${expenses.length} expenses. Skipped: ${skippedCount}`);

  // Group by category for summary
  const byCategory = new Map<string, { count: number; total: number }>();
  for (const e of expenses) {
    const existing = byCategory.get(e.category) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += e.amount;
    byCategory.set(e.category, existing);
  }

  console.log("\n   Categories:");
  for (const [cat, stats] of byCategory.entries()) {
    console.log(`     ${cat}: ${stats.count} entries, $${stats.total.toLocaleString()}`);
  }

  // Write expenses in batches of 25
  if (expenses.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < expenses.length; i += 25) {
      const chunk = expenses.slice(i, i + 25);
      await batchPutItems(TABLES.EXPENSES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${expenses.length} expenses...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} expenses.`);
  }

  // Summary
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  console.log("\n" + "═".repeat(50));
  console.log("✅ IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Expenses imported: ${expenses.length}`);
  console.log(`   Total amount:      $${totalAmount.toLocaleString()}`);
  console.log(`   Categories:        ${byCategory.size}`);
  console.log("═".repeat(50));

  // Breakdown by year
  const byYear = new Map<string, { count: number; total: number }>();
  for (const e of expenses) {
    const year = e.expense_date.slice(0, 4);
    const existing = byYear.get(year) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += e.amount;
    byYear.set(year, existing);
  }
  console.log("\n   Breakdown by year:");
  for (const [year, stats] of byYear.entries()) {
    console.log(`     ${year}: ${stats.count} expenses, $${stats.total.toLocaleString()}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
