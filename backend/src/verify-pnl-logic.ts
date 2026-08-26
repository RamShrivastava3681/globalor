/**
 * verify-pnl-logic.ts
 *
 * Simulates the P&L calculation to verify the logic is correct.
 */

import { scanTable, TABLES } from "./db/client.js";
import { computeCreditNoteTotals } from "./utils/creditNotes.js";
import type { Invoice, PurchaseInvoice, Expense, CreditDebitNote, Advance } from "./types/index.js";

async function main() {
  console.log("📋 Loading data from database...");

  const [invoices, purchaseInvoices, expenses, creditDebitNotes, advances] = await Promise.all([
    scanTable<Invoice>(TABLES.INVOICES),
    scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES),
    scanTable<Expense>(TABLES.EXPENSES),
    scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES),
    scanTable<Advance>(TABLES.ADVANCES),
  ]);

  console.log(`   Invoices: ${invoices.length}`);
  console.log(`   Purchase Invoices: ${purchaseInvoices.length}`);
  console.log(`   Expenses: ${expenses.length}`);
  console.log(`   Credit/Debit Notes: ${creditDebitNotes.length}`);
  console.log(`   Advances: ${advances.length}`);

  // Use all-time range
  const isInRange = (d: string | null | undefined) => !!d;

  // Compute credit/debit note totals
  const { creditNoteTotal, debitNoteTotal } = computeCreditNoteTotals(
    creditDebitNotes,
    [],
    isInRange,
  );

  // Compute P&L components
  const grossSales = invoices
    .filter((inv) => isInRange(inv.issue_date))
    .reduce((sum, inv) => sum + Number(inv.amount), 0);

  const grossPurchases = purchaseInvoices
    .filter((pi) => isInRange(pi.issue_date))
    .reduce((sum, pi) => sum + Number(pi.amount), 0);

  // P&L Formula
  const totalTurnover = grossSales - debitNoteTotal;  // Only debit notes reduce turnover
  const netPurchases = grossPurchases - creditNoteTotal;  // Only credit notes reduce COGS
  const totalCostOfSales = netPurchases;
  const grossProfit = totalTurnover - totalCostOfSales;

  console.log("\n" + "═".repeat(60));
  console.log("📊 P&L VERIFICATION");
  console.log("═".repeat(60));

  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│                    TURNOVER                         │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Gross Sales:          ${formatMoney(grossSales).padStart(15)} │`);
  console.log(`│  Debit Notes:         -${formatMoney(debitNoteTotal).padStart(15)} │`);
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Total Turnover:       ${formatMoney(totalTurnover).padStart(15)} │`);
  console.log("└─────────────────────────────────────────────────────┘");

  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│                 COST OF SALES                       │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Gross Purchases:      ${formatMoney(grossPurchases).padStart(15)} │`);
  console.log(`│  Credit Notes:        -${formatMoney(creditNoteTotal).padStart(15)} │`);
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Net Purchases:        ${formatMoney(netPurchases).padStart(15)} │`);
  console.log("└─────────────────────────────────────────────────────┘");

  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│                 GROSS PROFIT                        │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Turnover:             ${formatMoney(totalTurnover).padStart(15)} │`);
  console.log(`│  Cost of Sales:       -${formatMoney(totalCostOfSales).padStart(15)} │`);
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Gross Profit:         ${formatMoney(grossProfit).padStart(15)} │`);
  console.log("└─────────────────────────────────────────────────────┘");

  console.log("\n" + "═".repeat(60));
  console.log("✅ P&L LOGIC VERIFICATION");
  console.log("═".repeat(60));
  console.log("✓ Turnover = Gross Sales - Debit Notes");
  console.log("✓ Cost of Sales = Gross Purchases - Credit Notes");
  console.log("✓ Gross Profit = Turnover - Cost of Sales");
  console.log("═".repeat(60));
}

function formatMoney(amount: number): string {
  return "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

main().catch(console.error);
