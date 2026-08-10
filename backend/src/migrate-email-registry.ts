/**
 * ── Email Registry Migration Script ──
 *
 * Purpose: Backfill the `email → user_id` registry table from the existing
 * USERS table so that:
 *   1. Signin/signup look up users by email via an indexed GetItem instead of
 *      a full-table scan (fast under concurrent logins).
 *   2. Signup can enforce unique emails atomically (conditional write), which
 *      closes the duplicate-account race when two signups happen at once.
 *
 * **Safety guarantees:**
 * - Idempotent — safe to run multiple times (skips emails already present)
 * - NEVER deletes or overwrites existing data
 * - Creates the registry table if it doesn't exist yet
 *
 * The table is also auto-created on backend startup (schema.ts) for fresh
 * deployments; this script is only needed for EXISTING databases so current
 * users are reachable through the registry.
 *
 * Run:  npx tsx src/migrate-email-registry.ts
 */

import { CreateTableCommand, UpdateTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
import { ddbClient, putItem, scanTable, TABLES } from "./db/client.js";
import { nowISO } from "./utils/helpers.js";
import type { User } from "./types/index.js";

/** Far-future TTL — backfilled entries are permanent indexes, not reservations. */
const FINALIZED_TTL = 4102444800; // year 2100

// ── Helpers ──

function log(msg: string) {
  console.log(`  ${msg}`);
}

// ── Step 1: Ensure the registry table exists ──

async function ensureRegistryTable(): Promise<void> {
  try {
    await ddbClient.send(
      new CreateTableCommand({
        TableName: TABLES.EMAIL_REGISTRY,
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "email", AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
    log(`✅ Created table: ${TABLES.EMAIL_REGISTRY}`);
  } catch (err: any) {
    if (err.name === "ResourceInUseException") {
      log(`✓ Table already exists: ${TABLES.EMAIL_REGISTRY}`);
    } else {
      throw err;
    }
  }

  // Enable TTL so abandoned signup reservations (24h) expire automatically.
  try {
    await ddbClient.send(
      new UpdateTimeToLiveCommand({
        TableName: TABLES.EMAIL_REGISTRY,
        TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
      }),
    );
    log(`✓ TTL enabled on ${TABLES.EMAIL_REGISTRY}`);
  } catch (err: any) {
    console.error("  ❌ Failed to enable TTL:", err);
  }
}

// ── Step 2: Backfill email → user_id from USERS ──

async function backfillRegistry(): Promise<void> {
  let users: User[] = [];
  try {
    users = await scanTable<User>(TABLES.USERS);
  } catch (err) {
    console.error("  ❌ Failed to scan users table. Aborting.", err);
    return;
  }

  log(`  Found ${users.length} users.`);

  let inserted = 0;
  let skipped = 0;
  let noEmail = 0;

  for (const user of users) {
    if (!user.email) {
      noEmail++;
      continue;
    }
    try {
      await putItem(
        TABLES.EMAIL_REGISTRY,
        {
          email: user.email.trim().toLowerCase(),
          user_id: user.id,
          created_at: nowISO(),
          ttl: FINALIZED_TTL,
        },
        "attribute_not_exists(email)",
      );
      inserted++;
    } catch (err: any) {
      if (err.name === "ConditionalCheckFailedException") {
        skipped++;
      } else {
        console.error(`  ❌ Failed to index user ${user.id} (${user.email}):`, err);
      }
    }
  }

  log(`  Done: ${inserted} indexed, ${skipped} already present, ${noEmail} without email.`);
}

// ── Main ──

export async function runEmailRegistryMigration() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("   Email Registry Migration");
  console.log("   Indexes existing users by email for fast login");
  console.log("   and atomic signup uniqueness.");
  console.log("   ADDITIVE-ONLY — no data deleted or overwritten.");
  console.log("═══════════════════════════════════════════════\n");

  const startTime = Date.now();

  try {
    await ensureRegistryTable();
    await backfillRegistry();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━ Migration complete (${elapsed}s) ━━━\n`);
    return { success: true, elapsed };
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    return { success: false, error: err };
  }
}

// ── Run directly ──
if (
  process.argv[1]?.endsWith("migrate-email-registry.ts") ||
  process.argv[1]?.endsWith("migrate-email-registry.js")
) {
  runEmailRegistryMigration()
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
