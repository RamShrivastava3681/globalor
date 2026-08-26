/**
 * import-2025-excel.ts
 *
 * Reads sales-invoice-25.xlsx and purchase-invoice-2025.xlsx, creates:
 *   - Sales invoices (Receivable Invoice) → invoices table
 *   - Purchase invoices (Payable Invoice + Manual Journal) → purchase_invoices table
 *   - Credit notes (Receivable Credit Note + Payable Credit Note) → credit_debit_notes table
 *
 * All Source-currency amounts are converted to GBP using a flat rate of 1.3535.
 *
 * Usage:  npx tsx src/import-2025-excel.ts
 */
import XLSX from "xlsx";
import {
  putItem,
  scanTable,
  batchPutItems,
  TABLES,
} from "./db/client.js";
import { generateId, generateNoaToken, nowISO } from "./utils/helpers.js";
import { createActivityAlert } from "./utils/alerts.js";
import type { Invoice, PurchaseInvoice, CreditDebitNote, Debtor, Vendor, Profile } from "./types/index.js";

const GBP_RATE = 1.3535;
const NOW = nowISO();

// ── Excel date serial → ISO date string ──
function excelDateToISO(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractionalDay = serial - Math.floor(serial);
  const totalSeconds = Math.round(86400 * fractionalDay);
  const d = new Date(utc_value * 1000);
  d.setSeconds(d.getSeconds() + totalSeconds);
  return d.toISOString().slice(0, 10);
}

function toGBP(gbpAmount: number): number {
  // Multiply GBP column value by the conversion rate
  return Math.round((gbpAmount * GBP_RATE) * 100) / 100;
}

// ── Extract party name from description ──
// Format: "SUPPLIER NAME - notes" or "SUPPLIER NAME (COUNTRY) - notes"
function extractPartyName(description: string): string {
  // Split on " - " (with spaces around the dash)
  const parts = description.split(" - ");
  if (parts.length >= 2) {
    return parts[0].trim();
  }
  return description.trim();
}

// ── Read Excel file and return structured rows ──
interface ExcelRow {
  date: string;        // ISO date
  source: string;      // Source type
  description: string;
  reference: string;
  currency: string;
  debitSource: number;
  creditSource: number;
  debitGBP: number;
  creditGBP: number;
}

function readExcel(filePath: string): ExcelRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true });

  const rows: ExcelRow[] = [];

  for (let i = 3; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length === 0) continue;

    const col0 = String(row[0] ?? "").trim();
    const col1 = String(row[1] ?? "").trim();

    // Skip empty rows, section headers, total rows
    if (!col1) continue;
    if (col0 === "Gross Sales" || col0 === "Gross Purchases" ||
        col0 === "Total Gross Sales" || col0 === "Total Gross Purchases" ||
        col0 === "Total" || col0 === "Date") continue;

    const dateSerial = typeof row[0] === "number" ? row[0] : parseFloat(row[0]);
    if (isNaN(dateSerial)) continue;

    rows.push({
      date: excelDateToISO(dateSerial),
      source: col1,
      description: String(row[2] ?? ""),
      reference: String(row[3] ?? ""),
      currency: String(row[4] ?? ""),
      debitSource: Number(row[5] ?? 0),
      creditSource: Number(row[6] ?? 0),
      debitGBP: Number(row[7] ?? 0) * GBP_RATE,
      creditGBP: Number(row[8] ?? 0) * GBP_RATE,
    });
  }

  return rows;
}

// ── Resolve or create debtor by name ──
const debtorCache = new Map<string, string>(); // normalizedName → id
async function resolveDebtor(name: string, clientId: string, companyId: string | null): Promise<string> {
  const key = name.toLowerCase().trim();
  if (debtorCache.has(key)) return debtorCache.get(key)!;

  // Check existing
  const existing = await scanTable<Debtor>(TABLES.DEBTORS, {
    filterExpression: "client_id = :cid",
    expressionAttributeValues: { ":cid": clientId },
  });
  for (const d of existing) {
    if (d.name.toLowerCase().trim() === key) {
      debtorCache.set(key, d.id);
      return d.id;
    }
  }

  // Create new debtor
  const id = generateId();
  const debtor: Debtor = {
    id,
    company_id: companyId,
    name,
    legal_entity_name: null,
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
    created_at: NOW,
    updated_at: NOW,
  };
  await putItem(TABLES.DEBTORS, debtor as any);
  debtorCache.set(key, id);
  return id;
}

