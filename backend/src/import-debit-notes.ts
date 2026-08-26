/**
 * import-debit-notes.ts
 *
 * Reads debit-2024-final.xlsx, debit-notes-2025.xlsx, and debit26-final.xlsx,
 * creates debit notes (Receivable Credit Notes) in the credit_debit_notes table,
 * and links each note to its respective debtor.
 *
 * For OLO Report entries in 2026: extracts the invoice reference number from
 * the debtor column (e.g. "Invoice #-04NC2604001") and uses it as the note_number.
 *
 * If a debtor doesn't exist yet, it is created automatically.
 *
 * Usage: npx tsx src/import-debit-notes.ts
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

/** Extract company/debtor name from description field (before " - "). */
function extractCompany(desc: string): string {
  const dashIdx = desc.indexOf(" - ");
  if (dashIdx > 0) return desc.substring(0, dashIdx).trim();
  return desc.trim();
}

/** Extract description/reason from field (after " - "). */
function extractReason(desc: string): string | null {
  const dashIdx = desc.indexOf(" - ");
  if (dashIdx > 0) return desc.substring(dashIdx + 3).trim();
  return null;
}

/**
 * For OLO Report entries, extract the invoice reference number from the
 * debtor column. E.g.:
 *   "FEBECA C.A. - OLO Report April 2026-Invoice #-04NC2604001-COMISION..."
 * → "04NC2604001"
 */
function extractOloInvoiceRef(debtorField: string): string | null {
  const match = debtorField.match(/Invoice\s*#-([A-Z0-9]+)/i);
  if (match) return match[1];
  return null;
}

// ── Debtor resolution ──
const debtorByNorm = new Map<string, Debtor>();
const newDebtors = new Map<string, Debtor>();

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
  debtorName: string;
  noteNumber: string;
  amount: number;
  reason: string | null;
}

// ── Read 2026 file (has header row) ──
function read2026File(filePath: string): ParsedNote[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  const notes: ParsedNote[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 4) continue;

    const dateSerial = Number(row[0]);
    if (isNaN(dateSerial)) continue;

    const debtorField = String(row[1] ?? "").trim();
    if (!debtorField) continue;

    let noteNumber = String(row[2] ?? "").trim();
    const amount = Number(row[3]) || 0;
    if (amount === 0) continue;

    const debtorName = extractCompany(debtorField);
    const reason = extractReason(debtorField);

    // For OLO Report entries, extract invoice ref from debtor column
    if (noteNumber.toLowerCase().includes("olo report")) {
      const oloRef = extractOloInvoiceRef(debtorField);
      if (oloRef) {
        noteNumber = oloRef;
      }
    }

    notes.push({
      date: excelDateToDate(dateSerial),
      debtorName,
      noteNumber,
      amount,
      reason,
    });
  }

  return notes;
}

// ── Read 2024 file (has header row) ──
function read2024File(filePath: string): ParsedNote[] {
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
      debtorName,
      noteNumber,
      amount,
      reason,
    });
  }

  return notes;
}

// ── Read 2025 file (NO header row, different column layout) ──
// Columns: [date, "Receivable Credit Note", description, note_number, amount]
function read2025File(filePath: string): ParsedNote[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  const notes: ParsedNote[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 5) continue;

    const dateSerial = Number(row[0]);
    if (isNaN(dateSerial)) continue;

    const sourceType = String(row[1] ?? "").trim();
    if (!sourceType.includes("Receivable Credit Note")) continue;

    const description = String(row[2] ?? "").trim();
    if (!description) continue;

    const noteNumber = String(row[3] ?? "").trim();
    if (!noteNumber) continue;

    const amount = Number(row[4]) || 0;
    if (amount === 0) continue;

    const debtorName = extractCompany(description);
    const reason = extractReason(description);

    notes.push({
      date: excelDateToDate(dateSerial),
      debtorName,
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

  // Load existing debtors for matching
  console.log("📋 Loading existing debtors...");
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
  console.log(`   Found ${existingDebtors.length} debtors in database.`);

  for (const d of existingDebtors) {
    debtorByNorm.set(normalize(d.name), d);
  }

  // Process all three files
  const files = [
    { path: "debit-2024-final.xlsx", label: "2024", reader: read2024File },
    { path: "debit-notes-2025.xlsx", label: "2025", reader: read2025File },
    { path: "debit26-final.xlsx", label: "2026", reader: read2026File },
  ];

  const allNotes: CreditDebitNote[] = [];

  for (const file of files) {
    console.log(`\n📄 Reading ${file.path}...`);
    const parsed = file.reader(file.path);
    console.log(`   Found ${parsed.length} debit notes.`);

    for (const note of parsed) {
      const debtor = matchDebtor(note.debtorName);

      const cdn: CreditDebitNote = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        type: "debit",
        note_number: note.noteNumber,
        date: note.date,
        amount: note.amount,
        debtor_supplier_name: note.debtorName,
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

      allNotes.push(cdn);
    }
  }

  console.log(`\n📊 Total debit notes to import: ${allNotes.length}`);

  // Create new debtors
  if (newDebtors.size > 0) {
    const debtorList = Array.from(newDebtors.values());
    console.log(`\n🏢 Creating ${debtorList.length} new debtors...`);
    await batchPutItems(TABLES.DEBTORS, debtorList as any);
    console.log(`   ✔ Created ${debtorList.length} new debtors.`);
  } else {
    console.log("\n   ✔ No new debtors to create.");
  }

  // Write debit notes in batches of 25
  if (allNotes.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < allNotes.length; i += 25) {
      const chunk = allNotes.slice(i, i + 25);
      await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${allNotes.length} debit notes...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} debit notes.`);
  }

  // Summary
  console.log("\n" + "═".repeat(50));
  console.log("✅ IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Debit notes imported: ${allNotes.length}`);
  console.log(`   New debtors created:  ${newDebtors.size}`);
  console.log(`   Existing debtors used: ${debtorByNorm.size}`);
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
