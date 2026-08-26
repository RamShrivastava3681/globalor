/**
 * verify-2024-totals.ts
 *
 * Reads credit-2024.xlsx and debit-2024-final.xlsx and shows their
 * total/summary rows for verification.
 */

import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

function readFileTotals(filePath: string, label: string) {
  console.log(`\n📄 ${label}: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  // Show header
  if (raw.length > 0) {
    console.log(`   Header: ${JSON.stringify(raw[0])}`);
  }

  // Show all rows to find totals
  let sumAmount = 0;
  let count = 0;
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length < 4) continue;

    const col0 = String(row[0] ?? "").trim();
    const amount = Number(row[3]) || 0;

    // Show summary/total rows
    if (col0.toLowerCase().includes("total") || col0.toLowerCase().includes("gross")) {
      console.log(`   Row ${i}: ${JSON.stringify(row)}`);
    }

    if (!isNaN(Number(row[0])) && amount !== 0) {
      sumAmount += amount;
      count++;
    }
  }

  console.log(`   Computed: ${count} data rows, sum = $${sumAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Also show last few rows (often totals)
  console.log(`   Last 5 rows:`);
  for (let i = Math.max(1, raw.length - 5); i < raw.length; i++) {
    console.log(`     Row ${i}: ${JSON.stringify(raw[i])}`);
  }
}

readFileTotals(path.join(ROOT_DIR, "credit-2024.xlsx"), "Credit Notes");
readFileTotals(path.join(ROOT_DIR, "debit-2024-final.xlsx"), "Debit Notes");
