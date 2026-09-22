/**
 * import-bulk-payment-history.ts
 *
 * Display-only import of bulk-payment history from a DynamoDB CSV export
 * (e.g. results (1).csv) into the PAYMENTS table.
 *
 * - Writes ONLY to PAYMENTS. Never touches INVOICES (no close / no partial pay).
 * - Maps debtor_id -> customer_id, converts DynamoDB-typed closed_invoices /
 *   partial_invoices JSON into plain objects for the payment-history UI.
 * - Skips rows whose id already exists (idempotent re-runs).
 *
 * Usage:
 *   npx tsx src/import-bulk-payment-history.ts "C:\Users\ramsh\Downloads\results (1).csv" [--dry-run]
 */
import fs from "node:fs";
import { getItem, putItem, TABLES } from "./db/client.js";

const VALID_MODES = new Set(["manual", "fifo", "two_pass_fifo", "on_account"]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? "";
    });
    return row;
  });
}

/** Convert DynamoDB-typed list JSON to plain invoice entries. */
function parseInvoiceList(raw: string): Array<{ id: string; invoice_number: string; amount: number; amount_paid?: number }> {
  if (!raw || !raw.trim()) return [];
  const trimmed = raw.trim();
  if (trimmed === "[]") return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry: any) => {
        const m = entry?.M ?? entry;
        if (!m) return null;
        const str = (v: any) => v?.S ?? v?.s ?? (typeof v === "string" ? v : undefined);
        const num = (v: any) => {
          if (v?.N != null) return Number(v.N);
          if (typeof v === "number") return v;
          if (typeof v === "string" && v !== "") return Number(v);
          return undefined;
        };
        const id = str(m.id) ?? "";
        const invoice_number = str(m.invoice_number) ?? "";
        const amount = num(m.amount) ?? num(m.amount_paid) ?? 0;
        const amount_paid = num(m.amount_paid);
        if (!id && !invoice_number) return null;
        return { id, invoice_number, amount, ...(amount_paid != null ? { amount_paid } : {}) };
      })
      .filter(Boolean) as Array<{ id: string; invoice_number: string; amount: number; amount_paid?: number }>;
  } catch (err) {
    console.error(`    ⚠️  Could not parse invoice list JSON (${trimmed.slice(0, 80)}…):`, (err as Error).message);
    return [];
  }
}

function parseStringList(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw.trim());
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!filePath) {
    console.error('Usage: npx tsx src/import-bulk-payment-history.ts "<path-to-csv>" [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`📄 Reading ${filePath} ${dryRun ? "(DRY RUN)" : "(APPLY MODE)"}\n`);
  const rows = parseCsv(fs.readFileSync(filePath, "utf-8"));
  console.log(`   Rows in CSV: ${rows.length}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const [idx, row] of rows.entries()) {
    const id = (row.id ?? "").trim();
    if (!id) {
      errors++;
      console.log(`   ⚠️  Row ${idx + 1}: missing id, skipping.`);
      continue;
    }
    try {
      const existing = await getItem(TABLES.PAYMENTS, { id });
      if (existing) {
        skipped++;
        continue;
      }

      const closedRaw = parseInvoiceList(row.closed_invoices ?? "");
      const partialRaw = parseInvoiceList(row.partial_invoices ?? "");
      const mode = VALID_MODES.has((row.mode ?? "").trim()) ? (row.mode.trim() as any) : "two_pass_fifo";
      const customerId = (row.debtor_id ?? "").trim();
      if (!customerId) {
        errors++;
        console.log(`   ⚠️  Row ${idx + 1} (${id}): missing debtor_id, skipping.`);
        continue;
      }

      const record: Record<string, unknown> = {
        id,
        client_id: (row.client_id ?? "").trim(),
        company_id: (row.company_id ?? "").trim() || null,
        customer_id: customerId,
        debtor_id: customerId,
        amount: Number(row.amount) || 0,
        payment_date: (row.payment_date ?? "").trim(),
        remaining: Number(row.remaining) || 0,
        invoices_closed: Number(row.invoices_closed) || closedRaw.length,
        closed_invoices: closedRaw.map((c) => ({ id: c.id, invoice_number: c.invoice_number, amount: c.amount })),
        partial_invoices: partialRaw.map((p) => ({
          id: p.id,
          invoice_number: p.invoice_number,
          amount_paid: p.amount_paid ?? p.amount ?? 0,
        })),
        credit_note_ids: parseStringList(row.credit_note_ids ?? ""),
        mode,
        created_at: (row.created_at ?? "").trim(),
        updated_at: (row.updated_at ?? "").trim() || (row.created_at ?? "").trim(),
      };

      if (dryRun) {
        if (idx < 3) {
          console.log(
            `     • ${id} | amount: ${record.amount} | date: ${record.payment_date} | closed: ${(record.closed_invoices as any[]).length} | partial: ${(record.partial_invoices as any[]).length} | remaining: ${record.remaining}`,
          );
        }
        inserted++;
      } else {
        await putItem(TABLES.PAYMENTS, record as any);
        inserted++;
        if (inserted % 10 === 0) process.stdout.write(`   ✅ Inserted ${inserted}/${rows.length} …\r`);
      }
    } catch (err: any) {
      errors++;
      console.error(`\n   ❌ Row ${idx + 1} (${id}):`, err?.message || err);
    }
  }

  if (dryRun) {
    console.log(`\n   DRY RUN — would insert ${inserted}, skip-existing ${skipped}, errors ${errors}. No changes written.`);
    console.log("   NOTE: this import writes ONLY to PAYMENTS (history display). No invoices are closed.");
  } else {
    console.log(`\n\n✅ Done — inserted ${inserted}, already-existed (skipped) ${skipped}, errors ${errors}.`);
    console.log("   Invoices were NOT touched (display-only history import).");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
