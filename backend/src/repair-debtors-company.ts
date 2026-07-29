/**
 * ── Repair Debtors Company ID Script ──
 *
 * Purpose: Backfill correct `company_id` on existing debtors that have
 * `company_id = null`. This happens when the multi-tenant migration ran
 * and couldn't determine the company for debtors (because they don't have
 * a `client_id` field like invoices do).
 *
 * How it works:
 * 1. Scans all invoices and purchase orders to build a map:
 *    debtor_id → company_id (using the invoice/PO's company_id)
 * 2. Scans all debtors that have null/missing company_id
 * 3. Updates each debtor with the inferred company_id from the map
 * 4. Debtors with NO references (no invoices/POs) are left as null
 *    and will need manual assignment
 *
 * Run:  npx tsx src/repair-debtors-company.ts
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

// ── Step 1: Build debtor → company map from invoices ──

async function buildDebtorCompanyMap(): Promise<Map<string, string>> {
  heading("Step 1: Building debtor → company map from invoices & purchase orders");

  const map = new Map<string, string>();

  // Scan invoices
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    log(`  Found ${invoices.length} invoices.`);

    for (const inv of invoices) {
      if (inv.debtor_id && inv.company_id) {
        // Don't overwrite if already set (first seen wins)
        if (!map.has(inv.debtor_id)) {
          map.set(inv.debtor_id, inv.company_id);
        }
      }
    }
    log(`  Mapped ${map.size} debtors from invoices.`);
  } catch (err) {
    console.error("  ❌ Failed to scan invoices:", err);
  }

  // Also scan purchase orders (they also have debtor_id)
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);
    log(`  Found ${orders.length} purchase orders.`);

    for (const po of orders) {
      if (po.debtor_id && po.company_id) {
        if (!map.has(po.debtor_id)) {
          map.set(po.debtor_id, po.company_id);
        }
      }
    }
    log(`  Total mapped: ${map.size} debtors (including purchase orders).`);
  } catch (err) {
    console.error("  ❌ Failed to scan purchase orders:", err);
  }

  return map;
}

// ── Step 2: Repair debtors with null company_id ──

async function repairDebtors(debtorCompanyMap: Map<string, string>) {
  heading("Step 2: Repairing debtors with missing company_id");

  let debtors: Record<string, any>[] = [];
  try {
    debtors = await scanTable(TABLES.DEBTORS);
    log(`  Found ${debtors.length} total debtors.`);
  } catch (err) {
    console.error("  ❌ Failed to scan debtors:", err);
    return;
  }

  // Filter debtors that need repair
  const toRepair = debtors.filter((d) => !d.company_id);
  log(`  Debtors with null/missing company_id: ${toRepair.length}`);

  if (toRepair.length === 0) {
    log("  ✅ No debtors need repair!");
    return;
  }

  let repaired = 0;
  let skipped = 0;

  for (const debtor of toRepair) {
    const companyId = debtorCompanyMap.get(debtor.id);

    if (companyId) {
      try {
        await updateItem(
          TABLES.DEBTORS,
          { id: debtor.id },
          { company_id: companyId } as any,
        );
        repaired++;
        log(`  ✅ ${debtor.name || debtor.id} → company_id: ${companyId}`);
      } catch (err) {
        console.error(`  ❌ Failed to update debtor ${debtor.id}:`, err);
      }
    } else {
      skipped++;
      log(`  ⚠️  ${debtor.name || debtor.id} — no invoices/POs found, skipping.`);
    }
  }

  log(`\n  Done: ${repaired} repaired, ${skipped} skipped (no references found).`);
  log(`  Skipped debtors will need manual company assignment.`);
}

// ── Main ──

export async function runDebtorRepair() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("   Debtor Company ID Repair Script");
  console.log("   Backfills correct company_id on debtors");
  console.log("   that were set to null during migration.");
  console.log("═══════════════════════════════════════════════\n");

  const startTime = Date.now();

  try {
    const debtorMap = await buildDebtorCompanyMap();
    await repairDebtors(debtorMap);

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
  process.argv[1]?.endsWith("repair-debtors-company.ts") ||
  process.argv[1]?.endsWith("repair-debtors-company.js")
) {
  runDebtorRepair()
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
