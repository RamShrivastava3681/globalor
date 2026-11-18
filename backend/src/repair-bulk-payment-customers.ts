/**
 * repair-bulk-payment-customers.ts
 *
 * The display-only bulk-payment import wrote the OLD Dynamo `debtor_id` into
 * PAYMENTS.customer_id / debtor_id. Live invoices + the customer master now use
 * NEW customer_ids (sales re-imports mint fresh ids), so history shows "Unknown"
 * and `?customer_id=<new-id>` filtering misses those rows.
 *
 * This script permanently remaps stale payment rows:
 *  - Builds invoice_number (lower-trimmed) -> current customer/vendor party maps
 *    from the live INVOICES / PURCHASE_INVOICES tables.
 *  - For each PAYMENTS row whose customer_id does NOT resolve to a live
 *    customer/vendor, takes a majority vote across its linked
 *    closed_invoices + partial_invoices invoice_numbers.
 *  - Updates the row: customer_id = resolved current id (vendor_xxx shape for
 *    AP rows), debtor_id preserved as legacy (sales rows), customer_name
 *    denormalized, updated_at bumped.
 *  - Rows already resolving, or with no linked invoices / no majority, are left
 *    untouched (the history endpoint still resolves them at read time).
 *
 * Usage:
 *   npx tsx src/repair-bulk-payment-customers.ts [--dry-run] [--company-id <id>]
 */

import { scanTable, updateItem, TABLES } from "./db/client.js";
import { scanCustomersMerged } from "./utils/customers.js";
import { nowISO } from "./utils/helpers.js";
import type { Invoice, PurchaseInvoice, PaymentRecord } from "./types/index.js";

