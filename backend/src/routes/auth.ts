import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  getItem,
  putItem,
  updateItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { generateToken, requireAuth, countUsers, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { config } from "../config.js";
import type { User, Profile, UserRole, AppRole, Company } from "../types/index.js";

const router = Router();

// ── POST /api/auth/signup ──
// Every signup creates a new company and the user becomes factor_admin of that company.
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
});

router.post("/signup", async (req: Request, res: Response) => {
  try {
    const parsed = signupSchema.parse(req.body);
    const { email, password, company_name, contact_name } = parsed;

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
    const companyId = generateId();
    const password_hash = await bcrypt.hash(password, 10);
    const now = nowISO();

    // Create company
    const company: Company = {
      id: companyId,
      name: company_name,
      email: email,
      phone: null,
      address: null,
      settings: null,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.COMPANIES, company as any);

    // Create user (now with company_id)
    const user: User = { id, email, password_hash, company_id: companyId, created_at: now };
    await putItem(TABLES.USERS, user as any);

    // Create profile (now with company_id)
    const profile: Profile = {
      id, email, company_name,
      company_id: companyId,
      contact_name: contact_name || null,
      last_seen_at: null,
      created_at: now, updated_at: now,
    };
    await putItem(TABLES.PROFILES, profile as any);

    // Assign factor_admin role to the company admin
    const roleId = generateId();
    const userRole: UserRole = { id: roleId, user_id: id, role: "factor_admin" };
    await putItem(TABLES.USER_ROLES, userRole as any);

    const token = generateToken({ id, email, roles: ["factor_admin"], company_id: companyId });

    res.status(201).json({
      token,
      user: {
        id, email, company_name,
        company_id: companyId,
        contact_name: profile.contact_name,
        roles: ["factor_admin"],
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/auth/signin ──
const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/signin", async (req: Request, res: Response) => {
  try {
    const parsed = signinSchema.parse(req.body);
    const { email, password } = parsed;

    const users = await scanTable<User>(TABLES.USERS, {
      filterExpression: "email = :email",
      expressionAttributeValues: { ":email": email },
    });

    if (users.length === 0) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Update last_seen_at on profile
    await updateItem(TABLES.PROFILES, { id: user.id }, { last_seen_at: nowISO() });

    // Load roles
    const roles = await scanTable<{ role: AppRole }>(TABLES.USER_ROLES, {
      filterExpression: "user_id = :uid",
      expressionAttributeValues: { ":uid": user.id },
    });
    const appRoles: AppRole[] = roles.map((r) => r.role);

    // Load profile & company
    const profile = await getItem(TABLES.PROFILES, { id: user.id }) as Profile | undefined;
    const company = user.company_id
      ? await getItem(TABLES.COMPANIES, { id: user.company_id }) as Company | undefined
      : undefined;

    const token = generateToken({
      id: user.id,
      email: user.email,
      roles: appRoles,
      company_id: user.company_id ?? null,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        company_id: user.company_id ?? null,
        company_name: company?.name ?? profile?.company_name ?? "",
        contact_name: profile?.contact_name ?? null,
        last_seen_at: profile?.last_seen_at ?? null,
        roles: appRoles,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Signin error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/auth/me ──
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await getItem(TABLES.PROFILES, { id: req.user!.id }) as Profile | undefined;
    const roles = await scanTable<{ role: AppRole }>(TABLES.USER_ROLES, {
      filterExpression: "user_id = :uid",
      expressionAttributeValues: { ":uid": req.user!.id },
    });

    const appRoles = roles.map((r) => r.role);
    const isSuperAdmin = req.user!.email === config.admin.email;

    // Load company info
    const company = req.user!.company_id
      ? await getItem(TABLES.COMPANIES, { id: req.user!.company_id }) as Company | undefined
      : undefined;

    res.json({
      id: req.user!.id,
      email: req.user!.email,
      company_id: req.user!.company_id,
      company_name: company?.name ?? profile?.company_name ?? "",
      contact_name: profile?.contact_name ?? null,
      last_seen_at: profile?.last_seen_at ?? null,
      roles: appRoles,
      is_super_admin: isSuperAdmin,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/auth/refresh-token ──
router.post("/refresh-token", requireAuth, (req: AuthRequest, res: Response) => {
  const token = generateToken({
    id: req.user!.id,
    email: req.user!.email,
    roles: req.user!.roles,
    company_id: req.user!.company_id,
  });
  res.json({ token });
});

// ── POST /api/auth/ping ──
// Heartbeat endpoint — updates the user's last_seen_at timestamp
// Called periodically by the frontend to track online status
router.post("/ping", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await updateItem(TABLES.PROFILES, { id: req.user!.id }, { last_seen_at: nowISO() });
    res.json({ success: true });
  } catch (err) {
    console.error("Ping error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
