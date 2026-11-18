/**
 * Cash Command Centre — pure calculation engine (no React, no formatting).
 * All money is plain dollars (number). Display formatting happens at the UI layer.
 *
 * Locked decisions:
 * - Proforma table (purchase-orders) is EXCLUDED everywhere.
 * - POs = goods purchase orders only. Committed = checker-approved
 *   (approved/sent/partially_received) and not yet invoiced. Planned = draft.
 * - Sales/purchase invoices treat "rejected" (and literal "cancelled") as cancelled.
 */

export type Money = number;

export interface DatedMoney {
  date: string; // YYYY-MM-DD
  amount: Money;
  label: string;
}

export interface ForecastPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
  openingCash: Money;
  expectedInflows: Money;
  expectedOutflows: Money;
  closingCash: Money;
  status: "GREEN" | "AMBER" | "RED";
  events: DatedMoney[];
}

export type CashAlertType = "SHORTFALL_RISK" | "OVERDUE_SPIKE" | "BUFFER_BREACH";

export interface CashAlert {
  type: CashAlertType;
  message: string;
  date?: string;
  amount?: Money;
}

export type ForecastMode = "DAILY" | "WEEKLY" | "MONTHLY";
export type ForecastView = "BASE" | "WITH_COMMITMENTS";

// ── Date helpers (UTC, YYYY-MM-DD) ──