// ── Resolve or create vendor by name ──
const vendorCache = new Map<string, string>();
async function resolveVendor(name: string, clientId: string, companyId: string | null): Promise<string> {
  const key = name.toLowerCase().trim();
  if (vendorCache.has(key)) return vendorCache.get(key)!;

  const existing = await scanTable<Vendor>(TABLES.VENDORS, {
    filterExpression: "client_id = :cid",
    expressionAttributeValues: { ":cid": clientId },
  });
  for (const v of existing) {
    if (v.name.toLowerCase().trim() === key) {
      vendorCache.set(key, v.id);
      return v.id;
    }
  }

  const id = generateId();
  const vendor: Vendor = {
    id,
    client_id: clientId,
    company_id: companyId,
    name,
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
    notes: null,
    created_at: NOW,
    updated_at: NOW,
  };
  await putItem(TABLES.VENDORS, vendor as any);
  vendorCache.set(key, id);
  return id;
}

// ── Main ──
async function main() {
  console.log("🚀 Importing 2025 Excel data…\n");

  // Get the first client user as the owner
  const profiles = await scanTable<Profile>(TABLES.PROFILES);
  if (profiles.length === 0) {
    console.error("❌ No profiles found — cannot import.");
    process.exit(1);
  }
  const clientId = profiles[0].id;
  const companyId = profiles[0].company_id;
  console.log(`   Using client: ${clientId} (${profiles[0].company_name})\n`);

  // ────────────────────────────────────────────
  // 1. SALES INVOICE FILE
  // ────────────────────────────────────────────
  console.log("📄 Reading sales-invoice-25.xlsx…");
  const salesRows = readExcel("../sales-invoice-25.xlsx");
  console.log(`   Total rows: ${salesRows.length}`);

  const salesInvoices = salesRows.filter((r) => r.source === "Receivable Invoice");
  const salesCreditNotes = salesRows.filter((r) => r.source === "Receivable Credit Note");
  console.log(`   Receivable Invoices: ${salesInvoices.length}`);
  console.log(`   Receivable Credit Notes: ${salesCreditNotes.length}\n`);

  // Create sales invoices
  const invoiceBatch: Invoice[] = [];
  let salesInvCreated = 0;
  let salesInvErrors = 0;

  for (const row of salesInvoices) {
    try {
      const debtorName = extractPartyName(row.description);
      const debtorId = await resolveDebtor(debtorName, clientId, companyId);
      const amountGBP = row.creditGBP; // Credit = sales invoice amount

      const invoice: Invoice = {
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        debtor_id: debtorId,
        supplier_id: null,
        invoice_number: row.reference,
        amount: amountGBP,
        advance_rate: 0,
        fee_rate: 0,
        amount_received: amountGBP,
        issue_date: row.date,
        due_date: row.date,
        paid_date: row.date,
        receipt_date: null,
        advance_received_date: null,
        short_payment: null,
        late_days: null,
        paid_note: null,
        status: "paid",
        payment_type: "mass_upload",
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
        created_at: NOW,
        updated_at: NOW,
      };

      invoiceBatch.push(invoice);
      salesInvCreated++;

      // Write in batches of 25
      if (invoiceBatch.length >= 25) {
        await batchPutItems(TABLES.INVOICES, invoiceBatch.map((i) => i as unknown as Record<string, unknown>));
        process.stdout.write(`   📝 Sales invoices: ${salesInvCreated}/${salesInvoices.length}\r`);
        invoiceBatch.length = 0;
      }
    } catch (err: any) {
      salesInvErrors++;
      console.error(`   ❌ Error creating sales invoice ${row.reference}: ${err.message}`);
    }
  }

  // Flush remaining
  if (invoiceBatch.length > 0) {
    await batchPutItems(TABLES.INVOICES, invoiceBatch.map((i) => i as unknown as Record<string, unknown>));
  }
  console.log(`   ✅ Sales invoices created: ${salesInvCreated} (${salesInvErrors} errors)\n`);

  // Create sales credit notes
  let salesCnCreated = 0;
  let salesCnErrors = 0;
  const cdnBatchSales: CreditDebitNote[] = [];

  for (const row of salesCreditNotes) {
    try {
      const debtorName = extractPartyName(row.description);
      const debtorId = await resolveDebtor(debtorName, clientId, companyId);
      const amountGBP = row.debitGBP; // Debit = credit note amount for sales

      const cdn: CreditDebitNote = {
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        type: "credit",
        note_number: row.reference,
        date: row.date,
        amount: amountGBP,
        debtor_supplier_name: debtorName,
        supplier_id: null,
        linked_invoice_id: null,
        linked_invoice_type: "sales",
        reason: row.description.includes(" - ") ? row.description.split(" - ").slice(1).join(" - ").trim() : null,
        status: "paid",
        reviewed_at: null,
        reviewed_by: null,
        settled_at: null,
        settled_by: null,
        created_at: NOW,
        updated_at: NOW,
      };

      cdnBatchSales.push(cdn);
      salesCnCreated++;

      if (cdnBatchSales.length >= 25) {
        await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, cdnBatchSales.map((c) => c as unknown as Record<string, unknown>));
        process.stdout.write(`   📝 Sales credit notes: ${salesCnCreated}/${salesCreditNotes.length}\r`);
        cdnBatchSales.length = 0;
      }
    } catch (err: any) {
      salesCnErrors++;
      console.error(`   ❌ Error creating sales credit note ${row.reference}: ${err.message}`);
    }
  }

  if (cdnBatchSales.length > 0) {
    await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, cdnBatchSales.map((c) => c as unknown as Record<string, unknown>));
  }
  console.log(`   ✅ Sales credit notes created: ${salesCnCreated} (${salesCnErrors} errors)\n`);

  // ────────────────────────────────────────────
  // 2. PURCHASE INVOICE FILE
  // ────────────────────────────────────────────
  console.log("📄 Reading purchase-invoice-2025.xlsx…");
  const purchaseRows = readExcel("../purchase-invoice-2025.xlsx");
  console.log(`   Total rows: ${purchaseRows.length}`);

  const purchaseInvoices = purchaseRows.filter((r) => r.source === "Payable Invoice");
  const purchaseCreditNotes = purchaseRows.filter((r) => r.source === "Payable Credit Note");
  const manualJournals = purchaseRows.filter((r) => r.source === "Manual Journal");
  console.log(`   Payable Invoices: ${purchaseInvoices.length}`);
  console.log(`   Payable Credit Notes: ${purchaseCreditNotes.length}`);
  console.log(`   Manual Journals (→ purchase invoices): ${manualJournals.length}\n`);

  // Create purchase invoices (Payable Invoice + Manual Journal)
  const piBatch: PurchaseInvoice[] = [];
  let piCreated = 0;
  let piErrors = 0;

  const allPurchaseItems = [
    ...purchaseInvoices.map((r) => ({ ...r, isManualJournal: false })),
    ...manualJournals.map((r) => ({ ...r, isManualJournal: true })),
  ];

  for (const row of allPurchaseItems) {
    try {
      const vendorName = row.isManualJournal
        ? extractPartyName(row.description).split(" ").slice(0, 3).join(" ") // e.g. "TAF 1093 Inventory balance"
        : extractPartyName(row.description);
      const vendorId = await resolveVendor(vendorName, clientId, companyId);
      const amountGBP = row.debitGBP; // Debit = purchase invoice amount

      const pi: PurchaseInvoice = {
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        vendor_id: vendorId,
        invoice_number: row.isManualJournal ? row.reference : row.reference,
        amount: amountGBP,
        amount_paid: amountGBP,
        advance_rate: 0,
        po_number: null,
        po_date: null,
        issue_date: row.date,
        due_date: row.date,
        paid_date: row.date,
        funded_date: null,
        advance_paid_date: null,
        paid_note: row.isManualJournal ? "Manual Journal — treated as purchase invoice" : null,
        status: "paid",
        notes: row.isManualJournal ? `Manual Journal: ${row.description}` : null,
        documents: [],
        purchase_order_id: null,
        goods_purchase_order_id: null,
        linked_goods_receipt_ids: null,
        linked_sales_invoice_ids: [],
        payment_terms_days: 30,
        bl_date: null,
        due_date_source: "invoice",
        has_contractual_due_date: false,
        created_at: NOW,
        updated_at: NOW,
      };

      piBatch.push(pi);
      piCreated++;

      if (piBatch.length >= 25) {
        await batchPutItems(TABLES.PURCHASE_INVOICES, piBatch.map((p) => p as unknown as Record<string, unknown>));
        process.stdout.write(`   📝 Purchase invoices: ${piCreated}/${allPurchaseItems.length}\r`);
        piBatch.length = 0;
      }
    } catch (err: any) {
      piErrors++;
      console.error(`   ❌ Error creating purchase invoice ${row.reference}: ${err.message}`);
    }
  }

  if (piBatch.length > 0) {
    await batchPutItems(TABLES.PURCHASE_INVOICES, piBatch.map((p) => p as unknown as Record<string, unknown>));
  }
  console.log(`   ✅ Purchase invoices created: ${piCreated} (${piErrors} errors)\n`);

  // Create purchase credit notes
  let purchaseCnCreated = 0;
  let purchaseCnErrors = 0;
  const cdnBatchPurchase: CreditDebitNote[] = [];

  for (const row of purchaseCreditNotes) {
    try {
      const vendorName = extractPartyName(row.description);
      const vendorId = await resolveVendor(vendorName, clientId, companyId);
      const amountGBP = row.creditGBP; // Credit = credit note amount for purchases

      const cdn: CreditDebitNote = {
        id: generateId(),
        client_id: clientId,
        company_id: companyId,
        type: "credit",
        note_number: row.reference,
        date: row.date,
        amount: amountGBP,
        debtor_supplier_name: vendorName,
        supplier_id: vendorId,
        linked_invoice_id: null,
        linked_invoice_type: "purchase",
        reason: row.description.includes(" - ") ? row.description.split(" - ").slice(1).join(" - ").trim() : null,
        status: "paid",
        reviewed_at: null,
        reviewed_by: null,
        settled_at: null,
        settled_by: null,
        created_at: NOW,
        updated_at: NOW,
      };

      cdnBatchPurchase.push(cdn);
      purchaseCnCreated++;

      if (cdnBatchPurchase.length >= 25) {
        await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, cdnBatchPurchase.map((c) => c as unknown as Record<string, unknown>));
        process.stdout.write(`   📝 Purchase credit notes: ${purchaseCnCreated}/${purchaseCreditNotes.length}\r`);
        cdnBatchPurchase.length = 0;
      }
    } catch (err: any) {
      purchaseCnErrors++;
      console.error(`   ❌ Error creating purchase credit note ${row.reference}: ${err.message}`);
    }
  }

  if (cdnBatchPurchase.length > 0) {
    await batchPutItems(TABLES.CREDIT_DEBIT_NOTES, cdnBatchPurchase.map((c) => c as unknown as Record<string, unknown>));
  }
  console.log(`   ✅ Purchase credit notes created: ${purchaseCnCreated} (${purchaseCnErrors} errors)\n`);

  // ── Activity alert ──
  createActivityAlert({
    client_id: clientId,
    company_id: companyId,
    type: "purchase_invoice_created",
    severity: "info",
    message: `2025 Excel import: ${salesInvCreated} sales invoices, ${salesCnCreated} sales credit notes, ${piCreated} purchase invoices (${manualJournals.length} manual journals), ${purchaseCnCreated} purchase credit notes — GBP values × ${GBP_RATE}`,
    created_by: clientId,
  });

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("✅ IMPORT COMPLETE");
  console.log("=".repeat(60));
  console.log(`   Sales invoices:         ${salesInvCreated}`);
  console.log(`   Sales credit notes:     ${salesCnCreated}`);
  console.log(`   Purchase invoices:      ${piCreated} (incl. ${manualJournals.length} manual journals)`);
  console.log(`   Purchase credit notes:  ${purchaseCnCreated}`);
  console.log(`   Total records:          ${salesInvCreated + salesCnCreated + piCreated + purchaseCnCreated}`);
  console.log(`   Conversion rate:        1 GBP = ${GBP_RATE} source currency`);
  console.log(`   Debtor cache size:      ${debtorCache.size} unique debtors`);
  console.log(`   Vendor cache size:      ${vendorCache.size} unique vendors`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
