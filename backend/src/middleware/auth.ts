import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { JwtPayload, AppRole } from "../types/index.js";
import { scanTable, TABLES } from "../db/client.js";

// ── Types ──

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    roles: AppRole[];
  };
}

// ── JWT ──

export function generateToken(payload: { id: string; email: string; roles: AppRole[] }): string {
  const jwtPayload: JwtPayload = {
    sub: payload.id,
    email: payload.email,
    roles: payload.roles,
  };
  return jwt.sign(jwtPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as any,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = verifyToken(token);

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      roles: decoded.roles,
    };

    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Legacy role guard (kept for admin-only routes like /api/admin) ──

export function requireRole(...roles: AppRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const hasRole = roles.some((r) => req.user!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

// ── Permission-based access control ──
//
// Resource names used with requireWriteAccess():
//   "suppliers", "debtors", "invoices", "purchase-invoices",
//   "purchase-orders", "stock-movements", "advances", "expenses",
//   "vendors", "checker-desk", "funding-queue", "upload", "admin"

type ResourcePermission = {
  read: string[];   // '*' means all
  write: string[];  // resources this role can modify
};

const rolePermissions: Record<AppRole, ResourcePermission> = {
  factor_admin: {
    read: ["*"],
    write: ["*"],
  },
  operations: {
    read: ["*"],
    write: [
      "suppliers",
      "debtors",
      "invoices",
      "purchase-invoices",
      "purchase-orders",
      "stock-movements",
      "advances",
      "expenses",
      "vendors",
    ],
  },
  checker: {
    read: ["*"],
    write: ["checker-desk"],
  },
  treasury: {
    read: ["*"],
    write: ["funding-queue"],
  },
  client: {
    read: ["*"],
    write: [], // clients write through the normal flow (their own data)
  },
  viewer: {
    read: ["*"],
    write: [], // viewers can only read everything
  },
};

/**
 * Returns the combined set of write-resources a user is allowed to modify.
 * Includes a '*' wildcard for admins.
 */
export function getWritePermissions(roles: AppRole[]): string[] {
  const combined = new Set<string>();
  for (const role of roles) {
    const perms = rolePermissions[role];
    if (perms.write.includes("*")) return ["*"]; // admin shortcut
    for (const r of perms.write) combined.add(r);
  }
  return Array.from(combined);
}

/**
 * Express middleware that checks whether the authenticated user
 * has write access to the given resource.
 */
export function requireWriteAccess(resource: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const allowed = getWritePermissions(req.user.roles);
    if (allowed.includes("*") || allowed.includes(resource)) {
      return next();
    }

    res.status(403).json({ error: "You don't have permission to modify this resource" });
  };
}

/**
 * Express middleware that checks whether the authenticated user
 * has write access to ANY of the given resources.
 * Useful for routes like invoices where multiple roles with
 * different resource scopes need write access.
 */
export function requireAnyWriteAccess(...resources: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const allowed = getWritePermissions(req.user.roles);
    if (allowed.includes("*") || resources.some((r) => allowed.includes(r))) {
      return next();
    }

    res.status(403).json({ error: "You don't have permission to modify this resource" });
  };
}

// ── Helper ──

export async function loadUserRoles(userId: string): Promise<AppRole[]> {
  const roles = await scanTable<{ role: AppRole }>(TABLES.USER_ROLES, {
    filterExpression: "user_id = :uid",
    expressionAttributeValues: { ":uid": userId },
  });
  return roles.map((r) => r.role);
}

/**
 * Count users to determine if this is the first signup (first = admin).
 */
export async function countUsers(): Promise<number> {
  const users = await scanTable<any>(TABLES.USERS);
  return users.length;
}
