/**
 * reimport-2025-sales.ts
 *
 * 1. Deletes all 2025 sales invoices from DynamoDB.
 * 2. Reads sales-2025-final.xlsx (project root).
 * 3. Imports all "Receivable Invoice" rows with 0% fee and advance.
 * 4. Verifies the total matches 31,075,219.94.
 *
 * Usage:  npx tsx src/reimport-2025-sales.ts
 */
import XLSX from "xlsx";
import {
  scanTable,
  batchDeleteItems,
  batchPutItems,
  TABLES,
} from "./db/client.js";
import { generateId, generateNoaToken, nowISO } from "./utils/helpers.js";
import type { Invoice, Debtor } from "./types/index.js";

const CLIENT_ID = "1781861412998-c880305f";
const COMPANY_ID = "1784619121925-2c0baeaf";
const EXPECTED_TOTAL = 31075219.94;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:()]/g, "")
    .replace(
      /\b(s\.?a\.?|s\.?a\.?\s*d\.?\.?c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?)\.?/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDebtorField(raw: string): string {
  let s = raw.trim();
  const patterns = [
    / - As per the [Ii]nvoice.*$/,
    / - For the services rendered.*$/,
    / - OLO Report.*$/,
    / - VENTAS.*$/i,
    / - C\d+ - .*$/i,
    / - Document #.*$/i,
    / - FERRETERIA.*$/i,
    / - CONSORCIO.*$/i,
    / - FEBECA.*$/i,
    / - Dromex.*$/i,
    / - TRUPER.*$/i,
    /   [A-Z]/,
  ];
  for (const pat of patterns) {
    s = s.replace(pat, "");
  }
  return s.trim();
}

function buildDebtorLookup(debtors: Debtor[]): Map<string, Debtor> {
  const map = new Map<string, Debtor>();
  for (const d of debtors) {
    map.set(normalize(d.name), d);
  }
  return map;
}

function matchDebtor(raw: string, lookup: Map<string, Debtor>): Debtor | null {
  const cleaned = cleanDebtorField(raw);
  const norm = normalize(cleaned);
  if (lookup.has(norm)) return lookup.get(norm)!;
  for (const [key, debtor] of lookup) {
    if (norm.startsWith(key) || key.startsWith(norm)) return debtor;
  }
  for (const [key, debtor] of lookup) {
    if (norm.includes(key) || key.includes(norm)) return debtor;
  }
  return null;
}

function extractInvoiceNumber(invNum: string, rawDebtor: string): string {
  if (
    invNum.match(/^\d/) ||
    invNum.startsWith("INV-") ||
    invNum.startsWith("PB") ||
    invNum.startsWith("A0") ||
    invNum.startsWith("GL")
  ) {
    return invNum;
  }
  const dashIdx = invNum.indexOf(" - ");
  if (dashIdx > 0) return invNum.substring(0, dashIdx).trim();
  const m = rawDebtor.match(/Invoice\s*#?-?(\d[\d-]*)/i);
  if (m) return m[1];
  return invNum;
}

// ─── Parse sales-2025-final.xlsx (same format as import-sales-invoices.ts) ──

interface ParsedRow {
  date: string;
  rawDebtor: string;
  invoiceNumber: string;
  amount: number;
}

function parse2025Format(data: any[][]): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[2] || !row[4]) continue;
    const source = String(row[1] ?? "").trim();
    if (source !== "Receivable Invoice") continue;
    const amount = Number(row[4]) || 0;
    if (amount === 0) continue;
    const dateVal = row[0];
    let dateStr = "";
    if (typeof dateVal === "number" && dateVal > 40000)
      dateStr = excelDateToDate(dateVal);
    const rawInv = String(row[3] ?? "")
      .trim()
      .replace(/^INV-/i, "");
    const rawDebtor = String(row[2]).trim();
    rows.push({
      date: dateStr,
      rawDebtor,
      invoiceNumber: extractInvoiceNumber(rawInv, rawDebtor),
      amount,
    });
  }
  return rows;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const now = nowISO();

  // ── Step 1: Delete all 2025 sales invoices ──
  console.log("🗑️  Deleting all 2025 sales invoices...\n");
  const allInvoices = await scanTable<Invoice>(TABLES.INVOICES, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });
  const inv2025 = allInvoices.filter((inv) => {
    const y = (inv.issue_date ?? "").slice(0, 4);
    return y === "2025";
  });
  console.log(`   Found ${inv2025.length} invoices for 2025`);

  if (inv2025.length > 0) {
    const keys = inv2025.map((i) => ({ id: i.id }));
    for (let i = 0; i < keys.length; i += 25) {
      await batchDeleteItems(TABLES.INVOICES, keys.slice(i, i + 25));
      process.stdout.write(
        `   🗑️  Deleted ${Math.min(i + 25, keys.length)}/${keys.length}\r`,
      );
    }
    console.log(`\n   ✅ Deleted ${inv2025.length} 2025 sales invoices\n`);
  } else {
    console.log("   Nothing to delete.\n");
  }

  // ── Step 2: Load debtors for matching ──
  console.log("🔍 Loading existing debtors...");
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });
  console.log(`   Found ${existingDebtors.length} debtors`);
  const debtorLookup = buildDebtorLookup(existingDebtors);

  // ── Step 3: Read and parse sales-2025-final.xlsx ──
  console.log("\n📄 Reading sales-2025-final.xlsx...");
  const wb = XLSX.readFile("../sales-2025-final.xlsx");
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
  }) as any[][];
  const rows = parse2025Format(data);
  console.log(`   Parsed ${rows.length} receivable invoice rows\n`);

  // ── Step 4: Match debtors and build invoices ──
  const invoices: Invoice[] = [];
  const unmatchedDebtors = new Set<string>();
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of rows) {
    const debtor = matchDebtor(row.rawDebtor, debtorLookup);
    if (!debtor) {
      unmatchedCount++;
      unmatchedDebtors.add(row.rawDebtor);
      continue;
    }
    matchedCount++;

    const amount = Math.round(row.amount * 100) / 100;

    const invoice: Invoice = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      debtor_id: debtor.id,
      supplier_id: null,
      invoice_number: row.invoiceNumber,
      amount,
      advance_rate: 0,
      fee_rate: 0,
      amount_received: amount,
      issue_date: row.date,
      due_date: null,
      paid_date: row.date,
      receipt_date: null,
      advance_received_date: null,
      short_payment: null,
      late_days: null,
      paid_note: "Reimported from sales-2025-final.xlsx",
      status: "paid",
      noa_status: "not_sent",
      noa_token: generateNoaToken(),
      noa_sent_at: null,
      noa_responded_at: null,
      noa_comments: null,
      last_overdue_reminder_date: null,
      reminder_log: [],
      po_number: null,
      po_date: null,
      purchase_invoice_ids: [],
      purchase_order_id: null,
      payment_terms_days: 30,
      bl_date: null,
      due_date_source: "invoice",
      has_contractual_due_date: false,
      documents: [],
      created_at: now,
      updated_at: now,
    };
    invoices.push(invoice);
  }

  console.log(`   Matched: ${matchedCount} | Unmatched: ${unmatchedCount}`);

  if (unmatchedDebtors.size > 0) {
    console.log(`\n   ⚠️  Unmatched debtor names (${unmatchedDebtors.size}):`);
    for (const d of Array.from(unmatchedDebtors).sort()) {
      console.log(`     - "${d}"`);
    }
  }

  // ── Step 5: Calculate and verify total ──
  const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const roundedTotal = Math.round(totalAmount * 100) / 100;

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`📊 Total amount of invoices: $${roundedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`📊 Expected total:           $${EXPECTED_TOTAL.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  if (Math.abs(roundedTotal - EXPECTED_TOTAL) > 0.01) {
    const diff = roundedTotal - EXPECTED_TOTAL;
    console.log(`\n   ❌ MISMATCH! Difference: $${diff.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    console.log(`   The import will proceed anyway — review the Excel data.`);
  } else {
    console.log(`\n   ✅ TOTAL MATCHES!`);
  }

  // ── Step 6: Write to DynamoDB ──
  if (invoices.length === 0) {
    console.log("\n❌ No invoices to import — exiting.");
    return;
  }

  console.log(`\n💾 Writing ${invoices.length} invoices to DynamoDB...`);
  for (let i = 0; i < invoices.length; i += 25) {
    const chunk = invoices.slice(i, i + 25);
    await batchPutItems(
      TABLES.INVOICES,
      chunk as unknown as Record<string, unknown>[],
    );
    process.stdout.write(
      `   📝 ${Math.min(i + 25, invoices.length)}/${invoices.length}\r`,
    );
  }

  // ── Final Summary ──
  console.log(`\n\n═══════════════════════════════════════════════════════`);
  console.log(`✅ REIMPORT COMPLETE`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`   Invoices deleted:   ${inv2025.length}`);
  console.log(`   Invoices imported:  ${invoices.length}`);
  console.log(`   Matched debtors:    ${matchedCount}`);
  console.log(`   Unmatched debtors:  ${unmatchedCount}`);
  console.log(`   Fee rate:           0%`);
  console.log(`   Advance rate:       0%`);
  console.log(`   Total amount:       $${roundedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`   Expected total:     $${EXPECTED_TOTAL.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  if (Math.abs(roundedTotal - EXPECTED_TOTAL) <= 0.01) {
    console.log(`   Status:             ✅ MATCH`);
  } else {
    console.log(`   Status:             ❌ MISMATCH (diff: $${(roundedTotal - EXPECTED_TOTAL).toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
  }
  console.log(`═══════════════════════════════════════════════════════`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
