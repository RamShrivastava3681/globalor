import crypto from "crypto";

export function generateId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${timestamp}-${random}`;
}

export function generateNoaToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a human-facing document number like `PO-XXXXXXXX` or `GRN-XXXXXXXX`
 * (no ambiguous chars: no 0/O, 1/I).
 */
export function generateDocNumber(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

export function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function diffDaysUTC(from?: string | null, to?: string | null): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

export function safeMoney(val: unknown): number {
  return Number(val) || 0;
}

/**
 * Resolve the company_id for a new entity when the creating user has no
 * company_id (e.g. a super admin). Falls back to the customer's company_id,
 * then the user's company_id. Returns null only if nothing is available.
 *
 * This prevents invoices (and other entities) from being created with
 * company_id = null, which would make them invisible to other admins
 * in the same company.
 */
export function inferCompanyId(
  userCompanyId: string | null | undefined,
  customerCompanyId?: string | null,
  fallbackCompanyId?: string | null,
): string | null {
  return userCompanyId || customerCompanyId || fallbackCompanyId || null;
}
