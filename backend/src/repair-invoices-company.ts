/**
 * ── Repair Invoices Company ID Script ──
 *
 * Purpose: Backfill correct `company_id` on existing invoices that have
 * `company_id = null`. This happens when the super admin (whose company_id
 * is stripped to null) creates invoices — the invoice inherits null.
 *
 * How it works:
 * 1. Scans all invoices with null/missing company_id
 * 2. For each, tries to infer company_id from:
 *    a. The invoice's client_id → look up the user → get their company_id
 *    b. The invoice's debtor_id → look up the debtor → get their company_id
 *    c. The invoice's linked purchase orders (via po_number)
 * 3. Updates each invoice with the inferred company_id
 * 4. Reports any invoices that couldn't be repaired
 *
 * Run:  npx tsx src/repair-invoices-company.ts
 */

import { scanTable, getItem, updateItem, TABLES } from "./db/client.js";
import type { Invoice, User, Debtor, PurchaseOrder } from "./types/index.js";

// ── Helpers

function log(msg: string) {
  console.log(`  ${msg}`);
}

function heading(msg: string) {
  console.log(`\n━━━ ${msg} ━━━`);
}

// ── Step 1: Find invoices with null company_id

async function findInvoicesNeedingRepair(): Promise<Invoice[]> {
  heading("Step 1: Finding invoices with null/missing company_id");

  const allInvoices = await scanTable<Invoice>(TABLES.INVOICES);
  log(`  Found ${allInvoices.length} total invoices.`);

  const needingRepair = allInvoices.filter(
    (inv) => !inv.company_id
  );
  log(`  Invoices with null/missing company_id: ${needingRepair.length}`);

  return needingRepair;
}

// ── Step 2: Build lookup maps

async function buildLookupMaps() {
  heading("Step 2: Building lookup maps (users, debtors, purchase orders)");

  const users = await scanTable<User>(TABLES.USERS);
  const userMap = new Map(users.map((u) => [u.id, u]));
  log(`  Loaded ${users.length} users.`);

  const debtors = await scanTable<Debtor>(TABLES.DEBTORS);
  const debtorMap = new Map(debtors.map((d) => [d.id, d]));
  log(`  Loaded ${debtors.length} debtors.`);

  const purchaseOrders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS);
  const poByNumber = new Map(purchaseOrders.map((po) => [po.po_number, po]));
  log(`  Loaded ${purchaseOrders.length} purchase orders.`);

  return { userMap, debtorMap, poByNumber };
}

// ── Step 3: Infer company_id for an invoice

function inferCompanyId(
  invoice: Invoice,
  userMap: Map<string, User>,
  debtorMap: Map<string, Debtor>,
  poByNumber: Map<string, PurchaseOrder>,
): string | null {
  // Priority 1: Look up the client (user) who created the invoice
  if (invoice.client_id) {
    const user = userMap.get(invoice.client_id);
    if (user?.company_id) {
      return user.company_id;
    }
  }

  // Priority 2: Look up the debtor linked to this invoice
  if (invoice.debtor_id) {
    const debtor = debtorMap.get(invoice.debtor_id);
    if (debtor?.company_id) {
      return debtor.company_id;
    }
  }

  // Priority 3: Look up via purchase order number
  if (invoice.po_number) {
    const po = poByNumber.get(invoice.po_number);
    if (po?.company_id) {
      return po.company_id;
    }
  }

  return null;
}

// ── Step 4: Repair invoices

async function repairInvoices(
  invoices: Invoice[],
  userMap: Map<string, User>,
  debtorMap: Map<string, Debtor>,
  poByNumber: Map<string, PurchaseOrder>,
) {
  heading("Step 3: Repairing invoices with missing company_id");

  if (invoices.length === 0) {
    log("  ✅ No invoices need repair!");
    return;
  }

  let repaired = 0;
  let skipped = 0;

  for (const invoice of invoices) {
    const companyId = inferCompanyId(invoice, userMap, debtorMap, poByNumber);

    if (companyId) {
      try {
        await updateItem(
          TABLES.INVOICES,
          { id: invoice.id },
          { company_id: companyId } as any,
        );
        repaired++;
        log(`  ✅ Invoice ${invoice.invoice_number} (${invoice.id.slice(-8)}) → company_id: ${companyId}`);
      } catch (err) {
        console.error(`  ❌ Failed to update invoice ${invoice.id}:`, err);
      }
    } else {
      skipped++;
      log(`  ⚠️  Invoice ${invoice.invoice_number} (${invoice.id.slice(-8)}) — no user/debtor/PO found, skipping.`);
    }
  }

  log(`\n  Done: ${repaired} repaired, ${skipped} skipped (no references found).`);
  log("  Skipped invoices will need manual company assignment.");
}

// ── Main

export async function runInvoiceCompanyRepair() {
  console.log("\n═════════════════════════════════════════════");
  console.log("   Invoice Company ID Repair Script");
  console.log("   Backfills correct company_id on invoices");
  console.log("   that were set to null (super admin created).");
  console.log("═════════════════════════════════════════════\n");

  const startTime = Date.now();

  try {
    const invoices = await findInvoicesNeedingRepair();
    const { userMap, debtorMap, poByNumber } = await buildLookupMaps();
    await repairInvoices(invoices, userMap, debtorMap, poByNumber);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━ Repair complete (${elapsed}s) ━━━\n`);
    return { success: true, elapsed };
  } catch (err) {
    console.error("\n❌ Repair failed:", err);
    return { success: false, error: err };
  }
}

// ── Run directly
if (
  process.argv[1]?.endsWith("repair-invoices-company.ts") ||
  process.argv[1]?.endsWith("repair-invoices-company.js")
) {
  runInvoiceCompanyRepair()
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
