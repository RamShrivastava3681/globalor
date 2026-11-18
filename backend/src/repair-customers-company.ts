/**
 * ── Repair Customers Company ID Script ──
 *
 * Purpose: Backfill correct `company_id` on existing customers that have
 * `company_id = null`. This happens when the multi-tenant migration ran
 * and couldn't determine the company for customers (because they don't have
 * a `client_id` field like invoices do).
 *
 * How it works:
 * 1. Scans all invoices and purchase orders to build a map:
 *    customer_id → company_id (using the invoice/PO's company_id)
 * 2. Scans all customers that have null/missing company_id
 * 3. Updates each customer with the inferred company_id from the map
 * 4. Customers with NO references (no invoices/POs) are left as null
 *    and will need manual assignment
 *
 * Run:  npx tsx src/repair-customers-company.ts
 */

import { scanTable, updateItem, TABLES } from "./db/client.js";
import type { Invoice, PurchaseOrder } from "./types/index.js";

// ── Helpers ──

function log(msg: string) {
  console.log(`  ${msg}`);
}

function heading(msg: string) {
  console.log(`\n━━━ ${msg} ━━━`);
}

// ── Step 1: Build customer → company map from invoices ──

async function buildCustomerCompanyMap(): Promise<Map<string, string>> {
  heading("Step 1: Building customer → company map from invoices & purchase orders");

  const map = new Map<string, string>();

  // Scan invoices
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    log(`  Found ${invoices.length} invoices.`);

    for (const inv of invoices) {
      if (inv.customer_id && inv.company_id) {
        // Don't overwrite if already set (first seen wins)
        if (!map.has(inv.customer_id)) {
          map.set(inv.customer_id, inv.company_id);
        }
      }
    }
    log(`  Mapped ${map.size} customers from invoices.`);
  } catch (err) {
    console.error("  ❌ Failed to scan invoices:", err);
  }

  // Also scan purchase orders (they also have customer_id)
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);
    log(`  Found ${orders.length} purchase orders.`);

    for (const po of orders) {
      if (po.customer_id && po.company_id) {
        if (!map.has(po.customer_id)) {
          map.set(po.customer_id, po.company_id);
        }
      }
    }
    log(`  Total mapped: ${map.size} customers (including purchase orders).`);
  } catch (err) {
    console.error("  ❌ Failed to scan purchase orders:", err);
  }

  return map;
}

// ── Step 2: Repair customers with null company_id ──

async function repairCustomers(customerCompanyMap: Map<string, string>) {
  heading("Step 2: Repairing customers with missing company_id");

  let customers: Record<string, any>[] = [];
  try {
    customers = await scanTable(TABLES.CUSTOMERS);
    log(`  Found ${customers.length} total customers.`);
  } catch (err) {
    console.error("  ❌ Failed to scan customers:", err);
    return;
  }

  // Filter customers that need repair
  const toRepair = customers.filter((d) => !d.company_id);
  log(`  Customers with null/missing company_id: ${toRepair.length}`);

  if (toRepair.length === 0) {
    log("  ✅ No customers need repair!");
    return;
  }

  let repaired = 0;
  let skipped = 0;

  for (const customer of toRepair) {
    const companyId = customerCompanyMap.get(customer.id);

    if (companyId) {
      try {
        await updateItem(
          TABLES.CUSTOMERS,
          { id: customer.id },
          { company_id: companyId } as any,
        );
        repaired++;
        log(`  ✅ ${customer.name || customer.id} → company_id: ${companyId}`);
      } catch (err) {
        console.error(`  ❌ Failed to update customer ${customer.id}:`, err);
      }
    } else {
      skipped++;
      log(`  ⚠️  ${customer.name || customer.id} — no invoices/POs found, skipping.`);
    }
  }

  log(`\n  Done: ${repaired} repaired, ${skipped} skipped (no references found).`);
  log(`  Skipped customers will need manual company assignment.`);
}

// ── Main ──

export async function runCustomerRepair() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("   Customer Company ID Repair Script");
  console.log("   Backfills correct company_id on customers");
  console.log("   that were set to null during migration.");
  console.log("═══════════════════════════════════════════════\n");

  const startTime = Date.now();

  try {
    const customerMap = await buildCustomerCompanyMap();
    await repairCustomers(customerMap);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━ Repair complete (${elapsed}s) ━━━\n`);
    return { success: true, elapsed };
  } catch (err) {
    console.error("\n❌ Repair failed:", err);
    return { success: false, error: err };
  }
}

// ── Run directly ──
if (
  process.argv[1]?.endsWith("repair-customers-company.ts") ||
  process.argv[1]?.endsWith("repair-customers-company.js")
) {
  runCustomerRepair()
    .then((result) => {
      if (result.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
