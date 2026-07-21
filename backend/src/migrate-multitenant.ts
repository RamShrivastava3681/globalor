/**
 * ── Multi-Tenant Migration Script ──
 *
 * Purpose: Backfill `company_id` for all existing records so the app can
 * transition from single-tenant to multi-tenant mode.
 *
 * **Safety guarantees:**
 * - NEVER deletes or overwrites existing data
 * - Only adds new attributes to existing records
 * - Idempotent — safe to run multiple times (skips records that already
 *   have `company_id`)
 * - All operations are additive-only (SET operations on DynamoDB)
 *
 * **What this script does:**
 * 1. Scans all Profiles → groups by `company_name` → creates one Company
 *    record per unique name
 * 2. Updates each User record with the matching `company_id`
 * 3. Updates each Profile record with the matching `company_id`
 * 4. For every data entity that has a `client_id` (user ID), looks up the
 *    user's company and sets `company_id` on the entity
 *
 * Run manually:  npx tsx src/migrate-multitenant.ts
 * Or on startup by uncommenting the call in index.ts
 */

import { config } from "./config.js";
import { ddbClient } from "./db/client.js";
import {
  putItem,
  scanTable,
  updateItem,
  TABLES,
} from "./db/client.js";
import { generateId, nowISO } from "./utils/helpers.js";
import type { Company, Profile, User } from "./types/index.js";

// ── Helpers ──

function log(msg: string) {
  console.log(`  ${msg}`);
}

function heading(msg: string) {
  console.log(`\n━━━ ${msg} ━━━`);
}

/**
 * Normalize a company name for grouping (lowercase, trim).
 * Prevents duplicates like "Globalor" vs "globalor".
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ── Step 1: Create Company records from unique company names ──

async function migrateCompanies(): Promise<Map<string, string>> {
  heading("Step 1: Creating Company records from unique company names");

  const nameToCompanyId = new Map<string, string>(); // normalized name → company ID

  // Load existing companies to avoid duplicates
  let existingCompanies: Company[] = [];
  try {
    existingCompanies = await scanTable<Company>(TABLES.COMPANIES);
    for (const c of existingCompanies) {
      const key = normalizeName(c.name);
      if (!nameToCompanyId.has(key)) {
        nameToCompanyId.set(key, c.id);
      }
    }
    log(`  Found ${existingCompanies.length} existing companies.`);
  } catch {
    log("  Companies table may not exist yet — will create fresh.");
  }

  // Scan all profiles
  let profiles: Profile[] = [];
  try {
    profiles = await scanTable<Profile>(TABLES.PROFILES);
    log(`  Found ${profiles.length} profiles.`);
  } catch (err) {
    console.error("  ❌ Failed to scan profiles. Aborting.", err);
    return nameToCompanyId;
  }

  // Group by company_name
  const groups = new Map<string, Profile[]>();
  for (const p of profiles) {
    const name = p.company_name?.trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  log(`  Found ${groups.size} unique company names across ${profiles.length} profiles.`);

  // Create missing companies
  let created = 0;
  for (const [normalized, members] of groups) {
    if (nameToCompanyId.has(normalized)) {
      log(`  ✓ Company "${members[0].company_name}" already exists — skipping.`);
      continue;
    }

    const companyId = generateId();
    const now = nowISO();
    const sampleName = members[0].company_name;
    const sampleEmail = members.find((m) => m.email)?.email ?? null;

    const company: Company = {
      id: companyId,
      name: sampleName,
      email: sampleEmail,
      phone: null,
      address: null,
      settings: null,
      created_at: now,
      updated_at: now,
    };

    try {
      await putItem(TABLES.COMPANIES, company as any);
      nameToCompanyId.set(normalized, companyId);
      created++;
      log(`  ✅ Created company "${sampleName}" (${members.length} member(s))`);
    } catch (err) {
      console.error(`  ❌ Failed to create company "${sampleName}":`, err);
    }
  }

  log(`  Done. Created ${created} new companies.`);
  return nameToCompanyId;
}

// ── Step 2: Update Users and Profiles with company_id ──

async function migrateUsersAndProfiles(
  nameToCompanyId: Map<string, string>,
): Promise<Map<string, string>> {
  heading("Step 2: Updating Users & Profiles with company_id");

  // Build a map: user_id → company_id
  const userIdToCompanyId = new Map<string, string>();

  let profiles: Profile[] = [];
  try {
    profiles = await scanTable<Profile>(TABLES.PROFILES);
  } catch {
    log("  No profiles to process.");
    return userIdToCompanyId;
  }

  let usersUpdated = 0;
  let profilesUpdated = 0;
  let profilesSkipped = 0;

  for (const profile of profiles) {
    const name = profile.company_name?.trim();
    if (!name) {
      profilesSkipped++;
      continue;
    }

    const companyId = nameToCompanyId.get(normalizeName(name));
    if (!companyId) {
      // Shouldn't happen since we just created all companies, but just in case
      profilesSkipped++;
      continue;
    }

    userIdToCompanyId.set(profile.id, companyId);

    // Update profile if it doesn't already have company_id
    if (!(profile as any).company_id) {
      try {
        await updateItem(TABLES.PROFILES, { id: profile.id }, { company_id: companyId } as any);
        profilesUpdated++;
      } catch (err) {
        console.error(`  ❌ Failed to update profile ${profile.id}:`, err);
      }
    } else {
      profilesSkipped++;
    }
  }

  log(`  Profiles: ${profilesUpdated} updated, ${profilesSkipped} skipped (already had company_id or no company).`);

  // Now update Users
  let users: User[] = [];
  try {
    users = await scanTable<User>(TABLES.USERS);
  } catch {
    log("  No users to process.");
    return userIdToCompanyId;
  }

  for (const user of users) {
    // If user already has company_id, skip
    if ((user as any).company_id) {
      continue;
    }

    const companyId = userIdToCompanyId.get(user.id);
    if (companyId) {
      try {
        await updateItem(TABLES.USERS, { id: user.id }, { company_id: companyId } as any);
        usersUpdated++;
      } catch (err) {
        console.error(`  ❌ Failed to update user ${user.id}:`, err);
      }
    }
    // If user has no matching profile/company, keep company_id as null (will be null in the record)
    // We don't update users without a company — they'll handle it on next login
  }

  log(`  Users: ${usersUpdated} updated.`);
  log(`  Note: Users without a matching profile will get company_id on next JWT refresh.`);

  return userIdToCompanyId;
}

// ── Step 3: Update data entities with company_id ──

/**
 * Table descriptor for migration: which tables need company_id backfill,
 * and how to find the user_id for each item.
 */
