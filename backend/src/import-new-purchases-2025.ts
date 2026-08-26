/**
 * import-new-purchases-2025.ts
 *
 * 1. Scans and deletes all 2025 purchase invoices from purchase_invoices table.
 * 2. Reads purchase-25-final.xlsx.
 * 3. Extracts vendors and creates them if they don't exist.
 * 4. Inserts new purchase invoices in batches of 25.
 *
 * Usage: npx tsx src/import-new-purchases-2025.ts
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
  PurchaseInvoice,
  Vendor,
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

async function delete2025PurchaseInvoices() {
  console.log("🗑️  Scanning and deleting existing 2025 purchase invoices...");

  const allPurchases = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, {
    company_id: COMPANY_ID,
  });

  const purchases2025 = allPurchases.filter((p) => {
    const y = (p.issue_date ?? "").slice(0, 4);
    const createdY = (p.created_at ?? "").slice(0, 4);
    return y === "2025" || createdY === "2025";
  });

  console.log(`   Found ${purchases2025.length} purchase invoices from 2025.`);

  if (purchases2025.length > 0) {
    const keys = purchases2025.map((p) => ({ id: p.id }));
    let deletedCount = 0;
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await batchDeleteItems(TABLES.PURCHASE_INVOICES, chunk);
      deletedCount += chunk.length;
      process.stdout.write(`   🗑️  Deleted ${deletedCount}/${keys.length}...\r`);
    }
    console.log(`\n   ✔ Deleted all ${deletedCount} existing 2025 purchase invoices.`);
  } else {
    console.log("   ✔ No existing 2025 purchase invoices to delete.");
  }
  console.log();
}

async function importNewPurchaseInvoices() {
  const now = nowISO();

  // Load existing vendors
  const existingVendors = await scanTable<Vendor>(TABLES.VENDORS, {
    company_id: COMPANY_ID,
  });

  console.log(`📋 Loaded ${existingVendors.length} vendors.`);

  const vendorByNorm = new Map<string, Vendor>();
  for (const v of existingVendors) {
    vendorByNorm.set(normalize(v.name), v);
  }

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

  console.log("📄 Reading purchase-25-final.xlsx...");
  const wb = XLSX.readFile("../purchase-25-final.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const purchasesData = XLSX.utils.sheet_to_json(ws, {
    header: 1,
  }) as any[][];

  const purchaseInvoices: PurchaseInvoice[] = [];
  let skippedCount = 0;

  // Row 0 is the header: date, null, supplier, invoice_number, amount
  for (let i = 1; i < purchasesData.length; i++) {
    const row = purchasesData[i];
    if (!row || !row[0] || !row[2] || !row[3]) {
      skippedCount++;
      continue;
    }

    const typeStr = String(row[1] ?? "").trim();
    if (typeStr !== "Payable Invoice") {
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
    const vendor = matchVendor(companyName);

    const pi: PurchaseInvoice = {
      id: generateId(),
      client_id: CLIENT_ID,
      company_id: COMPANY_ID,
      vendor_id: vendor.id,
      invoice_number: ref,
      amount: amount,
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

    purchaseInvoices.push(pi);
  }

  console.log(`   Processed ${purchaseInvoices.length} valid purchase invoices. Skipped/Invalid: ${skippedCount}`);

  // Create new vendors
  if (newVendors.size > 0) {
    const vendorList = Array.from(newVendors.values());
    await batchPutItems(TABLES.VENDORS, vendorList as any);
    console.log(`   ✔ Created ${vendorList.length} new vendors.`);
  }

  // Write new purchase invoices
  if (purchaseInvoices.length > 0) {
    let writtenCount = 0;
    for (let i = 0; i < purchaseInvoices.length; i += 25) {
      const chunk = purchaseInvoices.slice(i, i + 25);
      await batchPutItems(TABLES.PURCHASE_INVOICES, chunk as any);
      writtenCount += chunk.length;
      process.stdout.write(`   📝 Wrote ${writtenCount}/${purchaseInvoices.length} purchase invoices...\r`);
    }
    console.log(`\n   ✔ Successfully imported all ${writtenCount} purchase invoices.`);
  }

  console.log("\n═══════════════════════════════════════");
  console.log("✅ IMPORT COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(`   New Purchase Invoices: ${purchaseInvoices.length}`);
  console.log(`   New Vendors:           ${newVendors.size}`);
  console.log("═══════════════════════════════════════");
}

async function main() {
  await delete2025PurchaseInvoices();
  await importNewPurchaseInvoices();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
