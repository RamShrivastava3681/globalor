/**
 * Format a number as USD currency with 0-2 decimal places.
 */
export function fmtMoney(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
}

/**
 * Compact USD formatting for KPI cards ($1.2K / $3.4M / $1.2B).
 */
export function fmtCompact(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(v);
}

/**
 * Format a date string to a human-readable short format (e.g. "Jan 15, 2026").
 */
export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format a date string to a human-readable date + time format.
 */
export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * Calculate the number of days between two ISO date strings.
 * Returns a non-negative integer.
 */
export function daysBetween(a: string, b: string = new Date().toISOString()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Effective due date for a sales invoice — always returns a visible date.
 * Falls back to issue_date + payment_terms_days (default 30) when due_date
 * is missing, so the due date is never blank in list/detail/PDF views.
 */
export function getEffectiveDueDate(
  inv: { due_date?: string | null; issue_date?: string | null; payment_terms_days?: number | string | null },
): string | null {
  if (inv?.due_date) return inv.due_date;
  const base = inv?.issue_date;
  if (!base) return null;
  const terms = Number(inv?.payment_terms_days) > 0 ? Number(inv.payment_terms_days) : 30;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + terms);
  return d.toISOString().slice(0, 10);
}
