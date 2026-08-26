/**
 * import-2024-credit-debit-notes.ts
 *
 * Reads credit-2024.xlsx and debit-2024-final.xlsx, imports them into the
 * credit_debit_notes table, and shows totals for verification.
 *
 * Usage: npx tsx src/import-2024-credit-debit-notes.ts
 */

import path from "path";
import { fileURLToPath } from "url";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
import type {
  CreditDebitNote,
  Vendor,
  Debtor,
} from "./types/index.js";

const CLIENT_ID = "1781861412998-c880305f"; // arjun.jaiswal@whizunik.com
const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

// ── Excel serial date → ISO date string ──
function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
}

/** Normalize a company name for fuzzy matching. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:()]/g, "")
    .replace(
      /\b(s\.?a\.?|s\.?a\.?\s*d\.?\s*c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|g\.?m\.?b\.?h\.?|b\.?v\.?|lda\.?|ab\.?|s\.?l\.?\s*\.?)\b\.?/gi,
      "",
    )
    .trim();
}

/** Extract company name from supplier/debtor field (before " - "). */
function extractCompany(field: string): string {
  const dashIdx = field.indexOf(" - ");
  if (dashIdx > 0) return field.substring(0, dashIdx).trim();
  return field.trim();
}

/** Extract description/reason from field (after " - "). */
function extractReason(field: string): string | null {
  const dashIdx = field.indexOf(" - ");
  if (dashIdx > 0) return field.substring(dashIdx + 3).trim();
  return null;
}

// ── Vendor/Debtor resolution ──
const vendorByNorm = new Map<string, Vendor>();
const debtorByNorm = new Map<string, Debtor>();
const newVendors = new Map<string, Vendor>();
const newDebtors = new Map<string, Debtor>();

function matchVendor(companyName: string): { id: string; name: string } {
  const norm = normalize(companyName);
  if (vendorByNorm.has(norm)) {
    const v = vendorByNorm.get(norm)!;
    return { id: v.id, name: v.name };
  }
  if (newVendors.has(norm)) {
    const v = newVendors.get(norm)!;
    return { id: v.id, name: v.name };
  }
  // Create new vendor
  const id = generateId();
  const now = nowISO();
  const vendor: Vendor = {
    id,
    client_id: CLIENT_ID,
    company_id: COMPANY_ID,
    name: companyName,
    address_line: null,
    city: null,
    country: null,
    postal_code: null,
    phone: null,
    website: null,
    contact_name: null,
    contact_email: null,
    contact_designation: null,
    contact_phone: null,
    industry: null,
    payment_terms_days: 30,
    notes: null,
    created_at: now,
    updated_at: now,
  };
  newVendors.set(norm, vendor);
  return { id, name: companyName };
}

function matchDebtor(companyName: string): { id: string; name: string } {
  const norm = normalize(companyName);
  if (debtorByNorm.has(norm)) {
    const d = debtorByNorm.get(norm)!;
    return { id: d.id, name: d.name };
  }
  if (newDebtors.has(norm)) {
    const d = newDebtors.get(norm)!;
    return { id: d.id, name: d.name };
  }
  // Create new debtor
  const id = generateId();
  const now = nowISO();
  const debtor: Debtor = {
    id,
    company_id: COMPANY_ID,
    name: companyName,
    legal_entity_name: companyName,
    registration_no: null,
    relationship_since: null,
    registered_address: null,
    postal_code: null,
    phone: null,
    website: null,
    contact_name: null,
    contact_email: null,
    contact_designation: null,
    contact_phone: null,
    industry: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
  newDebtors.set(norm, debtor);
  return { id, name: companyName };
}

// ── Parsed note ──
interface ParsedNote {
  date: string;
  entityName: string;
  noteNumber: string;
  amount: number;
  reason: string | null;
}

// ── Read credit-2024.xlsx ──
function readCreditFile(filePath: string): ParsedNote[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  const notes: ParsedNote[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 4) continue;

    // Skip total/summary rows
    const col0 = String(row[0] ?? "").trim();
    if (col0 === "Total Gross Purchases" || col0 === "Total" || col0 === "Date") continue;

    const dateSerial = Number(row[0]);
    if (isNaN(dateSerial)) continue;

    const supplierField = String(row[1] ?? "").trim();
    if (!supplierField) continue;

    let noteNumber = String(row[2] ?? "").trim();
    if (!noteNumber) {
      // Generate a synthetic note number for rows with empty note_number
      noteNumber = `CN-${col0}-${i}`;
    }

    const amount = Number(row[3]) || 0;
    if (amount === 0) continue;

    const companyName = extractCompany(supplierField);
    const reason = extractReason(supplierField);

    notes.push({
      date: excelDateToDate(dateSerial),
      entityName: companyName,
      noteNumber,
      amount,
      reason,
    });
  }

  return notes;
}

