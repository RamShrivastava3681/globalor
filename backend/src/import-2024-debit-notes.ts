/**
 * import-2024-debit-notes.ts
 *
 * Reads debit-2024-final.xlsx and imports all 2024 debit notes
 * into the credit_debit_notes table with type="debit" and linked_invoice_type="sales".
 *
 * Usage: npx tsx src/import-2024-debit-notes.ts
 */
import XLSX from "xlsx";
import {
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

const CLIENT_ID = "1781861412998-c880305f";
const COMPANY_ID = "1784619121925-2c0baeaf";

// ── Excel serial date → ISO date string ──
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
      /\b(s\.?a\.?|s\.?a\.?\s*d\.?\s*c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|g\.?m\.?b\.?h\.?|b\.?v\.?|lda\.?|ab\.?|s\.?l\.?\s*\.?)\b\.?/gi,
      "",
    )
    .trim();
}

function extractCompany(desc: string): string {
  const dashIdx = desc.indexOf(" - ");
  if (dashIdx > 0) return desc.substring(0, dashIdx).trim();
  return desc.trim();
}

function extractReason(desc: string): string | null {
  const dashIdx = desc.indexOf(" - ");
  if (dashIdx > 0) return desc.substring(dashIdx + 3).trim();
  return null;
}

async function main() {
  const now = nowISO();

  // Load existing debtors for matching
  console.log("📋 Loading existing debtors...");
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS);
  console.log(`   Found ${existingDebtors.length} debtors in database.`);

  const debtorByNorm = new Map<string, Debtor>();
  const newDebtors = new Map<string, Debtor>();

  for (const d of existingDebtors) {
    debtorByNorm.set(normalize(d.name), d);
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
    const id = generateId();
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

  // Read the Excel file
  console.log("\n📄 Reading debit-2024-final.xlsx...");
  const wb = XLSX.readFile("C:/Users/ramsh/Desktop/current projects/globalor-test/globalor-og/debit-2024-final.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  const allNotes: CreditDebitNote[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 4) continue;

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
    const { id: debtorId } = matchDebtor(debtorName);

    const cdn: CreditDebitNote = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      type: "debit",
      note_number: noteNumber,
      date: excelDateToDate(dateSerial),
      amount,
      debtor_supplier_name: debtorName,
      supplier_id: null,
      linked_invoice_id: null,
      linked_invoice_type: "sales",
      reason,
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

  console.log(`   Found ${allNotes.length} debit notes.`);

  // Verify total matches expected value
  const totalAmount = allNotes.reduce((sum, n) => sum + n.amount, 0);
  console.log(`   Total amount: ${totalAmount}`);
  console.log(`   Expected: 393887`);

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

  console.log("\n" + "═".repeat(50));
  console.log("✅ IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Debit notes imported: ${allNotes.length}`);
  console.log(`   New debtors created:  ${newDebtors.size}`);
  console.log(`   Existing debtors used: ${debtorByNorm.size}`);
  console.log("═".repeat(50));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
