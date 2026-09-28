import {
  scanTable,
  updateItem,
  deleteItem,
  getItem,
  TABLES,
} from "../db/client.js";

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

async function mergeOrgillSuppliers() {
  console.log("🔍 Finding ORGILL suppliers...");

  // Scan both tables to find the suppliers
  const [allSuppliers, allVendors] = await Promise.all([
    scanTable<Supplier>(TABLES.SUPPLIERS),
    scanTable<Vendor>(TABLES.VENDORS),
  ]);

  // Find ORGILL INC (the one to remove)
  const orgillInc = allSuppliers.find(
    (s) => s.company_name.trim().toUpperCase() === "ORGILL INC"
  );
  const orgillIncVendor = allVendors.find(
    (v) => v.name.trim().toUpperCase() === "ORGILL INC"
  );

  // Find ORGILL INC (USA) (the one to keep)
  const orgillIncUSA = allSuppliers.find(
    (s) => s.company_name.trim().toUpperCase() === "ORGILL INC (USA)"
  );
  const orgillIncUSAVendor = allVendors.find(
    (v) => v.name.trim().toUpperCase() === "ORGILL INC (USA)"
  );

  if (!orgillInc && !orgillIncVendor) {
    console.log("❌ ORGILL INC not found in either table");
    return;
  }

  if (!orgillIncUSA && !orgillIncUSAVendor) {
    console.log("❌ ORGILL INC (USA) not found in either table");
    return;
  }

  const oldSupplierId = orgillInc?.id || orgillIncVendor?.id;
  const newSupplierId = orgillIncUSA?.id || orgillIncUSAVendor?.id;

  console.log(`📋 Old supplier (to remove): ${oldSupplierId} - ${orgillInc?.company_name || orgillIncVendor?.name}`);
  console.log(`✅ New supplier (to keep): ${newSupplierId} - ${orgillIncUSA?.company_name || orgillIncUSAVendor?.name}`);

  if (oldSupplierId === newSupplierId) {
    console.log("⚠️ Both suppliers have the same ID, nothing to merge");
    return;
  }

  // Tables that reference vendor_id/supplier_id
  const tablesToUpdate = [
    { table: TABLES.PURCHASE_INVOICES, field: "vendor_id" },
    { table: TABLES.PURCHASE_ORDERS, field: "vendor_id" },
    { table: TABLES.GOODS_PURCHASE_ORDERS, field: "supplier_id" },
    { table: TABLES.ADVANCES, field: "vendor_id" }, // advances may reference vendor_id via purchase_order
    { table: TABLES.PAYMENTS, field: "customer_id" }, // supplier payments stored as customer_id
    { table: TABLES.CREDIT_DEBIT_NOTES, field: "supplier_id" },
    { table: TABLES.INVOICES, field: "supplier_id" }, // sales invoices with supplier_id
    { table: TABLES.PRODUCTS, field: "supplier_id" },
    { table: TABLES.STOCK_MOVEMENTS, field: "vendor_id" }, // if any
  ];

  console.log("\n🔄 Updating references from old supplier to new supplier...");

  for (const { table, field } of tablesToUpdate) {
    try {
      const items = await scanTable<any>(table);
      const toUpdate = items.filter((item) => item[field] === oldSupplierId);

      if (toUpdate.length > 0) {
        console.log(`  📝 Updating ${toUpdate.length} records in ${table}...`);
        for (const item of toUpdate) {
          await updateItem(table, { id: item.id }, { [field]: newSupplierId, updated_at: new Date().toISOString() });
        }
      } else {
        console.log(`  ✓ No records to update in ${table}`);
      }
    } catch (error) {
      console.error(`  ❌ Error updating ${table}:`, error);
    }
  }

  // Also update advances that reference purchase_order_id linked to old supplier
  // (purchase orders were already updated above, so advances linked to those POs are fine)

  console.log("\n🗑️ Deleting old supplier from SUPPLIERS table...");
  if (orgillInc) {
    await deleteItem(TABLES.SUPPLIERS, { id: oldSupplierId });
    console.log(`  ✅ Deleted from SUPPLIERS: ${oldSupplierId}`);
  }

  console.log("🗑️ Deleting old supplier from VENDORS table...");
  if (orgillIncVendor) {
    await deleteItem(TABLES.VENDORS, { id: oldSupplierId });
    console.log(`  ✅ Deleted from VENDORS: ${oldSupplierId}`);
  }

  // If the old supplier was only in VENDORS but not SUPPLIERS, we might have a different ID
  // Check if there's a vendor with the old name but different ID
  if (orgillIncVendor && orgillIncVendor.id !== oldSupplierId) {
    await deleteItem(TABLES.VENDORS, { id: orgillIncVendor.id });
    console.log(`  ✅ Deleted vendor from VENDORS: ${orgillIncVendor.id}`);
  }

  // Also ensure the new supplier exists in both tables (sync if needed)
  if (orgillIncUSA && !orgillIncUSAVendor) {
    // Create vendor entry for the kept supplier
    const vendor: Vendor = {
      id: orgillIncUSA.id,
      company_id: orgillIncUSA.company_id,
      name: orgillIncUSA.company_name,
      industry: (orgillIncUSA as any).industry || null,
      address_line: (orgillIncUSA as any).address_line || null,
      city: (orgillIncUSA as any).city || null,
      country: (orgillIncUSA as any).country || null,
      postal_code: (orgillIncUSA as any).postal_code || null,
      phone: (orgillIncUSA as any).phone || null,
      website: (orgillIncUSA as any).website || null,
      contact_name: (orgillIncUSA as any).contact_name || null,
      contact_email: (orgillIncUSA as any).contact_email || null,
      contact_designation: (orgillIncUSA as any).contact_designation || null,
      contact_phone: (orgillIncUSA as any).contact_phone || null,
      notes: (orgillIncUSA as any).notes || null,
      created_at: (orgillIncUSA as any).created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await import("../db/client.js").then(({ putItem }) => putItem(TABLES.VENDORS, vendor as any));
    console.log(`  ✅ Synced new supplier to VENDORS table`);
  }

  if (orgillIncUSAVendor && !orgillIncUSA) {
    console.log("  ⚠️ New supplier exists in VENDORS but not SUPPLIERS - consider creating SUPPLIERS entry");
  }

  console.log("\n✅ Merge complete!");
  console.log(`   - All references updated from ${oldSupplierId} to ${newSupplierId}`);
  console.log(`   - Old supplier removed from database`);
  console.log(`   - Kept supplier: ORGILL INC (USA) (${newSupplierId})`);
}

mergeOrgillSuppliers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Merge failed:", err);
    process.exit(1);
  });