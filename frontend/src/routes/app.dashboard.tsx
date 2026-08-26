import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ReactNode, useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { AnimatedMoney, AnimatedNumber } from "@/components/animated-number";
import {
  Activity, Paperclip, X, Link2, TrendingUp, FileText, FileSignature, Wallet,
  Receipt, ArrowUpRight, ExternalLink, AlertTriangle, Check, ChevronRight,
  ChevronDown, Clock, Users, Building2, Landmark, BarChart3, ArrowDownRight,
  ArrowUp, ArrowDown, Minus, Shield, Eye, Target, Zap, TrendingDown,
  CircleAlert, CircleCheck, Search, Calendar, RefreshCw, Download, Filter,
  ArrowRight, CircleDot, Info, AlertCircle, DollarSign, Percent, Timer,
  Layers, Package, Truck, ShoppingCart, Briefcase, PieChart as PieIcon,
} from "lucide-react";
import { DocumentList, type DocMeta } from "@/components/document-uploader";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie, AreaChart, Area, LineChart, Line,
  ComposedChart, ReferenceLine,
} from "recharts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

/* ═══════════════════════════════════════════════════════════════
   CHART SYSTEM — Premium institutional blue palette
   ═══════════════════════════════════════════════════════════════ */

const C = {
  primary: "var(--color-primary)",
  primaryLight: "rgba(0, 111, 207, 0.08)",
  success: "#0F3D6B",
  successLight: "rgba(15, 61, 107, 0.08)",
  warning: "#0E4C7E",
  destructive: "#3F4B5C",
  muted: "#8CA3B8",
  mutedLight: "rgba(140, 163, 184, 0.15)",
  grid: "var(--color-border)",
  gridDash: "3 3",
};

// Aging buckets: light → dark blue as receivables age
const AGING_RAMP = ["#3AA8FF", "#2A8FE0", "#1F78C8", "#1463B0", "#0A4D9E"];

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
  padding: "10px 14px",
};

/* ═══════════════════════════════════════════════════════════════
   SHARED UI ATOMS
   ═══════════════════════════════════════════════════════════════ */

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

