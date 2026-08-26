/**
 * seed-suppliers.ts
 *
 * One-shot script to create the specified suppliers in DynamoDB.
 * Usage: npx tsx src/seed-suppliers.ts
 */
import { scanTable, batchPutItems, TABLES } from "./db/client.js";
import { generateId, nowISO } from "./utils/helpers.js";
import type { Supplier } from "./types/index.js";

const COMPANY_ID = "1784619121925-2c0baeaf"; // Globalor

const SUPPLIER_NAMES = [
  "A/LOYDGB2L LLOYDS BANK PLC",
  "ABRASIVOS DE COLOMBIA S.A.",
  "AMIG (Amilibia Y De La Iglesia)",
  "ARBORIT SAS",
  "ARTEVASI S.A.",
  "ASSA ABLOY AMERICAS INTERNATIONAL LOGISTIC",
  "ASSA ABLOY AMERICAS RESIDENTIAL INC.",
  "ASSA ABLOY GUATEMALA S.A",
  "BALLYMORE COMPANY INC",
  "BAMERICA CORPORATION",
  "BEST HARDWARE BUY CORP",
  "BETTAMARK COMERCIO EXTERIOR LTDA",
  "BLACK AND DECKER",
  "CAPSHIRE (UK) LLP",
  "CATA ELECTRODOMESTICOS, S.L.(ESPAÑA)",
  "CECOTEC INNOVACIONES S.L",
  "CERAMICA DE BOIALVO, LDA",
  "Chalfen Corporate Limited",
  "CHAR-BROIL, LLC",
  "CIRTA DESIGN SA",
  "CLEVA INTERNATIONAL TRADING LIMITED",
  "COLCERAMICA SAS",
  "COMACCORD (XIAMEN) BUILDING MATERIAL CO., LTD",
  "COMERCIALIZADORA INTERNACIONAL SMART PROJECT SAS",
  "COMPANY 2416 LLC (CORPORACION)",
  "CONSOLIDADOS OCHOCIENTOS SIETE DE COSTA RICA S.A.",
  "COOL COMPANY S.A.",
  "CORTINEROS LIDER SA",
  "Cosmmac Media Mercado S.L.",
  "DELTA PLUS CENTROAMERICANA, S.A.",
  "DEMÓBILE INDÚSTRIA DE MÓVEIS LTDA",
  "DISTRIBUCIONES GLOBALES S.A",
  "EINHELL COLOMBIA SAS",
  "EINHELL GERMANY AG",
  "FERRETERIA EPA C.A. (VENEZUELA)",
  "FERRETERIA EPA, S.A. (COSTA RICA)",
  "FERRETERIA EPA, S.A. (GUATEMALA)",
  "FERRETERIA EPA, S.A. DE CV (SALVADOR)",
  "FOTO ELECTRIC SUPPLY CO. (FESCO)",
  "GBR CORPORATION LTD",
  "GLOBAL REJILLAS SAS (REJICOL)",
  "GLOBALMARKET ENTERPRISE S.A.",
  "Grupo Servica de Costa Rica, S.A.",
  "HANSI ANHAI FAR EAST LTD",
  "HARMONY INTERNATIONAL LTD.",
  "HDS TRADING CORP",
  "HUMEX S A (USA)",
  "HUNTER FAN COMPANY",
  "IBI INTERNACIONAL AB",
  "IDEAS PROMOCIONALES, C.A.",
  "ILLUMAX CHINA LIMITED",
  "ILUMINACIONES TECNICAS, S.A",
  "IN OCEAN LOGISTICS",
  "INDUMA SAS",
  "INDUSTRIAS ESTRA S.A",
  "INF AML",
  "INTERDESIGN INC",
  "INTERPORT LOGISTICS LLC.",
  "JMAT Group Limited",
  "KAEMINGK BV",
  "KENNEY MANUFACTURING",
  "KOOPMAN INTERNATIONAL B.V.",
  "KRONOFLOORING GMBH",
  "KRONOSPAN S.L.",
  "Kuehne Nagel",
  "Kwb Germany GmbH",
  "LOGISTICA AIRE MAR COSTA RICA, S.A.",
  "LOGISTICA INTEGRADA CA. LINC, S.A.",
  "MADECENTRO COLOMBIA S.A.S.",
  "MAJIC PRODUCTS, INC",
  "Manual Journal",
  "Marsh Commercial",
  "MARTIPLAST INDUSTRIA E COMERCIO DE PLASTICOS LTDA",
  "MATRIX INDUSTRIA E COMERCIO DE MOVEIS LTDA",
  "MEDITERRANEA DE PRODUCTOS DE LIMPIEZA S.R.L.",
  "MELENCO HOLDING LIMITED",
  "Mizunara Group Limited",
  "MOEN INCORPORATED KINSTON",
  "MORE PRODUCTS S.A.S",
  "NEW SPACE INC",
  "ORGILL INC (USA)",
  "OVERSEAS LOGISTICS OPERATIONS, S.A.",
  "PIÑA STUDIO CB",
  "PLASTICOS ALAI, S.A",
  "PLASTICOS MQ COLOMBIA",
  "PLASTICOS RIMAX SAS",
  "POLYCAR DE MEXICO S.A DE CV",
  "PRAT-K INDÚSTRIA E COMÉRCIO DE MÓVEIS E UTILIDADES LTDA.",
  "QINGDAO FORTUNE WOOD PRODUCTS CO. LTD",
  "Rehau S.A. de C.V.",
  "RICHELIEU GLENDALE HEIGHTS",
  "RICHELIEU HARDWARE CANADA LTD",
  "ROBERT BOSCH PANAMÁ COLÓN S.A.",
  "RTA DESING ZONA FRANCA SAS",
  "SAFETY SPEED MANUFACTURING",
  "SAFETY SPEED MFG",
  "SEGURIMAX TRADING S.A",
  "SHEFFA INTERNACIONAL LLC TURNBERRY",
  "SMART St Limited",
  "SPARX LOGISTICS COSTA RICA SOCIEDAD ANONIMA",
  "SPECTRUM BRANDS, INC.",
  "TERMOLAR S.A",
  "UJUETA TRADING CORPORATION",
  "VSI INDUSTRIAL SAC",
  "WAYBAR TRADING LIMITED",
  "YALE IMPORT COSTA RICA SRL",
];

