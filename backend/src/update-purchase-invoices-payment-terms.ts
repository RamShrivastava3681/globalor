import { scanTable, updateItem, TABLES } from "./db/client.js";
import type { PurchaseInvoice } from "./types/index.js";

async function main() {
  console.log("🔍 Scanning all purchase invoices…\n");

  const allPI = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);
  console.log(`   Total purchase invoices in table: ${allPI.length}\n`);

  if (allPI.length === 0) {
    console.log("   No purchase invoices found — exiting.");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const pi of allPI) {
    const currentTerms = pi.payment_terms_days ?? 30;
    const hasContractual = pi.has_contractual_due_date === true;

    if (currentTerms === 60 && !hasContractual) {
      skipped++;
      continue;
    }

    const newTerms = 60;
    const baseDate = pi.due_date_source === "bl" && pi.bl_date
      ? new Date(pi.bl_date)
      : new Date(pi.issue_date);

    const newDueDate = new Date(baseDate);
    newDueDate.setDate(newDueDate.getDate() + newTerms);

    const updates = {
      payment_terms_days: newTerms,
      due_date: hasContractual ? pi.due_date : newDueDate.toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    };

    try {
      await updateItem(TABLES.PURCHASE_INVOICES, { id: pi.id }, updates);
      updated++;
      if (updated % 25 === 0) {
        process.stdout.write(`   🔄 Updated ${updated}/${allPI.length} …\r`);
      }
    } catch (err: any) {
      console.error(`\n   ❌ Failed to update ${pi.invoice_number}:`, err.message || err);
    }
  }

  console.log(`\n\n✅ Done — updated ${updated} purchase invoices to 60-day payment terms, skipped ${skipped} already at 60 days.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});