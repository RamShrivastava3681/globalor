import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireRole, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO, daysBetween, safeMoney } from "../utils/helpers.js";
import { sendWelcomeEmail } from "../utils/email.js";
import { config } from "../config.js";
import type {
  AppRole, UserRole, Profile, Invoice, Debtor, Alert,
  NoaInvoiceResult, NoaStatus, User,
} from "../types/index.js";

const router = Router();

// ── Helper: check if the requesting user is the super admin ──
function isSuperAdmin(req: AuthRequest): boolean {
  return req.user?.email === config.admin.email;
}

// ── POST /api/admin/users ──
// Admin creates a new user with a specific role
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
  role: z.enum(["client", "factor_admin", "treasury", "checker", "operations", "viewer"]),
});

router.post("/users", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    // Only the super admin (the original admin from env vars) can create users
    if (!isSuperAdmin(req)) {
      res.status(403).json({ error: "Only the main administrator can create users" });
      return;
    }

    const parsed = createUserSchema.parse(req.body);
    const { email, password, company_name, contact_name, role } = parsed;

    // Check if user exists
    const existingUsers = await scanTable<User>(TABLES.USERS, {
      filterExpression: "email = :email",
      expressionAttributeValues: { ":email": email },
    });

    if (existingUsers.length > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const id = generateId();
    const password_hash = await bcrypt.hash(password, 10);
    const now = nowISO();

    // Create user
    const user: User = { id, email, password_hash, created_at: now };
    await putItem(TABLES.USERS, user as any);

    // Create profile
    const profile: Profile = {
      id, email, company_name,
      contact_name: contact_name || null,
      last_seen_at: null,
      created_at: now, updated_at: now,
    };
    await putItem(TABLES.PROFILES, profile as any);

    // Assign the specified role
    const roleId = generateId();
    const userRole: UserRole = { id: roleId, user_id: id, role: role as AppRole };
    await putItem(TABLES.USER_ROLES, userRole as any);

    // Send welcome email (non-blocking — don't fail the request if email fails)
    sendWelcomeEmail({
      to: email,
      companyName: company_name,
      contactName: contact_name || null,
      password,
    });

    res.status(201).json({
      id,
      email,
      company_name,
      contact_name: contact_name || null,
      role,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create user error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/profiles ──

// ── GET /api/admin/profiles ──
router.get("/profiles", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const profiles = await scanTable<Profile>(TABLES.PROFILES);
    res.json(profiles.map((p) => ({ id: p.id, email: p.email, company_name: p.company_name, contact_name: p.contact_name, last_seen_at: p.last_seen_at })));
  } catch (err) {
    console.error("Get profiles error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/roles ──
router.get("/roles", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const roles = await scanTable<UserRole>(TABLES.USER_ROLES);
    res.json(roles.map((r) => ({ user_id: r.user_id, role: r.role })));
  } catch (err) {
    console.error("Get roles error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/admin/roles ──
const upsertRoleSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(["client", "factor_admin", "treasury", "checker", "operations", "viewer"]),
  add: z.boolean(),
});

router.post("/roles", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { user_id, role, add } = upsertRoleSchema.parse(req.body);

    // Prevent ANYONE from revoking the super admin's factor_admin role
    if (!add && role === "factor_admin") {
      const targetUser = await scanTable<User>(TABLES.USERS, {
        filterExpression: "id = :id",
        expressionAttributeValues: { ":id": user_id },
      });
      if (targetUser.length > 0 && targetUser[0].email === config.admin.email) {
        res.status(403).json({ error: "Cannot revoke the main administrator's admin role" });
        return;
      }
    }

    if (add) {
      const existing = await scanTable<UserRole>(TABLES.USER_ROLES, {
        filterExpression: "user_id = :uid AND #r = :role",
        expressionAttributeNames: { "#r": "role" },
        expressionAttributeValues: { ":uid": user_id, ":role": role },
      });
      if (existing.length === 0) {
        const userRole: UserRole = { id: generateId(), user_id, role: role as AppRole };
        await putItem(TABLES.USER_ROLES, userRole as any);
      }
    } else {
      const existing = await scanTable<UserRole>(TABLES.USER_ROLES, {
        filterExpression: "user_id = :uid AND #r = :role",
        expressionAttributeNames: { "#r": "role" },
        expressionAttributeValues: { ":uid": user_id, ":role": role },
      });
      for (const r of existing) {
        await deleteItem(TABLES.USER_ROLES, { id: r.id });
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Upsert role error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/admin/users/:userId ──
// Only the super admin can delete users
router.delete("/users/:userId", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req)) {
      res.status(403).json({ error: "Only the main administrator can delete users" });
      return;
    }

    const { userId } = req.params;

    // Don't allow deleting the super admin themselves
    const targetUser = await scanTable<User>(TABLES.USERS, {
      filterExpression: "id = :id",
      expressionAttributeValues: { ":id": userId },
    });

    if (targetUser.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (targetUser[0].email === config.admin.email) {
      res.status(403).json({ error: "Cannot delete the main administrator account" });
      return;
    }

    // Delete user roles
    const userRoles = await scanTable<UserRole>(TABLES.USER_ROLES, {
      filterExpression: "user_id = :uid",
      expressionAttributeValues: { ":uid": userId },
    });
    for (const r of userRoles) {
      await deleteItem(TABLES.USER_ROLES, { id: r.id });
    }

    // Delete profile
    await deleteItem(TABLES.PROFILES, { id: userId });

    // Delete user
    await deleteItem(TABLES.USERS, { id: userId });

    res.json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/admin/generate-alerts ──
router.post("/generate-alerts", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES);
    const debtors = await scanTable<Debtor>(TABLES.DEBTORS);

    const alertsToCreate: Alert[] = [];

    for (const i of invoices) {
      if (i.status === "paid" || i.status === "rejected") continue;
      const dpd = i.due_date ? daysBetween(i.due_date) : 0;
      if (dpd > 0) {
        alertsToCreate.push({
          id: generateId(),
          client_id: i.client_id,
          invoice_id: i.id,
          debtor_id: i.debtor_id,
          type: "overdue",
          severity: dpd > 60 ? "critical" : dpd > 30 ? "warning" : "info",
          message: `Invoice ${i.invoice_number} overdue ${dpd} days — $${i.amount.toLocaleString()}`,
          is_read: false,
          created_at: nowISO(),
          created_by: req.user!.id,
        });
      }
      if (Number(i.amount) >= 100000) {
        const debtor = debtors.find((d) => d.id === i.debtor_id);
        alertsToCreate.push({
          id: generateId(),
          client_id: i.client_id,
          invoice_id: i.id,
          debtor_id: i.debtor_id,
          type: "large_invoice",
          severity: "info",
          message: `Large invoice received: $${i.amount.toLocaleString()} from ${debtor?.name ?? "debtor"}`,
          is_read: false,
          created_at: nowISO(),
          created_by: req.user!.id,
        });
      }
    }



    for (const alert of alertsToCreate) {
      await putItem(TABLES.ALERTS, alert as any);
    }

    res.json({ created: alertsToCreate.length });
  } catch (err) {
    console.error("Generate alerts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
