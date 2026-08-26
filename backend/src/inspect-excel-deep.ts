import XLSX from "xlsx";

const salesFile = "../sales-invoice-25.xlsx";
const purchaseFile = "../purchase-invoice-2025.xlsx";

function inspectSheet(filePath: string, label: string) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Read raw to preserve layout
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  
  console.log(`\n${"=".repeat(100)}`);
  console.log(`FILE: ${label}`);
  console.log(`${"=".repeat(100)}`);

  // Row 3 (0-indexed row 2) is the header row: Date, Source, Description, Reference, Currency, Debit(Source), Credit(Source), Debit(GBP), Credit(GBP), Running Balance
  // Let's parse with header row index 2
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  // Find all unique Source values and count them
  const sourceCounts = new Map<string, number>();
  const sourceSamples = new Map<string, any[]>();
  const dataRows: any[][] = [];
  
  for (let i = 3; i < raw.length; i++) { // skip first 3 rows (title, period, header)
    const row = raw[i] as unknown as any[];
    if (!row || row.length === 0) continue;
    
    const col0 = String(row[0] ?? "").trim();
    const col1 = String(row[1] ?? "").trim(); // Source
    const col2 = String(row[2] ?? "").trim(); // Description
    const col3 = String(row[3] ?? "").trim(); // Reference
    
    // Skip sub-header rows and total rows
    if (col0 === "Gross Sales" || col0 === "Gross Purchases" || 
        col0 === "Total Gross Sales" || col0 === "Total Gross Purchases" ||
        col0 === "Total" || col0 === "" || col0 === "Date" ||
        col1 === "" && col2 === "" && col3 === "") {
      continue;
    }
    
    // Skip if it looks like a section header (no date)
    if (col0 === "Manual Journal" || col0 === "Credit Note" || col0 === "Debit Note" || 
        col0 === "Sales Invoice" || col0 === "Purchase Invoice") {
      // This is a section sub-header
      console.log(`\n  [Section: ${col0}]`);
      continue;
    }
    
    if (col1) {
      sourceCounts.set(col1, (sourceCounts.get(col1) ?? 0) + 1);
      if (!sourceSamples.has(col1)) {
        sourceSamples.set(col1, []);
      }
      if (sourceSamples.get(col1)!.length < 3) {
        sourceSamples.get(col1)!.push({
          date: col0,
          source: col1,
          description: col2,
          reference: col3,
          currency: row[4],
          debitSource: row[5],
          creditSource: row[6],
          debitGBP: row[7],
          creditGBP: row[8],
          runningBalance: row[9],
        });
      }
    }
    
    dataRows.push(row);
  }

  console.log(`\nTotal data rows: ${dataRows.length}`);
  console.log(`\nSource type breakdown:`);
  for (const [src, count] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  console.log(`\nSamples per source type:`);
  for (const [src, samples] of sourceSamples) {
    console.log(`\n  --- ${src} (${sourceCounts.get(src)} rows) ---`);
    for (const s of samples) {
      console.log(`    ${JSON.stringify(s)}`);
    }
  }
}

inspectSheet(salesFile, "Sales Invoice 2025");
inspectSheet(purchaseFile, "Purchase Invoice 2025");
