/**
 * import-credit-notes.ts
 *
 * Reads credit-notes-2026.xlsx, credit-2025.xlsx, and credit-2024.xlsx,
 * creates purchase credit notes in the credit_debit_notes table,
 * and links each note to its respective supplier/vendor.
 *
 * If a vendor doesn't exist yet, it is created automatically.
 *
 * Usage: npx tsx src/import-credit-notes.ts
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
import type {
  CreditDebitNote,
  Vendor,
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

/** Extract company name from supplier field (before " - "). */
function extractCompany(supplierField: string): string {
  const dashIdx = supplierField.indexOf(" - ");
  if (dashIdx > 0) return supplierField.substring(0, dashIdx).trim();
  return supplierField.trim();
}

/** Extract description/reason from supplier field (after " - "). */
function extractReason(supplierField: string): string | null {
  const dashIdx = supplierField.indexOf(" - ");
  if (dashIdx > 0) return supplierField.substring(dashIdx + 3).trim();
  return null;
}

// ── Vendor resolution ──
const vendorByNorm = new Map<string, Vendor>();
const newVendors = new Map<string, Vendor>();

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

// ── Read and parse a credit note Excel file ──
interface ParsedNote {
  date: string;
  supplierName: string;
  noteNumber: string;
  amount: number;
  reason: string | null;
}

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

    const noteNumber = String(row[2] ?? "").trim();
    if (!noteNumber) continue;

    const amount = Number(row[3]) || 0;
    if (amount === 0) continue;

    const companyName = extractCompany(supplierField);
    const reason = extractReason(supplierField);

    notes.push({
      date: excelDateToDate(dateSerial),
      supplierName: companyName,
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

  // Load existing vendors for matching
  console.log("📋 Loading existing vendors...");
  const existingVendors = await scanTable<Vendor>(TABLES.VENDORS);
  console.log(`   Found ${existingVendors.length} vendors in database.`);

  for (const v of existingVendors) {
    vendorByNorm.set(normalize(v.name), v);
  }

  // Process all three files
  const files = [
    { path: "credit-2024.xlsx", label: "2024" },
    { path: "credit-2025.xlsx", label: "2025" },
    { path: "credit-notes-2026.xlsx", label: "2026" },
  ];

  const allNotes: CreditDebitNote[] = [];

  for (const file of files) {
    console.log(`\n📄 Reading ${file.path}...`);
    const parsed = readCreditFile(file.path);
    console.log(`   Found ${parsed.length} credit notes.`);

    for (const note of parsed) {
      const vendor = matchVendor(note.supplierName);

      const cdn: CreditDebitNote = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        type: "credit",
        note_number: note.noteNumber,
        date: note.date,
        amount: note.amount,
        debtor_supplier_name: note.supplierName,
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

      allNotes.push(cdn);
    }
  }

  console.log(`\n📊 Total credit notes to import: ${allNotes.length}`);

  // Create new vendors
  if (newVendors.size > 0) {
    const vendorList = Array.from(newVendors.values());
    console.log(`\n🏢 Creating ${vendorList.length} new vendors...`);
    await batchPutItems(TABLES.VENDORS, vendorList as any);
    console.log(`   ✔ Created ${vendorList.length} new vendors.`);
  } else {
    console.log("\n   ✔ No new vendors to create.");
  }

  // Write credit notes in batches of 25
  if (allNotes.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < allNotes.length; i += 25) {
      const chunk = allNotes.slice(i, i + 25);
      await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${allNotes.length} credit notes...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} credit notes.`);
  }

  // Summary
  console.log("\n" + "═".repeat(50));
  console.log("✅ IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Credit notes imported: ${allNotes.length}`);
  console.log(`   New vendors created:   ${newVendors.size}`);
  console.log(`   Existing vendors used: ${vendorByNorm.size}`);
  console.log("═".repeat(50));

  // Breakdown by year
  const byYear = new Map<string, number>();
  for (const n of allNotes) {
    const year = n.date.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  console.log("\n   Breakdown by year:");
  for (const [year, count] of byYear.entries()) {
    console.log(`     ${year}: ${count} notes`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
