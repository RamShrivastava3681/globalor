/**
 * import-purchase-invoices-all.ts
 *
 * Reads all three purchase-invoice Excel files (2024, 2025, 2026),
 * cleans supplier names, fuzzy-matches to existing vendors (or creates new ones),
 * and writes purchase invoices directly to DynamoDB in batches of 25.
 *
 * Usage: cd backend && npx tsx src/import-purchase-invoices-all.ts
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
  PurchaseInvoice,
  Vendor,
} from "./types/index.js";

const CLIENT_ID = "1781861412998-c880305f"; // arjun.jaiswal@whizunik.com
const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

// ── Date helpers ──

/** Convert Excel serial date to YYYY-MM-DD. */
function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Supplier name cleaning ──

/** Clean raw supplier description to a clean company name. */
function cleanSupplierName(raw: string): string {
  let s = raw.trim();

  // OLO Report pattern: 'COMPANY - OLO Report April 2026 - -Invoice #XXX-...'
  s = s.replace(/\s*-\s*OLO Report\s+.*$/i, "");

  // Truper pattern: 'COMPANY - Truper April 2026-...'
  s = s.replace(/\s*-\s*Truper\s+.*$/i, "");

  // Performance Fee pattern
  s = s.replace(/\s*-\s*Performance Fee\s+.*$/i, "");

  // TIPO DE CAMBIO patterns
  s = s.replace(/\s*-\s*TIPO DE CAMBIO EUROS$/i, "");
  s = s.replace(/\s*-\s*TIPO DE CAMBIO$/i, "");

  // Duplicate company name patterns: 'COMPANY - COMPANY - ...'
  const dupMatch = s.match(/^(.+?)\s*-\s*\1\s*$/);
  if (dupMatch) s = dupMatch[1];

  const dupDescMatch = s.match(/^(.+?)\s*-\s*\1\s*-\s*.+$/);
  if (dupDescMatch) s = dupDescMatch[1];

  // Simple trailing descriptions
  s = s.replace(/\s*-\s*As per the invoice$/i, "");
  s = s.replace(/\s*-\s*COMPRA DE MERCANCIAS$/i, "");
  s = s.replace(/\s*-\s*COMPRA DE MERCANCIA$/i, "");
  s = s.replace(/\s*-\s*COMRPA DE MERCANCIAS$/i, "");
  s = s.replace(/\s*-\s*FLETES SOBRE COMPRAS$/i, "");
  s = s.replace(/\s*-\s*FLETES SORE COMPRAS$/i, "");
  s = s.replace(/\s*-\s*FLETES SOBRE COMRPAS$/i, "");
  s = s.replace(/\s*-\s*FLETE DROPSHIP$/i, "");
  s = s.replace(/\s*-\s*FLETE EXPORTACION$/i, "");
  s = s.replace(/\s*-\s*ND POR DOCUMENTACION EXTRA EMITIDA$/i, "");
  s = s.replace(/\s*-\s*FLETE SOBRE COMPRAS$/i, "");
  s = s.replace(/\s*-\s*FLETE MARITIMO.*$/i, "");

  // Final duplicate check
  const finalDup = s.match(/^(.+?)\s*-\s*\1$/);
  if (finalDup) s = finalDup[1];

  return s.trim();
}

// ── Fuzzy vendor matching ──

