/**
 * import-2025-data.ts
 *
 * 1. Deletes all 2025 invoices, purchase invoices, and credit/debit notes.
 * 2. Reads sales-invoice-25.xlsx and purchase-invoice-2025.xlsx.
 * 3. Converts GBP → USD (×1.3535).
 * 4. Treats Manual Journals as credit/debit notes.
 * 5. Creates missing debtors/vendors as needed.
 *
 * Usage: npx tsx src/import-2025-data.ts
 */
import XLSX from "xlsx";
import {
  putItem,
  deleteItem,
  scanTable,
  batchPutItems,
  batchDeleteItems,
  TABLES,
} from "./db/client.js";
import {
  generateId,
  generateNoaToken,
  generateDocNumber,
  nowISO,
} from "./utils/helpers.js";
import type {
  Invoice,
  PurchaseInvoice,
  CreditDebitNote,
  Debtor,
  Vendor,
} from "./types/index.js";

// ─── Constants ───────────────────────────────────────────────────────────────
const GBP_TO_USD = 1.3535;
const CLIENT_ID = "1781861412998-c880305f"; // arjun.jaiswal@whizunik.com
const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert Excel serial date to YYYY-MM-DD. */
function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
}

/** Normalize a company name for fuzzy matching: lowercase, trim, collapse whitespace, strip punctuation. */
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

// ─── Step 1: Delete 2025 data ────────────────────────────────────────────────

async function delete2025Data() {
  console.log("🗑️  Deleting all 2025 data...\n");

  // Delete sales invoices from 2025
  const invoices = await scanTable<Invoice>(TABLES.INVOICES, {
    company_id: COMPANY_ID,
  });
  const inv2025 = invoices.filter((inv) => {
    const y = (inv.issue_date ?? "").slice(0, 4);
    return y === "2025";
  });
  if (inv2025.length > 0) {
    const keys = inv2025.map((i) => ({ id: i.id }));
    for (let i = 0; i < keys.length; i += 25) {
      await batchDeleteItems(TABLES.INVOICES, keys.slice(i, i + 25));
    }
  }
  console.log(`   ✔ Invoices: deleted ${inv2025.length}`);

  // Delete purchase invoices from 2025
  const purchases = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, {
    company_id: COMPANY_ID,
  });
  const pi2025 = purchases.filter((pi) => {
    const y = (pi.issue_date ?? "").slice(0, 4);
    return y === "2025";
  });
  if (pi2025.length > 0) {
    const keys = pi2025.map((i) => ({ id: i.id }));
    for (let i = 0; i < keys.length; i += 25) {
      await batchDeleteItems(TABLES.PURCHASE_INVOICES, keys.slice(i, i + 25));
    }
  }
  console.log(`   ✔ Purchase Invoices: deleted ${pi2025.length}`);

  // Delete credit/debit notes from 2025
  const notes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, {
    company_id: COMPANY_ID,
  });
  const cn2025 = notes.filter((n) => {
    const y = (n.date ?? "").slice(0, 4);
    return y === "2025";
  });
  if (cn2025.length > 0) {
    const keys = cn2025.map((i) => ({ id: i.id }));
    for (let i = 0; i < keys.length; i += 25) {
      await batchDeleteItems(TABLES.CREDIT_DEBIT_NOTES, keys.slice(i, i + 25));
    }
  }
  console.log(`   ✔ Credit/Debit Notes: deleted ${cn2025.length}`);

  console.log();
}

// ─── Step 2: Import data from Excel ──────────────────────────────────────────

