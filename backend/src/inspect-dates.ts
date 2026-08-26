import XLSX from "xlsx";

// Excel serial date to ISO date string
function excelDateToISO(serial: number): string {
  // Excel uses 1900 date system (with the leap year bug)
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const fractionalDay = serial - Math.floor(serial);
  const totalSeconds = Math.round(86400 * fractionalDay);
  const d = new Date(utc_value * 1000);
  // Add fractional day
  d.setSeconds(d.getSeconds() + totalSeconds);
  return d.toISOString().slice(0, 10);
}

const salesFile = "../sales-invoice-25.xlsx";
const purchaseFile = "../purchase-invoice-2025.xlsx";

function inspectDates(filePath: string, label: string) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true });

  console.log(`\n=== ${label} — Date samples ===`);
  for (let i = 3; i < Math.min(20, raw.length); i++) {
    const row = raw[i];
    if (!row || !row[1]) continue;
    const dateSerial = row[0];
    if (typeof dateSerial === "number") {
      console.log(`  Serial: ${dateSerial} → ISO: ${excelDateToISO(dateSerial)} | Source: ${row[1]} | Ref: ${row[3]}`);
    }
  }
  
  // Check some credit notes / manual journals
  console.log(`\n  Looking for special rows...`);
  for (let i = 3; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[1]) continue;
    const src = String(row[1]);
    if (src.includes("Credit Note") || src.includes("Manual Journal")) {
      const dateSerial = row[0];
      console.log(`  Serial: ${dateSerial} → ISO: ${excelDateToISO(dateSerial)} | Source: ${src} | Ref: ${row[3]} | Desc: ${String(row[2]).slice(0, 60)}`);
    }
  }
}

inspectDates(salesFile, "Sales");
inspectDates(purchaseFile, "Purchase");

// Also check: what's the conversion rate between source and GBP?
console.log("\n\n=== Conversion rate check ===");
const wb = XLSX.readFile(salesFile);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true });

let totalSource = 0, totalGBP = 0, count = 0;
for (let i = 3; i < raw.length; i++) {
  const row = raw[i];
  if (!row || row[1] !== "Receivable Invoice") continue;
  const src = Number(row[6] || 0); // Credit(Source)
  const gbp = Number(row[8] || 0); // Credit(GBP)
  if (src > 0 && gbp > 0) {
    totalSource += src;
    totalGBP += gbp;
    count++;
    if (count <= 5) {
      console.log(`  Source: ${src} → GBP: ${gbp} | Rate: ${(src/gbp).toFixed(4)}`);
    }
  }
}
console.log(`  Total Source: ${totalSource.toFixed(2)} → Total GBP: ${totalGBP.toFixed(2)} | Avg Rate: ${(totalSource/totalGBP).toFixed(4)} | Rows: ${count}`);
console.log(`  Using 1.3535: ${totalSource.toFixed(2)} / 1.3535 = ${(totalSource/1.3535).toFixed(2)}`);
