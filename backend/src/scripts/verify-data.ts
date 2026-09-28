import { scanTable, TABLES } from "../db/client.js";

async function main() {
  const vendors = await scanTable(TABLES.VENDORS);
  console.log('Vendors:', JSON.stringify(vendors.map(v => ({ id: v.id, name: v.name }))));
  
  const invoices = await scanTable(TABLES.PURCHASE_INVOICES);
  console.log('Invoices:', JSON.stringify(invoices.map(i => ({ 
    number: i.invoice_number, 
    vendor: i.vendor_id, 
    amount: i.amount, 
    issue: i.issue_date, 
    due: i.due_date 
  }))));
}

main().catch(console.error);