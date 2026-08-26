import { useMemo, ReactNode } from "react";
import { AnimatedMoney, AnimatedNumber } from "@/components/animated-number";
import { fmtMoney, fmtDate, daysBetween } from "@/lib/format";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";
import {
  TrendingUp, TrendingDown, Users, DollarSign, Clock,
  AlertTriangle, ArrowUpRight, BarChart3, PieChart as PieIcon,
  Activity, Receipt, FileText, Wallet, ShieldCheck,
} from "lucide-react";

// ── Blue palette (matches dashboard.tsx) ──
const CHART_PRIMARY = "var(--color-primary)";
const CHART_NEUTRAL = "#8CA3B8";
const RAMP = ["#3AA8FF", "#2A8FE0", "#1F78C8", "#1463B0", "#0A4D9E"];
const RAMP_SOFT = ["#E8F4FF", "#D0EAFF", "#B8DFFF", "#A0D4FF", "#88C9FF"];

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
  padding: "8px 12px",
};

// ── Hero Metric Card ──
function HeroMetric({
  label, value, meta, tone = "default", icon: Icon,
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "default" | "primary" | "success" | "warn" | "bad";
  icon?: ReactNode;
}) {
  const toneCls = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];

  const bgCls = {
    default: "from-transparent to-transparent",
    primary: "from-primary/[0.04] to-transparent",
    success: "from-success/[0.04] to-transparent",
    warn: "from-warning/[0.04] to-transparent",
    bad: "from-destructive/[0.04] to-transparent",
  }[tone];

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-xl border border-border bg-card px-5 py-5 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:border-border/80`}>
      {/* Subtle gradient background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${bgCls} pointer-events-none`} />
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {Icon && <span className="text-muted-foreground/50">{Icon}</span>}
          {label}
        </div>
        <div className={`mt-2.5 num num-lg font-semibold tracking-tight ${toneCls}`}>
          {value}
        </div>
        {meta && <div className="mt-1.5 text-[12px] text-muted-foreground leading-snug">{meta}</div>}
      </div>
    </div>
  );
}

// ── Section label ──
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

