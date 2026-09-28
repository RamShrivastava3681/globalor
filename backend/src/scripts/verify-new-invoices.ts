import { scanTable, TABLES } from "../db/client.js";

async function main() {
  const invoices = await scanTable(TABLES.PURCHASE_INVOICES);
  const newInvoices = invoices.filter(i => 
    ["FVI102559", "FVI102610", "FVI102566", "FVI102563", "FVI102518", "FVI102611", "FVI102519", "23948", "23939", "23938"].includes(i.invoice_number)
  );
  console.log('New Invoices:', JSON.stringify(newInvoices.map(i => ({ 
    number: i.invoice_number, 
    vendor: i.vendor_id, 
    amount: i.amount, 
    issue: i.issue_date, 
    due: i.due_date 
  })), null, 2));
  
  const vendors = await scanTable(TABLES.VENDORS);
  const majic = vendors.find(v => v.name === "MAJIC PRODUCTS INC");
  const madecentro = vendors.find(v => v.name === "MADECENTRO COLOMBIA S.A.S");
  console.log('\nMAJIC PRODUCTS INC:', majic);
  console.log('MADECENTRO COLOMBIA S.A.S:', madecentro);
}

main().catch(console.error);