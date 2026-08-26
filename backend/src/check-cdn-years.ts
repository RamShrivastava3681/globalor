import { scanTable, TABLES } from "./db/client.js";
import type { CreditDebitNote } from "./types/index.js";

async function main() {
  const all = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES);
  const byYear = new Map<string, number>();
  for (const n of all) {
    const y = (n.date ?? n.created_at ?? "").slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  console.log("Credit/debit notes by year:");
  for (const [y, c] of [...byYear.entries()].sort()) {
    console.log(`  ${y}: ${c}`);
  }
}
main();
