import XLSX from "xlsx";

const files = [
  "../credit-notes-2026.xlsx",
  "../sales2026-final.xlsx",
  "../sales-2024-year.xlsx",
  "../sales-2025-final.xlsx",
  "../credit-2025.xlsx",
  "../purchase_2026_final.xlsx",
  "../credit-2024.xlsx",
  "../purchase-25-final.xlsx",
  "../purchase-2024-final.xlsx",
  "../debit-notes-2025.xlsx",
  "../debit-2024-final.xlsx",
  "../debit26-final.xlsx",
  "sales-invoice-25.xlsx",
  "purchase-invoice-2025.xlsx",
];

for (const file of files) {
  console.log(`\n\n========== ${file} ==========`);
  try {
    const wb = XLSX.readFile(file);
    console.log("Sheet names:", wb.SheetNames);
    for (const name of wb.SheetNames) {
      if (name.toLowerCase().includes("expense") || name.toLowerCase().includes("finance")) {
        const ws = wb.Sheets[name];
        const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        console.log(`\n=== ${name} (rows: ${raw.length}) ===`);
        for (let i = 0; i < Math.min(15, raw.length); i++) {
          console.log(raw[i]);
        }
      }
    }
  } catch (e) {
    console.log(`Error reading ${file}:`, e);
  }
}