async function main() {
  console.log("🔍 Checking existing suppliers...\n");

  const existing = await scanTable<Supplier>(TABLES.SUPPLIERS, {
    company_id: COMPANY_ID,
  });
  const existingNames = new Set(existing.map((s) => s.company_name));
  console.log(`   Found ${existing.length} existing suppliers`);

  const now = nowISO();
  const newSuppliers: Supplier[] = [];

  for (const name of SUPPLIER_NAMES) {
    if (existingNames.has(name)) {
      console.log(`   ⏭️  "${name}" already exists — skipping`);
      continue;
    }
    newSuppliers.push({
      id: generateId(),
      company_id: COMPANY_ID,
      company_name: name,
      industry: null,
      website: null,
      phone: null,
      address_line: null,
      address_line2: null,
      city: null,
      country: null,
      postal_code: null,
      contact_name: null,
      contact_designation: null,
      contact_email: null,
      contact_phone: null,
      advance_rate: 0.8,
      fee_rate: 0.025,
      notes: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    });
  }

  if (newSuppliers.length === 0) {
    console.log("\n✅ All suppliers already exist — nothing to do.");
    return;
  }

  console.log(`\n💾 Creating ${newSuppliers.length} new suppliers...`);
  for (let i = 0; i < newSuppliers.length; i += 25) {
    const chunk = newSuppliers.slice(i, i + 25);
    await batchPutItems(TABLES.SUPPLIERS, chunk as any);
  }

  console.log("\n✅ Done! Created suppliers:");
  for (const s of newSuppliers) {
    console.log(`   ✔ ${s.company_name}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
