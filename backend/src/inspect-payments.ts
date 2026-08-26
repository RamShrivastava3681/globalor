import XLSX from "xlsx";

const wb = XLSX.readFile("sales-payment.xlsx");
console.log("Sheets:", wb.SheetNames.join(", "));

for (const sheetName of wb.SheetNames) {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
  console.log(`Total rows: ${data.length}`);
  
  // Print first 30 rows
  for (let i = 0; i < Math.min(30, data.length); i++) {
    console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
  }
  
  // Print last 5 rows
  if (data.length > 30) {
    console.log(`... (${data.length - 30} more rows) ...`);
    for (let i = Math.max(30, data.length - 5); i < data.length; i++) {
      console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
    }
  }
}
