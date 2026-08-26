/**
 * verify-imported.ts
 *
 * Verify the imported credit/debit notes in the database.
 */

import { scanTable, TABLES } from "./db/client.js";
import type { CreditDebitNote } from "./types/index.js";

async function main() {
  const notes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);

  const creditNotes = notes.filter((n) => n.type === "credit");
  const debitNotes = notes.filter((n) => n.type === "debit");

  const creditTotal = creditNotes.reduce((s, n) => s + Number(n.amount), 0);
  const debitTotal = debitNotes.reduce((s, n) => s + Number(n.amount), 0);

  console.log("═".repeat(50));
  console.log("📊 DATABASE VERIFICATION");
  console.log("═".repeat(50));
  console.log(`   Total records:       ${notes.length}`);
  console.log(`   Credit notes:        ${creditNotes.length}`);
  console.log(`     Total:             $${creditTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Debit notes:         ${debitNotes.length}`);
  console.log(`     Total:             $${debitTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Combined total:      $${(creditTotal + debitTotal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log("═".repeat(50));

  // Verify against Excel file totals
  const expectedCreditTotal = 2050553.69;
  const expectedDebitTotal = 1615785.97;
  const expectedCreditCount = 219;
  const expectedDebitCount = 266;

  console.log("\n📋 MATCHING AGAINST EXPECTED VALUES:");
  console.log(`   Credit notes: ${creditNotes.length === expectedCreditCount ? "✅" : "❌"} count=${creditNotes.length} (expected ${expectedCreditCount})`);
  console.log(`   Credit total: ${Math.abs(creditTotal - expectedCreditTotal) < 0.01 ? "✅" : "❌"} $${creditTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (expected $${expectedCreditTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`   Debit notes:  ${debitNotes.length === expectedDebitCount ? "✅" : "❌"} count=${debitNotes.length} (expected ${expectedDebitCount})`);
  console.log(`   Debit total:  ${Math.abs(debitTotal - expectedDebitTotal) < 0.01 ? "✅" : "❌"} $${debitTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (expected $${expectedDebitTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log("═".repeat(50));
}

main().catch(console.error);
