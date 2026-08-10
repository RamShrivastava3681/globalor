import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { putItem, TABLES } from "./db/client.js";
import { findUserByEmail, reserveEmail, releaseEmail, finalizeEmailReservation } from "./db/users.js";
import { generateId, nowISO } from "./utils/helpers.js";
import type { User, Profile, UserRole, AppRole, Company } from "./types/index.js";

/**
 * Seeds the super admin user from ADMIN_EMAIL / ADMIN_PASSWORD env vars on startup.
 * If the vars are set and the user doesn't exist yet, creates the user with
 * factor_admin role and a dedicated company. Safe to call on every startup —
 * it's a no-op if the admin already exists.
 */
export async function seedAdmin(): Promise<void> {
  const { password } = config.admin;
  if (!config.admin.email || !password) {
    console.log("   No ADMIN_EMAIL / ADMIN_PASSWORD configured — skipping seed.");
    return;
  }
  const email = config.admin.email.trim().toLowerCase();

  try {
    // Check if user already exists (indexed lookup with legacy scan fallback)
    let existing: User | undefined;
    try {
      existing = await findUserByEmail(email);
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") {
        console.warn("   ⚠️ Users table not found — admin seed skipped.");
      } else {
        console.warn("   ⚠️ Error during lookup — admin seed skipped.");
      }
      return;
    }

    if (existing) {
      console.log(`   Admin user "${email}" already exists — skipping seed.`);
      return;
    }

    const id = generateId();
    const companyId = generateId();

    // Atomically reserve the email so a concurrent signup can't take it first
    const reserved = await reserveEmail(email, id);
    if (!reserved) {
      console.log(`   ⚠️ Email "${email}" already reserved — skipping seed.`);
      return;
    }

    try {
      const password_hash = await bcrypt.hash(password, 10);
      const now = nowISO();
      const companyName = email.split('@')[0] || "Administrator";

      // Create super admin's company
      const company: Company = {
        id: companyId,
        name: companyName,
        email: email,
        phone: null,
        address: null,
        settings: null,
        created_at: now,
        updated_at: now,
      };
      try {
        await putItem(TABLES.COMPANIES, company as any);
      } catch (err: any) {
        console.error(`   ❌ Failed to create company record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
        await releaseEmail(email).catch(() => {});
        return;
      }

      // Create user (with company_id)
      const user: User = { id, email, password_hash, company_id: companyId, created_at: now };
      try {
        await putItem(TABLES.USERS, user as any);
      } catch (err: any) {
        console.error(`   ❌ Failed to create user record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
        await releaseEmail(email).catch(() => {});
        return;
      }

      // Create profile (with company_id)
      const profile: Profile = {
        id, email,
        company_name: companyName,
        company_id: companyId,
        contact_name: email.split('@')[0] || "Admin",
        last_seen_at: null,
        created_at: now,
        updated_at: now,
      };
      try {
        await putItem(TABLES.PROFILES, profile as any);
      } catch (err: any) {
        console.error(`   ❌ Failed to create profile record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
        await releaseEmail(email).catch(() => {});
        return;
      }

      // Assign factor_admin role
      const roleId = generateId();
      const userRole: UserRole = { id: roleId, user_id: id, role: "factor_admin" as AppRole };
      try {
        await putItem(TABLES.USER_ROLES, userRole as any);
      } catch (err: any) {
        console.error(`   ❌ Failed to create user role record: ${err.name === "ResourceNotFoundException" ? "Table not found" : err.message}`);
        await releaseEmail(email).catch(() => {});
        return;
      }

      // Account fully created — make the email reservation permanent
      await finalizeEmailReservation(email).catch(() => {});

      console.log(`   ✅ Super admin user created: ${email} (company: ${companyName})`);
    } catch (err) {
      // Roll back the reservation on any unexpected failure
      await releaseEmail(email).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("   ❌ Failed to seed admin user:", err);
  }
}