const normNum = (n: unknown) => String(n ?? "").trim().toLowerCase();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const companyIdx = process.argv.indexOf("--company-id");
  const companyId = companyIdx >= 0 ? process.argv[companyIdx + 1] : undefined;
  const companyFilter = companyId
    ? { filterExpression: "company_id = :cid", expressionAttributeValues: { ":cid": companyId } }
    : undefined;

  console.log(`\nRepairing bulk-payment customer links ${dryRun ? "(DRY RUN)" : "(APPLY MODE)"}`);

  const [debtorsAndCustomers, vendors, invoices, purchaseInvoices, payments] = await Promise.all([
    scanCustomersMerged(companyFilter as any).catch(() => []),
    scanTable<{ id: string; name: string }>(TABLES.VENDORS, companyFilter as any).catch(() => []),
    scanTable<Invoice>(TABLES.INVOICES, companyFilter as any).catch(() => [] as Invoice[]),
    scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES, companyFilter as any).catch(() => [] as PurchaseInvoice[]),
    scanTable<PaymentRecord>(TABLES.PAYMENTS, companyFilter as any),
  ]);

  const customerById = new Map(debtorsAndCustomers.map((d: any) => [String(d.id).trim(), d.name]));
  const vendorById = new Map(vendors.map((v: any) => [String(v.id).trim(), v.name]));
  const knownIds = new Set([...customerById.keys(), ...[...vendorById.keys()].flatMap((id) => [id, `vendor_${id}`, `supplier_${id}`])]);

  const salesNumToParty = new Map<string, string>();
  const salesNumToName = new Map<string, string>();
  for (const inv of invoices) {
    const partyId = String((inv as any).customer_id ?? (inv as any).debtor_id ?? "").trim();
    const key = normNum((inv as any).invoice_number);
    if (!key || !partyId || salesNumToParty.has(key)) continue;
    salesNumToParty.set(key, partyId);
    salesNumToName.set(key, customerById.get(partyId) ?? (inv as any).customer_name ?? (inv as any).debtor_name ?? "");
  }
  const purchaseNumToParty = new Map<string, string>();
  const purchaseNumToName = new Map<string, string>();
  for (const inv of purchaseInvoices) {
    const partyId = String((inv as any).vendor_id ?? (inv as any).supplier_id ?? "").trim();
    const key = normNum((inv as any).invoice_number);
    if (!key || !partyId || purchaseNumToParty.has(key)) continue;
    purchaseNumToParty.set(key, partyId);
    purchaseNumToName.set(key, vendorById.get(partyId) ?? (inv as any).vendor_name ?? (inv as any).supplier_name ?? "");
  }

  console.log(`  Payments: ${payments.length} | customers: ${customerById.size} | sales invoices: ${invoices.length} | purchase: ${purchaseInvoices.length}`);

  let remapped = 0;
  let nameOnly = 0;
  let alreadyOk = 0;
  let unresolvable = 0;

  for (const p of payments) {
    const pid = String(p.customer_id ?? "").trim();
    const stored = String((p as any).customer_name ?? "").trim();
    const resolves = pid && knownIds.has(pid);
    const isAP = pid.startsWith("vendor_") || pid.startsWith("supplier_");

    // Majority vote across linked invoice_numbers -> current party
    const votes = new Map<string, { count: number; name?: string }>();
    const entries: Array<any> = [...((p.closed_invoices ?? []) as any[]), ...(((p as any).partial_invoices ?? []) as any[])];
    for (const e of entries) {
      const nk = normNum(e?.invoice_number);
      if (!nk) continue;
      const party = !isAP ? salesNumToParty.get(nk) ?? purchaseNumToParty.get(nk) : purchaseNumToParty.get(nk);
      if (!party) continue;
      const nm = (!isAP ? salesNumToName.get(nk) : undefined) ?? purchaseNumToName.get(nk) ?? customerById.get(party) ?? vendorById.get(party);
      const key = purchaseNumToParty.get(nk) && !/^(vendor_|supplier_)/.test(party) ? `vendor_${party}` : party;
      const v = votes.get(key) ?? { count: 0, name: nm || undefined };
      v.count += 1;
      if (!v.name && nm) v.name = nm;
      votes.set(key, v);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [k, v] of votes) {
      if (v.count > bestCount) {
        best = k;
        bestCount = v.count;
      }
    }
    const bestName = best ? votes.get(best)?.name ?? customerById.get(best.replace(/^(vendor_|supplier_)/, "")) ?? vendorById.get(best.replace(/^(vendor_|supplier_)/, "")) : undefined;

    if (resolves && stored && stored !== "Unknown") {
      alreadyOk++;
      continue;
    }

    if (!best) {
      unresolvable++;
      if (unresolvable <= 10) console.log(`  ⚠️  ${p.id.slice(0, 8)}… amount ${(p as any).amount} — no invoice_number match (old debtor ${pid.slice(0, 8)}…, ${entries.length} linked invoices)`);
      continue;
    }

    const needsRemap = !resolves && best !== pid;
    const needsName = !stored || stored === "Unknown" || stored !== bestName;
    if (!needsRemap && !needsName) {
      alreadyOk++;
      continue;
    }

    if (dryRun) {
      if (remapped + nameOnly < 10) {
        console.log(`  • ${p.id.slice(0, 8)}… ${pid.slice(0, 8)}… → ${best.slice(0, 12)}… "${bestName}" ${needsRemap ? "[remap]" : "[name-only]"}`);
      }
      if (needsRemap) remapped++;
      else nameOnly++;
      continue;
    }

    const legacyDebtor = String((p as any).debtor_id ?? pid ?? "").trim();
    await updateItem(TABLES.PAYMENTS, { id: p.id }, {
      ...(needsRemap ? { customer_id: best, debtor_id: isAP ? (p as any).debtor_id ?? null : legacyDebtor } : {}),
      ...(bestName ? { customer_name: bestName } : {}),
      updated_at: nowISO(),
    } as any);
    if (needsRemap) remapped++;
    else nameOnly++;
  }

  console.log(`\n${dryRun ? "DRY RUN — " : ""}Done: ${remapped} remapped to current customer_id, ${nameOnly} name-only backfills, ${alreadyOk} already ok, ${unresolvable} unresolvable (no invoice_number match).`);
  if (dryRun) console.log("  Re-run without --dry-run to apply.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
