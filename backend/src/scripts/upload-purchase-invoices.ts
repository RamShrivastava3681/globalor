import { scanTable, putItem, getItem, TABLES } from "../db/client.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { Vendor, PurchaseInvoice } from "../types/index.js";

const COMPANY_ID = "default-company";

const invoices = [
  { invoiceNumber: "FVI102559", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 54499.12, issueDate: "2026-05-28" },
  { invoiceNumber: "FVI102610", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 2066.47, issueDate: "2026-07-30" },
  { invoiceNumber: "FVI102566", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 967.45, issueDate: "2026-06-01" },
  { invoiceNumber: "FVI102563", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 6196.17, issueDate: "2026-07-01" },
  { invoiceNumber: "FVI102518", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 1809.38, issueDate: "2026-05-01" },
  { invoiceNumber: "FVI102611", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 4850.34, issueDate: "2026-07-30" },
  { invoiceNumber: "FVI102519", vendorName: "MADECENTRO COLOMBIA S.A.S", amount: 5260.66, issueDate: "2026-05-01" },
  { invoiceNumber: "23948", vendorName: "MAJIC PRODUCTS INC", amount: 54637.34, issueDate: "2026-06-16" },
  { invoiceNumber: "23939", vendorName: "MAJIC PRODUCTS INC", amount: 52425.26, issueDate: "2026-06-23" },
  { invoiceNumber: "23938", vendorName: "MAJIC PRODUCTS INC", amount: 50520.42, issueDate: "2026-06-09" },
];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findOrCreateVendor(name: string): Promise<string> {
  const existing = await scanTable<Vendor>(TABLES.VENDORS);
  const found = existing.find(v => v.name?.toLowerCase() === name.toLowerCase() && v.company_id === COMPANY_ID);
  if (found) {
    console.log(`Found existing vendor: ${name} (${found.id})`);
    return found.id;
  }

  const id = generateId();
  const now = nowISO();
  const vendor: Vendor = {
    id,
    client_id: "system",
    company_id: COMPANY_ID,
    name,
    industry: null,
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
    notes: null,
    created_at: now,
    updated_at: now,
  };
  await putItem(TABLES.VENDORS, vendor as any);
  console.log(`Created vendor: ${name} (${id})`);
  return id;
}

async function createPurchaseInvoice(vendorId: string, inv: typeof invoices[0]) {
  const existing = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
  const found = existing.find(i => i.invoice_number === inv.invoiceNumber && i.company_id === COMPANY_ID);
  if (found) {
    console.log(`Invoice ${inv.invoiceNumber} already exists, skipping`);
    return;
  }

  const id = generateId();
  const now = nowISO();
  const dueDate = addDays(inv.issueDate, 60);

  const invoice: PurchaseInvoice = {
    id,
    client_id: "system",
    company_id: COMPANY_ID,
    vendor_id: vendorId,
    invoice_number: inv.invoiceNumber,
    amount: inv.amount,
    amount_paid: null,
    advance_rate: 0,
    po_number: null,
    po_date: null,
    issue_date: inv.issueDate,
    due_date: dueDate,
    paid_date: null,
    funded_date: null,
    advance_paid_date: null,
    paid_note: null,
    payment_terms_days: 60,
    bl_date: null,
    due_date_source: "invoice",
    has_contractual_due_date: false,
    notes: null,
    status: "draft",
    documents: [],
    purchase_order_id: null,
    goods_purchase_order_id: null,
    lines: undefined,
    linked_goods_receipt_ids: null,
    linked_sales_invoice_ids: [],
    created_at: now,
    updated_at: now,
  };

  await putItem(TABLES.PURCHASE_INVOICES, invoice as any);
  console.log(`Created invoice: ${inv.invoiceNumber} for ${inv.amount} (due: ${dueDate})`);
}

async function main() {
  console.log("Starting purchase invoice upload...\n");

  const vendorIds = new Map<string, string>();
  for (const inv of invoices) {
    if (!vendorIds.has(inv.vendorName)) {
      const vendorId = await findOrCreateVendor(inv.vendorName);
      vendorIds.set(inv.vendorName, vendorId);
    }
  }

  console.log("\nCreating purchase invoices...\n");
  for (const inv of invoices) {
    const vendorId = vendorIds.get(inv.vendorName)!;
    await createPurchaseInvoice(vendorId, inv);
  }

  console.log("\nDone!");
}

main().catch(console.error);