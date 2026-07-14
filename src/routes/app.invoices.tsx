import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, Stat, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import {
  X, Loader2, Link2, Send, Copy, Trash2, Save, Eye,
  FileText, Building2, User, Package, Download, ArrowUpDown, Upload,
  LayoutDashboard, PenLine, List, CheckCircle, SendHorizonal,
  BarChart3, Clock, Lock, AlertTriangle, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import * as XLSX from "xlsx";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart,} from "recharts";

export const Route = createFileRoute("/app/invoices")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "dashboard",
    view: (search.view as string) || undefined,
  }),
  component: InvoicesPage,
});

const datePresets = [
  {
    label: "Today",
    getRange: () => {
      const today = new Date().toISOString().slice(0, 10);
      return { from: today, to: today };
    },
  },
  {
    label: "This week",
    getRange: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const from = new Date(now);
      from.setDate(now.getDate() - dayOfWeek);
      const to = new Date(now);
      to.setDate(from.getDate() + 6);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "This quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), (q + 1) * 3, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "Last quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), (q - 1) * 3, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), q * 3, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "This year",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
      return { from, to };
    },
  },
];

const statusFilters = ["all", "draft", "submitted", "approved", "advanced", "paid", "overdue", "rejected"];

// â”€â”€ Main Page Component â”€â”€

