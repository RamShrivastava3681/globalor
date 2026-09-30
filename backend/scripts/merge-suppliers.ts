import {
  scanTable,
  updateItem,
  deleteItem,
  getItem,
  putItem,
  TABLES,
} from "../src/db/client.js";

interface Supplier {
  id: string;
  company_id: string;
  company_name: string;
}

interface Vendor {
  id: string;
  company_id: string;
  name: string;
}

const norm = (s: string) => s.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');

async function mergeSupplierGroup(
  keepName: string,
  removeName: string,
  tablesToUpdate: Array<{ table: string; field: string }>
) {
  console.log(`\n🔄 Merging: Keep='${keepName}' → Remove='${removeName}'`);

  // Scan all relevant tables
  const [allSuppliers, allVendors] = await Promise.all([
    scanTable<Supplier>(TABLES.SUPPLIERS),
    scanTable<Vendor>(TABLES.VENDORS),
  ]);

  // Find all matching records
  const keepSupps = allSuppliers.filter(s => norm(s.company_name) === norm(keepName));
  const removeSupps = allSuppliers.filter(s => norm(s.company_name) === norm(removeName));
  const keepVends = allVendors.filter(v => norm(v.name) === norm(keepName));
  const removeVends = allVendors.filter(v => norm(v.name) === norm(removeName));

  // Collect all unique IDs
  const keepIds = [...new Set([...keepSupps.map(s => s.id), ...keepVends.map(v => v.id)])];
  const removeIds = [...new Set([...removeSupps.map(s => s.id), ...removeVends.map(v => v.id)])];

  if (keepIds.length === 0) {
    console.log(`  ❌ No keep records found for '${keepName}'`);
    return;
  }
  if (removeIds.length === 0) {
    console.log(`  ⚠️ No remove records found for '${removeName}' (already merged?)`);
    return;
  }

  // Pick canonical ID: prefer supplier ID, then first vendor ID
  const canonicalId = keepSupps.length > 0 ? keepSupps[0].id : keepVends[0].id;
  console.log(`  ✅ Canonical ID: ${canonicalId}`);

  // IDs to migrate FROM (all remove IDs + other keep IDs that aren't canonical)
  const idsToMigrate = [...new Set([...removeIds, ...keepIds.filter(id => id !== canonicalId)])];
  console.log(`  🔁 Migrating from IDs: ${idsToMigrate.join(', ')}`);

  // 1. Update all references in related tables
  for (const { table, field } of tablesToUpdate) {
    try {
      const items = await scanTable<any>(table);
      for (const fromId of idsToMigrate) {
        const toUpdate = items.filter(item => item[field] === fromId);
        if (toUpdate.length > 0) {
          console.log(`    📝 ${table}.${field}: updating ${toUpdate.length} records from ${fromId} → ${canonicalId}`);
          for (const item of toUpdate) {
            await updateItem(table, { id: item.id }, { [field]: canonicalId, updated_at: new Date().toISOString() });
          }
        }
      }
    } catch (error) {
      console.error(`    ❌ Error updating ${table}:`, error);
    }
  }

  // 2. Delete duplicate records from SUPPLIERS table
  for (const supp of removeSupps) {
    if (supp.id !== canonicalId) {
      await deleteItem(TABLES.SUPPLIERS, { id: supp.id });
      console.log(`    🗑️ Deleted from SUPPLIERS: ${supp.id} (${supp.company_name})`);
    }
  }
  // Also delete any keep supplier records that aren't canonical
  for (const supp of keepSupps) {
    if (supp.id !== canonicalId) {
      await deleteItem(TABLES.SUPPLIERS, { id: supp.id });
      console.log(`    🗑️ Deleted duplicate from SUPPLIERS: ${supp.id} (${supp.company_name})`);
    }
  }

  // 3. Delete duplicate records from VENDORS table
  for (const vend of removeVends) {
    if (vend.id !== canonicalId) {
      await deleteItem(TABLES.VENDORS, { id: vend.id });
      console.log(`    🗑️ Deleted from VENDORS: ${vend.id} (${vend.name})`);
    }
  }
  // Also delete any keep vendor records that aren't canonical
  for (const vend of keepVends) {
    if (vend.id !== canonicalId) {
      await deleteItem(TABLES.VENDORS, { id: vend.id });
      console.log(`    🗑️ Deleted duplicate from VENDORS: ${vend.id} (${vend.name})`);
    }
  }

  // 4. Ensure canonical record exists in both tables (sync)
  const canonicalSupplier = allSuppliers.find(s => s.id === canonicalId);
  const canonicalVendor = allVendors.find(v => v.id === canonicalId);

  if (canonicalSupplier && !canonicalVendor) {
    // Create vendor entry
    const vendor: Vendor = {
      id: canonicalId,
      company_id: canonicalSupplier.company_id,
      name: canonicalSupplier.company_name,
      industry: (canonicalSupplier as any).industry || null,
      address_line: (canonicalSupplier as any).address_line || null,
      city: (canonicalSupplier as any).city || null,
      country: (canonicalSupplier as any).country || null,
      postal_code: (canonicalSupplier as any).postal_code || null,
      phone: (canonicalSupplier as any).phone || null,
      website: (canonicalSupplier as any).website || null,
      contact_name: (canonicalSupplier as any).contact_name || null,
      contact_email: (canonicalSupplier as any).contact_email || null,
      contact_designation: (canonicalSupplier as any).contact_designation || null,
      contact_phone: (canonicalSupplier as any).contact_phone || null,
      notes: (canonicalSupplier as any).notes || null,
      created_at: (canonicalSupplier as any).created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await putItem(TABLES.VENDORS, vendor as any);
    console.log(`    ✅ Synced canonical supplier to VENDORS table`);
  }

  if (canonicalVendor && !canonicalSupplier) {
    console.log(`    ⚠️ Canonical exists in VENDORS but not SUPPLIERS - consider creating SUPPLIERS entry`);
  }

  console.log(`  ✅ Merge complete for ${keepName}`);
}

async function main() {
  // Tables that reference vendor_id/supplier_id
  const tablesToUpdate = [
    { table: TABLES.PURCHASE_INVOICES, field: "vendor_id" },
    { table: TABLES.PURCHASE_ORDERS, field: "vendor_id" },
    { table: TABLES.GOODS_PURCHASE_ORDERS, field: "supplier_id" },
    { table: TABLES.ADVANCES, field: "vendor_id" },
    { table: TABLES.PAYMENTS, field: "customer_id" },
    { table: TABLES.CREDIT_DEBIT_NOTES, field: "supplier_id" },
    { table: TABLES.INVOICES, field: "supplier_id" },
    { table: TABLES.PRODUCTS, field: "supplier_id" },
    { table: TABLES.STOCK_MOVEMENTS, field: "vendor_id" },
  ];

  const groups = [
    { keep: 'MADECENTRO COLOMBIA S.A.S.', remove: 'MADECENTRO COLOMBIA S.A.S' },
    { keep: 'MAJIC PRODUCTS, INC', remove: 'MAJIC PRODUCTS INC' },
    { keep: 'SAFETY SPEED MANUFACTURING', remove: 'SAFETY SPEED MFG' },
  ];

  console.log('🚀 Starting supplier merge process...\n');

  for (const g of groups) {
    await mergeSupplierGroup(g.keep, g.remove, tablesToUpdate);
  }

  console.log('\n✅ All merges complete!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Merge failed:", err);
    process.exit(1);
  });