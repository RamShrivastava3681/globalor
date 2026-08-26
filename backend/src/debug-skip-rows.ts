/**
 * debug-skip-rows.ts
 *
 * Debug which rows were skipped during credit note import.
 */

import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

function excelDateToDate(serial: number): string {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractional = serial - Math.floor(serial);
  const total_seconds = Math.round(86400 * fractional);
  const d = new Date(utc_value * 1000 + total_seconds * 1000);
  return d.toISOString().slice(0, 10);
}

const filePath = path.join(ROOT_DIR, "credit-2024.xlsx");
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

let imported = 0;
let skipped = 0;
const skippedRows: Array<{ row: number; reason: string; data: any[] }> = [];

for (let i = 1; i < raw.length; i++) {
  const row = raw[i];
  if (!row || row.length < 4) {
    skipped++;
    skippedRows.push({ row: i, reason: `row.length < 4 (got ${row?.length})`, data: row });
    continue;
  }

  const col0 = String(row[0] ?? "").trim();
  if (col0 === "Total Gross Purchases" || col0 === "Total" || col0 === "Date") {
    skipped++;
    skippedRows.push({ row: i, reason: `skipped keyword: "${col0}"`, data: row });
    continue;
  }

  const dateSerial = Number(row[0]);
  if (isNaN(dateSerial)) {
    skipped++;
    skippedRows.push({ row: i, reason: `NaN date: "${row[0]}"`, data: row });
    continue;
  }

  const supplierField = String(row[1] ?? "").trim();
  if (!supplierField) {
    skipped++;
    skippedRows.push({ row: i, reason: "empty supplier", data: row });
    continue;
  }

  const noteNumber = String(row[2] ?? "").trim();
  if (!noteNumber) {
    skipped++;
    skippedRows.push({ row: i, reason: "empty note_number", data: row });
    continue;
  }

  const amount = Number(row[3]) || 0;
  if (amount === 0) {
    skipped++;
    skippedRows.push({ row: i, reason: `zero amount: "${row[3]}"`, data: row });
    continue;
  }

  imported++;
}

console.log(`Imported: ${imported}, Skipped: ${skipped}`);
console.log(`\nSkipped rows:`);
for (const s of skippedRows) {
  console.log(`  Row ${s.row}: ${s.reason}`);
  console.log(`    Data: ${JSON.stringify(s.data)}`);
}