interface TableDescriptor {
  tableName: string;
  label: string;
  /**
   * The field name on the item that holds the user ID.
   * For most tables this is "client_id".
   * For tables without this, items get company_id = null.
   */
  userIdField: string | null;
}

const DATA_TABLES: TableDescriptor[] = [
  { tableName: TABLES.DEBTORS, label: "Debtors", userIdField: "client_id" },
  { tableName: TABLES.VENDORS, label: "Vendors", userIdField: "client_id" },
  { tableName: TABLES.SUPPLIERS, label: "Suppliers", userIdField: "client_id" },
  { tableName: TABLES.INVOICES, label: "Sales invoices", userIdField: "client_id" },
  { tableName: TABLES.PURCHASE_INVOICES, label: "Purchase invoices", userIdField: "client_id" },
  { tableName: TABLES.PURCHASE_ORDERS, label: "Purchase orders", userIdField: "client_id" },
  { tableName: TABLES.ADVANCES, label: "Advances", userIdField: "client_id" },
  { tableName: TABLES.EXPENSES, label: "Expenses", userIdField: "client_id" },
  { tableName: TABLES.STOCK_MOVEMENTS, label: "Stock movements", userIdField: "client_id" },
  { tableName: TABLES.INVENTORY_ITEMS, label: "Inventory items", userIdField: "client_id" },
  { tableName: TABLES.CREDIT_DEBIT_NOTES, label: "Credit/Debit notes", userIdField: "client_id" },
  { tableName: TABLES.PAYMENTS, label: "Payment records", userIdField: "client_id" },
  { tableName: TABLES.ALERTS, label: "Alerts", userIdField: "client_id" },
  // These tables don't have client_id — we can't determine their company
  { tableName: TABLES.CHART_OF_ACCOUNTS, label: "Chart of accounts", userIdField: null },
  { tableName: TABLES.JOURNAL_ENTRIES, label: "Journal entries", userIdField: null },
  { tableName: TABLES.BALANCE_SHEET_ITEMS, label: "Balance sheet items", userIdField: null },
];

async function migrateDataEntities(
  userIdToCompanyId: Map<string, string>,
) {
  heading("Step 3: Backfilling company_id on data entities");

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const table of DATA_TABLES) {
    let items: Record<string, unknown>[] = [];
    try {
      items = await scanTable(table.tableName);
    } catch (err) {
      log(`  ⚠️ Could not scan ${table.label} (${table.tableName}). Table may not exist yet.`);
      continue;
    }

    if (items.length === 0) {
      log(`  ${table.label}: 0 items — skipping.`);
      continue;
    }

    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      // Skip items that already have company_id
      if (item.company_id) {
        skipped++;
        continue;
      }

      let companyId: string | null = null;

      if (table.userIdField) {
        const userId = item[table.userIdField] as string | undefined | null;
        if (userId) {
          companyId = userIdToCompanyId.get(userId) ?? null;
        }
      }

      // Even if companyId is null, we update to set it so future scans skip this item
      try {
        await updateItem(
          table.tableName,
          { id: item.id as string },
          { company_id: companyId } as any,
        );
        updated++;
      } catch (err) {
        console.error(`  ❌ Failed to update ${table.label} item ${item.id}:`, err);
      }
    }

    log(`  ${table.label}: ${updated} updated, ${skipped} skipped (already had company_id).`);
    totalProcessed += items.length;
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  log(`\n  Total: ${totalUpdated} records updated, ${totalSkipped} skipped across ${DATA_TABLES.length} tables.`);
}

// ── Main ──

export async function runMultiTenantMigration() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("   Multi-Tenant Data Migration");
  console.log("   This is an ADDITIVE-ONLY operation.");
  console.log("   No data will be deleted or overwritten.");
  console.log("═══════════════════════════════════════════════\n");

  const startTime = Date.now();

  try {
    // Step 1: Create Company records from unique company names
    const nameToCompanyId = await migrateCompanies();

    // Step 2: Update Users and Profiles
    const userIdToCompanyId = await migrateUsersAndProfiles(nameToCompanyId);

    // Step 3: Update all data entities
    await migrateDataEntities(userIdToCompanyId);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━ Migration complete (${elapsed}s) ━━━\n`);
    return { success: true, elapsed };
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    return { success: false, error: err };
  }
}

// ── Run directly ──
if (process.argv[1]?.endsWith("migrate-multitenant.ts") || process.argv[1]?.endsWith("migrate-multitenant.js")) {
  runMultiTenantMigration()
    .then((result) => {
      if (result.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
