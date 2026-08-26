/**
 * seed-debtors.ts
 *
 * One-shot script to create the following debtors in DynamoDB:
 *   1. CONSORCIO FERRETERO DE SAN JOSE S.A
 *   2. Dromex USA LLC
 *   3. FEBECA C.A.
 *   4. FERRETERIA EPA C.A. (VENEZUELA)
 *   5. FERRETERIA EPA, S.A. (COSTA RICA)
 *   6. FERRETERIA EPA, S.A. (GUATEMALA)
 *   7. FERRETERIA EPA, S.A. DE CV (SALVADOR)
 *   8. OVERSEAS LOGISTICS OPERATIONS
 *   9. TRUPER S.A DE C.V
 *
 * Usage: npx tsx src/seed-debtors.ts
 */
import { scanTable, batchPutItems, TABLES } from "./db/client.js";
import { generateId, nowISO } from "./utils/helpers.js";
import type { Debtor } from "./types/index.js";

const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

const DEBTOR_NAMES = [
  "CONSORCIO FERRETERO DE SAN JOSE S.A",
  "Dromex USA LLC",
  "FEBECA C.A.",
  "FERRETERIA EPA C.A. (VENEZUELA)",
  "FERRETERIA EPA, S.A. (COSTA RICA)",
  "FERRETERIA EPA, S.A. (GUATEMALA)",
  "FERRETERIA EPA, S.A. DE CV (SALVADOR)",
  "OVERSEAS LOGISTICS OPERATIONS",
  "TRUPER S.A DE C.V",
];

async function main() {
  console.log("🔍 Checking existing debtors...\n");

  const existing = await scanTable<Debtor>(TABLES.DEBTORS, {
    company_id: COMPANY_ID,
  });
  const existingNames = new Set(existing.map((d) => d.name));
  console.log(`   Found ${existing.length} existing debtors`);

  const now = nowISO();
  const newDebtors: Debtor[] = [];

  for (const name of DEBTOR_NAMES) {
    if (existingNames.has(name)) {
      console.log(`   ⏭️  "${name}" already exists — skipping`);
      continue;
    }
    newDebtors.push({
      id: generateId(),
      company_id: COMPANY_ID,
      name,
      legal_entity_name: name,
      registration_no: null,
      relationship_since: null,
      industry: null,
      registered_address: null,
      postal_code: null,
      phone: null,
      website: null,
      contact_name: null,
      contact_email: null,
      contact_designation: null,
      contact_phone: null,
      notes: null,
      created_at: now,
      updated_at: now,
    });
  }

  if (newDebtors.length === 0) {
    console.log("\n✅ All debtors already exist — nothing to do.");
    return;
  }

  console.log(`\n💾 Creating ${newDebtors.length} new debtors...`);
  for (let i = 0; i < newDebtors.length; i += 25) {
    const chunk = newDebtors.slice(i, i + 25);
    await batchPutItems(TABLES.DEBTORS, chunk as any);
  }

  console.log("\n✅ Done! Created debtors:");
  for (const d of newDebtors) {
    console.log(`   ✔ ${d.name}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
