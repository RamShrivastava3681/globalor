import { deleteItem, getItem, putItem, scanTable, updateItem, TABLES } from "./client.js";
import { nowISO } from "../utils/helpers.js";
import type { User } from "../types/index.js";

/**
 * Registry keys are normalized to lowercase so case-variant emails can't
 * create duplicate accounts (User@x.com vs user@x.com).
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Reservations carry a 24h DynamoDB TTL so an email can never be locked
 * forever if the process crashes between reservation and account creation.
 * Successful signups call `finalizeEmailReservation` to make the entry
 * effectively permanent (the TTL attribute is set far in the future).
 */
const RESERVATION_TTL_SECONDS = 24 * 60 * 60;
const FINALIZED_TTL = 4102444800; // year 2100 — effectively no expiry

/**
 * Look up a user by email.
 *
 * Fast path: reads the email → user_id registry table (strongly consistent
 * GetItem — no full-table scan, cheap under concurrent logins).
 *
 * Fallback: if the registry misses (e.g. users created before the registry
 * migration ran), scan the USERS table and case-insensitively match the
 * email, so legacy mixed-case accounts are still found.
 */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  // 1) Fast path — email registry
  try {
    const reg = (await getItem(TABLES.EMAIL_REGISTRY, { email: normalizeEmail(email) })) as
      | { user_id?: string }
      | undefined;
    if (reg?.user_id) {
      const user = (await getItem(TABLES.USERS, { id: reg.user_id })) as
        | User
        | undefined;
      if (user) return user;
    }
  } catch (err: any) {
    // Registry table may not exist yet — fall through to the scan
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  // 2) Fallback — legacy full-table scan (covers pre-migration users).
  //    Case-insensitive so legacy mixed-case accounts still match.
  const users = await scanTable<User>(TABLES.USERS);
  const needle = normalizeEmail(email);
  return users.find((u) => u.email && normalizeEmail(u.email) === needle);
}

/**
 * Atomically reserve an email for a new user.
 *
 * Uses a conditional write (`attribute_not_exists(email)`) on the registry
 * table, so only ONE concurrent signup per email can succeed. Returns false
 * when the email is already taken. This closes the check-then-act race in
 * the old signup flow (scan → insert) that allowed duplicate accounts.
 */
export async function reserveEmail(email: string, userId: string): Promise<boolean> {
  try {
    await putItem(
      TABLES.EMAIL_REGISTRY,
      {
        email: normalizeEmail(email),
        user_id: userId,
        created_at: nowISO(),
        ttl: Math.floor(Date.now() / 1000) + RESERVATION_TTL_SECONDS,
      },
      "attribute_not_exists(email)",
    );
    return true;
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/**
 * Mark a reservation as permanent once the account has been fully created,
 * so the registry entry is never expired by the reservation TTL.
 */
export async function finalizeEmailReservation(email: string): Promise<void> {
  await updateItem(
    TABLES.EMAIL_REGISTRY,
    { email: normalizeEmail(email) },
    { ttl: FINALIZED_TTL },
  );
}

/**
 * Release a previously reserved email. Called when account creation fails
 * partway through, so the address isn't permanently locked out.
 */
export async function releaseEmail(email: string): Promise<void> {
  await deleteItem(TABLES.EMAIL_REGISTRY, { email: normalizeEmail(email) });
}
