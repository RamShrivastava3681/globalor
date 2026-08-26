/**
 * import-sales-invoices.ts
 *
 * Imports sales invoices from 3 Excel files.
 * Deduplication key: (invoice_number + issue_date) — same number on different dates is kept.
 *
 * Usage: npx tsx src/import-sales-invoices.ts
 */
import XLSX from "xlsx";
import {
  scanTable,
  batchPutItems,
  TABLES,
} from "./db/client.js";
import {
  generateId,
  generateNoaToken,
  nowISO,
} from "./utils/helpers.js";
import type { Invoice, Debtor } from "./types/index.js";

const CLIENT_ID = "1781861412998-c880305f";
const COMPANY_ID = "1784619121925-2c0baeaf";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
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

function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:()]/g, "")
    .replace(/\b(s\.?a\.?|s\.?a\.?\s*d\.?\.?c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
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

function buildInvoice(
  row: { date: string; invoiceNumber: string; amount: number },
  debtor: Debtor,
  year: number,
  now: string,
): Invoice {
  const status: "paid" | "submitted" = year <= 2025 ? "paid" : "submitted";
  const amount = Math.round(row.amount * 100) / 100;
  return {
    id: generateId(),
    client_id: CLIENT_ID,
    company_id: COMPANY_ID,
    debtor_id: debtor.id,
    supplier_id: null,
    invoice_number: row.invoiceNumber,
    amount,
    advance_rate: 0.8,
    fee_rate: 0.025,
    amount_received: status === "paid" ? amount : null,
    issue_date: row.date,
    due_date: null,
    paid_date: status === "paid" ? row.date : null,
    receipt_date: null,
    advance_received_date: null,
    short_payment: null,
    late_days: null,
    paid_note: status === "paid" ? "Imported from Excel" : null,
    status,
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
}

// ─── Parse ───────────────────────────────────────────────────────────────────

/**
 * When the invoice_number column contains a label like "OLO Report April 2026"
 * instead of a real number, extract it from the debtor description.
 * e.g. "FERRETERIA EPA C.A. (VENEZUELA) - OLO Report April 2026-Invoice #-193193302-..."
 *   → "193193302"
 */
function extractInvoiceNumber(invNum: string, rawDebtor: string): string {
  // If the invoice number looks like a real number or has INV-/PB/A0/GL prefix, keep it
  if (invNum.match(/^\d/) || invNum.startsWith("INV-") || invNum.startsWith("PB") || invNum.startsWith("A0") || invNum.startsWith("GL")) {
    return invNum;
  }
  // Strip trailing descriptions: "OD2511001 - Adjustment for..." → "OD2511001"
  const dashIdx = invNum.indexOf(" - ");
  if (dashIdx > 0) return invNum.substring(0, dashIdx).trim();
  // Try to extract from debtor: "Invoice #-XXXXX" or "Invoice #XXXXX"
  const m = rawDebtor.match(/Invoice\s*#?-?(\d[\d-]*)/i);
  if (m) return m[1];
  return invNum;
}

function parseSimpleFormat(data: any[][]): { date: string; rawDebtor: string; invoiceNumber: string; amount: number }[] {
  const rows: { date: string; rawDebtor: string; invoiceNumber: string; amount: number }[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1] || !row[3]) continue;
    const debtor = String(row[1]).trim();
    if (debtor.startsWith("Total")) continue;
    const amount = Number(row[3]) || 0;
    if (amount === 0) continue;
    const dateVal = row[0];
    let dateStr = "";
    if (typeof dateVal === "number" && dateVal > 40000) dateStr = excelDateToDate(dateVal);
    const rawInv = String(row[2] ?? "").trim().replace(/^INV-/i, "");
    rows.push({
      date: dateStr,
      rawDebtor: debtor,
      invoiceNumber: extractInvoiceNumber(rawInv, debtor),
      amount,
    });
  }
  return rows;
}

function parse2025Format(data: any[][]): { date: string; rawDebtor: string; invoiceNumber: string; amount: number }[] {
  const rows: { date: string; rawDebtor: string; invoiceNumber: string; amount: number }[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[2] || !row[4]) continue;
    const source = String(row[1] ?? "").trim();
    if (source !== "Receivable Invoice") continue;
    const amount = Number(row[4]) || 0;
    if (amount === 0) continue;
    const dateVal = row[0];
    let dateStr = "";
    if (typeof dateVal === "number" && dateVal > 40000) dateStr = excelDateToDate(dateVal);
    const rawInv = String(row[3] ?? "").trim().replace(/^INV-/i, "");
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

  console.log("🔍 Loading existing debtors...");
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });
  console.log(`   Found ${existingDebtors.length} debtors\n`);
  const debtorLookup = buildDebtorLookup(existingDebtors);

  // Dedup key: "invoiceNumber|date"
  console.log("🔍 Loading existing invoices for dedup (key: invoice_number + date)...");
  const existingInvoices = await scanTable<Invoice>(TABLES.INVOICES, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });
  const existingKeys = new Set(existingInvoices.map((inv) => `${inv.invoice_number}|${inv.issue_date}`));
  console.log(`   Found ${existingInvoices.length} existing invoices (${existingKeys.size} unique inv#|date combos)\n`);

  const allInvoices: Invoice[] = [];
  let matchedTotal = 0;
  let unmatchedTotal = 0;
  let skippedDup = 0;
  const unmatchedDebtors = new Set<string>();

  function processRows(rows: { date: string; rawDebtor: string; invoiceNumber: string; amount: number }[], year: number, label: string) {
    let m = 0, u = 0, d = 0;
    for (const row of rows) {
      const debtor = matchDebtor(row.rawDebtor, debtorLookup);
      if (!debtor) { u++; unmatchedDebtors.add(row.rawDebtor); continue; }
      m++;
      const key = `${row.invoiceNumber}|${row.date}`;
      if (existingKeys.has(key)) { d++; continue; }
      existingKeys.add(key);
      allInvoices.push(buildInvoice(row, debtor, year, now));
    }
    matchedTotal += m; unmatchedTotal += u; skippedDup += d;
    console.log(`   ✔ ${label}: ${rows.length} rows → ${m} matched, ${u} unmatched, ${d} dups\n`);
  }

  // 2024
  {
    console.log("📄 Processing sales-2024-year.xlsx...");
    const wb = XLSX.readFile("../sales-2024-year.xlsx");
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
    processRows(parseSimpleFormat(data), 2024, "2024");
  }

  // 2025
  {
    console.log("📄 Processing sales-2025-final.xlsx...");
    const wb = XLSX.readFile("../sales-2025-final.xlsx");
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
    processRows(parse2025Format(data), 2025, "2025");
  }

  // 2026
  {
    console.log("📄 Processing sales2026-final.xlsx...");
    const wb = XLSX.readFile("../sales2026-final.xlsx");
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
    processRows(parseSimpleFormat(data), 2026, "2026");
  }

  if (allInvoices.length === 0) {
    console.log("✅ Nothing new to write — all invoices already exist.");
    return;
  }

  console.log(`💾 Writing ${allInvoices.length} invoices to DynamoDB...`);
  for (let i = 0; i < allInvoices.length; i += 25) {
    const chunk = allInvoices.slice(i, i + 25);
    await batchPutItems(TABLES.INVOICES, chunk as any);
    process.stdout.write(`   ${Math.min(i + 25, allInvoices.length)}/${allInvoices.length}\r`);
  }

  console.log("\n");
  console.log("═══════════════════════════════════════════════");
  console.log("✅ Import complete!");
  console.log("═══════════════════════════════════════════════");
  console.log(`   Invoices created:     ${allInvoices.length}`);
  console.log(`   Total matched rows:   ${matchedTotal}`);
  console.log(`   Total unmatched rows: ${unmatchedTotal}`);
  console.log(`   Duplicates skipped:   ${skippedDup}`);
  if (unmatchedDebtors.size > 0) {
    console.log(`\n   ⚠️  Unmatched debtor names (${unmatchedDebtors.size}):`);
    for (const d of Array.from(unmatchedDebtors).sort()) {
      console.log(`     - "${d}"`);
    }
  }
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