async function importFromExcel() {
  const now = nowISO();

  // Load existing debtors and vendors for name matching
  const existingDebtors = await scanTable<Debtor>(TABLES.DEBTORS, {
    company_id: COMPANY_ID,
  });
  const existingVendors = await scanTable<Vendor>(TABLES.VENDORS, {
    company_id: COMPANY_ID,
  });

  console.log(
    `   📋 Loaded ${existingDebtors.length} debtors, ${existingVendors.length} vendors\n`
  );

  // Build lookup maps: normalized name → entity
  const debtorByNorm = new Map<string, Debtor>();
  for (const d of existingDebtors) {
    debtorByNorm.set(normalize(d.name), d);
  }

  const vendorByNorm = new Map<string, Vendor>();
  for (const v of existingVendors) {
    vendorByNorm.set(normalize(v.name), v);
  }

  // Track new debtors/vendors to create
  const newDebtors = new Map<string, Debtor>(); // normalized → debtor
  const newVendors = new Map<string, Vendor>(); // normalized → vendor

  function matchDebtor(companyName: string): { id: string; name: string } {
    const norm = normalize(companyName);
    // Exact match
    if (debtorByNorm.has(norm)) {
      const d = debtorByNorm.get(norm)!;
      return { id: d.id, name: d.name };
    }
    // Already created in this run
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

  // ─── Process Sales Invoices ──────────────────────────────────────────────
  console.log("📄 Processing sales-invoice-25.xlsx...");
  const salesWb = XLSX.readFile("sales-invoice-25.xlsx");
  const salesWs = salesWb.Sheets[salesWb.SheetNames[0]];
  const salesData = XLSX.utils.sheet_to_json(salesWs, {
    header: 1,
  }) as any[][];

  const salesInvoices: Invoice[] = [];
  const salesCreditNotes: CreditDebitNote[] = [];
  let salesSkipped = 0;

  for (let i = 5; i < salesData.length; i++) {
    const row = salesData[i];
    if (!row || !row[1] || !row[4]) continue;

    const source = String(row[1]).trim();
    const desc = String(row[2] ?? "");
    const ref = String(row[3] ?? "").trim();
    const currency = String(row[4]).trim().toUpperCase();
    const dateStr = excelDateToDate(row[0]);

    // Skip totals rows
    if (source === "Total Gross Sales" || source === "Total") continue;

    const companyName = extractCompany(desc);

    if (source === "Receivable Invoice") {
      // Use Credit (GBP) for sales invoices
      const gbpAmount = Number(row[8]) || 0;
      const usdAmount = Math.round(gbpAmount * GBP_TO_USD * 100) / 100;

      if (usdAmount === 0) {
        salesSkipped++;
        continue;
      }

      const debtor = matchDebtor(companyName);

      const invoice: Invoice = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        debtor_id: debtor.id,
        supplier_id: null,
        invoice_number: ref,
        amount: usdAmount,
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
    } else if (source === "Receivable Credit Note") {
      // Use Debit (GBP) for receivable credit notes
      const gbpAmount = Number(row[7]) || 0;
      const usdAmount = Math.round(gbpAmount * GBP_TO_USD * 100) / 100;

      if (usdAmount === 0) {
        salesSkipped++;
        continue;
      }

      const debtor = matchDebtor(companyName);

      const note: CreditDebitNote = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        type: "credit",
        note_number: ref,
        date: dateStr,
        amount: usdAmount,
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
      salesCreditNotes.push(note);
    } else {
      salesSkipped++;
    }
  }

  console.log(
    `   ✔ Sales Invoices: ${salesInvoices.length} rows | Credit Notes: ${salesCreditNotes.length} rows | Skipped: ${salesSkipped}`
  );

  // ─── Process Purchase Invoices ───────────────────────────────────────────
  console.log("\n📄 Processing purchase-invoice-2025.xlsx...");
  const purchaseWb = XLSX.readFile("purchase-invoice-2025.xlsx");
  const purchaseWs = purchaseWb.Sheets[purchaseWb.SheetNames[0]];
  const purchaseData = XLSX.utils.sheet_to_json(purchaseWs, {
    header: 1,
  }) as any[][];

  const purchaseInvoices: PurchaseInvoice[] = [];
  const purchaseCreditNotes: CreditDebitNote[] = [];
  const manualJournalNotes: CreditDebitNote[] = [];
  let purchaseSkipped = 0;

  for (let i = 5; i < purchaseData.length; i++) {
    const row = purchaseData[i];
    if (!row || !row[1] || !row[4]) continue;

    const source = String(row[1]).trim();
    const desc = String(row[2] ?? "");
    const ref = String(row[3] ?? "").trim();
    const currency = String(row[4]).trim().toUpperCase();
    const dateStr = excelDateToDate(row[0]);

    // Skip totals rows
    if (
      source === "Total Gross Purchases" ||
      source === "Total"
    )
      continue;

    const companyName = extractCompany(desc);

    if (source === "Payable Invoice") {
      // Use Debit (GBP) for payable invoices
      const gbpAmount = Number(row[7]) || 0;
      const usdAmount = Math.round(gbpAmount * GBP_TO_USD * 100) / 100;

      if (usdAmount === 0) {
        purchaseSkipped++;
        continue;
      }

      const vendor = matchVendor(companyName);

      const pi: PurchaseInvoice = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        vendor_id: vendor.id,
        invoice_number: ref,
        amount: usdAmount,
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
    } else if (source === "Payable Credit Note") {
      // Use Credit (GBP) for payable credit notes
      const gbpAmount = Number(row[8]) || 0;
      const usdAmount = Math.round(gbpAmount * GBP_TO_USD * 100) / 100;

      if (usdAmount === 0) {
        purchaseSkipped++;
        continue;
      }

      const vendor = matchVendor(companyName);

      const note: CreditDebitNote = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        type: "credit",
        note_number: ref,
        date: dateStr,
        amount: usdAmount,
        debtor_supplier_name: companyName,
        supplier_id: vendor.id,
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
      purchaseCreditNotes.push(note);
    } else if (source === "Manual Journal") {
      // Treat manual journals as credit/debit notes
      // Use Debit (GBP) for manual journals
      const gbpAmount = Number(row[7]) || 0;
      const usdAmount = Math.round(gbpAmount * GBP_TO_USD * 100) / 100;

      if (usdAmount === 0) {
        purchaseSkipped++;
        continue;
      }

      const note: CreditDebitNote = {
        id: generateId(),
        client_id: CLIENT_ID,
        company_id: COMPANY_ID,
        type: "debit", // Manual journals treated as debit notes
        note_number: ref,
        date: dateStr,
        amount: usdAmount,
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
      manualJournalNotes.push(note);
    } else {
      purchaseSkipped++;
    }
  }

  console.log(
    `   ✔ Purchase Invoices: ${purchaseInvoices.length} rows | Credit Notes: ${purchaseCreditNotes.length} rows | Manual Journals (as debit notes): ${manualJournalNotes.length} rows | Skipped: ${purchaseSkipped}`
  );

  // ─── Step 3: Write to DynamoDB ──────────────────────────────────────────
  console.log("\n💾 Writing to DynamoDB...\n");

  // Create new debtors
  if (newDebtors.size > 0) {
    const debtorList = Array.from(newDebtors.values());
    await batchPutItems(TABLES.DEBTORS, debtorList as any);
    console.log(
      `   ✔ Created ${debtorList.length} new debtors: ${debtorList.map((d) => d.name).join(", ")}`
    );
  }

  // Create new vendors
  if (newVendors.size > 0) {
    const vendorList = Array.from(newVendors.values());
    await batchPutItems(TABLES.VENDORS, vendorList as any);
    console.log(
      `   ✔ Created ${vendorList.length} new vendors: ${vendorList.map((v) => v.name).join(", ")}`
    );
  }

  // Write sales invoices
  if (salesInvoices.length > 0) {
    for (let i = 0; i < salesInvoices.length; i += 25) {
      const chunk = salesInvoices.slice(i, i + 25);
      await batchPutItems(TABLES.INVOICES, chunk as any);
    }
    console.log(`   ✔ Wrote ${salesInvoices.length} sales invoices`);
  }

  // Write purchase invoices
  if (purchaseInvoices.length > 0) {
    for (let i = 0; i < purchaseInvoices.length; i += 25) {
      const chunk = purchaseInvoices.slice(i, i + 25);
      await batchPutItems(TABLES.PURCHASE_INVOICES, chunk as any);
    }
    console.log(
      `   ✔ Wrote ${purchaseInvoices.length} purchase invoices`
    );
  }

  // Write all credit/debit notes together
  const allCreditNotes = [
    ...salesCreditNotes,
    ...purchaseCreditNotes,
    ...manualJournalNotes,
  ];
  if (allCreditNotes.length > 0) {
    for (let i = 0; i < allCreditNotes.length; i += 25) {
      const chunk = allCreditNotes.slice(i, i + 25);
      await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, chunk as any);
    }
    console.log(
      `   ✔ Wrote ${allCreditNotes.length} credit/debit notes (sales: ${salesCreditNotes.length}, purchase: ${purchaseCreditNotes.length}, manual journals: ${manualJournalNotes.length})`
    );
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("✅ Import complete!");
  console.log("═══════════════════════════════════════");
  console.log(`   Sales Invoices:     ${salesInvoices.length}`);
  console.log(`   Purchase Invoices:  ${purchaseInvoices.length}`);
  console.log(`   Credit/Debit Notes: ${allCreditNotes.length}`);
  console.log(`     - Sales Credit Notes:    ${salesCreditNotes.length}`);
  console.log(`     - Purchase Credit Notes: ${purchaseCreditNotes.length}`);
  console.log(`     - Manual Journals:       ${manualJournalNotes.length}`);
  console.log(`   New Debtors:        ${newDebtors.size}`);
  console.log(`   New Vendors:        ${newVendors.size}`);
  console.log(`   Conversion rate:    GBP × ${GBP_TO_USD} = USD`);
  console.log("═══════════════════════════════════════");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await delete2025Data();
  await importFromExcel();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