function TierLabel({ level, children }: { level: 1 | 2 | 3 | 4 | 5; children: ReactNode }) {
  const sizes: Record<number, string> = {
    1: "text-lg",
    2: "text-base",
    3: "text-sm",
    4: "text-sm",
    5: "text-sm",
  };
  return (
    <div className={`font-display font-semibold tracking-tight text-foreground ${sizes[level]}`}>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  change,
  changeLabel,
  meta,
  tone = "default",
  className = "",
  compact = false,
}: {
  label: string;
  value: ReactNode;
  change?: number;
  changeLabel?: string;
  meta?: string;
  tone?: "default" | "positive" | "negative" | "warning" | "primary" | "muted";
  className?: string;
  compact?: boolean;
}) {
  const toneCls = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
    warning: "text-warning",
    primary: "text-primary",
    muted: "text-muted-foreground",
  }[tone];

  const changeColor = change !== undefined
    ? change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground"
    : "";

  return (
    <div className={`min-w-0 ${compact ? "px-3 py-3" : "px-4 py-4 md:px-5 md:py-5"} ${className}`}>
      <div className="label-micro">{label}</div>
      <div className={`mt-2 font-mono font-semibold tracking-tight ${toneCls} ${compact ? "text-base" : "text-xl"}`}>
        {value}
      </div>
      {(change !== undefined || meta) && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {change !== undefined && (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${changeColor}`}>
              {change > 0 ? "↑" : change < 0 ? "↓" : "—"}
              {Math.abs(change).toFixed(1)}%
            </span>
          )}
          {meta && <span className="text-muted-foreground">{meta}</span>}
        </div>
      )}
    </div>
  );
}

function InsightCard({
  icon: Icon,
  headline,
  explanation,
  impact,
  variant = "info",
  detailTo,
}: {
  icon: React.ComponentType<{ className?: string }>;
  headline: string;
  explanation: string;
  impact?: string;
  variant?: "info" | "warning" | "critical" | "success";
  detailTo?: string;
}) {
  const borderCls = {
    info: "border-l-info",
    warning: "border-l-warning",
    critical: "border-l-destructive",
    success: "border-l-success",
  }[variant];

  const iconBg = {
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    critical: "bg-destructive/10 text-destructive",
    success: "bg-success/10 text-success",
  }[variant];

  return (
    <div className={`rounded-lg border border-border border-l-[3px] ${borderCls} bg-card p-4 transition-shadow hover:shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{headline}</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{explanation}</div>
          {impact && (
            <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
              Financial impact: <span className="text-foreground">{impact}</span>
            </div>
          )}
        </div>
        {detailTo && (
          <Link to={detailTo} className="shrink-0 text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">
            View details →
          </Link>
        )}
      </div>
    </div>
  );
}

function RingScore({ score, label, size = 160 }: { score: number; label: string; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "var(--color-primary)" : score >= 40 ? "var(--color-warning)" : "var(--color-destructive)";

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={10} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={10}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <div className="font-mono text-3xl font-bold tracking-tight text-foreground">{score}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function MiniBar({ value, max, color = C.primary }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FORMATTING HELPERS
   ═══════════════════════════════════════════════════════════════ */

function abbrevMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function pctOf(a: number, b: number): string {
  if (b === 0) return "—";
  return ((a / b) * 100).toFixed(1) + "%";
}

/* ═══════════════════════════════════════════════════════════════
   MAIN DASHBOARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function Dashboard() {
  const { isAdmin, isTreasury, user } = useAuth();
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);
  const [advanceTab, setAdvanceTab] = useState<"sales" | "purchase">("sales");
  const [shortPaymentsOpen, setShortPaymentsOpen] = useState(false);
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);

  /* ── Data Queries ── */
  const invoicesQ = useQuery({
    queryKey: ["invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
    refetchInterval: 30_000,
  });

  const purchasesQ = useQuery({
    queryKey: ["purchase_invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
    refetchInterval: 30_000,
  });

  const expensesQ = useQuery({
    queryKey: ["expenses", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/expenses")) ?? [],
    refetchInterval: 30_000,
  });

  const alertsQ = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => (await api.get<any[]>("/alerts")) ?? [],
    refetchInterval: 30_000,
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
    refetchInterval: 30_000,
  });

  const proformasQ = useQuery({
    queryKey: ["proformas"],
    queryFn: async () => (await api.get<any[]>("/purchase-orders")) ?? [],
    refetchInterval: 30_000,
  });

  const creditNotesQ = useQuery({
    queryKey: ["credit-note-totals"],
    queryFn: async () =>
      (await api.get<any>("/reports/credit-notes")) ?? { creditNoteTotal: 0, debitNoteTotal: 0 },
    refetchInterval: 30_000,
  });

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => (await api.get<any[]>("/advances")) ?? [],
    refetchInterval: 30_000,
  });

  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await api.get<any[]>("/suppliers")) ?? [],
    refetchInterval: 60_000,
  });

  const vendorsQ = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
    refetchInterval: 60_000,
  });

  const creditDebitNotesQ = useQuery({
    queryKey: ["credit-debit-notes"],
    queryFn: async () => (await api.get<any[]>("/credit-debit-notes")) ?? [],
    refetchInterval: 30_000,
  });

  /* ── Raw data ── */
  const invoices = invoicesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const proformas = proformasQ.data ?? [];
  const advances = advancesQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const creditDebitNotes = creditDebitNotesQ.data ?? [];

  /* ── Initial loading skeleton ── */
  const initialLoading = [invoicesQ, purchasesQ, expensesQ, proformasQ, advancesQ, alertsQ, debtorsQ, creditNotesQ].some((q) => q.isPending);

  /* ═══════════════════════════════════════════════════════════════
     ALL COMPUTED METRICS — transparent formulas
     ═══════════════════════════════════════════════════════════════ */
  const m = useMemo(() => {
    // Core financials
    const salesTotal = invoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const purchaseTotal = purchases.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const expenseTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);

    const creditNoteTotal = Number(creditNotesQ.data?.creditNoteTotal ?? 0);
    const debitNoteTotal = Number(creditNotesQ.data?.debitNoteTotal ?? 0);
    // Revenue: reduce by debit notes only
    const salesReturns = debitNoteTotal;
    const netSales = salesTotal - salesReturns;
    // COGS: reduce by credit notes only
    const netPurchases = purchaseTotal - creditNoteTotal;
    const gross = netSales - netPurchases;
    const net = gross - expenseTotal;

    const grossMargin = netSales > 0 ? (gross / netSales) * 100 : 0;
    const netMargin = netSales > 0 ? (net / netSales) * 100 : 0;
    const expenseRatio = netSales > 0 ? (expenseTotal / netSales) * 100 : 0;

    // Receivables
    const totalOutstanding = invoices
      .filter((i: any) => i.status !== "paid" && i.status !== "rejected")
      .reduce((s: number, i: any) => s + Number(i.amount), 0);
    const collectedAmount = invoices.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
    const openInvoiceCount = invoices.filter((i: any) => i.status !== "paid" && i.status !== "rejected").length;
    const paidInvoices = invoices.filter((i: any) => i.status === "paid");
    const totalShortPayment = paidInvoices.reduce((s: number, i: any) => s + Number(i.short_payment ?? 0), 0);
    const shortPaidInvoices = paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0);

    // Payment days
    const paidSalesInvoices = invoices.filter((i: any) => i.status === "paid" && i.issue_date && i.paid_date);
    const avgSalesPayDays = paidSalesInvoices.length > 0
      ? Math.round(paidSalesInvoices.reduce((s: number, i: any) => s + daysBetween(i.issue_date, i.paid_date), 0) / paidSalesInvoices.length)
      : 0;

    const paidPurchaseInvoices = purchases.filter((p: any) => p.status === "paid" && p.issue_date && p.paid_date);
    const avgPurchasePayDays = paidPurchaseInvoices.length > 0
      ? Math.round(paidPurchaseInvoices.reduce((s: number, p: any) => s + daysBetween(p.issue_date, p.paid_date), 0) / paidPurchaseInvoices.length)
      : 0;

    const collectionRate = salesTotal > 0 ? +((collectedAmount / salesTotal) * 100).toFixed(2) : 0;
    const workingCapitalGap = avgSalesPayDays - avgPurchasePayDays;

    // Aging buckets
    const aging = invoices.reduce(
      (acc: any, i: any) => {
        if (i.status === "paid" || i.status === "rejected") return acc;
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

    const overdueTotal = aging.b1 + aging.b2 + aging.b3 + aging.b4;
    const highRiskAmount = aging.b4;

    // Customer concentration (top debtors by outstanding)
    const debtorExposure = new Map<string, { name: string; outstanding: number; count: number; id: string }>();
    invoices.filter((i: any) => i.status !== "paid" && i.status !== "rejected").forEach((i: any) => {
      const did = i.debtor_id;
      const name = i.debtor?.name ?? "Unknown";
      const existing = debtorExposure.get(did) ?? { name, outstanding: 0, count: 0, id: did };
      existing.outstanding += Number(i.amount);
      existing.count += 1;
      debtorExposure.set(did, existing);
    });
    const topDebtors = [...debtorExposure.values()].sort((a, b) => b.outstanding - a.outstanding);
    const top5Concentration = totalOutstanding > 0
      ? topDebtors.slice(0, 5).reduce((s, d) => s + d.outstanding, 0) / totalOutstanding * 100
      : 0;

    // Supplier exposure
    const vendorPayable = new Map<string, { name: string; amount: number; count: number }>();
    purchases.filter((p: any) => p.status !== "paid").forEach((p: any) => {
      const vid = p.vendor_id;
      const name = p.vendor?.name ?? p.vendor_name ?? "Unknown";
      const existing = vendorPayable.get(vid) ?? { name, amount: 0, count: 0 };
      existing.amount += Number(p.amount);
      existing.count += 1;
      vendorPayable.set(vid, existing);
    });
    const topVendors = [...vendorPayable.values()].sort((a, b) => b.amount - a.amount);
    const totalPayable = purchases.filter((p: any) => p.status !== "paid").reduce((s: number, p: any) => s + Number(p.amount), 0);

    // Invoice operations
    const totalInvoices = invoices.length;
    const totalPurchaseInvoices = purchases.length;
    const settledInvoices = invoices.filter((i: any) => i.status === "paid").length;
    const pendingInvoices = invoices.filter((i: any) => i.status === "draft" || i.status === "submitted" || i.status === "pending_review").length;
    const overdueInvoices = invoices.filter((i: any) => i.status === "overdue").length;
    const disputedInvoices = invoices.filter((i: any) => i.status === "rejected" || i.status === "disputed").length;

    // Expense categories
    const expenseByCategory = new Map<string, number>();
    expenses.forEach((e: any) => {
      const cat = e.category || "Other";
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + Number(e.amount));
    });
    const expenseCategories = [...expenseByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({ category, amount }));

    // Short payments by customer
    const shortPayByDebtor = new Map<string, { name: string; amount: number; count: number }>();
    shortPaidInvoices.forEach((i: any) => {
      const name = i.debtor?.name ?? "Unknown";
      const existing = shortPayByDebtor.get(i.debtor_id) ?? { name, amount: 0, count: 0 };
      existing.amount += Number(i.short_payment);
      existing.count += 1;
      shortPayByDebtor.set(i.debtor_id, existing);
    });
    const shortPayByCustomer = [...shortPayByDebtor.values()].sort((a, b) => b.amount - a.amount);

    // Monthly revenue for chart (group by month)
    const monthlyRevenue = new Map<string, number>();
    const monthlyCOGS = new Map<string, number>();
    invoices.forEach((i: any) => {
      if (!i.issue_date) return;
      const month = i.issue_date.slice(0, 7);
      monthlyRevenue.set(month, (monthlyRevenue.get(month) ?? 0) + Number(i.amount));
    });
    purchases.forEach((p: any) => {
      if (!p.issue_date) return;
      const month = p.issue_date.slice(0, 7);
      monthlyCOGS.set(month, (monthlyCOGS.get(month) ?? 0) + Number(p.amount));
    });

    // Merge all months
    const allMonths = new Set([...monthlyRevenue.keys(), ...monthlyCOGS.keys()]);
    const revenueChartData = [...allMonths].sort().map((month) => {
      const revenue = monthlyRevenue.get(month) ?? 0;
      const cogs = monthlyCOGS.get(month) ?? 0;
      const gp = revenue - cogs;
      const ni = gp - expenseTotal / Math.max(1, allMonths.size);
      return {
        month,
        label: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        revenue,
        cogs,
        grossProfit: gp,
        netIncome: ni,
        grossMargin: revenue > 0 ? ((gp / revenue) * 100).toFixed(1) : "0",
      };
    });

    // Aging count
    const agingCount = invoices.reduce(
      (acc: any, i: any) => {
        if (i.status === "paid" || i.status === "rejected") return acc;
        const dpd = i.due_date ? daysBetween(i.due_date) : 0;
        if (dpd <= 0) acc.current += 1;
        else if (dpd <= 30) acc.b1 += 1;
        else if (dpd <= 60) acc.b2 += 1;
        else if (dpd <= 90) acc.b3 += 1;
        else acc.b4 += 1;
        return acc;
      },
      { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }
    );

    // Financial Health Score (transparent methodology)
    // Components: Profitability (25), Cash Flow (20), Receivables (20), Collections (15), Working Capital (10), Risk (10)
    const profitabilityScore = (() => {
      let s = 0;
      if (netMargin > 20) s = 25;
      else if (netMargin > 10) s = 20;
      else if (netMargin > 0) s = 15;
      else if (netMargin > -10) s = 8;
      else s = 0;
      return s;
    })();

    const cashFlowScore = (() => {
      let s = 0;
      if (avgSalesPayDays <= 30) s = 20;
      else if (avgSalesPayDays <= 45) s = 16;
      else if (avgSalesPayDays <= 60) s = 12;
      else if (avgSalesPayDays <= 90) s = 8;
      else s = 4;
      return s;
    })();

    const receivablesScore = (() => {
      const arRatio = totalOutstanding > 0 && netSales > 0 ? totalOutstanding / netSales : 0;
      if (arRatio < 0.15) s = 20;
      else if (arRatio < 0.25) s = 16;
      else if (arRatio < 0.40) s = 12;
      else if (arRatio < 0.60) s = 8;
      else s = 4;
      var s = 0;
      return s;
    })();

    const collectionsScore = (() => {
      if (collectionRate >= 95) return 15;
      if (collectionRate >= 85) return 12;
      if (collectionRate >= 70) return 9;
      if (collectionRate >= 50) return 6;
      return 3;
    })();

    const workingCapitalScore = (() => {
      const gap = Math.abs(workingCapitalGap);
      if (gap <= 15) return 10;
      if (gap <= 30) return 8;
      if (gap <= 50) return 6;
      if (gap <= 70) return 4;
      return 2;
    })();

    const riskScore = (() => {
      const overdueRatio = totalOutstanding > 0 ? highRiskAmount / totalOutstanding : 0;
      if (overdueRatio < 0.05) return 10;
      if (overdueRatio < 0.10) return 8;
      if (overdueRatio < 0.20) return 6;
      if (overdueRatio < 0.35) return 4;
      return 2;
    })();

    const financialHealthScore = Math.min(100, profitabilityScore + cashFlowScore + receivablesScore + collectionsScore + workingCapitalScore + riskScore);

    // Invoice status funnels
    const allDocs = invoices.length + purchases.length;
    const settledDocs = settledInvoices + purchases.filter((p: any) => p.status === "paid").length;
    const activeInvoices = totalInvoices - settledInvoices - disputedInvoices;
    const overdueDocCount = overdueInvoices + purchases.filter((p: any) => p.status === "overdue").length;

    // Advances
    const salesAdvancesTotal = advances.filter((a: any) => a.side === "sales").reduce((s: number, a: any) => s + Number(a.amount), 0);
    const purchaseAdvancesTotal = advances.filter((a: any) => a.side === "purchase").reduce((s: number, a: any) => s + Number(a.amount), 0);

    // Credit debit notes
    const totalCreditNotes = creditNoteTotal;
    const totalDebitNotes = debitNoteTotal;

    // Month-end readiness proxy
    const monthEndPending = pendingInvoices;
    const monthEndUnsettled = openInvoiceCount;
    const monthEndUnapplied = creditDebitNotes.filter((n: any) => n.status === "pending").length;
    const monthEndMissingDocs = invoices.filter((i: any) => !i.documents || i.documents.length === 0).length;
    const readinessItems = 5;
    const readinessReady = readinessItems - (monthEndPending > 0 ? 1 : 0) - (monthEndUnsettled > 0 ? 1 : 0) - (monthEndUnapplied > 0 ? 1 : 0) - (monthEndMissingDocs > 0 ? 1 : 0) - (overdueInvoices > 0 ? 1 : 0);
    const readinessPct = Math.round(((Math.max(0, readinessReady)) / readinessItems) * 100);

    // Recent activity (last 8 alerts)
    const recentAlerts = (alertsQ.data ?? []).slice(0, 8);

    return {
      // Core
      salesTotal, purchaseTotal, expenseTotal, salesReturns,
      netSales, netPurchases, gross, net,
      grossMargin, netMargin, expenseRatio,
      // Receivables
      totalOutstanding, collectedAmount, openInvoiceCount,
      paidInvoices, totalShortPayment, shortPaidInvoices,
      shortPayByCustomer,
      // Payment days
      avgSalesPayDays, avgPurchasePayDays, collectionRate, workingCapitalGap,
      // Aging
      aging, overdueTotal, highRiskAmount, agingCount,
      // Customers
      topDebtors, top5Concentration,
      // Suppliers
      topVendors, totalPayable,
      // Invoice ops
      totalInvoices, totalPurchaseInvoices, settledInvoices,
      pendingInvoices, overdueInvoices, disputedInvoices,
      // Expenses
      expenseCategories,
      // Charts
      revenueChartData,
      // Health
      financialHealthScore,
      profitabilityScore, cashFlowScore, receivablesScore,
      collectionsScore, workingCapitalScore, riskScore,
      // Invoices funnel
      allDocs, settledDocs, activeInvoices, overdueDocCount,
      // Advances
      salesAdvancesTotal, purchaseAdvancesTotal,
      // Credit notes
      totalCreditNotes, totalDebitNotes,
      // Month end
      readinessPct, monthEndPending, monthEndUnsettled,
      monthEndUnapplied, monthEndMissingDocs,
      // Recent
      recentAlerts,
    };
  }, [invoices, purchases, expenses, proformas, advances, suppliers, vendors, creditDebitNotes, creditNotesQ.data, alertsQ.data, debtorsQ.data]);

  const isTreasuryView = isTreasury;

  const eyebrow = isAdmin ? "Overview" : isTreasury ? "Treasury" : "Overview";
  const titleText = isAdmin ? "Dashboard" : isTreasury ? "Funding Overview" : "Dashboard";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 md:px-6 bg-[var(--color-surface-subtle)] min-h-screen">
      {/* ═══════════════════════════════════════════════════════════════
         § 3. EXECUTIVE HEADER
         ═══════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {eyebrow}
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {titleText}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Track revenue, profitability, cash flow, receivables, and operational risk across your portfolio.
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Data synchronized
              </span>
              <span>·</span>
              <span>Last updated just now</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="lg" variant="outline" className="text-xs">
              <Link to={isTreasury ? "/app/queue" : "/app/invoices"}>
                {isTreasury ? "Open funding queue" : "Open invoice queue"}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {initialLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════
             § 4. FINANCIAL HEALTH SCORE + § 5. FINANCIAL PERFORMANCE HERO
             ═══════════════════════════════════════════════════════════════ */}
          <section className="grid gap-6 lg:grid-cols-[340px_1fr]">
            {/* Health Score */}
            <div className="rounded-xl border border-border bg-card p-6 flex flex-col items-center justify-center relative">
              <SectionLabel>Financial Health</SectionLabel>
              <div className="relative mt-2">
                <RingScore score={m.financialHealthScore} label="Score" />
              </div>
              <div className="mt-4 text-center">
                <div className={`text-sm font-semibold ${
                  m.financialHealthScore >= 70 ? "text-success" : m.financialHealthScore >= 40 ? "text-warning" : "text-destructive"
                }`}>
                  {m.financialHealthScore >= 70 ? "Healthy" : m.financialHealthScore >= 40 ? "Needs Attention" : "At Risk"}
                </div>
              </div>
              <div className="mt-4 w-full space-y-2">
                {[
                  { label: "Profitability", score: m.profitabilityScore, max: 25 },
                  { label: "Cash Flow", score: m.cashFlowScore, max: 20 },
                  { label: "Receivables", score: m.receivablesScore, max: 20 },
                  { label: "Collections", score: m.collectionsScore, max: 15 },
                  { label: "Working Capital", score: m.workingCapitalScore, max: 10 },
                  { label: "Risk", score: m.riskScore, max: 10 },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-24 text-right">{f.label}</span>
                    <div className="flex-1">
                      <MiniBar value={f.score} max={f.max} />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">{f.score}/{f.max}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Performance Hero */}
            <div className="rounded-xl border border-border bg-card">
              <div className="border-b border-border/60 px-6 py-3.5">
                <h3 className="font-display text-sm font-semibold text-foreground">Financial Performance</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Current period overview</p>
              </div>
              <div className="grid divide-y lg:grid-cols-4 lg:divide-y-0 lg:divide-x divide-border/60">
                {!isTreasuryView && (
                  <MetricCard
                    label="Revenue"
                    value={<AnimatedMoney value={Math.round(m.netSales)} />}
                    change={m.salesReturns > 0 ? undefined : undefined}
                    meta={`${m.totalInvoices} invoices · −${fmtMoney(Math.round(m.salesReturns))} returns`}
                  />
                )}
                {!isTreasuryView && (
                  <MetricCard
                    label="Gross Profit"
                    value={<AnimatedMoney value={Math.round(m.gross)} />}
                    tone={m.grossMargin >= 0 ? "positive" : "negative"}
                    meta={`${m.grossMargin.toFixed(1)}% margin`}
                  />
                )}
                {!isTreasuryView && (
                  <MetricCard
                    label="Net Income"
                    value={<AnimatedMoney value={Math.round(m.net)} />}
                    tone={m.netMargin >= 0 ? "positive" : "negative"}
                    meta={`${m.netMargin.toFixed(1)}% net margin`}
                  />
                )}
                <MetricCard
                  label="Outstanding AR"
                  value={<AnimatedMoney value={Math.round(m.totalOutstanding)} />}
                  tone="primary"
                  meta={`${m.openInvoiceCount} invoices · ${pctOf(m.totalOutstanding, m.netSales)} of revenue`}
                />
                {!isTreasuryView && (
                  <MetricCard
                    label="Expenses"
                    value={<AnimatedMoney value={Math.round(m.expenseTotal)} />}
                    meta={`${m.expenseRatio.toFixed(1)}% of revenue`}
                  />
                )}
                {!isTreasuryView && (
                  <MetricCard
                    label="Collection Rate"
                    value={`${m.collectionRate}%`}
                    tone={m.collectionRate >= 85 ? "positive" : m.collectionRate >= 60 ? "warning" : "negative"}
                    meta={`${fmtMoney(Math.round(m.collectedAmount))} collected`}
                  />
                )}
                <MetricCard
                  label="Avg Sales Pay Days"
                  value={String(m.avgSalesPayDays)}
                  tone={m.avgSalesPayDays <= 45 ? "positive" : m.avgSalesPayDays <= 75 ? "warning" : "negative"}
                  meta="Customer payment cycle"
                />
                <MetricCard
                  label="Avg Purchase Pay Days"
                  value={String(m.avgPurchasePayDays)}
                  meta="Supplier payment cycle"
                />
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 6. EXECUTIVE INSIGHTS
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && m.totalOutstanding > 0 && (
            <section>
              <SectionLabel>Key Insights</SectionLabel>
              <div className="grid gap-3 md:grid-cols-2">
                {m.totalOutstanding > 0 && (
                  <InsightCard
                    icon={Clock}
                    headline="Receivables are a working-capital constraint"
                    explanation={`${fmtMoney(Math.round(m.totalOutstanding))} is currently outstanding across ${m.openInvoiceCount} invoices, representing ${pctOf(m.totalOutstanding, m.netSales)} of revenue.`}
                    impact={fmtMoney(Math.round(m.totalOutstanding))}
                    variant="warning"
                    detailTo="/app/invoices"
                  />
                )}
                {m.workingCapitalGap > 10 && (
                  <InsightCard
                    icon={Timer}
                    headline="Customer payment cycles are slower than supplier cycles"
                    explanation={`Customers take ${m.avgSalesPayDays} days to pay while suppliers are paid in ${m.avgPurchasePayDays} days. Cash remains committed for ${m.workingCapitalGap} days.`}
                    impact={`${m.workingCapitalGap} days gap`}
                    variant="warning"
                  />
                )}
                {m.shortPaidInvoices.length > 0 && (
                  <InsightCard
                    icon={AlertTriangle}
                    headline="Short-payment discrepancies require attention"
                    explanation={`${m.shortPaidInvoices.length} invoices contain ${fmtMoney(Math.round(m.totalShortPayment))} in short payments.`}
                    impact={fmtMoney(Math.round(m.totalShortPayment))}
                    variant="critical"
                    detailTo="/app/invoices"
                  />
                )}
                {m.grossMargin >= 20 && (
                  <InsightCard
                    icon={TrendingUp}
                    headline="Gross margin remains healthy"
                    explanation={`Gross margin is currently ${m.grossMargin.toFixed(1)}%, indicating strong pricing discipline.`}
                    variant="success"
                  />
                )}
                {m.overdueTotal > 0 && (
                  <InsightCard
                    icon={AlertCircle}
                    headline={`${fmtMoney(Math.round(m.overdueTotal))} in overdue receivables`}
                    explanation={`${m.overdueInvoices} invoices are past their due date. ${m.highRiskAmount > 0 ? `${fmtMoney(Math.round(m.highRiskAmount))} is over 90 days overdue.` : "No critical aging yet."}`}
                    impact={fmtMoney(Math.round(m.overdueTotal))}
                    variant={m.highRiskAmount > 0 ? "critical" : "warning"}
                    detailTo="/app/invoices"
                  />
                )}
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 7. REVENUE & PROFITABILITY CHART
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && m.revenueChartData.length > 0 && (
            <section>
              <Card
                title="Revenue & Profitability"
                action={
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" /> Monthly trend
                  </span>
                }
              >
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={m.revenueChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.primary} stopOpacity={0.12} />
                          <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.grid} strokeDasharray={C.gridDash} vertical={false} />
                      <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => abbrevMoney(v)} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v: number, name: string) => [fmtMoney(v), name.replace(/([A-Z])/g, " $1").trim()]}
                        cursor={{ fill: "var(--color-muted)" }}
                      />
                      <Area type="monotone" dataKey="revenue" stroke={C.primary} fill="url(#revenueGrad)" strokeWidth={2} name="Revenue" />
                      <Bar dataKey="cogs" fill={C.mutedLight} name="COGS" radius={[3, 3, 0, 0]} barSize={18} />
                      <Line type="monotone" dataKey="grossProfit" stroke={C.success} strokeWidth={2} dot={false} name="Gross Profit" />
                      <Line type="monotone" dataKey="netIncome" stroke={C.primary} strokeWidth={2} dot={false} strokeDasharray="5 5" name="Net Income" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border/50 pt-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.primary }} /> Revenue</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.muted }} /> COGS</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.success }} /> Gross Profit</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: C.primary }} /> Net Income</span>
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 8. PROFITABILITY WATERFALL
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && (
            <section>
              <Card title="Where Revenue Goes">
                <div className="flex flex-col sm:flex-row items-stretch gap-0 sm:gap-2 py-4">
                  {[
                    { label: "Revenue", value: m.netSales, color: C.primary, sub: "Sales less debit notes" },
                    { label: "COGS", value: -m.netPurchases, color: C.muted, sub: "Purchases less credit notes" },
                    { label: "Gross Profit", value: m.gross, color: C.success, sub: `${m.grossMargin.toFixed(1)}% margin`, isResult: true },
                    { label: "Expenses", value: -m.expenseTotal, color: C.muted, sub: `${m.expenseRatio.toFixed(1)}% of revenue` },
                    { label: "Net Income", value: m.net, color: m.net >= 0 ? C.primary : C.destructive, sub: `${m.netMargin.toFixed(1)}% margin`, isResult: true },
                  ].map((step, idx) => (
                    <div key={step.label} className="flex-1 flex flex-col items-center">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">{step.label}</div>
                      <div
                        className={`w-full rounded-lg px-3 py-4 text-center transition-all ${
                          step.isResult ? "border-2" : "border border-border/60"
                        }`}
                        style={{
                          borderColor: step.isResult ? step.color : undefined,
                          background: step.value >= 0 ? "var(--color-card)" : "var(--color-surface-subtle)",
                        }}
                      >
                        <div className={`font-mono text-lg font-bold ${step.value >= 0 ? "text-foreground" : "text-destructive"}`}>
                          {step.value >= 0 ? "" : "−"}{fmtMoney(Math.abs(Math.round(step.value)))}
                        </div>
                      </div>
                      <div className="mt-1.5 text-[10px] text-muted-foreground text-center">{step.sub}</div>
                      {idx < 4 && (
                        <div className="hidden sm:flex absolute items-center justify-center" style={{ display: "none" }}>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 9. CASH FLOW & LIQUIDITY
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && (
            <section>
              <SectionLabel>Cash Flow & Liquidity</SectionLabel>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="font-display text-sm font-semibold text-foreground mb-4">Cash Conversion Proxy</h4>
                  <p className="text-[11px] text-muted-foreground mb-4">
                    Based on receivables, collection rate, and payment cycles. Actual bank data not available.
                  </p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Cash tied in receivables</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{fmtMoney(Math.round(m.totalOutstanding))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Avg customer payment cycle</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{m.avgSalesPayDays} days</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Avg supplier payment cycle</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{m.avgPurchasePayDays} days</span>
                    </div>
                    <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">Working capital gap</span>
                      <span className={`font-mono text-sm font-bold ${m.workingCapitalGap > 0 ? "text-destructive" : "text-success"}`}>
                        {m.workingCapitalGap > 0 ? "+" : ""}{m.workingCapitalGap} days
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg bg-surface-subtle p-3 text-[11px] text-muted-foreground leading-relaxed">
                    Cash remains committed for approximately <span className="font-semibold text-foreground">{Math.abs(m.workingCapitalGap)} days</span> between supplier settlement and customer collection.
                    {m.workingCapitalGap > 30 && " This extended gap may require working capital financing."}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="font-display text-sm font-semibold text-foreground mb-4">Working Capital Timeline</h4>
                  <div className="space-y-6 mt-6">
                    {/* Customer timeline */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Customer Payment</span>
                      </div>
                      <div className="relative h-8 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.min(100, (m.avgSalesPayDays / Math.max(m.avgSalesPayDays, m.avgPurchasePayDays, 1)) * 100)}%`,
                            background: `linear-gradient(90deg, ${C.primary}22, ${C.primary})`,
                          }}
                        />
                        <div className="absolute inset-0 flex items-center px-3">
                          <span className="text-[11px] font-semibold text-foreground">{m.avgSalesPayDays} days</span>
                        </div>
                      </div>
                    </div>

                    {/* Supplier timeline */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Supplier Payment</span>
                      </div>
                      <div className="relative h-8 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.min(100, (m.avgPurchasePayDays / Math.max(m.avgSalesPayDays, m.avgPurchasePayDays, 1)) * 100)}%`,
                            background: `linear-gradient(90deg, ${C.success}22, ${C.success})`,
                          }}
                        />
                        <div className="absolute inset-0 flex items-center px-3">
                          <span className="text-[11px] font-semibold text-foreground">{m.avgPurchasePayDays} days</span>
                        </div>
                      </div>
                    </div>

                    {/* Gap indicator */}
                    {m.workingCapitalGap > 0 && (
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                          <span className="text-xs font-semibold text-foreground">
                            {m.workingCapitalGap}-day working capital gap
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Suppliers are paid {m.workingCapitalGap} days before customers pay you.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 10 & 11. RECEIVABLES INTELLIGENCE + AGING
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <SectionLabel>Receivables Intelligence</SectionLabel>
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              {/* Main receivables card */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <div className="font-mono text-2xl font-bold text-foreground">{fmtMoney(Math.round(m.totalOutstanding))}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{m.openInvoiceCount} invoices outstanding</div>
                  </div>
                  <Link to="/app/invoices" search={{ tab: "list", view: undefined }} className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">
                    Review receivables →
                  </Link>
                </div>

                {/* Stacked bar */}
                <div className="h-8 rounded-full overflow-hidden flex mb-4">
                  {[
                    { label: "Current", val: m.aging.current, color: AGING_RAMP[0] },
                    { label: "1–30", val: m.aging.b1, color: AGING_RAMP[1] },
                    { label: "31–60", val: m.aging.b2, color: AGING_RAMP[2] },
                    { label: "61–90", val: m.aging.b3, color: AGING_RAMP[3] },
                    { label: "90+", val: m.aging.b4, color: AGING_RAMP[4] },
                  ].map((b) => (
                    <div
                      key={b.label}
                      className="h-full transition-all duration-500 relative group"
                      style={{
                        width: m.totalOutstanding > 0 ? `${(b.val / m.totalOutstanding) * 100}%` : "20%",
                        background: b.color,
                        minWidth: b.val > 0 ? "2px" : "0",
                      }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                        <div className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-[10px] shadow-lg whitespace-nowrap">
                          <div className="font-semibold text-foreground">{b.label}</div>
                          <div className="text-muted-foreground">{fmtMoney(Math.round(b.val))}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Aging labels */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[
                    { label: "Current", val: m.aging.current, count: m.agingCount.current, color: AGING_RAMP[0] },
                    { label: "1–30d", val: m.aging.b1, count: m.agingCount.b1, color: AGING_RAMP[1] },
                    { label: "31–60d", val: m.aging.b2, count: m.agingCount.b2, color: AGING_RAMP[2] },
                    { label: "61–90d", val: m.aging.b3, count: m.agingCount.b3, color: AGING_RAMP[3] },
                    { label: "90+d", val: m.aging.b4, count: m.agingCount.b4, color: AGING_RAMP[4] },
                  ].map((b) => (
                    <div key={b.label} className="text-center">
                      <div className="text-[10px] font-semibold" style={{ color: b.color }}>{b.label}</div>
                      <div className="mt-0.5 text-xs font-mono text-foreground">{fmtMoney(Math.round(b.val))}</div>
                      <div className="text-[10px] text-muted-foreground">{b.count} inv</div>
                    </div>
                  ))}
                </div>

                {/* Key metrics row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-border/50 pt-4">
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Overdue Exposure</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-foreground">{fmtMoney(Math.round(m.overdueTotal))}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">High-Risk (90+)</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-destructive">{m.agingCount.b4} invoices</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collection Rate</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-foreground">{m.collectionRate}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Collection</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-foreground">{m.avgSalesPayDays}d</div>
                  </div>
                </div>
              </div>

              {/* Aging chart */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-display text-sm font-semibold text-foreground mb-4">Aging Distribution</h4>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: "Current", amount: m.aging.current, fill: AGING_RAMP[0] },
                      { name: "1–30", amount: m.aging.b1, fill: AGING_RAMP[1] },
                      { name: "31–60", amount: m.aging.b2, fill: AGING_RAMP[2] },
                      { name: "61–90", amount: m.aging.b3, fill: AGING_RAMP[3] },
                      { name: "90+", amount: m.aging.b4, fill: AGING_RAMP[4] },
                    ]} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray={C.gridDash} horizontal={false} />
                      <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={10} tickFormatter={(v) => abbrevMoney(v)} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} axisLine={false} width={50} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [fmtMoney(v), "Amount"]} />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={16}>
                        {[AGING_RAMP[0], AGING_RAMP[1], AGING_RAMP[2], AGING_RAMP[3], AGING_RAMP[4]].map((color, idx) => (
                          <Cell key={idx} fill={color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {m.highRiskAmount > 0 && (
                  <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-[11px] font-semibold text-destructive">At Risk</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmtMoney(Math.round(m.highRiskAmount))} is currently more than 90 days overdue.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 12. CUSTOMER CONCENTRATION
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && m.topDebtors.length > 0 && (
            <section>
              <SectionLabel>Customer Exposure</SectionLabel>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-foreground">Top Customers by Outstanding</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Top 5 represent <span className="font-semibold text-foreground">{m.top5Concentration.toFixed(1)}%</span> of outstanding receivables
                    </p>
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={m.topDebtors.slice(0, 8).map((d) => ({
      name: d.name.length > 16 ? d.name.slice(0, 14) + "…" : d.name,
      outstanding: d.outstanding,
      count: d.count,
    }))} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray={C.gridDash} horizontal={false} />
                      <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={10} tickFormatter={(v) => abbrevMoney(v)} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} axisLine={false} width={120} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v: number, name: string, props: any) => [fmtMoney(v), `Outstanding · ${props.payload.count} invoices`]}
                      />
                      <Bar dataKey="outstanding" name="Outstanding" fill={C.primary} radius={[0, 4, 4, 0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 13. SUPPLIER EXPOSURE
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && m.topVendors.length > 0 && (
            <section>
              <SectionLabel>Supplier Exposure</SectionLabel>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-foreground">Top Suppliers by Payable</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Total payable: <span className="font-semibold text-foreground">{fmtMoney(Math.round(m.totalPayable))}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  {m.topVendors.slice(0, 6).map((v, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-28 truncate text-xs text-muted-foreground font-medium" title={v.name}>
                        {v.name.length > 18 ? v.name.slice(0, 16) + "…" : v.name}
                      </div>
                      <div className="flex-1">
                        <MiniBar value={v.amount} max={m.topVendors[0]?.amount ?? 1} color={C.muted} />
                      </div>
                      <div className="w-24 text-right font-mono text-xs font-semibold text-foreground">{fmtMoney(Math.round(v.amount))}</div>
                      <div className="w-16 text-right text-[10px] text-muted-foreground">{v.count} inv</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 14. WORKING CAPITAL INTELLIGENCE
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && (
            <section>
              <Card title="Working Capital Intelligence">
                <div className="grid gap-6 sm:grid-cols-3">
                  <div className="text-center rounded-lg border border-border p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Customer Payment Cycle</div>
                    <div className="mt-2 font-mono text-2xl font-bold text-foreground">{m.avgSalesPayDays}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">days</div>
                  </div>
                  <div className="text-center rounded-lg border border-border p-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Supplier Payment Cycle</div>
                    <div className="mt-2 font-mono text-2xl font-bold text-foreground">{m.avgPurchasePayDays}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">days</div>
                  </div>
                  <div className={`text-center rounded-lg border p-4 ${
                    m.workingCapitalGap > 30 ? "border-warning/40 bg-warning/5" : "border-border"
                  }`}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Working Capital Gap</div>
                    <div className={`mt-2 font-mono text-2xl font-bold ${
                      m.workingCapitalGap > 30 ? "text-warning" : "text-foreground"
                    }`}>{Math.abs(m.workingCapitalGap)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">days {m.workingCapitalGap > 0 ? "gap" : "surplus"}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-surface-subtle p-3 text-[11px] text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Invoice issued</span>
                  {" "}{"\u2192"}{" "}
                  <span className="font-semibold text-foreground">Customer pays ({m.avgSalesPayDays}d)</span>
                  {" · vs · "}
                  <span className="font-semibold text-foreground">Supplier paid ({m.avgPurchasePayDays}d)</span>
                  {m.workingCapitalGap > 0 && (
                    <>{" → "}
                    <span className="font-semibold text-warning">{m.workingCapitalGap} days cash trapped</span>
                    </>
                  )}
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 15. COLLECTION PERFORMANCE
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && (
            <section>
              <Card title="Collections">
                <div className="grid gap-6 sm:grid-cols-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Collection Rate</div>
                    <div className="mt-1.5 font-mono text-xl font-bold text-foreground">{m.collectionRate}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Collected</div>
                    <div className="mt-1.5 font-mono text-xl font-bold text-foreground">{fmtMoney(Math.round(m.collectedAmount))}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Outstanding</div>
                    <div className="mt-1.5 font-mono text-xl font-bold text-primary">{fmtMoney(Math.round(m.totalOutstanding))}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg Days to Collect</div>
                    <div className="mt-1.5 font-mono text-xl font-bold text-foreground">{m.avgSalesPayDays}</div>
                  </div>
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 16. PAYMENT DISCREPANCIES
             ═══════════════════════════════════════════════════════════════ */}
          {m.shortPaidInvoices.length > 0 && (
            <section>
              <Card
                title="Payment Discrepancies"
                action={
                  <button
                    onClick={() => setShortPaymentsOpen(true)}
                    className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors"
                  >
                    Review discrepancies →
                  </button>
                }
              >
                <div className="flex items-baseline gap-4 mb-4">
                  <div>
                    <div className="font-mono text-xl font-bold text-destructive">{fmtMoney(Math.round(m.totalShortPayment))}</div>
                    <div className="text-[11px] text-muted-foreground">{m.shortPaidInvoices.length} invoices affected</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {m.shortPayByCustomer.slice(0, 6).map((c, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-32 truncate text-xs text-muted-foreground font-medium" title={c.name}>{c.name}</div>
                      <div className="flex-1">
                        <MiniBar value={c.amount} max={m.shortPayByCustomer[0]?.amount ?? 1} color="var(--color-destructive)" />
                      </div>
                      <div className="w-20 text-right font-mono text-xs font-semibold text-destructive">{fmtMoney(Math.round(c.amount))}</div>
                      <div className="w-12 text-right text-[10px] text-muted-foreground">{c.count} inv</div>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 17. EXPENSE INTELLIGENCE
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && m.expenseCategories.length > 0 && (
            <section>
              <SectionLabel>Expense Intelligence</SectionLabel>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="font-display text-sm font-semibold text-foreground mb-4">Expense Breakdown</h4>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={m.expenseCategories.slice(0, 8).map((e) => ({
                        name: e.category.length > 16 ? e.category.slice(0, 14) + "…" : e.category,
                        amount: e.amount,
                      }))} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} strokeDasharray={C.gridDash} horizontal={false} />
                        <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={10} tickFormatter={(v) => abbrevMoney(v)} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} axisLine={false} width={100} />
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [fmtMoney(v), "Amount"]} />
                        <Bar dataKey="amount" fill={C.muted} radius={[0, 4, 4, 0]} barSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="font-display text-sm font-semibold text-foreground mb-4">Expense Efficiency</h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Total Expenses</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{fmtMoney(Math.round(m.expenseTotal))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Expense / Revenue</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{m.expenseRatio.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Revenue / Expense</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{m.expenseTotal > 0 ? (m.netSales / m.expenseTotal).toFixed(2) : "—"}x</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-3">
                      <span className="text-xs text-muted-foreground">Largest Category</span>
                      <span className="text-xs font-semibold text-foreground">{m.expenseCategories[0]?.category ?? "—"}</span>
                    </div>
                  </div>
                  {m.netSales > 0 && m.expenseTotal > 0 && (
                    <div className="mt-4 rounded-lg bg-surface-subtle p-3 text-[11px] text-muted-foreground leading-relaxed">
                      For every dollar of revenue, <span className="font-semibold text-foreground">${(m.expenseTotal / m.netSales).toFixed(2)}</span> goes to expenses.
                      {m.expenseRatio > 30 ? " This ratio may warrant cost optimization." : " This is within a healthy range."}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 19. INVOICE OPERATIONS
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <Card title="Invoice Operations">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {[
                  { label: "Total", value: m.totalInvoices, icon: FileText },
                  { label: "Sales", value: m.totalInvoices, icon: FileText },
                  { label: "Purchase", value: m.totalPurchaseInvoices, icon: ShoppingCart },
                  { label: "Settled", value: m.settledInvoices, icon: Check },
                  { label: "Pending", value: m.pendingInvoices, icon: Clock },
                  { label: "Overdue", value: m.overdueInvoices, icon: AlertTriangle },
                ].map((item) => (
                  <div key={item.label} className="text-center rounded-lg border border-border p-3">
                    <item.icon className="h-4 w-4 mx-auto text-muted-foreground mb-1.5" />
                    <div className="font-mono text-lg font-bold text-foreground">{item.value}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>

              {/* Invoice funnel */}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { label: "Created", value: m.allDocs },
                  { label: "Active", value: m.activeInvoices },
                  { label: "Settled", value: m.settledDocs },
                  { label: "Overdue/Disputed", value: m.overdueDocCount },
                ].map((step, idx) => (
                  <div key={step.label} className="text-center">
                    <div className="font-mono text-sm font-bold text-foreground">{step.value}</div>
                    <div className="text-[10px] text-muted-foreground">{step.label}</div>
                    {idx < 3 && <ArrowDown className="h-3 w-3 mx-auto text-muted-foreground/30 mt-1" />}
                  </div>
                ))}
              </div>
            </Card>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 20. RISK & ATTENTION CENTER
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <Card
              title="Risk & Attention Center"
              action={<Link to="/app/alerts" className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">View all →</Link>}
            >
              {(m.recentAlerts.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                  <Activity className="mb-3 h-5 w-5 text-border" />
                  No alerts — all clear
                </div>
              ) : (
                <div className="space-y-1.5">
                  {m.recentAlerts.map((a: any) => (
                    <div key={a.id} className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-surface-active transition-colors">
                      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                        a.severity === "critical" ? "bg-destructive" :
                        a.severity === "warning" ? "bg-warning" :
                        "bg-primary"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground leading-snug">{a.message}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{fmtDate(a.created_at)}</span>
                          <span>·</span>
                          <span className="uppercase tracking-wider">{a.type}</span>
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                        a.severity === "critical" ? "border-destructive/20 bg-destructive/5 text-destructive" :
                        a.severity === "warning" ? "border-warning/20 bg-warning/5 text-warning" :
                        "border-info/20 bg-info/5 text-info"
                      }`}>
                        {a.severity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 23. MONTH-END READINESS
             ═══════════════════════════════════════════════════════════════ */}
          {!isTreasuryView && (
            <section>
              <Card title="Month-End Readiness">
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="flex flex-col items-center justify-center min-w-[120px]">
                    <div className="relative">
                      <RingScore score={m.readinessPct} label="Ready" size={100} />
                    </div>
                    <div className={`mt-2 text-sm font-semibold ${
                      m.readinessPct >= 80 ? "text-success" : m.readinessPct >= 50 ? "text-warning" : "text-destructive"
                    }`}>
                      {m.readinessPct >= 80 ? "On Track" : m.readinessPct >= 50 ? "Needs Work" : "Behind"}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2.5">
                    {[
                      { label: "Invoices pending", value: m.monthEndPending, ok: m.monthEndPending === 0 },
                      { label: "Unsettled receivables", value: m.monthEndUnsettled, ok: m.monthEndUnsettled < 5 },
                      { label: "Unapplied credit notes", value: m.monthEndUnapplied, ok: m.monthEndUnapplied === 0 },
                      { label: "Overdue invoices", value: m.overdueInvoices, ok: m.overdueInvoices === 0 },
                      { label: "Missing documentation", value: m.monthEndMissingDocs, ok: m.monthEndMissingDocs < 3 },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div className="flex items-center gap-2">
                          {item.ok ? (
                            <CircleCheck className="h-4 w-4 text-success" />
                          ) : (
                            <CircleAlert className="h-4 w-4 text-warning" />
                          )}
                          <span className="text-xs text-foreground">{item.label}</span>
                        </div>
                        <span className={`font-mono text-xs font-semibold ${item.ok ? "text-muted-foreground" : "text-foreground"}`}>
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             RECENT ACTIVITY + PROFORMAS + ADVANCES + EXPENSES
             ═══════════════════════════════════════════════════════════════ */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Invoices */}
            <Card title="Recent Invoices" action={<Link to="/app/invoices" search={{ tab: "list", view: undefined }} className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">View all →</Link>}>
              {invoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
                  <FileText className="mb-3 h-6 w-6 text-border" />No invoices yet.
                </div>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-5 py-2.5 text-left">Invoice</th>
                        <th className="px-5 py-2.5 text-left">Debtor</th>
                        <th className="px-5 py-2.5 text-right">Amount</th>
                        <th className="px-5 py-2.5 text-right">Short pay</th>
                        <th className="px-5 py-2.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.slice(0, 5).map((i: any) => (
                        <tr key={i.id} className="border-b border-border/60 hover:bg-muted/50 transition-colors">
                          <td className="px-5 py-3 font-mono text-xs text-foreground">{i.invoice_number}</td>
                          <td className="px-5 py-3 text-muted-foreground truncate max-w-[120px]">{i.debtor?.name ?? "—"}</td>
                          <td className="px-5 py-3 text-right num font-medium">{fmtMoney(i.amount)}</td>
                          <td className={`px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {i.short_payment != null && Number(i.short_payment) > 0 ? fmtMoney(Number(i.short_payment)) : "—"}
                          </td>
                          <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Advances */}
            <Card
              title={
                <div className="flex items-center gap-3">
                  <span>Advances</span>
                  <div className="flex gap-1">
                    {(["sales", "purchase"] as const).map((s) => (
                      <button key={s} onClick={() => setAdvanceTab(s)}
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                          advanceTab === s ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-input"
                        }`}>{s === "sales" ? "Received" : "Given"}</button>
                    ))}
                  </div>
                </div>
              }
              action={<Link to="/app/advances" className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">View all →</Link>}
            >
              {advances.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
                  <Wallet className="mb-3 h-6 w-6 text-border" />No advances yet.
                </div>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-5 py-2.5 text-left">Date</th>
                        <th className="px-5 py-2.5 text-left">Linked to</th>
                        <th className="px-5 py-2.5 text-right">Amount</th>
                        <th className="px-5 py-2.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advances.filter((a: any) => a.side === advanceTab).slice(0, 5).map((a: any) => {
                        const cp = a.order
                          ? (a.side === "sales" ? a.order.debtor?.name : a.order.vendor?.name)
                          : (a.side === "sales" ? a.invoice?.debtor?.name : a.purchase?.vendor?.name);
                        return (
                          <tr key={a.id} className="border-b border-border/60 hover:bg-muted/50 transition-colors">
                            <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.advance_date)}</td>
                            <td className="px-5 py-3">
                              {a.order ? (
                                <span className="text-xs text-primary">PO {a.order.po_number}</span>
                              ) : a.invoice || a.purchase ? (
                                <span className="text-xs text-primary">{(a.invoice?.invoice_number || a.purchase?.invoice_number)}</span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-5 py-3 text-right num text-primary font-medium">{fmtMoney(a.amount)}</td>
                            <td className="px-5 py-3"><StatusPill status={a.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Recent Expenses */}
          {!isTreasuryView && expenses.length > 0 && (
            <Card title="Recent Expenses" action={<Link to="/app/expenses" className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">View all →</Link>}>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-5 py-2.5 text-left">Date</th>
                      <th className="px-5 py-2.5 text-left">Category</th>
                      <th className="px-5 py-2.5 text-left">Description</th>
                      <th className="px-5 py-2.5 text-right">Amount</th>
                      <th className="px-5 py-2.5 text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.slice(0, 5).map((e: any) => (
                      <tr key={e.id} className="border-b border-border/60 hover:bg-muted/50 transition-colors">
                        <td className="px-5 py-3">{fmtDate(e.expense_date)}</td>
                        <td className="px-5 py-3 capitalize text-muted-foreground">{e.category}</td>
                        <td className="px-5 py-3 text-muted-foreground truncate max-w-[200px]">{e.description ?? "—"}</td>
                        <td className="px-5 py-3 text-right num font-medium">{fmtMoney(e.amount)}</td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => setViewingExpense(e)}
                            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors">Details</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 26. EXECUTIVE ACTION CENTER
             ═══════════════════════════════════════════════════════════════ */}
          {(() => {
            const actions: Array<{ rank: number; title: string; impact: string; to: string; severity: "critical" | "warning" | "info" }> = [];

            if (m.highRiskAmount > 0) {
              actions.push({ rank: 1, title: `Follow up on ${m.agingCount.b4} invoices >90 days`, impact: `${fmtMoney(Math.round(m.highRiskAmount))} exposure`, to: "/app/invoices", severity: "critical" });
            }
            if (m.shortPaidInvoices.length > 0) {
              actions.push({ rank: actions.length + 1, title: `Investigate ${fmtMoney(Math.round(m.totalShortPayment))} in short payments`, impact: `${m.shortPaidInvoices.length} invoices`, to: "/app/invoices", severity: "critical" });
            }
            if (m.overdueInvoices > 0) {
              actions.push({ rank: actions.length + 1, title: `Review ${m.overdueInvoices} overdue invoices`, impact: `${fmtMoney(Math.round(m.overdueTotal))} exposure`, to: "/app/invoices", severity: "warning" });
            }
            if (m.monthEndPending > 0) {
              actions.push({ rank: actions.length + 1, title: `Process ${m.monthEndPending} pending invoices`, impact: "Month-end readiness", to: "/app/invoices", severity: "warning" });
            }
            if (m.topDebtors.length > 5) {
              actions.push({ rank: actions.length + 1, title: "Review customer concentration risk", impact: `Top 5 = ${m.top5Concentration.toFixed(1)}%`, to: "/app/debtors", severity: "info" });
            }

            if (actions.length === 0) return null;

            return (
              <section>
                <SectionLabel>What Needs Your Attention</SectionLabel>
                <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
                  {actions.map((action) => (
                    <div key={action.rank} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-active transition-colors">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        action.severity === "critical" ? "bg-destructive/10 text-destructive" :
                        action.severity === "warning" ? "bg-warning/10 text-warning" :
                        "bg-info/10 text-info"
                      }`}>
                        {action.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground">{action.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{action.impact}</div>
                      </div>
                      <Link to={action.to} search={{ tab: "list", view: undefined }} className="shrink-0 text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">
                        Review →
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════════════
             RECENT PROFORMAS
             ═══════════════════════════════════════════════════════════════ */}
          <Card title="Recent Proformas" action={<Link to="/app/proformas" className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors">View all →</Link>}>
            {proformas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
                <FileSignature className="mb-3 h-6 w-6 text-border" />No proformas yet.
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-5 py-2.5 text-left">Proforma</th>
                      <th className="px-5 py-2.5 text-left">Counterparty</th>
                      <th className="px-5 py-2.5 text-left">Side</th>
                      <th className="px-5 py-2.5 text-right">Amount</th>
                      <th className="px-5 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proformas.slice(0, 5).map((p: any) => (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs">{p.proforma_number ?? p.po_number}</td>
                        <td className="px-5 py-3 text-muted-foreground">{p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">{p.side}</td>
                        <td className="px-5 py-3 text-right num font-medium">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3"><StatusPill status={p.proforma_status || p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
         MODALS
         ═══════════════════════════════════════════════════════════════ */}
      {viewingExpense && (
        <ExpenseDetailModal expense={viewingExpense} onClose={() => setViewingExpense(null)} />
      )}

      <ShortPaymentsDialog
        open={shortPaymentsOpen}
        onOpenChange={setShortPaymentsOpen}
        totalShortPayment={m.totalShortPayment}
        shortPaidInvoices={m.shortPaidInvoices}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SKELETON
   ═══════════════════════════════════════════════════════════════ */

function DashboardSkeleton() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-label="Loading dashboard">
      {/* Health + Hero */}
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="h-3 w-32 skeleton mx-auto" />
          <div className="mt-4 h-[160px] w-[160px] rounded-full skeleton mx-auto" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-2 skeleton" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border/60 px-6 py-3">
            <div className="h-4 w-40 skeleton" />
          </div>
          <div className="grid lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border/60">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <div className="h-2.5 w-24 skeleton" />
                <div className="mt-3 h-6 w-32 skeleton" />
                <div className="mt-2 h-2.5 w-20 skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 skeleton rounded-lg" />
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="h-4 w-48 skeleton" />
          <div className="mt-4 h-72 skeleton" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="h-4 w-32 skeleton" />
          <div className="mt-4 h-72 skeleton" />
        </div>
      </div>

      {/* Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card">
            <div className="border-b border-border/70 px-5 py-3.5">
              <div className="h-4 w-32 skeleton" />
            </div>
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, r) => (
                <div key={r} className="h-8 skeleton" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHORT PAYMENTS DIALOG
   ═══════════════════════════════════════════════════════════════ */

function ShortPaymentsDialog({
  open,
  onOpenChange,
  totalShortPayment,
  shortPaidInvoices,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  totalShortPayment: number;
  shortPaidInvoices: any[];
}) {
  const count = shortPaidInvoices.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Short-Paid Invoices
            <span className="rounded-full bg-destructive/10 text-destructive text-xs font-semibold px-2.5 py-0.5 ml-2">
              {count} {count === 1 ? "invoice" : "invoices"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Total short payments: {fmtMoney(totalShortPayment)}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto -mx-6 -mb-6 mt-2">
          {count === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
              <Wallet className="mb-3 h-6 w-6 text-border" />
              No short payments
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10">
                  <th className="px-6 py-3 text-left">Invoice</th>
                  <th className="px-6 py-3 text-left">Debtor</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3 text-right">Short payment</th>
                  <th className="px-6 py-3 text-left">Paid</th>
                  <th className="px-6 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {shortPaidInvoices.map((i: any) => (
                  <tr key={i.id} className="border-b border-border/60 hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3.5 font-mono text-xs font-medium text-foreground">{i.invoice_number}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">{i.debtor?.name ?? "—"}</td>
                    <td className="px-6 py-3.5 text-right num font-medium">{fmtMoney(i.amount)}</td>
                    <td className="px-6 py-3.5 text-right num text-destructive font-semibold">{fmtMoney(i.short_payment)}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">{fmtDate(i.paid_date)}</td>
                    <td className="px-6 py-3.5 text-right">
                      <Link
                        to="/app/invoices"
                        search={{ tab: "list", view: undefined }}
                        onClick={() => onOpenChange(false)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary-hover transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-3 bg-card">
          <span className="text-xs text-muted-foreground">{count} invoices</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Total short:</span>
            <span className="num font-semibold text-destructive">{fmtMoney(totalShortPayment)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EXPENSE DETAIL MODAL
   ═══════════════════════════════════════════════════════════════ */

function ExpenseDetailModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const link = expense.invoice?.invoice_number
    ? { kind: "Sales invoice", num: expense.invoice.invoice_number, to: "/app/invoices" as const }
    : expense.purchase?.invoice_number
      ? { kind: "Purchase invoice", num: expense.purchase.invoice_number, to: "/app/purchases" as const }
      : null;
  const docs: DocMeta[] = Array.isArray(expense.documents) ? expense.documents : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg font-semibold text-foreground">Expense Detail</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Date</div>
              <div className="mt-0.5 text-foreground">{fmtDate(expense.expense_date)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Category</div>
              <div className="mt-0.5 text-foreground capitalize">{String(expense.category)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Amount</div>
              <div className="mt-0.5 text-foreground">{fmtMoney(expense.amount)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Linked transaction</div>
              <div className="mt-0.5">
                {link ? (
                  <Link to={link.to} search={{ tab: "list", view: undefined }} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Link2 className="h-3 w-3" />
                    <span className="text-muted-foreground">{link.kind}</span>
                    <span className="font-mono">{link.num}</span>
                  </Link>
                ) : <span className="text-muted-foreground">Unlinked</span>}
              </div>
            </div>
          </div>
          {expense.description && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Description</div>
              <p className="text-muted-foreground">{expense.description}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Attachments</div>
            <DocumentList docs={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}
