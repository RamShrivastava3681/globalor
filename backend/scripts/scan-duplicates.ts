import { scanTable, TABLES } from "../src/db/client.js";

async function scan() {
  const [suppliers, vendors, purchaseInvoices, purchaseOrders, goodsPurchaseOrders, advances, payments, creditDebitNotes, invoices, products, stockMovements] = await Promise.all([
    scanTable(TABLES.SUPPLIERS),
    scanTable(TABLES.VENDORS),
    scanTable(TABLES.PURCHASE_INVOICES),
    scanTable(TABLES.PURCHASE_ORDERS),
    scanTable(TABLES.GOODS_PURCHASE_ORDERS),
    scanTable(TABLES.ADVANCES),
    scanTable(TABLES.PAYMENTS),
    scanTable(TABLES.CREDIT_DEBIT_NOTES),
    scanTable(TABLES.INVOICES),
    scanTable(TABLES.PRODUCTS),
    scanTable(TABLES.STOCK_MOVEMENTS),
  ]);

  const norm = (s: string) => s.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  
  console.log('=== SUPPLIERS ===');
  for (const s of suppliers) {
    console.log(`  ${s.id} - ${s.company_name} [norm: ${norm(s.company_name)}]`);
  }
  
  console.log('\n=== VENDORS ===');
  for (const v of vendors) {
    console.log(`  ${v.id} - ${v.name} [norm: ${norm(v.name)}]`);
  }

  const groups = [
    { keep: 'MADECENTRO COLOMBIA S.A.S.', remove: 'MADECENTRO COLOMBIA S.A.S' },
    { keep: 'MAJIC PRODUCTS, INC', remove: 'MAJIC PRODUCTS INC' },
    { keep: 'ORGILL INC (USA)', remove: 'ORGILL INC' },
    { keep: 'SAFETY SPEED MANUFACTURING', remove: 'SAFETY SPEED MFG' },
  ];

  for (const g of groups) {
    console.log(`\n=== GROUP: Keep='${g.keep}' Remove='${g.remove}' ===`);
    
    // Find all matching suppliers and vendors
    const keepSupps = suppliers.filter(s => norm(s.company_name) === norm(g.keep));
    const removeSupps = suppliers.filter(s => norm(s.company_name) === norm(g.remove));
    const keepVends = vendors.filter(v => norm(v.name) === norm(g.keep));
    const removeVends = vendors.filter(v => norm(v.name) === norm(g.remove));
    
    console.log(`  Suppliers matching KEEP: ${keepSupps.map(s => s.id).join(', ') || 'none'}`);
    console.log(`  Suppliers matching REMOVE: ${removeSupps.map(s => s.id).join(', ') || 'none'}`);
    console.log(`  Vendors matching KEEP: ${keepVends.map(v => v.id).join(', ') || 'none'}`);
    console.log(`  Vendors matching REMOVE: ${removeVends.map(v => v.id).join(', ') || 'none'}`);
    
    // All unique IDs to keep and remove
    const keepIds = [...new Set([...keepSupps.map(s => s.id), ...keepVends.map(v => v.id)])];
    const removeIds = [...new Set([...removeSupps.map(s => s.id), ...removeVends.map(v => v.id)])];
    
    console.log(`  All Keep IDs: ${keepIds.join(', ') || 'none'}`);
    console.log(`  All Remove IDs: ${removeIds.join(', ') || 'none'}`);
    
    if (keepIds.length === 0 || removeIds.length === 0) {
      console.log('  ⚠️ Could not find both keep and remove IDs');
      continue;
    }
    
    const tables = [
      { name: 'PURCHASE_INVOICES', items: purchaseInvoices, field: 'vendor_id' },
      { name: 'PURCHASE_ORDERS', items: purchaseOrders, field: 'vendor_id' },
      { name: 'GOODS_PURCHASE_ORDERS', items: goodsPurchaseOrders, field: 'supplier_id' },
      { name: 'ADVANCES', items: advances, field: 'vendor_id' },
      { name: 'PAYMENTS', items: payments, field: 'customer_id' },
      { name: 'CREDIT_DEBIT_NOTES', items: creditDebitNotes, field: 'supplier_id' },
      { name: 'INVOICES', items: invoices, field: 'supplier_id' },
      { name: 'PRODUCTS', items: products, field: 'supplier_id' },
      { name: 'STOCK_MOVEMENTS', items: stockMovements, field: 'vendor_id' },
    ];
    
    let totalRefs = 0;
    for (const t of tables) {
      for (const removeId of removeIds) {
        const count = t.items.filter(i => i[t.field] === removeId).length;
        if (count > 0) {
          console.log(`    ${t.name} (${t.field}): ${count} refs to remove ID ${removeId}`);
          totalRefs += count;
        }
      }
      for (const keepId of keepIds) {
        const keepCount = t.items.filter(i => i[t.field] === keepId).length;
        if (keepCount > 0) {
          console.log(`    ${t.name} (${t.field}): ${keepCount} refs to keep ID ${keepId}`);
        }
      }
    }
    console.log(`  Total references to migrate: ${totalRefs}`);
  }
}

scan().catch(console.error);