/** Normalize a company name for fuzzy matching. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:()]/g, "")
    .replace(
      /\b(s\.?a\.?|s\.?a\.?\s*d\.?\s*c\.?\.?v\.?|c\.?a\.?|l\.?t\.?d\.?|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|g\.?m\.?b\.?h\.?|b\.?v\.?|lda\.?|ab\.?|s\.?l\.?\.?)\b\.?/gi,
      "",
    )
    .trim();
}

// ── File definitions ──
const FILES = [
  {
    name: "../purchase-2024-final.xlsx",
    supplierCol: 1,
    invoiceCol: 2,
    amountCol: 3,
    dateCol: 0,
    hasTypeCol: false,
  },
  {
    name: "../purchase-25-final.xlsx",
    supplierCol: 2,
    invoiceCol: 3,
    amountCol: 4,
    dateCol: 0,
    hasTypeCol: true,
    typeCol: 1,
    typeFilter: "Payable Invoice",
  },
  {
    name: "../purchase_2026_final.xlsx",
    supplierCol: 1,
    invoiceCol: 2,
    amountCol: 3,
    dateCol: 0,
    hasTypeCol: false,
  },
];

async function main() {
  const now = nowISO();

  // ── Load existing vendors ──
  console.log("📋 Loading existing vendors...");
  const existingVendors = await scanTable<Vendor>(TABLES.VENDORS, {
    company_id: COMPANY_ID,
  });
  console.log(`   Found ${existingVendors.length} existing vendors.`);

  const vendorByNorm = new Map<string, Vendor>();
  for (const v of existingVendors) {
    vendorByNorm.set(normalize(v.name), v);
  }

  const newVendors = new Map<string, Vendor>();

  /** Match a company name to an existing vendor or create a new one. */
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

  // ── Also load existing purchase invoices to skip duplicates ──
  console.log("📋 Loading existing purchase invoices for dedup...");
  const existingPIs = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, {
    company_id: COMPANY_ID,
  });
  const existingPIKeys = new Set(
    existingPIs.map((p) => `${p.vendor_id}::${p.invoice_number}`.toLowerCase()),
  );
  console.log(`   Found ${existingPIs.length} existing purchase invoices (${existingPIKeys.size} unique vendor+invoice combos).`);

  // ── Read all three Excel files ──
  const allInvoices: PurchaseInvoice[] = [];
  let totalSkipped = 0;
  let duplicatesSkipped = 0;

  for (const f of FILES) {
    console.log(`\n📄 Reading ${f.name}...`);
    const wb = XLSX.readFile(f.name);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

    let fileCount = 0;
    let fileSkipped = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      // Type filter for 2025 file
      if (f.hasTypeCol) {
        const typeStr = String(row[f.typeCol!] ?? "").trim();
        if (typeStr !== f.typeFilter) {
          fileSkipped++;
          continue;
        }
      }

      const dateSerial = Number(row[f.dateCol]);
      if (isNaN(dateSerial)) {
        fileSkipped++;
        continue;
      }

      const rawSupplier = String(row[f.supplierCol] ?? "").trim();
      const invoiceNumber = String(row[f.invoiceCol] ?? "").trim();
      const amount = Number(row[f.amountCol]) || 0;

      if (!rawSupplier || !invoiceNumber) {
        fileSkipped++;
        continue;
      }

      const companyName = cleanSupplierName(rawSupplier);
      const vendor = matchVendor(companyName);
      const dateStr = excelDateToDate(dateSerial);

      const dedupKey = `${vendor.id}::${invoiceNumber}`.toLowerCase();
      if (existingPIKeys.has(dedupKey)) {
        duplicatesSkipped++;
        continue;
      }
      existingPIKeys.add(dedupKey);

      const pi: PurchaseInvoice = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        vendor_id: vendor.id,
        invoice_number: invoiceNumber,
        amount,
        amount_paid: null,
        advance_rate: 0,
        po_number: null,
        po_date: null,
        issue_date: dateStr,
        due_date: null,
        paid_date: null,
        funded_date: null,
        advance_paid_date: null,
        paid_note: null,
        notes: null,
        status: "approved",
        documents: [],
        purchase_order_id: null,
        linked_sales_invoice_ids: [],
        payment_terms_days: 30,
        bl_date: null,
        due_date_source: "invoice",
        has_contractual_due_date: false,
        created_at: now,
        updated_at: now,
      };

      allInvoices.push(pi);
      fileCount++;
    }

    console.log(`   ✔ ${fileCount} invoices parsed, ${fileSkipped} rows skipped.`);
    totalSkipped += fileSkipped;
  }

  console.log(`\n📊 Total valid invoices: ${allInvoices.length}`);
  console.log(`   Duplicates skipped: ${duplicatesSkipped}`);
  console.log(`   Rows skipped: ${totalSkipped}`);

  // ── Create new vendors ──
  if (newVendors.size > 0) {
    const vendorList = Array.from(newVendors.values());
    let written = 0;
    for (let i = 0; i < vendorList.length; i += 25) {
      const chunk = vendorList.slice(i, i + 25);
      await batchPutItems(TABLES.VENDORS, chunk as any);
      written += chunk.length;
      process.stdout.write(`   🏢 Wrote ${written}/${vendorList.length} new vendors...\r`);
    }
    console.log(`\n   ✔ Created ${vendorList.length} new vendors.`);
  } else {
    console.log("\n   ✔ All suppliers matched to existing vendors.");
  }

  // ── Write purchase invoices in batches of 25 ──
  if (allInvoices.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < allInvoices.length; i += 25) {
      const chunk = allInvoices.slice(i, i + 25);
      await batchPutItems(TABLES.PURCHASE_INVOICES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${allInvoices.length} purchase invoices...\r`);
    }
    console.log(`\n   ✔ Successfully imported ${writtenCount} purchase invoices.`);
  }

  // ── Summary ──
  console.log("\n═══════════════════════════════════════");
  console.log("✅ IMPORT COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(`   Purchase Invoices:  ${allInvoices.length}`);
  console.log(`   New Vendors:        ${newVendors.size}`);
  console.log(`   Duplicates Skipped: ${duplicatesSkipped}`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