function InvoicesPage() {
  const { tab, view } = Route.useSearch();
  const navigate = useNavigate();
  const { isAdmin, isChecker, user, canWrite } = useAuth();
  const canCreate = canWrite("invoices");
  const canEdit = canWrite("invoices");
  const qc = useQueryClient();

  // Shared queries
  const allInvoicesQ = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
  });
  const allInvoices = allInvoicesQ.data ?? [];

  // Compute dashboard stats
  const stats = useMemo(() => {
    const total = allInvoices.length;
    const totalAmount = allInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const draft = allInvoices.filter((i: any) => i.status === "draft");
    const draftAmount = draft.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const submitted = allInvoices.filter((i: any) => i.status === "submitted");
    const submittedAmount = submitted.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const inFunding = allInvoices.filter((i: any) => ["approved", "advanced", "funded"].includes(i.status));
    const fundingAmount = inFunding.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const paid = allInvoices.filter((i: any) => i.status === "paid");
    const paidAmount = paid.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const overdue = allInvoices.filter((i: any) => i.status === "overdue");
    const overdueAmount = overdue.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const shortPayments = allInvoices.filter((i: any) => Number(i.short_payment) > 0);
    const shortPaymentTotal = shortPayments.reduce((s: number, i: any) => s + Number(i.short_payment), 0);
    const outstanding = allInvoices.filter((i: any) => !["paid", "rejected"].includes(i.status));
    const outstandingAmount = outstanding.reduce((s: number, i: any) => s + Number(i.amount), 0);

    return {
      total, totalAmount,
      draftCount: draft.length, draftAmount,
      submittedCount: submitted.length, submittedAmount,
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draftAmount + submittedAmount,
      fundingCount: inFunding.length, fundingAmount,
      paidCount: paid.length, paidAmount,
      overdueCount: overdue.length, overdueAmount,
      shortPaymentCount: shortPayments.length, shortPaymentTotal,
      outstandingCount: outstanding.length, outstandingAmount,
    };
  }, [allInvoices]);

  const setTab = (t: string) => navigate({ to: "/app/invoices", search: { tab: t, view: undefined }, replace: true });

  const tabs = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "create", label: "Create Invoice", icon: PenLine },
    { key: "list", label: "All Invoices", icon: List },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Sales Invoices"
        title={isAdmin ? "Invoice management" : "Your invoices"}
        description={
          tab === "dashboard"
            ? "Overview of all your sales invoices at a glance."
            : tab === "create"
            ? "Create a new sales invoice to submit for review."
            : "View, review, and manage all your sales invoices."
        }
      />

      {/* Tab Navigation */}
      <div className="border-b border-border bg-white px-6 md:px-10">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-6 md:p-10">
        {tab === "dashboard" && <DashboardView stats={stats} invoices={allInvoices} />}
        {tab === "create" && <CreateInvoiceView />}
        {tab === "list" && (
          <ListView
            isAdmin={isAdmin}
            canEdit={canEdit}
            canCreate={canCreate}
            qc={qc}
            viewParam={view}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}

// â”€â”€ Page 1: Sales Dashboard â”€â”€

function DashboardView({ stats, invoices }: { stats: any; invoices: any[] }) {
  const { isAdmin } = useAuth();

  // Buyer/debtor filter state
  const [selectedDebtorId, setSelectedDebtorId] = useState<string>("");

  // Get unique debtors from invoices for the filter dropdown
  const debtors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const inv of invoices) {
      if (inv.debtor_id && inv.debtor?.name) {
        map.set(inv.debtor_id, { id: inv.debtor_id, name: inv.debtor.name });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredInvoices]);

  // Filter invoices by selected debtor
  const filteredInvoices = useMemo(() => {
    if (!selectedDebtorId) return invoices;
    return invoices.filter((i: any) => i.debtor_id === selectedDebtorId);
  }, [invoices, selectedDebtorId]);

  // Recompute stats locally based on filtered invoices
  const localStats = useMemo(() => {
    const inv = filteredInvoices;
    const total = inv.length;
    const totalAmount = inv.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const draft = inv.filter((i: any) => i.status === "draft");
    const draftAmount = draft.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const submitted = inv.filter((i: any) => i.status === "submitted");
    const submittedAmount = submitted.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const inFunding = inv.filter((i: any) => ["approved", "advanced", "funded"].includes(i.status));
    const fundingAmount = inFunding.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const paid = inv.filter((i: any) => i.status === "paid");
    const paidAmount = paid.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const overdue = inv.filter((i: any) => i.status === "overdue");
    const overdueAmount = overdue.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const shortPayments = inv.filter((i: any) => Number(i.short_payment) > 0);
    const shortPaymentTotal = shortPayments.reduce((s: number, i: any) => s + Number(i.short_payment), 0);
    const outstanding = inv.filter((i: any) => !["paid", "rejected"].includes(i.status));
    const outstandingAmount = outstanding.reduce((s: number, i: any) => s + Number(i.amount), 0);
    return {
      total, totalAmount,
      draftCount: draft.length, draftAmount,
      submittedCount: submitted.length, submittedAmount,
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draftAmount + submittedAmount,
      fundingCount: inFunding.length, fundingAmount,
      paidCount: paid.length, paidAmount,
      overdueCount: overdue.length, overdueAmount,
      shortPaymentCount: shortPayments.length, shortPaymentTotal,
      outstandingCount: outstanding.length, outstandingAmount,
    };
  }, [filteredInvoices]);

  // Use filtered stats when a debtor is selected, otherwise use parent stats
  const displayStats = selectedDebtorId ? localStats : stats;

  // Chart data: monthly aggregation of invoices (respects buyer filter)
  const chartData = useMemo(() => {
    const months = new Map<string, { month: string; count: number; amount: number }>();
    for (const inv of filteredInvoices) {
      const date = inv.issue_date || inv.created_at;
      if (!date) continue;
      const key = date.slice(0, 7); // "YYYY-MM"
      const entry = months.get(key) || { month: key, count: 0, amount: 0 };
      entry.count++;
      entry.amount += Number(inv.amount) || 0;
      months.set(key, entry);
    }
    return [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // Last 12 months
  }, [filteredInvoices]);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    const amounts: Record<string, number> = {};
    for (const status of statusFilters) {
      if (status === "all") continue;
      const items = filteredInvoices.filter((i: any) => i.status === status);
      counts[status] = items.length;
      amounts[status] = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
    }
    return { counts, amounts };
  }, [filteredInvoices]);

  const topDebtors = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const inv of filteredInvoices) {
      const name = inv.debtor?.name || "Unknown";
      const entry = map.get(name) || { name, count: 0, total: 0 };
      entry.count++;
      entry.total += Number(inv.amount);
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filteredInvoices]);

  // Top 5 most overdue invoices (by days past due)
  const mostOverdue = useMemo(() => {
    const now = new Date();
    return filteredInvoices
      .filter((i: any) => i.status === "overdue" && i.due_date)
      .map((i: any) => {
        const due = new Date(i.due_date);
        const daysPastDue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        return { ...i, daysPastDue };
      })
      .sort((a: any, b: any) => b.daysPastDue - a.daysPastDue)
      .slice(0, 5);
  }, [invoices]);

  if (filteredInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium text-foreground">No invoices yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">{selectedDebtorId ? "No invoices found for this buyer." : "Create your first invoice to see dashboard stats."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Buyer Filter */}
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedDebtorId}
            onChange={(e) => setSelectedDebtorId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">All Buyers</option>
            {debtors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        {selectedDebtorId && (
          <button
            onClick={() => setSelectedDebtorId("")}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filter
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {selectedDebtorId ? (
            <>{filteredInvoices.length} invoices &middot; {fmtMoney(displayStats.totalAmount)}</>
          ) : (
            <>{invoices.length} invoices total</>
          )}
        </span>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Invoices" value={String(displayStats.total)} />
        <Stat label="Total Invoice Amount" value={fmtMoney(displayStats.totalAmount)} />
        <Stat label="Paid Invoices" value={String(displayStats.paidCount)} delta={fmtMoney(displayStats.paidAmount)} tone="good" />
        <Stat label="Outstanding Amount" value={fmtMoney(displayStats.outstandingAmount)} delta={`${displayStats.outstandingCount} invoices`} tone="warn" />
      </div>

      {/* Secondary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Awaiting Checker"
          value={String(displayStats.awaitingCheckerCount)}
          delta={fmtMoney(displayStats.awaitingCheckerAmount)}
          tone="warn"
        />
        <Stat
          label="In Funding Queue"
          value={String(displayStats.fundingCount)}
          delta={fmtMoney(displayStats.fundingAmount)}
          tone="neutral"
        />
        <Stat
          label="Overdue Invoices"
          value={String(displayStats.overdueCount)}
          delta={fmtMoney(displayStats.overdueAmount)}
          tone={displayStats.overdueCount > 0 ? "bad" : "good"}
        />
        <Stat
          label="Short Payments"
          value={String(displayStats.shortPaymentCount)}
          delta={fmtMoney(displayStats.shortPaymentTotal)}
          tone={displayStats.shortPaymentCount > 0 ? "bad" : "good"}
        />
      </div>

      {/* Invoice Trend Chart */}
      <Card title={
        <div className="flex items-center gap-2">
          <span>Invoice Trend</span>
          <span className="text-xs font-normal text-muted-foreground">Monthly volume &amp; value</span>
        </div>
      }>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-2, 142 76% 36%))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(var(--chart-2, 142 76% 36%))" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => {
                  const d = new Date(v + "-01");
                  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
                }}
                className="text-xs text-muted-foreground"
              />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => "$" + (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "K" : v)}
                className="text-xs text-muted-foreground"
                domain={[0, (max: number) => Math.ceil(max * 1.15 / 100000) * 100000]}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs text-muted-foreground"
                domain={[0, (max: number) => Math.ceil(max * 1.15 / 5) * 5]}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = new Date(label + "-01");
                  const monthLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                  const amount = payload.find(p => p.dataKey === "amount")?.value as number || 0;
                  const count = payload.find(p => p.dataKey === "count")?.value as number || 0;
                  return (
                    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium mb-1">{monthLabel}</div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--primary))" }} />
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono font-medium tabular-nums">{fmtMoney(amount)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--chart-2, 142 76% 36%))" }} />
                        <span className="text-muted-foreground">Invoices:</span>
                        <span className="font-mono font-medium tabular-nums">{count}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="amount"
                fill="url(#barGradient)"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
                className="cursor-pointer"
              />
              <Area
                yAxisId="right"
                dataKey="count"
                fill="url(#areaGradient)"
                stroke="hsl(var(--chart-2, 142 76% 36%))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 1, stroke: "hsl(var(--background))", fill: "hsl(var(--chart-2, 142 76% 36%))" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Break down by status */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status Breakdown">
          <div className="space-y-3">
            {statusFilters.filter((s) => s !== "all").map((status) => {
              const count = statusBreakdown.counts[status] ?? 0;
              const amount = statusBreakdown.amounts[status] ?? 0;
              if (count === 0) return null;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusPill status={status} />
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{count}</div>
                    <div className="text-xs text-muted-foreground">{fmtMoney(amount)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Top Debtors by Volume">
          <div className="space-y-3">
            {topDebtors.length === 0 ? (
              <div className="text-sm text-muted-foreground">No debtor data yet.</div>
            ) : (
              topDebtors.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{d.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium num">{fmtMoney(d.total)}</div>
                    <div className="text-[10px] text-muted-foreground">{d.count} invoice{d.count !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Overdue Alerts Section */}
      {mostOverdue.length > 0 && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span>Overdue Alerts</span>
              <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                {displayStats.overdueCount} overdue
              </span>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The following {mostOverdue.length} invoice{mostOverdue.length !== 1 ? "s are" : " is"} past due and require immediate attention.
            </p>
            <div className="-mx-6 -mb-6">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 text-left font-normal">Invoice</th>
                    <th className="px-6 py-3 text-left font-normal">Debtor</th>
                    <th className="px-6 py-3 text-right font-normal">Amount</th>
                    <th className="px-6 py-3 text-right font-normal">Days Overdue</th>
                    <th className="px-6 py-3 text-left font-normal">Due Date</th>
                    <th className="px-6 py-3 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mostOverdue.map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="px-6 py-3">{i.debtor?.name ?? "â€”"}</td>
                      <td className="px-6 py-3 text-right num text-destructive">{fmtMoney(i.amount)}</td>
                      <td className="px-6 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          i.daysPastDue > 60
                            ? "bg-destructive/15 text-destructive"
                            : i.daysPastDue > 30
                            ? "bg-warning/15 text-warning"
                            : "bg-orange-100 text-orange-700"
                        }`}>
                          <AlertCircle className="h-3 w-3" />
                          {i.daysPastDue}d
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className="px-6 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stats.overdueCount > 5 && (
              <div className="pt-2 text-center text-xs text-muted-foreground">
                + {displayStats.overdueCount - 5} more overdue invoice{(displayStats.overdueCount - 5) !== 1 ? "s" : ""} not shown
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Recent Activity */}
      <Card title="Recent Invoices">
        <div className="-mx-6 -mb-6">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left font-normal">Invoice</th>
                <th className="px-6 py-3 text-left font-normal">Debtor</th>
                <th className="px-6 py-3 text-right font-normal">Amount</th>
                <th className="px-6 py-3 text-left font-normal">Status</th>
                <th className="px-6 py-3 text-left font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.slice(0, 10).map((i: any) => (
                <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                  <td className="px-6 py-3">{i.debtor?.name ?? "â€”"}</td>
                  <td className="px-6 py-3 text-right num">{fmtMoney(i.amount)}</td>
                  <td className="px-6 py-3"><StatusPill status={i.status} /></td>
                  <td className="px-6 py-3 text-sm text-muted-foreground">{fmtDate(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// â”€â”€ Page 2: Create Invoice â”€â”€

function CreateInvoiceView() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canCreate = canWrite("invoices");
  const qc = useQueryClient();

  const [form, setForm] = useState({
    invoice_number: "",
    debtor_id: "",
    amount: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    payment_terms_days: "30",
    bl_date: "",
    due_date_source: "invoice" as "invoice" | "bl",
    po_number: "",
    po_date: "",
    purchase_invoice_id: "",
  });
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [invEnabled, setInvEnabled] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const [invItems, setInvItems] = useState<Array<{ item_name: string; sku: string; quantity: string; unit: string; unit_cost: string }>>([]);
  const [hasDueDate, setHasDueDate] = useState(true);

  const stockMovementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const purchasesQ = useQuery({
    queryKey: ["purchases-for-link"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices/mini")) ?? [],
  });

  const availableInventory = useMemo(() => {
    const m = new Map<string, { sku: string; item_name: string; unit: string; qty: number; inQty: number; inValue: number }>();
    for (const r of (stockMovementsQ.data ?? []) as any[]) {
      const skuKey = r.sku || r.item_name;
      const k = `${skuKey}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur = m.get(k) ?? { sku: r.sku || "", item_name: r.item_name, unit: r.unit || "unit", qty: 0, inQty: 0, inValue: 0 };
      cur.qty += sign * Number(r.quantity);
      if (r.direction === "in") {
        cur.inQty += Number(r.quantity);
        cur.inValue += Number(r.quantity) * Number(r.unit_cost ?? 0);
      }
      m.set(k, cur);
    }
    return [...m.values()].map(c => {
      const avgCost = c.inQty > 0 ? c.inValue / c.inQty : 0;
      return { ...c, value: c.qty > 0 ? c.qty * avgCost : 0 };
    }).filter((item) => item.qty > 0).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [stockMovementsQ.data]);

  const filteredInv = useMemo(() => {
    if (!invSearch.trim() || !availableInventory) return [];
    const q = invSearch.toLowerCase();
    return availableInventory.filter((i) => i.sku.toLowerCase().includes(q) || i.item_name.toLowerCase().includes(q));
  }, [invSearch, availableInventory]);

  const addInvItem = (item: { sku: string; item_name: string; unit: string; qty: number; value: number }) => {
    if (invItems.some((it) => it.sku === item.sku)) return;
    setInvItems((prev) => [...prev, { item_name: item.item_name, sku: item.sku, quantity: "", unit: item.unit, unit_cost: "" }]);
  };

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  useEffect(() => {
    if (poLookupQ.data?.proformas) {
      const salesPf = poLookupQ.data.proformas.find((p: any) => p.side === "sales");
      if (salesPf?.debtor_id && !form.debtor_id) {
        setForm((prev: any) => ({ ...prev, debtor_id: salesPf.debtor_id }));
      }
    }
  }, [poLookupQ.data]);

  const termsDays = Number(form.payment_terms_days) || 30;
  const computedDue = (() => {
    const base = form.due_date_source === "bl" && form.bl_date ? form.bl_date : form.issue_date;
    if (!base) return "";
    const d = new Date(base);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please select a debtor first.");
      const payload: any = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: hasDueDate ? effectiveDue : null,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        bl_date: form.bl_date || null,
        due_date_source: form.due_date_source,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        purchase_invoice_id: form.purchase_invoice_id || null,
        documents: docs,
      };
      if (invEnabled) {
        const items = invItems.filter((it) => it.item_name.trim() && Number(it.quantity) > 0);
        if (items.length > 0) {
          payload.inventory_items = items.map((item) => ({
            item_name: item.item_name.trim(),
            sku: item.sku || null,
            quantity: Number(item.quantity),
            unit: item.unit || "unit",
            unit_cost: item.unit_cost ? Number(item.unit_cost) : null,
          }));
        }
      }
      await api.post("/invoices", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      toast.success("Invoice created as draft. Review it in All Invoices before sending to checker.");
      // Reset form
      setForm({
        invoice_number: "", debtor_id: "", amount: "",
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: "", payment_terms_days: "30",
        bl_date: "", due_date_source: "invoice",
        po_number: "", po_date: "", purchase_invoice_id: "",
      });
      setDocs([]);
      setInvItems([]);
      setInvEnabled(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!canCreate) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Lock className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium">No permission</h3>
        <p className="mt-1 text-sm text-muted-foreground">You don't have permission to create invoices.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">New Sales Invoice</h2>
        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
        >
          <Upload className="h-3.5 w-3.5" /> Mass import
        </button>
      </div>

      {debtorsQ.data?.length === 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div>
          <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></Field>
            <Field label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></Field>
          </div>
        </div>

        {form.po_number.trim() && poLookupQ.data?.proformas && poLookupQ.data.proformas.filter((p: any) => p.side === "sales").length > 0 && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <div className="mb-1 uppercase tracking-widest text-primary">Proforma linked to PO {form.po_number}</div>
            {(() => {
              const salesPf = poLookupQ.data.proformas.find((p: any) => p.side === "sales");
              if (!salesPf) return <div className="text-muted-foreground">No sales proforma found for this PO.</div>;
              return (
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Proforma #</span><span className="font-mono">{salesPf.proforma_number || "â€”"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="num">{fmtMoney(salesPf.amount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-warning">{salesPf.proforma_status?.replace("_", " ")}</span></div>
                </div>
              );
            })()}
          </div>
        )}

        <Field label="Invoice number"><input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="inp" placeholder="INV-00123" /></Field>
        <Field label="Debtor">
          <select required value={form.debtor_id} onChange={(e) => setForm({ ...form, debtor_id: e.target.value })} className="inp">
            <option value="">Select debtor</option>
            {debtorsQ.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Total invoice amount (USD)"><input required type="text" inputMode="decimal" pattern="-?[0-9]+(\.[0-9]+)?" title="Enter a number (e.g. 123.45 or -50.00)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="inp" /></Field>
          <Field label="BL date"><input type="date" value={form.bl_date} onChange={(e) => setForm({ ...form, bl_date: e.target.value })} className="inp" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} /></Field>
          <Field label="Due date source">
            <select className="inp" value={form.due_date_source} onChange={(e) => setForm({ ...form, due_date_source: e.target.value as any })}>
              <option value="invoice">From invoice date</option>
              <option value="bl">From BL date</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Due date (auto: ${termsDays}d net from ${form.due_date_source === "bl" ? "BL" : "invoice"} date)`}>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={hasDueDate} onChange={(e) => {
                  const v = e.target.checked;
                  setHasDueDate(v);
                  if (!v) setForm({ ...form, due_date: "" });
                  else setForm({ ...form, due_date: computedDue });
                }} />
                Enable due date
              </label>
              {hasDueDate && <input type="date" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="inp" />}
            </div>
          </Field>
          <Field label="Link to purchase invoice (optional)">
            <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
              <option value="">â€” No link â€”</option>
              {purchasesQ.data?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.invoice_number} Â· {fmtMoney(p.amount)}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Inventory tracking */}
        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={invEnabled} onChange={(e) => setInvEnabled(e.target.checked)} />
            <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-out / debit)</span>
          </label>
          {invEnabled && (
            <div className="mt-3 space-y-4">
              {availableInventory.length > 0 && (
                <div className="relative">
                  <input type="text" placeholder="Search by SKU or item name..." value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                  {invSearch.trim() && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                      {filteredInv.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground">No matching items in stock</div>
                      ) : filteredInv.map((avail) => (
                        <button key={avail.sku} type="button"
                          onClick={() => { addInvItem(avail); setInvSearch(""); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-primary">{avail.sku || avail.item_name}</span>
                            <span className="text-muted-foreground">{avail.item_name}</span>
                          </div>
                          <span className="text-muted-foreground">{avail.qty} {avail.unit} on hand Â· {fmtMoney(avail.qty > 0 ? avail.value / avail.qty : 0)}/unit</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {availableInventory.length === 0 && (
                <div className="text-xs text-muted-foreground">No stock available. Add inventory via purchase invoices first.</div>
              )}
              {invItems.map((item, idx) => (
                <div key={idx} className="relative rounded-md border border-border bg-background/40 p-3 pt-5">
                  <button type="button" onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-destructive" aria-label="Remove item">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-xs text-primary">{item.sku}</span>
                    <span className="text-xs text-muted-foreground">{item.item_name} Â· {item.unit}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Qty to sell *">
                      <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="inp" value={item.quantity} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                    </Field>
                    <Field label="Unit cost (selling price)">
                      <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="inp" value={item.unit_cost} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_cost: e.target.value } : it))} />
                    </Field>
                  </div>
                </div>
              ))}
              {invItems.length === 0 && availableInventory.length > 0 && (
                <div className="text-xs text-muted-foreground">Search and select items above to add them to this invoice.</div>
              )}
            </div>
          )}
        </div>

        <DocumentUploader userId={""} scope="invoices" docs={docs} onChange={setDocs}
          hint="Attach the invoice PDF, BL, packing list, or other supporting paperwork." />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => {
            setForm({
              invoice_number: "", debtor_id: "", amount: "",
              issue_date: new Date().toISOString().slice(0, 10),
              due_date: "", payment_terms_days: "30",
              bl_date: "", due_date_source: "invoice",
              po_number: "", po_date: "", purchase_invoice_id: "",
            });
            setDocs([]);
            setInvItems([]);
          }} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
            Reset
          </button>
          <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 hover:bg-primary/90 transition-colors">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Create Draft Invoice
          </button>
        </div>
      </form>

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>

      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} debtors={debtorsQ.data ?? []} />}
    </div>
  );
}

// â”€â”€ Page 3: All Invoices â”€â”€

function ListView({ isAdmin, canEdit, canCreate, qc, viewParam, navigate }: { isAdmin: boolean; canEdit: boolean; canCreate: boolean; qc: any; viewParam?: string; navigate: any }) {
  const { canWrite } = useAuth();
  const canSendNoa = canWrite("invoices") || canWrite("checker-desk");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [sortField, setSortField] = useState<"created" | "issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const limit = 50;

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list", page, limit, sortField, sortOrder],
    queryFn: async () => {
      const res = await api.get<any>("/invoices?page=" + page + "&limit=" + limit + "&sortField=" + sortField + "&sortOrder=" + sortOrder);
      return res ?? { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  });

  const stockMovementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const purchasesQ = useQuery({
    queryKey: ["purchases-for-link"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices/mini")) ?? [],
  });

  const sendNoa = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.post<{ noa_status: string; noa_link: string }>(`/invoices/${id}/send-noa`);
      return result;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const link = `${window.location.origin}/noa/${result.noa_link.replace("/noa/", "")}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success("NOA link copied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/invoices/${id}`);
    },
    onSuccess: () => {
      toast.success("Invoice removed");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const submitToChecker = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/invoices/${id}/submit`);
    },
    onSuccess: () => {
      toast.success("Invoice sent to checker for review");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  const invoiceData = invoicesQ.data?.data ?? [];
  const totalInvoices = invoicesQ.data?.total ?? 0;
  const totalPages = invoicesQ.data?.totalPages ?? 1;

  // Auto-open detail modal
  useEffect(() => {
    if (viewParam) {
      (async () => {
        const found = invoiceData.find((i: any) => i.id === viewParam);
        if (found) {
          setViewing(found);
        } else {
          try {
            const match = await api.get<any>("/invoices/" + viewParam);
            if (match) setViewing(match);
          } catch { /* silent */ }
        }
        navigate({ to: "/app/invoices", search: { tab: "list", view: undefined }, replace: true });
      })();
    }
  }, [viewParam]);

  const filtered = invoiceData.filter((i: any) => {
    if (filter !== "all" && i.status !== filter) return false;
    if (issueDateFrom && i.issue_date && i.issue_date < issueDateFrom) return false;
    if (issueDateTo && i.issue_date && i.issue_date > issueDateTo) return false;
    const q = searchQuery.toLowerCase();
    return (
      i.invoice_number?.toLowerCase().includes(q) ||
      i.debtor?.name?.toLowerCase().includes(q) ||
      i.po_number?.toLowerCase().includes(q) ||
      i.status?.toLowerCase().includes(q) ||
      i.client?.company_name?.toLowerCase().includes(q) ||
      i.client?.contact_name?.toLowerCase().includes(q)
    );
  });

  const viewedInventory = useMemo(() => {
    if (!viewing) return [];
    return (stockMovementsQ.data ?? []).filter((m: any) => m.invoice_id === viewing.id);
  }, [viewing, stockMovementsQ.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s.replace(/_/g, " ")}</button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
            <Upload className="h-3.5 w-3.5" /> Mass import
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {datePresets.map((preset) => {
          const range = preset.getRange();
          const active = issueDateFrom === range.from && issueDateTo === range.to;
          return (
            <button key={preset.label} onClick={() => {
              const r = preset.getRange();
              setIssueDateFrom(r.from);
              setIssueDateTo(r.to);
            }}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Issue from</label>
          <input type="date" value={issueDateFrom}
            onChange={(e) => setIssueDateFrom(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">to</label>
          <input type="date" value={issueDateTo}
            onChange={(e) => setIssueDateTo(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
        </div>
        {(issueDateFrom || issueDateTo) && (
          <button onClick={() => { setIssueDateFrom(""); setIssueDateTo(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline">
            Clear dates
          </button>
        )}
      </div>
      <div className="relative">
        <input type="text" placeholder="Search invoices by number, debtor, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
        <div className="flex gap-1">
          {(["created", "issue", "due"] as const).map((field) => (
            <button
              key={field}
              onClick={() => {
                setPage(1);
                if (sortField === field) {
                  setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                } else {
                  setSortField(field);
                  setSortOrder("asc");
                }
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                sortField === field
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <ArrowUpDown className="h-3 w-3" />
              {field === "created" ? "Created date" : field === "issue" ? "Issue date" : "ERP Due date"}
              {sortField === field && (
                <span className="text-[10px]">{sortOrder === "asc" ? "â†‘" : "â†“"}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {invoicesQ.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loadingâ€¦</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left font-normal">UID</th>
                  <th className="px-5 py-2 text-left font-normal">Invoice Number</th>
                  {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                  <th className="px-5 py-2 text-left font-normal">Debtor</th>
                  <th className="px-5 py-2 text-left font-normal">Issue date</th>
                  <th className="px-5 py-2 text-right font-normal">Invoice Amount</th>
                  <th className="px-5 py-2 text-right font-normal">Received</th>
                  <th className="px-5 py-2 text-right font-normal">Short payment</th>
                  <th className="px-5 py-2 text-left font-normal">ERP Due Date</th>
                  <th className="px-5 py-2 text-left font-normal">Paid date</th>
                  <th className="px-5 py-2 text-right font-normal">Late days</th>
                  <th className="px-5 py-2 text-left font-normal">Status</th>
                  <th className="px-5 py-2 text-left font-normal">NOA</th>
                  <th className="px-5 py-2 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i: any) => {
                  const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                  const lateDays = i.status === "paid"
                    ? (i.late_days != null ? Number(i.late_days) : 0)
                    : Math.max(0, dpd);
                  const isDraft = i.status === "draft";
                  const isSubmitted = i.status === "submitted";
                  return (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={i.id}>#{i.id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs">{i.invoice_number}</div>
                        {i.po_number && <div className="text-[10px] text-muted-foreground">PO {i.po_number}{i.po_date ? ` Â· ${fmtDate(i.po_date)}` : ""}</div>}
                        {i.purchase && (
                          <Link to="/app/purchases" search={{ view: i.purchase.id }} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                            <Link2 className="h-2.5 w-2.5" /> {i.purchase.invoice_number} Â· {i.purchase.vendor?.name ?? ""}
                          </Link>
                        )}
                      </td>
                      {isAdmin && <td className="px-5 py-3 text-muted-foreground">{i.client?.company_name || i.client?.contact_name || "â€”"}</td>}
                      <td className="px-5 py-3">{i.debtor?.name ?? "â€”"}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(i.issue_date)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                      <td className="px-5 py-3 text-right num text-muted-foreground">{i.amount_received != null ? fmtMoney(i.amount_received) : "â€”"}</td>
                      <td className={`px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{i.short_payment != null ? fmtMoney(i.short_payment) : "â€”"}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
                      <td className="px-5 py-3 text-sm">{i.status === "paid" ? fmtDate(i.paid_date) : <span className="text-muted-foreground">â€”</span>}</td>
                      <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                      <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                      <td className="px-5 py-3">
                        <NoaBadge status={i.noa_status} />
                        {i.noa_comments && <div className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={i.noa_comments}>"{i.noa_comments}"</div>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button onClick={() => setViewing(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                            <Eye className="h-3 w-3" /> View
                          </button>

                          {/* Draft invoices: salesman can review and submit to checker */}
                          {isDraft && canEdit && (
                            <>
                              <button onClick={() => { setEditing(i); setOpen(true); }}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                                <PenLine className="h-3 w-3" /> Review
                              </button>
                              <button onClick={() => { if (confirm(`Send invoice ${i.invoice_number} to checker for review?`)) submitToChecker.mutate(i.id); }}
                                disabled={submitToChecker.isPending}
                                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                                <SendHorizonal className="h-3 w-3" /> Send to Checker
                              </button>
                            </>
                          )}

                          {/* Submitted invoices: awaiting checker approval */}
                          {isSubmitted && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-2 py-1 text-[10px] text-warning">
                              <Clock className="h-3 w-3" /> Awaiting checker
                            </span>
                          )}

                          {/* NOA actions */}
                          {canSendNoa && i.noa_status === "not_sent" && !isDraft && !isSubmitted && (
                            <button onClick={() => sendNoa.mutate(i.id)} className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                              <Send className="h-3 w-3" /> Send NOA
                            </button>
                          )}
                          {i.noa_status !== "not_sent" && (
                            <button onClick={() => copyNoa(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted">
                              <Copy className="h-3 w-3" /> Copy NOA link
                            </button>
                          )}

                          {/* Edit/Delete for draft invoices */}
                          {canEdit && isDraft && (
                            <>
                              <button onClick={() => { setEditing(i); setOpen(true); }} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                              <button onClick={() => { if (confirm(`Remove invoice ${i.invoice_number}?`)) remove.mutate(i.id); }}
                                className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}

                          {/* Admin checker actions */}
                          {isAdmin && isSubmitted && (isAdmin || canWrite("checker-desk")) && (
                            <Link to="/app/checker" className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                              <CheckCircle className="h-3 w-3" /> Review â†’
                            </Link>
                          )}

                          {/* Funding queue / closed status labels */}
                          {isAdmin && !isDraft && !isSubmitted && (i.status === "approved" || i.status === "advanced" || i.status === "funded") && (
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                          )}
                          {isAdmin && i.status === "paid" && (
                            <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <div className="text-xs text-muted-foreground">
            {totalInvoices.toLocaleString()} total invoices Â· Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              â† Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`min-w-[2rem] rounded-md border px-2 py-1.5 text-xs transition ${
                      pageNum === page
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next â†’
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} debtors={debtorsQ.data ?? []} />}
      {open && (
        <InvoiceFormModal
          editing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          debtors={debtorsQ.data ?? []}
          purchases={purchasesQ.data ?? []}
          availableInventory={[]}
          isEditMode
        />
      )}
      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          inventory={viewedInventory}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

// â”€â”€ Shared Components â”€â”€

function NoaBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}

function InvoiceFormModal({ editing, onClose, debtors, purchases, availableInventory, isEditMode }: {
  editing: any | null;
  onClose: () => void;
  debtors: any[];
  purchases: any[];
  availableInventory: Array<{ sku: string; item_name: string; unit: string; qty: number; value: number }>;
  isEditMode?: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    invoice_number: editing?.invoice_number ?? "",
    debtor_id: editing?.debtor_id ?? "",
    amount: String(editing?.amount ?? ""),
    issue_date: editing?.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: editing?.due_date ?? "",
    payment_terms_days: String(editing?.payment_terms_days ?? "30"),
    bl_date: editing?.bl_date ?? "",
    due_date_source: editing?.due_date_source ?? "invoice",
    po_number: editing?.po_number ?? "",
    po_date: editing?.po_date ?? "",
    purchase_invoice_id: editing?.purchase_invoice_id ?? "",
  }));
  const [docs, setDocs] = useState<DocMeta[]>(editing?.documents ?? []);
  const [hasDueDate, setHasDueDate] = useState(() => {
    if (editing?.due_date) return true;
    const terms = Number(editing?.payment_terms_days ?? 30) || 30;
    const base = editing?.due_date_source === "bl" && editing?.bl_date ? editing.bl_date : (editing?.issue_date ?? new Date().toISOString().slice(0, 10));
    return !!base;
  });

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales-edit", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  const termsDays = Number(form.payment_terms_days) || 30;
  const computedDue = (() => {
    const base = form.due_date_source === "bl" && form.bl_date ? form.bl_date : form.issue_date;
    if (!base) return "";
    const d = new Date(base);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please select a debtor first.");
      const payload: any = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: hasDueDate ? effectiveDue : null,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        bl_date: form.bl_date || null,
        due_date_source: form.due_date_source,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        purchase_invoice_id: form.purchase_invoice_id || null,
        documents: docs,
      };
      if (editing) {
        await api.patch(`/invoices/${editing.id}`, payload);
      } else {
        await api.post("/invoices", payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      toast.success(editing ? "Invoice updated" : "Invoice created as draft.");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit invoice" : "Submit invoice"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
          {debtors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></Field>
              <Field label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></Field>
            </div>
          </div>

          {form.po_number.trim() && poLookupQ.data?.proformas && poLookupQ.data.proformas.filter((p: any) => p.side === "sales").length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Proforma linked to PO {form.po_number}</div>
              {(() => {
                const salesPf = poLookupQ.data.proformas.find((p: any) => p.side === "sales");
                if (!salesPf) return <div className="text-muted-foreground">No sales proforma found for this PO.</div>;
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Proforma #</span><span className="font-mono">{salesPf.proforma_number || "â€”"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="num">{fmtMoney(salesPf.amount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-warning">{salesPf.proforma_status?.replace("_", " ")}</span></div>
                  </div>
                );
              })()}
            </div>
          )}

          <Field label="Invoice number"><input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="inp" placeholder="INV-00123" /></Field>
          <Field label="Debtor">
            <select required value={form.debtor_id} onChange={(e) => setForm({ ...form, debtor_id: e.target.value })} className="inp">
              <option value="">Select debtor</option>
              {debtors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Total invoice amount (USD)"><input required type="text" inputMode="decimal" pattern="-?[0-9]+(\.[0-9]+)?" title="Enter a number (e.g. 123.45 or -50.00)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="inp" /></Field>
            <Field label="BL date"><input type="date" value={form.bl_date} onChange={(e) => setForm({ ...form, bl_date: e.target.value })} className="inp" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} /></Field>
            <Field label="Due date source">
              <select className="inp" value={form.due_date_source} onChange={(e) => setForm({ ...form, due_date_source: e.target.value as any })}>
                <option value="invoice">From invoice date</option>
                <option value="bl">From BL date</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Due date (auto: ${termsDays}d net from ${form.due_date_source === "bl" ? "BL" : "invoice"} date)`}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hasDueDate} onChange={(e) => {
                    const v = e.target.checked;
                    setHasDueDate(v);
                    if (!v) setForm({ ...form, due_date: "" });
                    else setForm({ ...form, due_date: computedDue });
                  }} />
                  Enable due date
                </label>
                {hasDueDate && <input type="date" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="inp" />}
              </div>
            </Field>
            <Field label="Link to purchase invoice (optional)">
              <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
                <option value="">â€” No link â€”</option>
                {purchases.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.invoice_number} Â· {fmtMoney(p.amount)}</option>
                ))}
              </select>
            </Field>
          </div>
          <DocumentUploader userId={""} scope="invoices" docs={docs} onChange={setDocs}
            hint="Attach the invoice PDF, BL, packing list, or other supporting paperwork." />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editing ? "Save changes" : "Submit"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function InvoiceDetailModal({ invoice, inventory, onClose }: { invoice: any; inventory: any[]; onClose: () => void }) {
  const invDocs: DocMeta[] = Array.isArray(invoice.documents) ? invoice.documents : [];
  const debtor = invoice.debtor;
  const purchase = invoice.purchase;
  const openDoc = async (d: DocMeta) => {
    try {
      const encodedPath = d.path.split("/").map(encodeURIComponent).join("/");
      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4444";
      window.open(`${baseUrl}/upload/signed-url/${encodedPath}?token=${token}`, "_blank", "noopener");
    } catch {
      toast.error("Could not open document");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg">{invoice.invoice_number}</h3>
            <StatusPill status={invoice.status} />
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
              invoice.noa_status === "accepted" ? "border-success/50 text-success"
              : invoice.noa_status === "rejected" ? "border-destructive/50 text-destructive"
              : invoice.noa_status === "sent" ? "border-warning/50 text-warning"
              : "border-border text-muted-foreground"
            }`}>
              NOA: {invoice.noa_status?.replace("_", " ")}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Invoice summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Invoice details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Amount" value={fmtMoney(invoice.amount)} />
              <Detail label="Amount received" value={invoice.amount_received != null ? fmtMoney(invoice.amount_received) : "â€”"} />
              <Detail label="Issue date" value={fmtDate(invoice.issue_date)} />
              <Detail label="ERP Due date" value={fmtDate(invoice.due_date)} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (from ${invoice.due_date_source === "bl" ? "BL" : "invoice"} date)` : "â€”"} />
              {invoice.bl_date && <Detail label="BL date" value={fmtDate(invoice.bl_date)} />}
              <Detail label="Paid date" value={invoice.paid_date ? fmtDate(invoice.paid_date) : "â€”"} />
              <Detail label="Advance received" value={invoice.advance_received_date ? fmtDate(invoice.advance_received_date) : "â€”"} />
              <Detail label="Created" value={fmtDate(invoice.created_at)} />
              <Detail label="Last updated" value={fmtDate(invoice.updated_at)} />
              {invoice.po_number && <Detail label="PO number" value={invoice.po_number} />}
              {invoice.po_date && <Detail label="PO date" value={fmtDate(invoice.po_date)} />}
              {invoice.short_payment != null && <Detail label="Short payment" value={fmtMoney(invoice.short_payment)} />}
              {invoice.late_days != null && <Detail label="Late days" value={String(invoice.late_days)} />}
              {invoice.paid_note && <Detail label="Payment note" value={invoice.paid_note} />}
            </div>
            {invoice.noa_comments && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">NOA comments</div>
                <p className="mt-1 text-xs italic">"{invoice.noa_comments}"</p>
              </div>
            )}
          </div>

          {/* Debtor details */}
          {debtor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />Debtor
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={debtor.name} />
                <Detail label="Contact" value={debtor.contact_name || "â€”"} />
                <Detail label="Email" value={debtor.contact_email || "â€”"} />
                <Detail label="Phone" value={debtor.contact_phone || "â€”"} />
                <Detail label="Industry" value={debtor.industry || "â€”"} />
                {debtor.address_line && <Detail label="Address" value={[debtor.address_line, debtor.city, debtor.country].filter(Boolean).join(", ")} />}
                {debtor.website && <Detail label="Website" value={debtor.website} />}
              </div>
              {debtor.notes && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                  <p className="mt-1 text-xs text-muted-foreground">{debtor.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Linked purchase invoice */}
          {purchase && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Link2 className="mr-1 inline h-3.5 w-3.5" />Linked purchase invoice
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Invoice #" value={purchase.invoice_number} />
                <Detail label="Amount" value={fmtMoney(purchase.amount)} />
                <Detail label="Status" value={purchase.status} />
                {purchase.vendor && (
                  <>
                    <Detail label="Supplier" value={purchase.vendor.name} />
                    <Detail label="Supplier contact" value={purchase.vendor.contact_name || "â€”"} />
                    <Detail label="Supplier email" value={purchase.vendor.contact_email || "â€”"} />
                  </>
                )}
                {purchase.due_date && <Detail label="ERP Due date" value={fmtDate(purchase.due_date)} />}
                {purchase.po_number && <Detail label="PO number" value={purchase.po_number} />}
              </div>
            </div>
          )}

          {/* Client info */}
          {invoice.client && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <User className="mr-1 inline h-3.5 w-3.5" />Client
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Detail label="Company" value={invoice.client.company_name || "â€”"} />
                <Detail label="Contact" value={invoice.client.contact_name || "â€”"} />
                <Detail label="Email" value={invoice.client.email || "â€”"} />
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({invDocs.length})
            </h4>
            {invDocs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No documents attached to this invoice.</div>
            ) : (
              <ul className="space-y-1.5">
                {invDocs.map((d) => (
                  <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate" title={d.name}>{d.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button type="button" onClick={() => openDoc(d)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                      <Download className="h-3 w-3" /> Open
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Inventory movements */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <Package className="mr-1 inline h-3.5 w-3.5" />Inventory entries ({inventory.length})
            </h4>
            {inventory.length === 0 ? (
              <div className="text-xs text-muted-foreground">No inventory movements linked to this invoice.</div>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Item</th>
                      <th className="px-4 py-2 text-left font-normal">SKU</th>
                      <th className="px-4 py-2 text-right font-normal">Qty</th>
                      <th className="px-4 py-2 text-left font-normal">Unit</th>
                      <th className="px-4 py-2 text-right font-normal">Unit cost</th>
                      <th className="px-4 py-2 text-left font-normal">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((m: any) => (
                      <tr key={m.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5">{m.item_name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.sku || "â€”"}</td>
                        <td className="px-4 py-2.5 text-right num">{Number(m.quantity).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.unit}</td>
                        <td className="px-4 py-2.5 text-right num">{m.unit_cost != null ? fmtMoney(m.unit_cost) : "â€”"}</td>
                        <td className="px-4 py-2.5">{fmtDate(m.movement_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// â”€â”€ Mass Import Modal â”€â”€

interface ImportRow {
  invoice_number: string;
  amount: number;
  issue_date: string;
}

function MassImportModal({ onClose, debtors }: { onClose: () => void; debtors: any[] }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [debtorId, setDebtorId] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [dueDateSource, setDueDateSource] = useState<"invoice" | "bl">("invoice");
  const [blDate, setBlDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!debtorId) {
      toast.error("Please select a debtor first");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

        const parsed: ImportRow[] = json.map((row: any) => {
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row.invoiceNum ?? row.Invoice ?? row["Invoice#"] ?? "";
          const amt = Number(row.amount ?? row["Amount"] ?? row.Amount ?? 0);
          const issDate = row.issue_date ?? row["Issue Date"] ?? row.issueDate ?? row.Date ?? row.date ?? "";
          let dateStr = String(issDate);
          if (typeof issDate === "number" && !isNaN(issDate)) {
            const d = new Date((issDate - 25569) * 86400 * 1000);
            dateStr = d.toISOString().slice(0, 10);
          }
          return {
            invoice_number: String(invNum).trim(),
            amount: isNaN(amt) ? 0 : amt,
            issue_date: dateStr || "",
          };
        }).filter((r) => r.invoice_number && r.amount !== 0);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: invoice_number, amount, issue_date");
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Could not parse the Excel file. Please check the format.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      const payload = {
        debtor_id: debtorId,
        payment_terms_days: Number(paymentTermsDays) || 30,
        due_date_source: dueDateSource,
        bl_date: blDate || null,
        po_number: poNumber.trim() || null,
        po_date: poDate || null,
        advance_rate: 0,
        fee_rate: 0,
        invoices: rows.map((r) => ({
          invoice_number: r.invoice_number,
          amount: r.amount,
          issue_date: r.issue_date,
        })),
      };
      return await api.post<{ created: any[]; errors: Array<{ invoice_number: string; error: string }> }>("/invoices/batch", payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ created: data.created.length, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created.length} invoices created successfully`);
      } else {
        toast.success(`${data.created.length} created, ${errList.length} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const computedDue = useMemo(() => {
    if (!rows.length) return "";
    const base = dueDateSource === "bl" && blDate ? blDate : rows[0].issue_date;
    if (!base) return "";
    const d = new Date(base);
    d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
    return d.toISOString().slice(0, 10);
  }, [rows, dueDateSource, blDate, paymentTermsDays]);

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "form" ? "Mass import invoices" : step === "preview" ? "Preview imported invoices" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet (.xlsx, .xls, .xlsb, .xlsm), CSV, TSV, or ODS file with columns:{' '}
              <code className="font-mono text-primary">invoice_number</code>,{' '}
              <code className="font-mono text-primary">amount</code>,{' '}
              <code className="font-mono text-primary">issue_date</code>.
              Each row becomes a separate invoice. Due dates are auto-calculated from payment terms.
            </div>
            <Field label="Debtor *">
              <select required value={debtorId} onChange={(e) => setDebtorId(e.target.value)} className="inp">
                <option value="">Select debtor</option>
                {debtors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment terms (days) *"><input required type="number" min="0" className="inp" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} /></Field>
              <Field label="Due date source">
                <select className="inp" value={dueDateSource} onChange={(e) => setDueDateSource(e.target.value as any)}>
                  <option value="invoice">From invoice date</option>
                  <option value="bl">From BL date</option>
                </select>
              </Field>
            </div>
            {dueDateSource === "bl" && <Field label="BL date"><input type="date" className="inp" value={blDate} onChange={(e) => setBlDate(e.target.value)} /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="PO number (optional)"><input className="inp" placeholder="PO-2026-001" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></Field>
              <Field label="PO date"><input type="date" className="inp" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></Field>
            </div>
            <div className="border-t border-border pt-4">
              <Field label="Upload Excel / CSV file *">
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods" onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20" />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono text-foreground">{fileName}</span> Â· Found <strong className="text-foreground">{rows.length}</strong> invoices Â· Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Debtor</span><span>{debtors.find((d: any) => d.id === debtorId)?.name ?? "â€”"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payment terms</span><span>{paymentTermsDays}d net (from {dueDateSource === "bl" ? "BL" : "invoice"} date)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Due date example</span><span className="font-mono">{computedDue || "â€”"}</span></div>
              {poNumber && <div className="flex justify-between"><span className="text-muted-foreground">PO number</span><span className="font-mono">{poNumber}</span></div>}
            </div>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice number</th>
                    <th className="px-5 py-2 text-left font-normal">Issue date</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due date (computed)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const base = dueDateSource === "bl" && blDate ? blDate : r.issue_date;
                    const d = new Date(base);
                    d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
                    const dueStr = d.toISOString().slice(0, 10);
                    return (
                      <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(r.issue_date)}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                        <td className="px-5 py-3 text-sm font-mono">{dueStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button disabled={batchImport.isPending} onClick={() => batchImport.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {batchImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.created}</div>
              <div className="text-xs text-muted-foreground mt-1">Invoices created successfully</div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-xs uppercase tracking-widest text-destructive mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">{result.errors.map((err, i) => <li key={i} className="text-xs text-destructive">{err}</li>)}</ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}

        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}


