import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  getItem,
  putItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { generateToken, requireAuth, countUsers, type AuthRequest } from "../middleware/auth.js";
import { nowISO } from "../utils/helpers.js";
import type { User, Profile, UserRole, AppRole } from "../types/index.js";

const router = Router();

// ── POST /api/auth/signup ──
// First user to sign up automatically becomes factor_admin.
// Subsequent signups get the default "client" role (admin can change this in Settings).
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

    const userCount = await countUsers();
    const isFirstUser = userCount === 0;

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    const now = nowISO();

    // Create user
    const user: User = { id, email, password_hash, created_at: now };
    await putItem(TABLES.USERS, user as any);

    // Create profile
    const profile: Profile = {
      id, email, company_name,
      contact_name: contact_name || null,
      created_at: now, updated_at: now,
    };
    await putItem(TABLES.PROFILES, profile as any);

    // Assign role: first user = factor_admin, otherwise "client"
    const defaultRole: AppRole = isFirstUser ? "factor_admin" : "client";
    const roleId = uuidv4();
    const userRole: UserRole = { id: roleId, user_id: id, role: defaultRole };
    await putItem(TABLES.USER_ROLES, userRole as any);

    const token = generateToken({ id, email, roles: [defaultRole] });

    res.status(201).json({
      token,
      user: { id, email, company_name, contact_name: profile.contact_name, roles: [defaultRole] },
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

    // Load roles
    const roles = await scanTable<{ role: AppRole }>(TABLES.USER_ROLES, {
      filterExpression: "user_id = :uid",
      expressionAttributeValues: { ":uid": user.id },
    });
    const appRoles: AppRole[] = roles.map((r) => r.role);

    // Load profile
    const profile = await getItem(TABLES.PROFILES, { id: user.id }) as Profile | undefined;

    const token = generateToken({ id: user.id, email: user.email, roles: appRoles });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        company_name: profile?.company_name ?? "",
        contact_name: profile?.contact_name ?? null,
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

    res.json({
      id: req.user!.id,
      email: req.user!.email,
      company_name: profile?.company_name ?? "",
      contact_name: profile?.contact_name ?? null,
      roles: roles.map((r) => r.role),
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
  });
  res.json({ token });
});

export default router;