// ── Rank Badge (1st, 2nd, 3rd) ──
function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) return <span className="text-xs text-muted-foreground/50 font-mono">#{rank}</span>;
  const styles = ["bg-primary text-primary-foreground", "bg-primary/15 text-primary", "bg-primary/8 text-primary/70"];
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${styles[rank - 1]}`}>
      {rank}
    </span>
  );
}

// ── Progress bar ──
function ProgressBar({ value, max, color = "var(--color-primary)" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Types ──
export type CounterpartyKind = "supplier" | "debtor";

export interface DashboardInvoice {
  id: string;
  amount: number;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  short_payment?: number;
  late_days?: number;
  vendor_id?: string;
  debtor_id?: string;
}

export interface DashboardParty {
  id: string;
  company_name?: string;
  name?: string;
  industry?: string | null;
  advance_rate?: number;
  fee_rate?: number;
}

// ── Main Dashboard Component ──
export function CounterpartyDashboard({
  kind,
  parties,
  invoices,
  loading,
}: {
  kind: CounterpartyKind;
  parties: DashboardParty[];
  invoices: DashboardInvoice[];
  loading: boolean;
}) {
  // ── Computed analytics ──
  const analytics = useMemo(() => {
    const nameKey = kind === "supplier" ? "company_name" : "name";
    const idKey = kind === "supplier" ? "vendor_id" : "debtor_id";

    // Party name map
    const partyMap = new Map<string, string>();
    parties.forEach((p) => partyMap.set(p.id, (p as any)[nameKey] || "Unknown"));

    // Basic totals
    const totalAmount = invoices.reduce((s, i) => s + Number(i.amount), 0);
    const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "rejected");
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const outstanding = openInvoices.reduce((s, i) => s + Number(i.amount), 0);
    const collected = paidInvoices.reduce((s, i) => s + Number(i.amount), 0);
    const overdueInvoices = openInvoices.filter((i) => {
      const dpd = i.due_date ? daysBetween(i.due_date) : 0;
      return dpd > 0;
    });
    const overdueTotal = overdueInvoices.reduce((s, i) => s + Number(i.amount), 0);

    // Payment days
    const payDays = paidInvoices
      .filter((i) => i.issue_date && i.paid_date)
      .map((i) => daysBetween(i.issue_date!, i.paid_date!))
      .filter((d) => d >= 0);
    const avgPayDays = payDays.length > 0 ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length) : 0;
    const collectionRate = totalAmount > 0 ? +((collected / totalAmount) * 100).toFixed(1) : 0;

    // Spending/Revenue by party (top 8)
    const partySpend = new Map<string, { total: number; count: number; outstanding: number }>();
    invoices.forEach((i) => {
      const pid = (i as any)[idKey];
      if (!pid) return;
      const existing = partySpend.get(pid) ?? { total: 0, count: 0, outstanding: 0 };
      existing.total += Number(i.amount);
      existing.count += 1;
      if (i.status !== "paid" && i.status !== "rejected") existing.outstanding += Number(i.amount);
      partySpend.set(pid, existing);
    });
    const topParties = [...partySpend.entries()]
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 8)
      .map(([pid, data]) => ({
        name: (partyMap.get(pid) || "Unknown").slice(0, 16),
        fullName: partyMap.get(pid) || "Unknown",
        total: data.total,
        count: data.count,
        outstanding: data.outstanding,
      }));

    // Monthly trend (last 6 months)
    const monthlyMap = new Map<string, { amount: number; count: number }>();
    const now = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthlyMap.set(key, { amount: 0, count: 0 });
    }
    invoices.forEach((i) => {
      if (!i.issue_date) return;
      const d = new Date(i.issue_date);
      const key = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const entry = monthlyMap.get(key);
      if (entry) {
        entry.amount += Number(i.amount);
        entry.count += 1;
      }
    });
    const monthlyTrend = [...monthlyMap.entries()].map(([month, data]) => ({
      month,
      amount: data.amount,
      count: data.count,
    }));

    // Aging breakdown
    const aging = openInvoices.reduce(
      (acc, i) => {
        const dpd = i.due_date ? daysBetween(i.due_date) : 0;
        const amt = Number(i.amount);
        if (dpd <= 0) acc.current += amt;
        else if (dpd <= 30) acc.b1 += amt;
        else if (dpd <= 60) acc.b2 += amt;
        else if (dpd <= 90) acc.b3 += amt;
        else acc.b4 += amt;
        return acc;
      },
      { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }
    );

    // Status distribution
    const statusCounts = new Map<string, number>();
    invoices.forEach((i) => {
      statusCounts.set(i.status, (statusCounts.get(i.status) ?? 0) + 1);
    });

    // Top 5 by outstanding
    const topOutstanding = [...partySpend.entries()]
      .filter(([, d]) => d.outstanding > 0)
      .sort(([, a], [, b]) => b.outstanding - a.outstanding)
      .slice(0, 5)
      .map(([pid, data]) => ({
        name: partyMap.get(pid) || "Unknown",
        outstanding: data.outstanding,
        count: data.count,
      }));

    return {
      partyCount: parties.length,
      totalAmount,
      outstanding,
      collected,
      overdueTotal,
      overdueCount: overdueInvoices.length,
      openCount: openInvoices.length,
      paidCount: paidInvoices.length,
      avgPayDays,
      collectionRate,
      topParties,
      monthlyTrend,
      aging,
      statusCounts,
      topOutstanding,
      totalInvoices: invoices.length,
    };
  }, [kind, parties, invoices]);

  const isSupplier = kind === "supplier";
  const label = isSupplier ? "supplier" : "debtor";
  const metricLabel = isSupplier ? "Spent" : "Invoiced";

  if (loading) {
    return <DashboardSkeleton isSupplier={isSupplier} />;
  }

  if (parties.length === 0) {
    return null; // No data to show
  }

  // Aging chart data
  const agingData = [
    { name: "Current", amount: analytics.aging.current, fill: RAMP[0] },
    { name: "1–30d", amount: analytics.aging.b1, fill: RAMP[1] },
    { name: "31–60d", amount: analytics.aging.b2, fill: RAMP[2] },
    { name: "61–90d", amount: analytics.aging.b3, fill: RAMP[3] },
    { name: "90+d", amount: analytics.aging.b4, fill: RAMP[4] },
  ];

  // Status pie data
  const statusColors: Record<string, string> = {
    paid: "#0F3D6B",
    pending: "#1463B0",
    pending_review: "#2A8FE0",
    approved: "#3AA8FF",
    overdue: "#3F4B5C",
    rejected: "#8CA3B8",
    funded: "#0A4D9E",
    sent: "#1F78C8",
  };
  const statusData = [...analytics.statusCounts.entries()].map(([status, count]) => ({
    name: status.replace(/_/g, " "),
    value: count,
    fill: statusColors[status] || CHART_NEUTRAL,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Hero Metrics ── */}
      <section>
        <SectionLabel>
          {isSupplier ? "Procurement overview" : "Receivables overview"}
        </SectionLabel>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <HeroMetric
            label={`Total ${label}s`}
            value={String(analytics.partyCount)}
            meta={`${analytics.totalInvoices} transactions`}
            icon={<Users className="h-3.5 w-3.5" />}
          />
          <HeroMetric
            label={`Total ${metricLabel}`}
            value={fmtMoney(Math.round(analytics.totalAmount))}
            meta={`${analytics.paidCount} settled · ${analytics.openCount} open`}
            tone="primary"
            icon={<DollarSign className="h-3.5 w-3.5" />}
          />
          <HeroMetric
            label="Outstanding"
            value={fmtMoney(Math.round(analytics.outstanding))}
            meta={analytics.overdueCount > 0 ? `${analytics.overdueCount} overdue` : `${analytics.openCount} open`}
            tone={analytics.outstanding > 0 ? "warn" : "success"}
            icon={analytics.outstanding > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          />
          <HeroMetric
            label={isSupplier ? "Avg payment days" : "Avg collection days"}
            value={`${analytics.avgPayDays}d`}
            meta={isSupplier
              ? `${analytics.collectionRate}% payment rate`
              : `${analytics.collectionRate}% collection rate`
            }
            tone={analytics.avgPayDays > 60 ? "warn" : "default"}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
        </div>
      </section>

      {/* ── Charts Row: Trend + Status ── */}
      <section>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Monthly Trend */}
          <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground/50" />
                {isSupplier ? "Monthly spend" : "Monthly revenue"}
              </h3>
              <span className="text-[10px] text-muted-foreground/60">Last 6 months</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.monthlyTrend} barCategoryGap="20%">
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [fmtMoney(v), metricLabel]} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="amount" name={metricLabel} radius={[4, 4, 0, 0]} barSize={36}>
                    {analytics.monthlyTrend.map((_, idx) => (
                      <Cell key={idx} fill={idx === analytics.monthlyTrend.length - 1 ? CHART_PRIMARY : CHART_NEUTRAL} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Status Distribution */}
          <div className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <PieIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
              Status breakdown
            </div>
            {statusData.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(v: number, name: string) => [v, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 space-y-1.5">
              {statusData.slice(0, 5).map((s) => (
                <div key={s.name} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.fill }} />
                    <span className="text-muted-foreground capitalize">{s.name}</span>
                  </div>
                  <span className="font-mono font-medium">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Top Counterparties ── */}
      <section>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top by total */}
          <div className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
                Top {isSupplier ? "suppliers" : "debtors"} by {metricLabel.toLowerCase()}
              </h3>
              <span className="text-[10px] text-muted-foreground/60">All time</span>
            </div>
            {analytics.topParties.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : (
              <div className="space-y-3">
                {analytics.topParties.slice(0, 5).map((p, idx) => (
                  <div key={p.name} className="group">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <RankBadge rank={idx + 1} />
                        <span className="truncate text-sm font-medium group-hover:text-primary transition-colors">{p.fullName}</span>
                      </div>
                      <span className="ml-3 shrink-0 num text-sm font-semibold">{fmtMoney(Math.round(p.total))}</span>
                    </div>
                    <ProgressBar value={p.total} max={analytics.topParties[0].total} color={RAMP[Math.min(idx, RAMP.length - 1)]} />
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/60">
                      <span>{p.count} transactions</span>
                      {p.outstanding > 0 && <span className="text-warning">{fmtMoney(Math.round(p.outstanding))} outstanding</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top by outstanding */}
          <div className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/50" />
                Top by outstanding balance
              </h3>
              <span className="text-[10px] text-muted-foreground/60">Open only</span>
            </div>
            {analytics.topOutstanding.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <ShieldCheck className="mr-2 h-4 w-4" />
                {isSupplier ? "All suppliers settled" : "All debtors settled"}
              </div>
            ) : (
              <div className="space-y-3">
                {analytics.topOutstanding.map((p, idx) => {
                  const maxOut = analytics.topOutstanding[0].outstanding;
                  return (
                    <div key={p.name} className="group">
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <RankBadge rank={idx + 1} />
                          <span className="truncate text-sm font-medium group-hover:text-primary transition-colors">{p.name}</span>
                        </div>
                        <span className="ml-3 shrink-0 num text-sm font-semibold text-warning">{fmtMoney(Math.round(p.outstanding))}</span>
                      </div>
                      <ProgressBar value={p.outstanding} max={maxOut} color={RAMP[Math.min(idx, RAMP.length - 1)]} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mini stats */}
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Overdue total</div>
                <div className={`mt-1 num text-sm font-semibold ${analytics.overdueTotal > 0 ? "text-destructive" : "text-success"}`}>
                  {fmtMoney(Math.round(analytics.overdueTotal))}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Collection rate</div>
                <div className={`mt-1 num text-sm font-semibold ${analytics.collectionRate >= 80 ? "text-success" : analytics.collectionRate >= 50 ? "text-warning" : "text-destructive"}`}>
                  {analytics.collectionRate}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Avg days</div>
                <div className="mt-1 num text-sm font-semibold">{analytics.avgPayDays}d</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Settled</div>
                <div className="mt-1 num text-sm font-semibold text-success">{analytics.paidCount}/{analytics.totalInvoices}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Aging Distribution (full width) ── */}
      {analytics.outstanding > 0 && (
        <section>
          <SectionLabel>
            {isSupplier ? "Payables aging" : "Receivables aging"}
          </SectionLabel>
          <div className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [fmtMoney(v), "Outstanding"]} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="amount" name="Outstanding" radius={[4, 4, 0, 0]} barSize={48}>
                    {agingData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 border-t border-border/60 pt-4">
              {agingData.map((b) => {
                const total = agingData.reduce((a, x) => a + x.amount, 0) || 1;
                return (
                  <div key={b.name} className="text-center">
                    <div className="text-[10px] font-semibold" style={{ color: b.fill }}>{b.name}</div>
                    <div className="mt-1 num text-xs font-medium">{fmtMoney(Math.round(b.amount))}</div>
                    <div className="text-[10px] text-muted-foreground/50">{total > 0 ? `${((b.amount / total) * 100).toFixed(0)}%` : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Skeleton ──
function DashboardSkeleton({ isSupplier }: { isSupplier: boolean }) {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true">
      <div>
        <div className="mb-3 h-3 w-40 skeleton" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card px-5 py-5">
              <div className="h-2.5 w-24 skeleton" />
              <div className="mt-3 h-7 w-32 skeleton" />
              <div className="mt-2 h-3 w-20 skeleton" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-4 h-4 w-36 skeleton" />
          <div className="h-52 skeleton" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 h-4 w-28 skeleton" />
          <div className="h-40 skeleton" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 h-4 w-44 skeleton" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, r) => <div key={r} className="h-8 skeleton" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
