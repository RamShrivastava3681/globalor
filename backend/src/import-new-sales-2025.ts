/**
 * import-new-sales-2025.ts
 *
 * 1. Scans and deletes all 2025 sales invoices from the invoices table.
 * 2. Reads sales-2025-final.xlsx.
 * 3. Extracts debtors and creates them if they don't exist.
 * 4. Inserts new sales invoices in batches of 25.
 *
 * Usage: npx tsx src/import-new-sales-2025.ts
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
  generateNoaToken,
  nowISO,
} from "./utils/helpers.js";
import type {
  Invoice,
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

async function delete2025SalesInvoices() {
  console.log("🗑️  Scanning and deleting existing 2025 sales invoices...");

  const invoices = await scanTable<Invoice>(TABLES.INVOICES, {
    filterExpression: "company_id = :cid",
    expressionAttributeValues: { ":cid": COMPANY_ID },
  });

  const inv2025 = invoices.filter((inv) => {
    const issueYear = (inv.issue_date ?? "").slice(0, 4);
    const createdYear = (inv.created_at ?? "").slice(0, 4);
    return issueYear === "2025" || createdYear === "2025";
  });

  console.log(`   Found ${inv2025.length} invoices from 2025.`);

  if (inv2025.length > 0) {
    const keys = inv2025.map((i) => ({ id: i.id }));
    let deletedCount = 0;
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await batchDeleteItems(TABLES.INVOICES, chunk);
      deletedCount += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deletedCount}/${keys.length}...\r`);
    }
    console.log(`\n   ✔ Deleted all ${deletedCount} existing 2025 sales invoices.`);
  } else {
    console.log("   ✔ No existing 2025 sales invoices to delete.");
  }
  console.log();
}

async function importNewSales() {
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

  console.log("📄 Reading sales-2025-final.xlsx...");
  const wb = XLSX.readFile("../sales-2025-final.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const salesData = XLSX.utils.sheet_to_json(ws, {
    header: 1,
  }) as any[][];

  const salesInvoices: Invoice[] = [];
  let skippedCount = 0;

  // Row 0 is the header: date, type, debtor, invoice_number, amount
  for (let i = 1; i < salesData.length; i++) {
    const row = salesData[i];
    if (!row || !row[0] || !row[1] || !row[2] || !row[3]) {
      skippedCount++;
      continue;
    }

    const typeStr = String(row[1]).trim();
    if (typeStr !== "Receivable Invoice") {
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
    const debtor = matchDebtor(companyName);

    const invoice: Invoice = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      debtor_id: debtor.id,
      supplier_id: null,
      invoice_number: ref,
      amount: amount,
      advance_rate: 0,
      fee_rate: 0,
      amount_received: null,
      issue_date: dateStr,
      due_date: null,
      paid_date: null,
      receipt_date: null,
      advance_received_date: null,
      short_payment: null,
      late_days: null,
      paid_note: null,
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

    salesInvoices.push(invoice);
  }

  console.log(`   Processed ${salesInvoices.length} valid invoices. Skipped/Invalid: ${skippedCount}`);

  // Create new debtors
  if (newDebtors.size > 0) {
    const debtorList = Array.from(newDebtors.values());
    await batchPutItems(TABLES.DEBTORS, debtorList as any);
    console.log(`   ✔ Created ${debtorList.length} new debtors.`);
  }

  // Write new invoices
  if (salesInvoices.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < salesInvoices.length; i += 25) {
      const chunk = salesInvoices.slice(i, i + 25);
      await batchPutItems(TABLES.INVOICES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${salesInvoices.length} invoices...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} sales invoices.`);
  }

  console.log("\n═══════════════════════════════════════");
  console.log("✅ IMPORT COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(`   New Sales Invoices: ${salesInvoices.length}`);
  console.log(`   New Debtors:        ${newDebtors.size}`);
  console.log("═══════════════════════════════════════");
}

async function main() {
  await delete2025SalesInvoices();
  await importNewSales();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
