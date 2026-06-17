import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { putItem, scanTable, TABLES } from "./db/client.js";
import { nowISO } from "./utils/helpers.js";
import type { User, Profile, UserRole, AppRole } from "./types/index.js";

/**
 * Seeds the admin user from ADMIN_EMAIL / ADMIN_PASSWORD env vars on startup.
 * If the vars are set and the user doesn't exist yet, creates the user with
 * factor_admin role. Safe to call on every startup — it's a no-op if the
 * admin already exists.
 */
export async function seedAdmin(): Promise<void> {
  const { email, password } = config.admin;
  if (!email || !password) {
    console.log("   No ADMIN_EMAIL / ADMIN_PASSWORD configured — skipping seed.");
    return;
  }

  try {
    // Check if user already exists
    let existing: User[] = [];
    try {
      existing = await scanTable<User>(TABLES.USERS, {
        filterExpression: "email = :email",
        expressionAttributeValues: { ":email": email },
      });
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") {
        console.warn("   ⚠️ Users table not found — admin seed skipped.");
      } else {
        console.warn("   ⚠️ Error during scan — admin seed skipped.");
      }
      return;
    }

    if (existing.length > 0) {
      console.log(`   Admin user "${email}" already exists — skipping seed.`);
      return;
    }

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    const now = nowISO();

    // Create user
    const user: User = { id, email, password_hash, created_at: now };
    try {
      await putItem(TABLES.USERS, user as any);
    } catch (err: any) {
      console.error(`   ❌ Failed to create user record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
      return;
    }

    // Create profile
    const profile: Profile = {
      id, email,
      company_name: email.split('@')[0] || "Administrator",
      contact_name: email.split('@')[0] || "Admin",
      created_at: now,
      updated_at: now,
    };
    try {
      await putItem(TABLES.PROFILES, profile as any);
    } catch (err: any) {
      console.error(`   ❌ Failed to create profile record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
      return;
    }

    // Assign factor_admin role
    const roleId = uuidv4();
    const userRole: UserRole = { id: roleId, user_id: id, role: "factor_admin" as AppRole };
    try {
      await putItem(TABLES.USER_ROLES, userRole as any);
    } catch (err: any) {
      console.error(`   ❌ Failed to create user role record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
      return;
    }

    console.log(`   ✅ Admin user created: ${email}`);
  } catch (err) {
    console.error("   ❌ Failed to seed admin user:", err);
  }
}
