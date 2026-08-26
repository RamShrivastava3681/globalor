/**
 * import-new-debit-notes-2025.ts
 *
 * 1. Scans and deletes all 2025 sales credit notes (supplier_id = null) from credit_debit_notes table.
 * 2. Reads debit-notes-2025.xlsx.
 * 3. Extracts debtors and creates them if they don't exist.
 * 4. Inserts new sales credit notes in batches of 25.
 *
 * Usage: npx tsx src/import-new-debit-notes-2025.ts
 */
import XLSX from "xlsx";
import {
  putItem,
  scanTable,
  batchPutItems,
  batchDeleteItems,
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

/** Convert Excel serial date to YYYY-MM-DD. */
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
    .replace(/\b(s\.?a\.?|s\.?a\.?\s*d\.?\s*c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|g\.?m\.?b\.?h\.?|b\.?v\.?|lda\.?|ab\.?|s\.?l\.?\s*\.?)\b\.?/gi, "")
    .trim();
}

/** Extract company name from an Excel description field (before " - "). */
function extractCompany(desc: string): string {
  const dashIdx = desc.indexOf(" - ");
  if (dashIdx > 0) return desc.substring(0, dashIdx).trim();
  return desc.trim();
}

async function delete2025DebitNotes() {
  console.log("🗑️  Scanning and deleting existing 2025 sales credit notes...");

  const allNotes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });

  const notes2025 = allNotes.filter((n) => {
    const y = (n.date ?? "").slice(0, 4);
    const createdY = (n.created_at ?? "").slice(0, 4);
    return (y === "2025" || createdY === "2025") && !n.supplier_id;
  });

  console.log(`   Found ${notes2025.length} sales credit notes from 2025.`);

  if (notes2025.length > 0) {
    const keys = notes2025.map((n) => ({ id: n.id }));
    let deletedCount = 0;
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await batchDeleteItems(TABLES.CREDIT_DEBIT_NOTES, chunk);
      deletedCount += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deletedCount}/${keys.length}...\r`);
    }
    console.log(`\n   ✔ Deleted all ${deletedCount} existing 2025 sales credit notes.`);
  } else {
    console.log("   ✔ No existing 2025 sales credit notes to delete.");
  }
  console.log();
}

async function importNewDebitNotes() {
  const now = nowISO();

  // Load existing debtors
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });

  console.log(`📋 Loaded ${existingDebtors.length} debtors.`);

  const debtorByNorm = new Map<string, Debtor>();
  for (const d of existingDebtors) {
    debtorByNorm.set(normalize(d.name), d);
  }

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

  console.log("📄 Reading debit-notes-2025.xlsx...");
  const wb = XLSX.readFile("../debit-notes-2025.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const notesData = XLSX.utils.sheet_to_json(ws, {
    header: 1,
  }) as any[][];

  const creditNotes: CreditDebitNote[] = [];
  let skippedCount = 0;

  // The file has no header row: data starts directly at index 0
  for (let i = 0; i < notesData.length; i++) {
    const row = notesData[i];
    if (!row || !row[0] || !row[1] || !row[2] || !row[3]) {
      skippedCount++;
      continue;
    }

    const typeStr = String(row[1]).trim();
    if (typeStr !== "Receivable Credit Note") {
      skippedCount++;
      continue;
    }

    const dateSerial = Number(row[0]);
    if (isNaN(dateSerial)) {
      skippedCount++;
      continue;
    }

    const dateStr = excelDateToDate(dateSerial);
    const desc = String(row[2]).trim();
    const ref = String(row[3]).trim();
    const amount = Number(row[4]) || 0;

    const companyName = extractCompany(desc);
    matchDebtor(companyName); // Ensure debtor is created if needed

    const note: CreditDebitNote = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      type: "credit",
      note_number: ref,
      date: dateStr,
      amount: amount,
      debtor_supplier_name: companyName,
      supplier_id: null,
      linked_invoice_id: null,
      linked_invoice_type: null,
      reason: desc,
      status: "received",
      reviewed_at: null,
      reviewed_by: null,
      settled_at: null,
      settled_by: null,
      settled_at_creation: false,
      created_at: now,
      updated_at: now,
    };

    creditNotes.push(note);
  }

  console.log(`   Processed ${creditNotes.length} valid credit notes. Skipped/Invalid: ${skippedCount}`);

  // Create new debtors
  if (newDebtors.size > 0) {
    const debtorList = Array.from(newDebtors.values());
    await batchPutItems(TABLES.DEBTORS, debtorList as any);
    console.log(`   ✔ Created ${debtorList.length} new debtors.`);
  }

  // Write new notes
  if (creditNotes.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < creditNotes.length; i += 25) {
      const chunk = creditNotes.slice(i, i + 25);
      await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${creditNotes.length} notes...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} credit notes.`);
  }

  console.log("\n═══════════════════════════════════════");
  console.log("✅ IMPORT COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(`   New Debit/Credit Notes: ${creditNotes.length}`);
  console.log(`   New Debtors:            ${newDebtors.size}`);
  console.log("═══════════════════════════════════════");
}

async function main() {
  await delete2025DebitNotes();
  await importNewDebitNotes();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