export function todayYMD(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYMD(ymd: string, days: number): string {
  const dt = new Date(ymd + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function ymdLE(a: string, b: string): boolean {
  return (a || "") <= (b || "");
}

export function inWindow(date: string | null | undefined, start: string, end: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= start && d <= end;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Primitive derivations ──

export function availableForOps(account: any): Money {
  return round2(Number(account?.current_balance ?? 0) - Number(account?.restricted_balance ?? 0));
}

export function isActiveAccount(a: any): boolean {
  return a?.status === "active";
}

export function isCancelledStatus(s: string | null | undefined): boolean {
  const v = String(s ?? "").toLowerCase();
  return v === "cancelled" || v === "rejected";
}

// ── Sales invoice inflow math (spec §3) ──

export function salesInvoiceFigures(inv: any): {
  totalDue: Money;
  paid: Money;
  outstanding: Money;
  paidDate: string | null;
} {
  const grandTotal = Number(inv?.grand_total ?? inv?.amount ?? 0);
  const advanceDeducted = Number(inv?.advance_deducted ?? 0);
  const totalDue = round2(grandTotal - advanceDeducted);
  let paid = Number(inv?.amount_received ?? 0);
  if (inv?.status === "paid" && !(paid > 0)) paid = totalDue;
  paid = round2(paid);
  return {
    totalDue,
    paid,
    outstanding: round2(Math.max(0, totalDue - paid)),
    paidDate: (inv?.paid_date ?? inv?.receipt_date ?? null) as string | null,
  };
}

export function purchaseInvoiceFigures(pi: any): {
  totalDue: Money;
  paid: Money;
  outstanding: Money;
  paidDate: string | null;
} {
  const totalDue = round2(Number(pi?.amount ?? 0));
  let paid = Number(pi?.amount_paid ?? 0);
  if (pi?.status === "paid" && !(paid > 0)) paid = totalDue;
  paid = round2(paid);
  return {
    totalDue,
    paid,
    outstanding: round2(Math.max(0, totalDue - paid)),
    paidDate: (pi?.paid_date ?? null) as string | null,
  };
}

// ── Goods PO classification (proforma excluded) ──

const COMMITTED_PO = new Set(["approved", "sent", "partially_received"]);

export function poExpectedDate(po: any): string | null {
  return (po?.expected_delivery_date ?? po?.po_date ?? null) as string | null;
}

export function isPOInvoiced(po: any, purchaseInvoices: any[]): boolean {
  if (!po) return false;
  return purchaseInvoices.some(
    (pi) =>
      (pi?.goods_purchase_order_id && pi.goods_purchase_order_id === po.id) ||
      (pi?.po_number && po?.po_number && pi.po_number === po.po_number),
  );
}

export function isCommittedPO(po: any, purchaseInvoices: any[]): boolean {
  if (!po || isCancelledStatus(po?.status)) return false;
  if (!COMMITTED_PO.has(String(po?.status ?? ""))) return false;
  return !isPOInvoiced(po, purchaseInvoices);
}

export function isPlannedPO(po: any): boolean {
  if (!po || isCancelledStatus(po?.status)) return false;
  return String(po?.status ?? "") === "draft";
}

// ── Recurring expansion ──
// payment_day = day-of-month (1-31, clamped) for MONTHLY/QUARTERLY/ANNUAL,
// day-of-week (1=Mon..7=Sun) for WEEKLY.

function clampDay(year: number, month0: number, day: number): string {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), last);
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function nextRecurringDate(exp: any, fromYMD: string): string | null {
  if (!exp || exp.status !== "active") return null;
  const day = Math.max(1, Math.min(31, Number(exp.payment_day ?? 1)));
  const freq = String(exp.frequency ?? "MONTHLY");
  if (freq === "WEEKLY") {
    // payment_day 1..7 = Mon..Sun
    const dow = ((day - 1) % 7) + 1; // 1..7
    const base = new Date(fromYMD + "T00:00:00Z");
    const baseDow = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
    const delta = (dow - baseDow + 7) % 7;
    base.setUTCDate(base.getUTCDate() + delta);
    return base.toISOString().slice(0, 10);
  }
  const step = freq === "MONTHLY" ? 1 : freq === "QUARTERLY" ? 3 : 12;
  const [y, m] = fromYMD.split("-").map(Number);
  for (let i = 0; i < 36; i++) {
    const total = (m - 1) + i * step;
    const yy = y + Math.floor(total / 12);
    const mm = total % 12;
    const cand = clampDay(yy, mm, day);
    if (cand >= fromYMD) return cand;
  }
  return null;
}

export function expandRecurring(exp: any, start: string, end: string): DatedMoney[] {
  if (!exp || exp.status !== "active") return [];
  const out: DatedMoney[] = [];
  const freq = String(exp.frequency ?? "MONTHLY");
  const stepDays = freq === "WEEKLY" ? 7 : freq === "MONTHLY" ? 0 : freq === "QUARTERLY" ? 0 : 0;
  let cur = nextRecurringDate(exp, start);
  let guard = 0;
  while (cur && cur <= end && guard++ < 60) {
    out.push({ date: cur, amount: round2(Number(exp.amount ?? 0)), label: String(exp.category ?? "Recurring") });
    if (stepDays > 0) {
      cur = addDaysYMD(cur, stepDays);
      if (cur < start) break;
    } else {
      const step = freq === "MONTHLY" ? 1 : freq === "QUARTERLY" ? 3 : 12;
      const [y, m] = cur.split("-").map(Number);
      const total = (m - 1) + step;
      cur = clampDay(y + Math.floor(total / 12), total % 12, Number(exp.payment_day ?? 1));
    }
  }
  return out;
}

// ── 7-day summary ──

export interface CashSummaryInput {
  accounts: any[];
  inflows: any[];
  outflows: any[];
  settlements: any[];
  recurring: any[];
  commitments: any[];
  salesInvoices: any[];
  purchaseInvoices: any[];
  goodsPOs: any[];
  today?: string;
}

export interface CashSummary {
  availableCash: Money;
  activeAccountsCount: Money;
  marketplaceBalance: Money;
  directInflows7d: Money;
  settlements7d: Money;
  invoiceInflows7d: Money;
  totalInflows7d: Money;
  directOutflows7d: Money;
  commitments7d: Money;
  recurring7d: Money;
  invoiceOutflows7d: Money;
  approvedPO7d: Money;
  totalOutflows7d: Money;
  overdueReceipts: Money;
  supplierPayables: Money;
  poCommitments: Money;
  plannedPOs: Money;
  overdueCollections: Money;
  supplierDue7d: Money;
  marketplacePending: Money;
  salesInflows7d: Money;
  marketplaceInflows7d: Money;
  recurringOutflows7d: Money;
  purchaseOutflows7d: Money;
  inflowEvents7d: DatedMoney[];
  outflowEvents7d: DatedMoney[];
}

export function summarize7d(input: CashSummaryInput): CashSummary {
  const today = (input.today ?? todayYMD()).slice(0, 10);
  const end7 = addDaysYMD(today, 7);

  const accounts = input.accounts ?? [];
  const active = accounts.filter(isActiveAccount);
  const availableCash = round2(
    active.filter((a) => ["BANK", "CASH"].includes(String(a?.type))).reduce((s, a) => s + availableForOps(a), 0),
  );
  const marketplaceBalance = round2(
    active.filter((a) => String(a?.type) === "MARKETPLACE").reduce((s, a) => s + availableForOps(a), 0),
  );

  // Direct inflows
  let directInflows7d = 0;
  const inflowEvents7d: DatedMoney[] = [];
  for (const f of input.inflows ?? []) {
    if (isCancelledStatus(f?.status)) continue;
    if (!["EXPECTED", "OVERDUE"].includes(String(f?.status))) continue;
    if (inWindow(f?.expected_date, today, end7)) {
      directInflows7d += Number(f?.amount ?? 0);
      inflowEvents7d.push({ date: f.expected_date.slice(0, 10), amount: Number(f.amount ?? 0), label: f?.customer_name ?? f?.type ?? "Inflow" });
    }
  }
  directInflows7d = round2(directInflows7d);

  // Settlements (exclude RECEIVED + DISPUTED)
  let settlements7d = 0;
  for (const s of input.settlements ?? []) {
    if (["RECEIVED", "DISPUTED"].includes(String(s?.status))) continue;
    if (inWindow(s?.expected_date, today, end7)) {
      settlements7d += Number(s?.net_expected ?? 0);
      inflowEvents7d.push({ date: s.expected_date.slice(0, 10), amount: Number(s.net_expected ?? 0), label: s?.marketplace_name ?? "Settlement" });
    }
  }
  settlements7d = round2(settlements7d);

  // Invoice inflows
  let invoiceInflows7d = 0;
  let overdueReceipts = 0;
  for (const inv of input.salesInvoices ?? []) {
    if (isCancelledStatus(inv?.status)) continue;
    if (inv?.status === "paid") continue; // paid invoices count as fully received (no forecast)
    const fig = salesInvoiceFigures(inv);
    if (fig.outstanding <= 0) continue;
    const due = (inv?.due_date ?? null) as string | null;
    if (fig.paid > 0 && fig.paidDate && inWindow(fig.paidDate, today, end7)) {
      invoiceInflows7d += fig.paid;
      inflowEvents7d.push({ date: fig.paidDate.slice(0, 10), amount: fig.paid, label: inv?.invoice_number ?? "Sales receipt" });
    } else if (due && inWindow(due, today, end7)) {
      invoiceInflows7d += fig.outstanding;
      inflowEvents7d.push({ date: due.slice(0, 10), amount: fig.outstanding, label: inv?.invoice_number ?? "Sales receipt" });
    }
    if (due && due.slice(0, 10) < today) overdueReceipts += fig.outstanding;
  }
  invoiceInflows7d = round2(invoiceInflows7d);
  overdueReceipts = round2(overdueReceipts);

  const totalInflows7d = round2(directInflows7d + settlements7d + invoiceInflows7d);

  // Direct outflows
  let directOutflows7d = 0;
  const outflowEvents7d: DatedMoney[] = [];
  let supplierDue7d = 0;
  for (const f of input.outflows ?? []) {
    if (isCancelledStatus(f?.status)) continue;
    if (!["EXPECTED", "OVERDUE"].includes(String(f?.status))) continue;
    if (inWindow(f?.expected_date, today, end7)) {
      directOutflows7d += Number(f?.amount ?? 0);
      outflowEvents7d.push({ date: f.expected_date.slice(0, 10), amount: Number(f.amount ?? 0), label: f?.supplier_name ?? f?.type ?? "Outflow" });
      if (String(f?.type) === "SUPPLIER_PAYMENT") supplierDue7d += Number(f?.amount ?? 0);
    }
  }
  directOutflows7d = round2(directOutflows7d);
  supplierDue7d = round2(supplierDue7d);

  // Manual commitments in window
  let commitments7d = 0;
  for (const c of input.commitments ?? []) {
    if (isCancelledStatus(c?.status)) continue;
    if (!["PENDING", "APPROVED"].includes(String(c?.status))) continue;
    if (inWindow(c?.expected_payment_date, today, end7)) {
      commitments7d += Number(c?.expected_payment_amount ?? 0);
      outflowEvents7d.push({ date: c.expected_payment_date.slice(0, 10), amount: Number(c.expected_payment_amount ?? 0), label: c?.supplier_name ?? "Commitment" });
    }
  }
  commitments7d = round2(commitments7d);

  // Recurring in window
  const recEvents = (input.recurring ?? []).flatMap((e) => expandRecurring(e, today, end7));
  const recurring7d = round2(recEvents.reduce((s, e) => s + e.amount, 0));
  for (const e of recEvents) outflowEvents7d.push({ ...e, label: `Recurring · ${e.label}` });

  // Purchase invoice outflows
  let invoiceOutflows7d = 0;
  let supplierPayables = 0;
  for (const pi of input.purchaseInvoices ?? []) {
    if (isCancelledStatus(pi?.status)) continue;
    if (pi?.status === "paid") continue;
    const fig = purchaseInvoiceFigures(pi);
    if (fig.outstanding <= 0) continue;
    supplierPayables += fig.outstanding;
    const due = (pi?.due_date ?? null) as string | null;
    if (fig.paid > 0 && fig.paidDate && inWindow(fig.paidDate, today, end7)) {
      invoiceOutflows7d += fig.paid;
      outflowEvents7d.push({ date: fig.paidDate.slice(0, 10), amount: fig.paid, label: pi?.invoice_number ?? "Supplier payment" });
    } else if (due && inWindow(due, today, end7)) {
      invoiceOutflows7d += fig.outstanding;
      outflowEvents7d.push({ date: due.slice(0, 10), amount: fig.outstanding, label: pi?.invoice_number ?? "Supplier payment" });
    }
  }
  invoiceOutflows7d = round2(invoiceOutflows7d);
  supplierPayables = round2(supplierPayables);

  // Approved (committed, uninvoiced) goods POs in window
  const purchaseInvoices = input.purchaseInvoices ?? [];
  let approvedPO7d = 0;
  let poCommitments = 0;
  let plannedPOs = 0;
  for (const po of input.goodsPOs ?? []) {
    if (isCancelledStatus(po?.status)) continue;
    const amt = round2(Number(po?.grand_total ?? 0));
    if (isCommittedPO(po, purchaseInvoices)) {
      poCommitments += amt;
      if (inWindow(poExpectedDate(po), today, end7)) {
        approvedPO7d += amt;
        outflowEvents7d.push({ date: (poExpectedDate(po) as string).slice(0, 10), amount: amt, label: po?.po_number ?? "PO" });
      }
    } else if (isPlannedPO(po)) {
      plannedPOs += amt;
    }
  }
  approvedPO7d = round2(approvedPO7d);
  // Active manual commitments (any PENDING/APPROVED, not cancelled) join PO commitments KPI
  const manualActive = round2(
    (input.commitments ?? [])
      .filter((c) => !isCancelledStatus(c?.status) && ["PENDING", "APPROVED"].includes(String(c?.status)))
      .reduce((s, c) => s + Number(c?.expected_payment_amount ?? 0), 0),
  );
  poCommitments = round2(poCommitments + manualActive);
  plannedPOs = round2(plannedPOs);

  const totalOutflows7d = round2(directOutflows7d + commitments7d + recurring7d + invoiceOutflows7d + approvedPO7d);

  // Overdue collections (manual expected inflows past due)
  const overdueCollections = round2(
    (input.inflows ?? [])
      .filter((f) => {
        if (isCancelledStatus(f?.status)) return false;
        if (["RECEIVED", "CANCELLED"].includes(String(f?.status))) return false;
        const d = (f?.expected_date ?? "").slice(0, 10);
        return String(f?.status) === "OVERDUE" || (d !== "" && d < today);
      })
      .reduce((s, f) => s + Number(f?.amount ?? 0), 0),
  );

  const marketplacePending = round2(
    (input.settlements ?? [])
      .filter((s) => !["RECEIVED", "DISPUTED"].includes(String(s?.status)))
      .reduce((s, x) => s + Number(x?.net_expected ?? 0), 0),
  );

  return {
    availableCash,
    activeAccountsCount: active.length,
    marketplaceBalance,
    directInflows7d,
    settlements7d,
    invoiceInflows7d,
    totalInflows7d,
    directOutflows7d,
    commitments7d,
    recurring7d,
    invoiceOutflows7d,
    approvedPO7d,
    totalOutflows7d,
    overdueReceipts,
    supplierPayables,
    poCommitments,
    plannedPOs,
    overdueCollections,
    supplierDue7d,
    marketplacePending,
    salesInflows7d: invoiceInflows7d,
    marketplaceInflows7d: settlements7d,
    recurringOutflows7d: recurring7d,
    purchaseOutflows7d: invoiceOutflows7d,
    inflowEvents7d,
    outflowEvents7d,
  };
}

// ── Forecast engine ──

export interface ForecastInput extends CashSummaryInput {
  minimumBuffer: Money;
  mode?: ForecastMode;
  view?: ForecastView;
}

function periodDefs(mode: ForecastMode, today: string): Array<{ key: string; label: string; start: string; end: string }> {
  if (mode === "WEEKLY") {
    return Array.from({ length: 13 }, (_, i) => {
      const start = addDaysYMD(today, i * 7);
      const end = addDaysYMD(today, i * 7 + 6);
      return { key: `W${i + 1}`, label: `Wk ${i + 1}`, start, end };
    });
  }
  if (mode === "MONTHLY") {
    const [y, m] = today.split("-").map(Number);
    return Array.from({ length: 6 }, (_, i) => {
      const total = (m - 1) + i;
      const yy = y + Math.floor(total / 12);
      const mm = total % 12;
      const first = `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
      const last = new Date(Date.UTC(yy, mm + 1, 0)).toISOString().slice(0, 10);
      return {
        key: `M${i + 1}`,
        label: new Date(Date.UTC(yy, mm, 1)).toLocaleDateString("en-US", { month: "short" }),
        start: i === 0 ? today : first,
        end: last,
      };
    });
  }
  return Array.from({ length: 30 }, (_, i) => {
    const d = addDaysYMD(today, i);
    return {
      key: d,
      label: new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      start: d,
      end: d,
    };
  });
}

function bucketize(events: DatedMoney[], start: string, end: string): Money {
  return round2(events.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0));
}

export interface ForecastResult {
  periods: ForecastPeriod[];
  alerts: CashAlert[];
  lowestCash: Money;
  lowestDate: string | null;
  projected7d: Money;
  projected30d: Money;
  cashStatus: "GREEN" | "AMBER" | "RED";
}

export function buildForecast(input: ForecastInput): ForecastResult {
  const today = (input.today ?? todayYMD()).slice(0, 10);
  const mode = input.mode ?? "DAILY";
  const view = input.view ?? "BASE";
  const buffer = Number(input.minimumBuffer ?? 0);

  const s = summarize7d(input);
  const horizon = mode === "DAILY" ? addDaysYMD(today, 29) : mode === "WEEKLY" ? addDaysYMD(today, 90) : addDaysYMD(today, 180);

  // All dated inflow events across horizon
  const inflowEvents: DatedMoney[] = [];
  for (const f of input.inflows ?? []) {
    if (isCancelledStatus(f?.status)) continue;
    if (!["EXPECTED", "OVERDUE"].includes(String(f?.status))) continue;
    if (inWindow(f?.expected_date, today, horizon))
      inflowEvents.push({ date: f.expected_date.slice(0, 10), amount: Number(f.amount ?? 0), label: f?.customer_name ?? f?.type ?? "Inflow" });
  }
  for (const st of input.settlements ?? []) {
    if (["RECEIVED", "DISPUTED"].includes(String(st?.status))) continue;
    if (inWindow(st?.expected_date, today, horizon))
      inflowEvents.push({ date: st.expected_date.slice(0, 10), amount: Number(st.net_expected ?? 0), label: st?.marketplace_name ?? "Settlement" });
  }
  for (const inv of input.salesInvoices ?? []) {
    if (isCancelledStatus(inv?.status) || inv?.status === "paid") continue;
    const fig = salesInvoiceFigures(inv);
    if (fig.outstanding <= 0) continue;
    const due = (inv?.due_date ?? null) as string | null;
    if (fig.paid > 0 && fig.paidDate && inWindow(fig.paidDate, today, horizon))
      inflowEvents.push({ date: fig.paidDate.slice(0, 10), amount: fig.paid, label: inv?.invoice_number ?? "Sales receipt" });
    else if (due && inWindow(due, today, horizon))
      inflowEvents.push({ date: due.slice(0, 10), amount: fig.outstanding, label: inv?.invoice_number ?? "Sales receipt" });
  }

  // All dated outflow events across horizon
  const outflowEvents: DatedMoney[] = [];
  for (const f of input.outflows ?? []) {
    if (isCancelledStatus(f?.status)) continue;
    if (!["EXPECTED", "OVERDUE"].includes(String(f?.status))) continue;
    if (inWindow(f?.expected_date, today, horizon))
      outflowEvents.push({ date: f.expected_date.slice(0, 10), amount: Number(f.amount ?? 0), label: f?.supplier_name ?? f?.type ?? "Outflow" });
  }
  for (const e of input.recurring ?? []) {
    for (const occ of expandRecurring(e, today, horizon)) outflowEvents.push({ ...occ, label: `Recurring · ${occ.label}` });
  }
  for (const pi of input.purchaseInvoices ?? []) {
    if (isCancelledStatus(pi?.status) || pi?.status === "paid") continue;
    const fig = purchaseInvoiceFigures(pi);
    if (fig.outstanding <= 0) continue;
    const due = (pi?.due_date ?? null) as string | null;
    if (fig.paid > 0 && fig.paidDate && inWindow(fig.paidDate, today, horizon))
      outflowEvents.push({ date: fig.paidDate.slice(0, 10), amount: fig.paid, label: pi?.invoice_number ?? "Supplier payment" });
    else if (due && inWindow(due, today, horizon))
      outflowEvents.push({ date: due.slice(0, 10), amount: fig.outstanding, label: pi?.invoice_number ?? "Supplier payment" });
  }
  if (view === "WITH_COMMITMENTS") {
    for (const c of input.commitments ?? []) {
      if (isCancelledStatus(c?.status)) continue;
      if (!["PENDING", "APPROVED"].includes(String(c?.status))) continue;
      if (inWindow(c?.expected_payment_date, today, horizon))
        outflowEvents.push({ date: c.expected_payment_date.slice(0, 10), amount: Number(c.expected_payment_amount ?? 0), label: c?.supplier_name ?? "Commitment" });
    }
    const pis = input.purchaseInvoices ?? [];
    for (const po of input.goodsPOs ?? []) {
      if (!isCommittedPO(po, pis)) continue;
      const d = poExpectedDate(po);
      if (d && inWindow(d, today, horizon))
        outflowEvents.push({ date: d.slice(0, 10), amount: round2(Number(po.grand_total ?? 0)), label: po?.po_number ?? "PO" });
    }
  } else {
    // Base view still shows manual direct outflows; PO commitments excluded entirely.
  }

  const defs = periodDefs(mode, today);
  const periods: ForecastPeriod[] = [];
  let opening = s.availableCash;
  for (const d of defs) {
    const inf = bucketize(inflowEvents, d.start, d.end);
    const out = bucketize(outflowEvents, d.start, d.end);
    const closing = round2(opening + inf - out);
    const status = closing < buffer ? "RED" : closing < buffer * 1.2 ? "AMBER" : "GREEN";
    periods.push({
      ...d,
      openingCash: opening,
      expectedInflows: inf,
      expectedOutflows: out,
      closingCash: closing,
      status,
      events: [...inflowEvents.filter((e) => e.date >= d.start && e.date <= d.end).map((e) => ({ ...e, amount: e.amount })),
        ...outflowEvents.filter((e) => e.date >= d.start && e.date <= d.end).map((e) => ({ ...e, amount: -e.amount }))],
    });
    opening = closing;
  }

  let lowestCash = periods.length ? periods[0].closingCash : s.availableCash;
  let lowestDate: string | null = periods.length ? periods[0].start : null;
  for (const p of periods) {
    if (p.closingCash < lowestCash) {
      lowestCash = p.closingCash;
      lowestDate = p.start;
    }
  }

  const alerts: CashAlert[] = [];
  const firstBreach = periods.find((p) => p.closingCash < buffer);
  if (firstBreach) {
    alerts.push({
      type: "SHORTFALL_RISK",
      message: `Shortfall risk: closing below buffer on ${firstBreach.label}`,
      date: firstBreach.start,
      amount: round2(buffer - firstBreach.closingCash),
    });
  }
  const amber = periods.find((p) => p.status === "AMBER");
  if (amber) {
    alerts.push({
      type: "BUFFER_BREACH",
      message: `Buffer zone: closing within 20% of buffer on ${amber.label}`,
      date: amber.start,
      amount: round2(amber.closingCash - buffer),
    });
  }
  if (s.overdueReceipts > 0 && s.overdueReceipts >= Math.max(buffer, 1)) {
    alerts.push({
      type: "OVERDUE_SPIKE",
      message: "Overdue receivables exceed the cash buffer",
      amount: s.overdueReceipts,
    });
  }

  const cashStatus: ForecastResult["cashStatus"] = firstBreach ? "RED" : amber ? "AMBER" : "GREEN";
  const projected7d = s.availableCash + s.totalInflows7d - s.totalOutflows7d;
  const projected30d = periods.length ? periods[periods.length - 1].closingCash : s.availableCash;

  return { periods, alerts, lowestCash, lowestDate, projected7d: round2(projected7d), projected30d, cashStatus };
}
