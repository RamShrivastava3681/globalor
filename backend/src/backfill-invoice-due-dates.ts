/**
 * backfill-invoice-due-dates.ts
 *
 * Ensures due_date is visible on ALL sales invoices using payment terms = 30 days.
 *
 * - For every invoice where due_date is null/empty, compute:
 *     due_date = issue_date + payment_terms_days (default 30)
 *   per user confirmation: always from issue_date + 30 days.
 * - For every invoice where payment_terms_days is null/0, set it to 30.
 *
 * Usage:
 *   npx tsx src/backfill-invoice-due-dates.ts --dry-run   # preview only
 *   npx tsx src/backfill-invoice-due-dates.ts             # apply updates
 */
import { scanTable, updateItem, TABLES } from "./db/client.js";
import type { Invoice } from "./types/index.js";

const DEFAULT_TERMS = 30;

function addDays(baseISO: string, days: number): string | null {
  if (!baseISO) return null;
  const d = new Date(baseISO);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`🔍 Scanning sales invoices for missing due dates… ${dryRun ? "(DRY RUN)" : "(APPLY MODE)"}\n`);

  const allInv = await scanTable<Invoice>(TABLES.INVOICES);
  console.log(`   Total sales invoices: ${allInv.length}`);

  const needingFix = allInv.filter((inv) => {
    const missingDue = !(inv as any).due_date;
    const terms = Number((inv as any).payment_terms_days);
    const missingTerms = !(terms > 0);
    return missingDue || missingTerms;
  });

  console.log(`   Invoices needing fix (missing due_date OR missing payment_terms): ${needingFix.length}\n`);

  if (needingFix.length === 0) {
    console.log("   ✅ Nothing to fix — all invoices already have due dates.");
    return;
  }

  console.log("   Sample:");
  for (const inv of needingFix.slice(0, 10)) {
    const terms = Number((inv as any).payment_terms_days) > 0 ? Number((inv as any).payment_terms_days) : DEFAULT_TERMS;
    const computed = addDays((inv as any).issue_date ?? "", terms);
    console.log(
      `     • ${inv.invoice_number} | issue: ${(inv as any).issue_date ?? "—"} | due: ${(inv as any).due_date ?? "—"} | terms: ${(inv as any).payment_terms_days ?? "—"} → new due: ${computed ?? "SKIPPED (no issue_date)"} (terms → ${terms})`,
    );
  }
  if (needingFix.length > 10) console.log(`     … and ${needingFix.length - 10} more`);
  console.log();

  if (dryRun) {
    console.log("   DRY RUN — no changes written. Re-run without --dry-run to apply.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const inv of needingFix) {
    const rawTerms = Number((inv as any).payment_terms_days);
    const terms = rawTerms > 0 ? rawTerms : DEFAULT_TERMS;
    const computed = addDays((inv as any).issue_date ?? "", terms);
    if (!computed) {
      skipped++;
      console.log(`   ⚠️  ${inv.invoice_number} — no valid issue_date, skipping.`);
      continue;
    }
    const updates: Record<string, unknown> = {};
    if (!(inv as any).due_date) updates.due_date = computed;
    if (!(rawTerms > 0)) updates.payment_terms_days = DEFAULT_TERMS;
    if (Object.keys(updates).length === 0) continue;
    try {
      await updateItem(TABLES.INVOICES, { id: inv.id }, updates as any);
      updated++;
      process.stdout.write(`   ✅ Updated ${updated}/${needingFix.length} …\r`);
    } catch (err: any) {
      skipped++;
      console.error(`\n   ❌ Failed ${inv.invoice_number}:`, err?.message || err);
    }
  }

  console.log(`\n\n✅ Done — updated ${updated}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