// ── Read debit-2024-final.xlsx ──
function readDebitFile(filePath: string): ParsedNote[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  const notes: ParsedNote[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 4) continue;

    // Skip total/summary rows
    const col0 = String(row[0] ?? "").trim();
    if (col0 === "Total Gross Sales" || col0 === "Total" || col0 === "Date") continue;

    const dateSerial = Number(row[0]);
    if (isNaN(dateSerial)) continue;

    const debtorField = String(row[1] ?? "").trim();
    if (!debtorField) continue;

    const noteNumber = String(row[2] ?? "").trim();
    if (!noteNumber) continue;

    const amount = Number(row[3]) || 0;
    if (amount === 0) continue;

    const debtorName = extractCompany(debtorField);
    const reason = extractReason(debtorField);

    notes.push({
      date: excelDateToDate(dateSerial),
      entityName: debtorName,
      noteNumber,
      amount,
      reason,
    });
  }

  return notes;
}

// ── Main ──
async function main() {
  const now = nowISO();

  // Load existing vendors and debtors for matching
  console.log("📋 Loading existing vendors and debtors...");
  const [existingVendors, existingDebtors] = await Promise.all([
    scanTable<Vendor>(TABLES.VENDORS),
    scanTable<Debtor>(TABLES.DEBTORS),
  ]);
  console.log(`   Found ${existingVendors.length} vendors, ${existingDebtors.length} debtors.`);

  for (const v of existingVendors) {
    vendorByNorm.set(normalize(v.name), v);
  }
  for (const d of existingDebtors) {
    debtorByNorm.set(normalize(d.name), d);
  }

  // Process credit notes
  const creditPath = path.join(ROOT_DIR, 'credit-2024.xlsx');
  console.log(`\n📄 Reading credit-2024.xlsx...`);
  const creditParsed = readCreditFile(creditPath);
  console.log(`   Found ${creditParsed.length} credit notes.`);

  const creditNotes: CreditDebitNote[] = [];
  let creditTotal = 0;
  for (const note of creditParsed) {
    const vendor = matchVendor(note.entityName);
    creditTotal += note.amount;

    const cdn: CreditDebitNote = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      type: "credit",
      note_number: note.noteNumber,
      date: note.date,
      amount: note.amount,
      debtor_supplier_name: note.entityName,
      supplier_id: vendor.id,
      linked_invoice_id: null,
      linked_invoice_type: "purchase",
      reason: note.reason,
      status: "paid",
      reviewed_at: null,
      reviewed_by: null,
      settled_at: null,
      settled_by: null,
      settled_at_creation: false,
      created_at: now,
      updated_at: now,
    };

    creditNotes.push(cdn);
  }

  // Process debit notes
  const debitPath = path.join(ROOT_DIR, 'debit-2024-final.xlsx');
  console.log(`\n📄 Reading debit-2024-final.xlsx...`);
  const debitParsed = readDebitFile(debitPath);
  console.log(`   Found ${debitParsed.length} debit notes.`);

  const debitNotes: CreditDebitNote[] = [];
  let debitTotal = 0;
  for (const note of debitParsed) {
    const debtor = matchDebtor(note.entityName);
    debitTotal += note.amount;

    const cdn: CreditDebitNote = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      type: "debit",
      note_number: note.noteNumber,
      date: note.date,
      amount: note.amount,
      debtor_supplier_name: note.entityName,
      supplier_id: null,
      linked_invoice_id: null,
      linked_invoice_type: "sales",
      reason: note.reason,
      status: "received",
      reviewed_at: null,
      reviewed_by: null,
      settled_at: null,
      settled_by: null,
      settled_at_creation: false,
      created_at: now,
      updated_at: now,
    };

    debitNotes.push(cdn);
  }

  // ── Show totals for verification ──
  console.log("\n" + "═".repeat(50));
  console.log("📊 VERIFICATION SUMMARY");
  console.log("═".repeat(50));
  console.log(`   Credit Notes (2024):`);
  console.log(`     Count:  ${creditNotes.length}`);
  console.log(`     Total:  $${creditTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Debit Notes (2024):`);
  console.log(`     Count:  ${debitNotes.length}`);
  console.log(`     Total:  $${debitTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Combined:`);
  console.log(`     Count:  ${creditNotes.length + debitNotes.length}`);
  console.log(`     Total:  $${(creditTotal + debitTotal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log("═".repeat(50));

  // Breakdown by month
  console.log("\n📅 Credit Notes by Month:");
  const creditByMonth = new Map<string, { count: number; total: number }>();
  for (const n of creditNotes) {
    const month = n.date.slice(0, 7);
    const existing = creditByMonth.get(month) ?? { count: 0, total: 0 };
    existing.count += 1;
    existing.total += n.amount;
    creditByMonth.set(month, existing);
  }
  for (const [month, data] of creditByMonth.entries()) {
    console.log(`   ${month}: ${data.count} notes, $${data.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  console.log("\n📅 Debit Notes by Month:");
  const debitByMonth = new Map<string, { count: number; total: number }>();
  for (const n of debitNotes) {
    const month = n.date.slice(0, 7);
    const existing = debitByMonth.get(month) ?? { count: 0, total: 0 };
    existing.count += 1;
    existing.total += n.amount;
    debitByMonth.set(month, existing);
  }
  for (const [month, data] of debitByMonth.entries()) {
    console.log(`   ${month}: ${data.count} notes, $${data.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  // ── Write to database ──
  console.log("\n💾 Writing to database...");

  // Create new vendors
  if (newVendors.size > 0) {
    const vendorList = Array.from(newVendors.values());
    console.log(`   Creating ${vendorList.length} new vendors...`);
    await batchPutItems(TABLES.VENDORS, vendorList as any);
    console.log(`   ✔ Created ${vendorList.length} new vendors.`);
  }

  // Create new debtors
  if (newDebtors.size > 0) {
    const debtorList = Array.from(newDebtors.values());
    console.log(`   Creating ${debtorList.length} new debtors...`);
    await batchPutItems(TABLES.DEBTORS, debtorList as any);
    console.log(`   ✔ Created ${debtorList.length} new debtors.`);
  }

  // Write credit notes
  const allNotes = [...creditNotes, ...debitNotes];
  if (allNotes.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < allNotes.length; i += 25) {
      const chunk = allNotes.slice(i, i + 25);
      await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${allNotes.length} notes...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} notes.`);
  }

  // Final summary
  console.log("\n" + "═".repeat(50));
  console.log("✅ IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Credit notes imported: ${creditNotes.length} ($${creditTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`   Debit notes imported:  ${debitNotes.length} ($${debitTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`   Total notes:           ${allNotes.length}`);
  console.log(`   New vendors created:   ${newVendors.size}`);
  console.log(`   New debtors created:   ${newDebtors.size}`);
  console.log("═".repeat(50));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
