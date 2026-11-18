import { scanTable, TABLES } from "../db/client.js";

const [suppliers, vendors, purchaseInvoices] = await Promise.all([
  scanTable(TABLES.SUPPLIERS),
  scanTable(TABLES.VENDORS),
  scanTable(TABLES.PURCHASE_INVOICES),
]);

console.log("=== SUPPLIERS ===");
for (const s of suppliers) {
  console.log(`  ${s.id} - ${s.company_name}`);
}

console.log("\n=== VENDORS ===");
for (const v of vendors) {
  console.log(`  ${v.id} - ${v.name}`);
}

console.log("\n=== PURCHASE INVOICES for ORGILL INC (USA) ===");
const orgillInvoices = purchaseInvoices.filter(pi => pi.vendor_id === '1787637532337-6055ef49');
console.log(`Total: ${orgillInvoices.length}`);
for (const pi of orgillInvoices) {
  console.log(`  ${pi.invoice_number} - $${pi.amount} - ${pi.status}`);
}

// Check for any remaining references to old supplier
console.log("\n=== CHECKING FOR OLD SUPPLIER REFERENCES ===");
const oldId = '1787642474061-7d13722d';
const tables = [
  { name: 'PURCHASE_INVOICES', table: TABLES.PURCHASE_INVOICES, field: 'vendor_id' },
  { name: 'PURCHASE_ORDERS', table: TABLES.PURCHASE_ORDERS, field: 'vendor_id' },
  { name: 'GOODS_PURCHASE_ORDERS', table: TABLES.GOODS_PURCHASE_ORDERS, field: 'supplier_id' },
  { name: 'ADVANCES', table: TABLES.ADVANCES, field: 'vendor_id' },
  { name: 'PAYMENTS', table: TABLES.PAYMENTS, field: 'customer_id' },
  { name: 'CREDIT_DEBIT_NOTES', table: TABLES.CREDIT_DEBIT_NOTES, field: 'supplier_id' },
  { name: 'INVOICES', table: TABLES.INVOICES, field: 'supplier_id' },
  { name: 'PRODUCTS', table: TABLES.PRODUCTS, field: 'supplier_id' },
  { name: 'STOCK_MOVEMENTS', table: TABLES.STOCK_MOVEMENTS, field: 'vendor_id' },
];

for (const { name, table, field } of tables) {
  const items = await scanTable(table);
  const found = items.filter(item => item[field] === oldId);
  if (found.length > 0) {
    console.log(`  ⚠️ ${name}: ${found.length} records still reference old ID`);
  } else {
    console.log(`  ✅ ${name}: clean`);
  }
}