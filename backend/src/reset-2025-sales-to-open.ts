/**
 * reset-2025-sales-to-open.ts
 *
 * Resets every sales invoice with issue_date >= 2025-01-01 to open/unpaid
 * and wipes the bulk-payment history (PAYMENTS table).
 *
 * Invoice reopen mirrors the canonical reverse logic in
 * routes/bulkPayments.ts (reverseSalesInvoice):
 *   - status -> "overdue" when due_date < today, else "approved"
 *   - amount_received / paid_date / receipt_date / late_days -> null
 *   - short_payment / paid_note -> null, payment_type attribute removed
 *
 * Usage:
 *   npx tsx src/reset-2025-sales-to-open.ts --dry-run   # preview, no writes
 *   npx tsx src/reset-2025-sales-to-open.ts             # apply
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  scanTable,
  batchDeleteItems,
  updateItem,
  docClient,
  TABLES,
} from "./db/client.js";
import { nowISO } from "./utils/helpers.js";
import type { Invoice, PaymentRecord } from "./types/index.js";

const CUTOFF = "2025-01-01";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const now = nowISO();
  const today = now.slice(0, 10);

  console.log(
    `🔍 Scanning sales invoices with issue_date >= ${CUTOFF} ${dryRun ? "(DRY RUN)" : "(APPLY MODE)"}\n`,
  );

  const allInv = await scanTable<Invoice>(TABLES.INVOICES);
  console.log(`   Total sales invoices in table: ${allInv.length}`);

  const targets = allInv.filter(
    (inv) => (inv.issue_date ?? "") >= CUTOFF,
  );
  console.log(`   Matched for reset (issue_date >= ${CUTOFF}): ${targets.length}`);

  const alreadyOpen = targets.filter(
    (inv) =>
      inv.status !== "paid" &&
      inv.status !== "funded" &&
      inv.amount_received == null &&
      inv.paid_date == null,
  ).length;
  const paidLike = targets.length - alreadyOpen;
  console.log(`   Already open/unpaid: ${alreadyOpen} | paid/partially-paid to reset: ${paidLike}\n`);

  if (targets.length > 0) {
    console.log("   Sample matched invoices:");
    for (const inv of targets.slice(0, 10)) {
      console.log(
        `     • ${inv.invoice_number} | issue: ${inv.issue_date} | due: ${inv.due_date ?? "-"} | status: ${inv.status} | received: ${inv.amount_received ?? "null"}`,
      );
    }
    if (targets.length > 10) console.log(`     … and ${targets.length - 10} more`);
    console.log();
  }

  let reopened = 0;
  let skipped = 0;
  let errors = 0;

  if (!dryRun) {
    for (const inv of targets) {
      const isOverdue = inv.due_date != null && inv.due_date < today;
      try {
        await updateItem(
          TABLES.INVOICES,
          { id: inv.id },
          {
            status: isOverdue ? "overdue" : "approved",
            amount_received: null,
            paid_date: null,
            receipt_date: null,
            short_payment: null,
            late_days: null,
            paid_note: null,
            updated_at: now,
          },
        );
        // Fully reset: drop the payment_type marker (bulk_pay / treasury_pay / …)
        // so the invoice reads as never-paid. REMOVE is a no-op when absent.
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLES.INVOICES,
              Key: { id: inv.id },
              UpdateExpression: "REMOVE payment_type",
            }),
          );
        } catch {
          /* non-fatal — payment_type stays as-is */
        }
        reopened++;
        if (reopened % 50 === 0 || reopened === targets.length)
          process.stdout.write(`   ✅ Reopened ${reopened}/${targets.length} …\r`);
      } catch (err: any) {
        errors++;
        console.error(`\n   ❌ ${inv.invoice_number} (${inv.id}):`, err?.message || err);
      }
    }
    console.log(`\n   Invoices reopened: ${reopened}, errors: ${errors}, skipped: ${skipped}`);
  } else {
    console.log(
      `   DRY RUN — would reopen ${targets.length} invoices (overdue vs approved decided per due_date at apply time). No changes written.`,
    );
  }

  // ── Bulk payment history ──
  console.log(`\n🔍 Scanning bulk-payment history (${TABLES.PAYMENTS})…`);
  const allPayments = await scanTable<PaymentRecord>(TABLES.PAYMENTS);
  console.log(`   Payment records in table: ${allPayments.length}`);

  if (allPayments.length > 0) {
    console.log("   Sample payment records:");
    for (const p of allPayments.slice(0, 5)) {
      console.log(
        `     • ${p.id} | date: ${p.payment_date} | amount: ${p.amount} | closed: ${p.closed_invoices?.length ?? 0} | partial: ${p.partial_invoices?.length ?? 0}`,
      );
    }
    if (allPayments.length > 5) console.log(`     … and ${allPayments.length - 5} more`);
    console.log();
  }

  let deleted = 0;
  if (!dryRun && allPayments.length > 0) {
    const keys = allPayments.map((p) => ({ id: p.id }));
    for (let i = 0; i < keys.length; i += 25) {
      try {
        await batchDeleteItems(TABLES.PAYMENTS, keys.slice(i, i + 25));
        deleted += Math.min(25, keys.length - i);
        process.stdout.write(`   🗑️  Deleted ${deleted}/${keys.length} …\r`);
      } catch (err: any) {
        console.error(`\n   ❌ Batch delete failed at offset ${i}:`, err?.message || err);
      }
    }
    console.log(`\n   Payment records deleted: ${deleted}`);
  } else if (dryRun) {
    console.log(
      `   DRY RUN — would delete ${allPayments.length} payment records (entire history). No changes written.`,
    );
  } else {
    console.log("   Nothing to delete.");
  }

  // ── Verify ──
  if (!dryRun) {
    console.log("\n🔎 Verifying…");
    const [verifyInv, verifyPay] = await Promise.all([
      scanTable<Invoice>(TABLES.INVOICES),
      scanTable<PaymentRecord>(TABLES.PAYMENTS),
    ]);
    const remaining = verifyInv.filter((inv) => (inv.issue_date ?? "") >= CUTOFF);
    const stillPaid = remaining.filter(
      (inv) => inv.status === "paid" || inv.paid_date != null || inv.amount_received != null,
    );
    console.log(`   Invoices in range: ${remaining.length} | still showing paid data: ${stillPaid.length}`);
    console.log(`   Payment records remaining: ${verifyPay.length}`);
    if (stillPaid.length > 0) {
      console.log("   ⚠️  Still-paid sample:");
      for (const inv of stillPaid.slice(0, 5))
        console.log(`     • ${inv.invoice_number} | status: ${inv.status} | received: ${inv.amount_received ?? "null"} | paid_date: ${inv.paid_date ?? "null"}`);
    } else {
      console.log("   ✅ All in-range invoices are open/unpaid.");
    }
    if (verifyPay.length === 0) console.log("   ✅ Bulk-payment history cleared.");
    else console.log(`   ⚠️  ${verifyPay.length} payment records remain — re-run or inspect.`);
  }

  console.log(dryRun ? "\n✅ DRY RUN complete — no changes written." : "\n✅ Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
