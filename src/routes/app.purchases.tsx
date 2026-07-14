import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, Stat, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import {
  X, Loader2, Link2, Trash2, Save, Eye,
  FileText, Building2, Package, Download, User, Plus, Upload,
  LayoutDashboard, PenLine, List, CheckCircle, SendHorizonal,
  BarChart3, Clock, Lock, AlertTriangle, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/purchases")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "dashboard",
    view: (search.view as string) || undefined,
  }),
  component: PurchasesPage,
});

const datePresets = [
  { label: "Today", getRange: () => { const today = new Date().toISOString().slice(0, 10); return { from: today, to: today }; } },
  { label: "This week", getRange: () => { const now = new Date(); const d = now.getDay(); const f = new Date(now); f.setDate(now.getDate() - d); const t = new Date(now); t.setDate(f.getDate() + 6); return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) }; } },
  { label: "This month", getRange: () => { const n = new Date(); const f = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10); const t = new Date(n.getFullYear(), n.getMonth() + 1, 0).toISOString().slice(0, 10); return { from: f, to: t }; } },
  { label: "Last month", getRange: () => { const n = new Date(); const f = new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().slice(0, 10); const t = new Date(n.getFullYear(), n.getMonth(), 0).toISOString().slice(0, 10); return { from: f, to: t }; } },
  { label: "This quarter", getRange: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3); const f = new Date(n.getFullYear(), q * 3, 1).toISOString().slice(0, 10); const t = new Date(n.getFullYear(), (q + 1) * 3, 0).toISOString().slice(0, 10); return { from: f, to: t }; } },
  { label: "Last quarter", getRange: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3); const f = new Date(n.getFullYear(), (q - 1) * 3, 1).toISOString().slice(0, 10); const t = new Date(n.getFullYear(), q * 3, 0).toISOString().slice(0, 10); return { from: f, to: t }; } },
  { label: "This year", getRange: () => { const n = new Date(); const f = new Date(n.getFullYear(), 0, 1).toISOString().slice(0, 10); const t = new Date(n.getFullYear(), 11, 31).toISOString().slice(0, 10); return { from: f, to: t }; } },
];

const statusFilters = ["all", "draft", "submitted", "approved", "paid", "overdue", "disputed"];

// ── Main Page Component ──

function PurchasesPage() {
  const { tab, view } = Route.useSearch();
  const navigate = useNavigate();
  const { user, isAdmin, isChecker, canWrite } = useAuth();
  const canCreate = canWrite("purchase-invoices");
  const canEdit = canWrite("purchase-invoices");
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();

  // Shared queries
  const piQ = useQuery({
    queryKey: ["purchase_invoices"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
  });

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
  });

  const salesQ = useQuery({
    queryKey: ["invoices-mini"],
    queryFn: async () => (await api.get<any[]>("/invoices/mini")) ?? [],
  });

  const allPi = piQ.data ?? [];

  // Compute dashboard stats
  const stats = useMemo(() => {
    const total = allPi.length;
    const totalAmount = allPi.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const draft = allPi.filter((p: any) => p.status === "draft");
    const draftAmount = draft.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const submitted = allPi.filter((p: any) => p.status === "submitted");
    const submittedAmount = submitted.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const inFunding = allPi.filter((p: any) => ["approved", "advanced", "funded"].includes(p.status));
    const fundingAmount = inFunding.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const paid = allPi.filter((p: any) => p.status === "paid");
    const paidAmount = paid.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const overdue = allPi.filter((p: any) => p.status === "overdue");
    const overdueAmount = overdue.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const disputed = allPi.filter((p: any) => p.status === "disputed");
    const disputedAmount = disputed.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const suppliersUsed = new Set(allPi.map((p: any) => p.vendor_id).filter(Boolean)).size;
    const openPayables = allPi.filter((p: any) => !["paid", "disputed"].includes(p.status));
    const openPayablesAmount = openPayables.reduce((s: number, p: any) => s + Number(p.amount), 0);
    return {
      total, totalAmount,
      draftCount: draft.length, draftAmount,
      submittedCount: submitted.length, submittedAmount,
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draftAmount + submittedAmount,
      fundingCount: inFunding.length, fundingAmount,
      paidCount: paid.length, paidAmount,
      overdueCount: overdue.length, overdueAmount,
      disputedCount: disputed.length, disputedAmount,
      suppliersUsed,
      openPayablesCount: openPayables.length, openPayablesAmount,
    };
  }, [allPi]);

  const setTab = (t: string) => navigate({ to: "/app/purchases", search: { tab: t, view: undefined }, replace: true });

  const tabs = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "create", label: "Create Invoice", icon: PenLine },
    { key: "list", label: "All Invoices", icon: List },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase invoices"
        description={
          tab === "dashboard"
            ? "Overview of all your purchase invoices at a glance."
            : tab === "create"
            ? "Create a new purchase invoice to submit for review."
            : "View, review, and manage all your purchase invoices."
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
        {tab === "dashboard" && <DashboardView stats={stats} invoices={allPi} />}
        {tab === "create" && <CreatePurchaseView />}
        {tab === "list" && (
          <ListView
            piQ={piQ}
            vendorsQ={vendorsQ}
            salesQ={salesQ}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canCreate={canCreate}
            canReview={canReview}
            viewParam={view}
            qc={qc}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}

// ── Page 1: Purchase Dashboard ──

function DashboardView({ stats, invoices }: { stats: any; invoices: any[] }) {
  const { isAdmin } = useAuth();

  // Supplier/vendor filter
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");

  const vendors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const inv of invoices) {
      if (inv.vendor_id && inv.vendor?.name) map.set(inv.vendor_id, { id: inv.vendor_id, name: inv.vendor.name });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!selectedVendorId) return invoices;
    return invoices.filter((i: any) => i.vendor_id === selectedVendorId);
  }, [invoices, selectedVendorId]);

  const localStats = useMemo(() => {
    const inv = filteredInvoices;
    const total = inv.length;
    const totalAmount = inv.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const draft = inv.filter((p: any) => p.status === "draft");
    const submitted = inv.filter((p: any) => p.status === "submitted");
    const inFunding = inv.filter((p: any) => ["approved", "advanced", "funded"].includes(p.status));
    const paid = inv.filter((p: any) => p.status === "paid");
    const overdue = inv.filter((p: any) => p.status === "overdue");
    const disputed = inv.filter((p: any) => p.status === "disputed");
    const openPayables = inv.filter((p: any) => !["paid", "disputed"].includes(p.status));
    return {
      total,
      totalAmount,
      draftCount: draft.length, draftAmount: draft.reduce((s: number, p: any) => s + Number(p.amount), 0),
      submittedCount: submitted.length, submittedAmount: submitted.reduce((s: number, p: any) => s + Number(p.amount), 0),
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draft.reduce((s, p) => s + Number(p.amount), 0) + submitted.reduce((s, p) => s + Number(p.amount), 0),
      fundingCount: inFunding.length, fundingAmount: inFunding.reduce((s: number, p: any) => s + Number(p.amount), 0),
      paidCount: paid.length, paidAmount: paid.reduce((s: number, p: any) => s + Number(p.amount), 0),
      overdueCount: overdue.length, overdueAmount: overdue.reduce((s: number, p: any) => s + Number(p.amount), 0),
      disputedCount: disputed.length, disputedAmount: disputed.reduce((s: number, p: any) => s + Number(p.amount), 0),
      suppliersUsed: new Set(inv.map((p: any) => p.vendor_id).filter(Boolean)).size,
      openPayablesCount: openPayables.length,
      openPayablesAmount: openPayables.reduce((s: number, p: any) => s + Number(p.amount), 0),
    };
  }, [filteredInvoices]);

  const displayStats = selectedVendorId ? localStats : stats;

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

  const topSuppliers = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const inv of filteredInvoices) {
      const name = inv.vendor?.name || "Unknown";
      const entry = map.get(name) || { name, count: 0, total: 0 };
      entry.count++;
      entry.total += Number(inv.amount);
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filteredInvoices]);

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
  }, [filteredInvoices]);

  const chartData = useMemo(() => {
    const months = new Map<string, { month: string; count: number; amount: number }>();
    for (const inv of filteredInvoices) {
      const date = inv.issue_date || inv.created_at;
      if (!date) continue;
      const key = date.slice(0, 7);
      const entry = months.get(key) || { month: key, count: 0, amount: 0 };
      entry.count++;
      entry.amount += Number(inv.amount) || 0;
      months.set(key, entry);
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [filteredInvoices]);

  if (filteredInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium text-foreground">No purchase invoices yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">{selectedVendorId ? "No invoices found for this supplier." : "Create your first purchase invoice."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Supplier Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30">
            <option value="">All Suppliers</option>
            {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
          </select>
        </div>
        {selectedVendorId && (
          <button onClick={() => setSelectedVendorId("")} className="text-xs text-muted-foreground hover:text-foreground underline">Clear filter</button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {selectedVendorId ? <>{filteredInvoices.length} invoices · {fmtMoney(displayStats.totalAmount)}</> : <>{invoices.length} invoices total</>}
        </span>
      </div>

      {/* Primary KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Purchases" value={String(displayStats.total)} />
        <Stat label="Total Amount" value={fmtMoney(displayStats.totalAmount)} />
        <Stat label="Paid Invoices" value={String(displayStats.paidCount)} delta={fmtMoney(displayStats.paidAmount)} tone="good" />
        <Stat label="Open Payables" value={fmtMoney(displayStats.openPayablesAmount)} delta={`${displayStats.openPayablesCount} invoices`} tone="warn" />
      </div>

      {/* Secondary KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting Checker" value={String(displayStats.awaitingCheckerCount)} delta={fmtMoney(displayStats.awaitingCheckerAmount)} tone="warn" />
        <Stat label="In Funding Queue" value={String(displayStats.fundingCount)} delta={fmtMoney(displayStats.fundingAmount)} tone="neutral" />
        <Stat label="Overdue" value={String(displayStats.overdueCount)} delta={fmtMoney(displayStats.overdueAmount)} tone={displayStats.overdueCount > 0 ? "bad" : "good"} />
        <Stat label="Disputed" value={String(displayStats.disputedCount)} delta={fmtMoney(displayStats.disputedAmount)} tone={displayStats.disputedCount > 0 ? "bad" : "good"} />
      </div>

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <Card title={<div className="flex items-center gap-2"><span>Purchase Trend</span><span className="text-xs font-normal text-muted-foreground">Monthly volume &amp; value</span></div>}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGradientP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="areaGradientP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(262 80% 50%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(262 80% 50%)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v) => { const d = new Date(v + "-01"); return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }} className="text-xs text-muted-foreground" />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v) => "$" + (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "K" : v)}
                  className="text-xs text-muted-foreground" domain={[0, (max: number) => Math.ceil(max * 1.15 / 100000) * 100000]} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tickMargin={8}
                  className="text-xs text-muted-foreground" domain={[0, (max: number) => Math.ceil(max * 1.15 / 5) * 5]} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = new Date(label + "-01");
                  const monthLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                  const amount = payload.find(p => p.dataKey === "amount")?.value as number || 0;
                  const count = payload.find(p => p.dataKey === "count")?.value as number || 0;
                  return (
                    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium mb-1">{monthLabel}</div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(38 92% 50%)" }} />
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono font-medium tabular-nums">{fmtMoney(amount)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(262 80% 50%)" }} />
                        <span className="text-muted-foreground">Invoices:</span>
                        <span className="font-mono font-medium tabular-nums">{count}</span>
                      </div>
                    </div>
                  );
                }} />
                <Bar yAxisId="left" dataKey="amount" fill="url(#barGradientP)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Area yAxisId="right" dataKey="count" fill="url(#areaGradientP)" stroke="hsl(262 80% 50%)" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, strokeWidth: 1, stroke: "hsl(var(--background))", fill: "hsl(262 80% 50%)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Status Breakdown & Top Suppliers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status Breakdown">
          <div className="space-y-3">
            {statusFilters.filter((s) => s !== "all").map((status) => {
              const count = statusBreakdown.counts[status] ?? 0;
              const amount = statusBreakdown.amounts[status] ?? 0;
              if (count === 0) return null;
              return (
                <div key={status} className="flex items-center justify-between">
                  <StatusPill status={status} />
                  <div className="text-right">
                    <div className="text-sm font-medium">{count}</div>
                    <div className="text-xs text-muted-foreground">{fmtMoney(amount)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Top Suppliers by Volume">
          <div className="space-y-3">
            {topSuppliers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No supplier data yet.</div>
            ) : (
              topSuppliers.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{s.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium num">{fmtMoney(s.total)}</div>
                    <div className="text-[10px] text-muted-foreground">{s.count} invoice{s.count !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Overdue Alerts */}
      {mostOverdue.length > 0 && (
        <Card title={<div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><span>Overdue Alerts</span><span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{displayStats.overdueCount} overdue</span></div>}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">The following {mostOverdue.length} invoice{mostOverdue.length !== 1 ? "s are" : " is"} past due and require attention.</p>
            <div className="-mx-6 -mb-6">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 text-left font-normal">Invoice</th><th className="px-6 py-3 text-left font-normal">Supplier</th>
                    <th className="px-6 py-3 text-right font-normal">Amount</th><th className="px-6 py-3 text-right font-normal">Days Overdue</th>
                    <th className="px-6 py-3 text-left font-normal">Due Date</th><th className="px-6 py-3 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mostOverdue.map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="px-6 py-3">{i.vendor?.name ?? "—"}</td>
                      <td className="px-6 py-3 text-right num text-destructive">{fmtMoney(i.amount)}</td>
                      <td className="px-6 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.daysPastDue > 60 ? "bg-destructive/15 text-destructive" : i.daysPastDue > 30 ? "bg-warning/15 text-warning" : "bg-orange-100 text-orange-700"}`}>
                          <AlertCircle className="h-3 w-3" />{i.daysPastDue}d
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className="px-6 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {displayStats.overdueCount > 5 && (
              <div className="pt-2 text-center text-xs text-muted-foreground">+ {displayStats.overdueCount - 5} more overdue invoice{(displayStats.overdueCount - 5) !== 1 ? "s" : ""} not shown</div>
            )}
          </div>
        </Card>
      )}

      {/* Recent Invoices */}
      <Card title="Recent Purchase Invoices">
        <div className="-mx-6 -mb-6">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left font-normal">Invoice</th><th className="px-6 py-3 text-left font-normal">Supplier</th>
                <th className="px-6 py-3 text-right font-normal">Amount</th><th className="px-6 py-3 text-left font-normal">Status</th><th className="px-6 py-3 text-left font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.slice(0, 10).map((i: any) => (
                <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                  <td className="px-6 py-3">{i.vendor?.name ?? "—"}</td>
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

// ── Page 2: Create Purchase Invoice ──

function CreatePurchaseView() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canCreate = canWrite("purchase-invoices");
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
  });

  if (!canCreate) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Lock className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium">No permission</h3>
        <p className="mt-1 text-sm text-muted-foreground">You don't have permission to create purchase invoices.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">New Purchase Invoice</h2>
        <button onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
          <Upload className="h-3.5 w-3.5" /> Mass import
        </button>
      </div>
      <PurchaseInvoiceForm
        editing={null}
        vendors={vendorsQ.data ?? []}
        onClose={() => navigate({ to: "/app/purchases", search: { tab: "list" }, replace: true })}
        onDone={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        isStandalone
      />
      {importOpen && <MassImportPurchaseModal onClose={() => setImportOpen(false)} vendors={vendorsQ.data ?? []} />}
    </div>
  );
}

// ── Page 3: All Purchases (List View) ──

function ListView({ piQ, vendorsQ, salesQ, isAdmin, canEdit, canCreate, canReview, viewParam, qc, navigate }: {
  piQ: any; vendorsQ: any; salesQ: any; isAdmin: boolean; canEdit: boolean; canCreate: boolean;
  canReview: boolean; viewParam?: string; qc: any; navigate: any;
}) {
  const { canWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");

  const stockMovementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const linkedSales = (piId: string) => {
    const pi = (piQ.data ?? []).find((p: any) => p.id === piId);
    return pi?.linkedSales ?? [];
  };

  // Auto-open detail modal
  useEffect(() => {
    if (viewParam && piQ.data) {
      const found = piQ.data.find((p: any) => p.id === viewParam);
      if (found) {
        setViewing(found);
        navigate({ to: "/app/purchases", search: { tab: "list", view: undefined }, replace: true });
      }
    }
  }, [viewParam, piQ.data]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "paid") patch.paid_date = new Date().toISOString().slice(0, 10);
      await api.patch(`/purchase-invoices/${id}`, patch);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/purchase-invoices/${id}`); },
    onSuccess: () => { toast.success("Purchase invoice removed"); qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const submitToChecker = useMutation({
    mutationFn: async (id: string) => { await api.post(`/purchase-invoices/${id}/submit`); },
    onSuccess: () => { toast.success("Invoice sent to checker for review"); qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = (piQ.data ?? []).filter((p: any) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (issueDateFrom && p.issue_date && p.issue_date < issueDateFrom) return false;
    if (issueDateTo && p.issue_date && p.issue_date > issueDateTo) return false;
    const q = searchQuery.toLowerCase();
    return p.invoice_number?.toLowerCase().includes(q) || p.po_number?.toLowerCase().includes(q) ||
      p.vendor?.name?.toLowerCase().includes(q) || p.status?.toLowerCase().includes(q) ||
      p.client?.company_name?.toLowerCase().includes(q) || p.client?.contact_name?.toLowerCase().includes(q);
  });

  const viewedInventory = useMemo(() => {
    if (!viewing) return [];
    return (stockMovementsQ.data ?? []).filter((m: any) => m.purchase_invoice_id === viewing.id);
  }, [viewing, stockMovementsQ.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
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
            <button key={preset.label} onClick={() => { const r = preset.getRange(); setIssueDateFrom(r.from); setIssueDateTo(r.to); }}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Issue from</label>
          <input type="date" value={issueDateFrom} onChange={(e) => setIssueDateFrom(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">to</label>
          <input type="date" value={issueDateTo} onChange={(e) => setIssueDateTo(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
        </div>
        {(issueDateFrom || issueDateTo) && (
          <button onClick={() => { setIssueDateFrom(""); setIssueDateTo(""); }} className="text-xs text-muted-foreground hover:text-foreground underline">Clear dates</button>
        )}
      </div>

      <div className="relative">
        <input type="text" placeholder="Search purchases by invoice, supplier, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
      </div>

      <Card>
        {piQ.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No purchase invoices.</div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left font-normal">Invoice</th>
                  <th className="px-5 py-2 text-left font-normal">Client</th>
                  <th className="px-5 py-2 text-left font-normal">Supplier</th>
                  <th className="px-5 py-2 text-left font-normal">PO</th>
                  <th className="px-5 py-2 text-left font-normal">Issue date</th>
                  <th className="px-5 py-2 text-right font-normal">Amount</th>
                  <th className="px-5 py-2 text-left font-normal">ERP Due Date</th>
                  <th className="px-5 py-2 text-left font-normal">Contractual Payment Terms</th>
                  <th className="px-5 py-2 text-left font-normal">Paid date</th>
                  <th className="px-5 py-2 text-right font-normal">Late days</th>
                  <th className="px-5 py-2 text-left font-normal">Status</th>
                  <th className="px-5 py-2 text-left font-normal">Linked sales</th>
                  <th className="px-5 py-2 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => {
                  const dpd = p.due_date && p.status !== "paid" ? daysBetween(p.due_date) : 0;
                  let lateDays = Math.max(0, dpd);
                  if (p.status === "paid" && p.due_date && p.paid_date) {
                    const ms = new Date(p.paid_date).getTime() - new Date(p.due_date).getTime();
                    lateDays = Math.max(0, Math.round(ms / 86400000));
                  }
                  const links = linkedSales(p.id);
                  const isDraft = p.status === "draft";
                  const isSubmitted = p.status === "submitted";
                  return (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">{p.invoice_number}</td>
                      <td className="px-5 py-3 text-muted-foreground">{p.client?.company_name || p.client?.contact_name || "—"}</td>
                      <td className="px-5 py-3">{p.vendor?.name ?? "—"}</td>
                      <td className="px-5 py-3">
                        {p.po_number ? (<div><div className="font-mono text-xs">{p.po_number}</div>{p.po_date && <div className="text-[10px] text-muted-foreground">{fmtDate(p.po_date)}</div>}</div>) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-sm">{fmtDate(p.issue_date)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(p.due_date)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${p.has_contractual_due_date ? "border-success/50 text-success" : "border-border text-muted-foreground"}`}>
                          {p.has_contractual_due_date ? "Yes" : "N/A"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm">{p.status === "paid" ? fmtDate(p.paid_date) : <span className="text-muted-foreground">—</span>}</td>
                      <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                      <td className="px-5 py-3"><StatusPill status={p.status} /></td>
                      <td className="px-5 py-3">
                        {links.length === 0 ? <span className="text-muted-foreground">—</span> : (
                          <div className="space-y-0.5">
                            {links.map((s: any) => (
                              <Link key={s.id} to="/app/invoices" search={{ view: s.id }} className="flex items-center gap-1 text-xs text-primary hover:underline">
                                <Link2 className="h-3 w-3" />{s.invoice_number}<span className="text-muted-foreground">→ {s.debtor?.name ?? "?"}</span>
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button onClick={() => setViewing(p)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                            <Eye className="h-3 w-3" /> View
                          </button>

                          {/* Draft: review + submit to checker */}
                          {isDraft && canEdit && (
                            <>
                              <button onClick={() => { setEditing(p); setOpen(true); }}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                                <PenLine className="h-3 w-3" /> Review
                              </button>
                              <button onClick={() => { if (confirm(`Send invoice ${p.invoice_number} to checker for review?`)) submitToChecker.mutate(p.id); }}
                                disabled={submitToChecker.isPending}
                                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                                <SendHorizonal className="h-3 w-3" /> Send to Checker
                              </button>
                            </>
                          )}

                          {/* Submitted: awaiting checker */}
                          {isSubmitted && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-2 py-1 text-[10px] text-warning">
                              <Clock className="h-3 w-3" /> Awaiting checker
                            </span>
                          )}

                          {/* Edit/Delete for draft */}
                          {canEdit && isDraft && (
                            <>
                              <button onClick={() => { setEditing(p); setOpen(true); }} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                              <button onClick={() => { if (confirm(`Remove purchase invoice ${p.invoice_number}?`)) remove.mutate(p.id); }}
                                className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}

                          {/* Checker actions */}
                          {(isAdmin || canReview) && isSubmitted && (
                            <Link to="/app/checker" className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                              <CheckCircle className="h-3 w-3" /> Review →
                            </Link>
                          )}

                          {/* Status labels */}
                          {!isDraft && !isSubmitted && ["approved", "advanced", "funded"].includes(p.status) && (
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                          )}
                          {p.status === "paid" && <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>}
                          {p.status === "overdue" && <span className="text-[10px] uppercase tracking-widest text-destructive">Overdue</span>}
                          {p.status === "disputed" && <span className="text-[10px] uppercase tracking-widest text-destructive">Disputed</span>}
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

      {/* Modals */}
      {importOpen && <MassImportPurchaseModal onClose={() => setImportOpen(false)} vendors={vendorsQ.data ?? []} />}
      {open && (
        <PurchaseInvoiceForm
          editing={editing}
          vendors={vendorsQ.data ?? []}
          onClose={() => { setOpen(false); setEditing(null); }}
          onDone={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        />
      )}
      {viewing && (
        <PurchaseInvoiceDetailModal
          invoice={viewing}
          salesLinks={linkedSales(viewing.id)}
          inventory={viewedInventory}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

// ── Purchase Invoice Form (shared between Create and Edit) ──

function PurchaseInvoiceForm({ editing, vendors, onClose, onDone, isStandalone }: {
  editing: any | null; vendors: any[]; onClose: () => void; onDone: () => void; isStandalone?: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    invoice_number: editing?.invoice_number ?? "",
    vendor_id: editing?.vendor_id ?? "",
    amount: String(editing?.amount ?? ""),
    po_number: editing?.po_number ?? "",
    po_date: editing?.po_date ?? "",
    issue_date: editing?.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: editing?.due_date ?? "",
    payment_terms_days: String(editing?.payment_terms_days ?? "30"),
    has_contractual_due_date: editing?.has_contractual_due_date ?? false,
    bl_date: editing?.bl_date ?? "",
    due_date_source: editing?.due_date_source ?? "invoice",
    notes: editing?.notes ?? "",
  }));
  const [docs, setDocs] = useState<DocMeta[]>(editing?.documents ?? []);
  const [invEnabled, setInvEnabled] = useState(false);
  const [invItems, setInvItems] = useState<Array<{ item_name: string; sku: string; quantity: string; unit: string; unit_cost: string }>>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);
  const vendorRef = useRef<HTMLDivElement>(null);
  const [linkedSalesIds, setLinkedSalesIds] = useState<string[]>(editing?.linked_sales_invoice_ids ?? []);
  const [salesSearch, setSalesSearch] = useState("");
  const [salesOpen, setSalesOpen] = useState(false);
  const salesRef = useRef<HTMLDivElement>(null);
  const [hasDueDate, setHasDueDate] = useState(() => {
    if (editing?.due_date) return true;
    const terms = Number(editing?.payment_terms_days ?? 30) || 30;
    const base = editing?.due_date_source === "bl" && editing?.bl_date ? editing.bl_date : (editing?.issue_date ?? new Date().toISOString().slice(0, 10));
    return !!base;
  });

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-purchase", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a: any) => a.status !== "refunded")
    .reduce((s: number, a: any) => s + Number(a.amount), 0);

  useEffect(() => {
    if (!editing && poLookupQ.data?.proformas) {
      const purchasePf = poLookupQ.data.proformas.find((p: any) => p.side === "purchase");
      if (purchasePf?.vendor_id && !form.vendor_id) setForm((prev: any) => ({ ...prev, vendor_id: purchasePf.vendor_id }));
    }
  }, [poLookupQ.data]);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (vendorRef.current && !vendorRef.current.contains(e.target as Node)) setVendorOpen(false); };
    document.addEventListener("mousedown", handle); return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (salesRef.current && !salesRef.current.contains(e.target as Node)) setSalesOpen(false); };
    document.addEventListener("mousedown", handle); return () => document.removeEventListener("mousedown", handle);
  }, []);

  const salesInvoicesQ = useQuery({
    queryKey: ["sales-invoices-mini"],
    queryFn: async () => (await api.get<any[]>("/invoices/mini")) ?? [],
  });

  const balanceDue = Math.max(0, Number(form.amount || 0) - advancesTotal);
  const termsDays = Number(form.payment_terms_days) || 30;
  const computedDue = (() => {
    const base = form.due_date_source === "bl" && form.bl_date ? form.bl_date : form.issue_date;
    if (!base) return "";
    const d = new Date(base); d.setDate(d.getDate() + termsDays); return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.vendor_id) throw new Error("Add a supplier first.");
      if (!form.invoice_number.trim()) throw new Error("Invoice number required");
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      const payload: any = {
        vendor_id: form.vendor_id, invoice_number: form.invoice_number.trim(), amount: Number(form.amount),
        po_number: form.po_number || null, po_date: form.po_date || null, issue_date: form.issue_date,
        due_date: hasDueDate ? effectiveDue : null, payment_terms_days: Number(form.payment_terms_days) || 30,
        bl_date: form.bl_date || null, due_date_source: form.due_date_source,
        notes: form.notes || null, documents: docs,
      };
      if (!editing && invEnabled) {
        const items = invItems.filter((it) => it.item_name.trim() && Number(it.quantity) > 0);
        if (items.length > 0) {
          payload.inventory_items = items.map((item) => ({ item_name: item.item_name.trim(), sku: item.sku || null, quantity: Number(item.quantity), unit: item.unit || "unit", unit_cost: item.unit_cost ? Number(item.unit_cost) : null }));
        }
      }
      payload.linked_sales_invoice_ids = linkedSalesIds;
      if (editing) { await api.patch(`/purchase-invoices/${editing.id}`, payload); }
      else { await api.post("/purchase-invoices", payload); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] }); onDone();
      toast.success(editing ? "Purchase invoice updated" : "Purchase invoice created as draft.");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className={isStandalone ? "" : "fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"} onClick={isStandalone ? undefined : onClose}>
      <div className={isStandalone ? "max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-sm" : "max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault"} onClick={(e) => e.stopPropagation()}>
        {!isStandalone && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
            <h3 className="font-display text-lg">{editing ? "Edit purchase invoice" : "New purchase invoice"}</h3>
            <button onClick={onClose}><X className="h-4 w-4" /></button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          {vendors.length === 0 && <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">Add a supplier first in the Suppliers tab.</div>}

          {!editing && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
              <div className="grid gap-3 md:grid-cols-2">
                <L label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></L>
                <L label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></L>
              </div>
            </div>
          )}

          {!editing && form.po_number.trim() && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Advances paid against PO {form.po_number}</div>
              {poLookupQ.isFetching ? <div className="text-muted-foreground">Looking up…</div>
                : (poLookupQ.data?.advances ?? []).length === 0 ? <div className="text-muted-foreground">No advances recorded for this PO number.</div>
                : <ul className="space-y-0.5">{(poLookupQ.data?.advances ?? []).map((a: any) => (
                    <li key={a.id} className="flex justify-between"><span className="text-muted-foreground">{fmtDate(a.advance_date)}{a.reference ? ` · ${a.reference}` : ""}</span><span className="num text-primary">{fmtMoney(a.amount)}</span></li>
                  ))}</ul>
              }
              <div className="mt-2 flex justify-between border-t border-border pt-2"><span>Total invoice amount</span><span className="num">{fmtMoney(Number(form.amount || 0))}</span></div>
              <div className="flex justify-between"><span>Advance paid</span><span className="num text-primary">{fmtMoney(advancesTotal)}</span></div>
              <div className="flex justify-between font-medium border-t border-border pt-1 mt-1"><span>Balance due to supplier</span><span className="num">{fmtMoney(balanceDue)}</span></div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <L label="Invoice number *"><input required maxLength={80} className="inp" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></L>
            <L label="Supplier *">
              <div className="relative" ref={vendorRef}>
                {form.vendor_id ? (
                  <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                    <span className="text-sm truncate">{vendors.find((v: any) => v.id === form.vendor_id)?.name ?? "Unknown"}</span>
                    <button type="button" onClick={() => { setForm({ ...form, vendor_id: "" }); setVendorSearch(""); }} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <input className="inp" placeholder="Search suppliers…" value={vendorSearch} onChange={(e) => { setVendorSearch(e.target.value); setVendorOpen(true); }} onFocus={() => setVendorOpen(true)} />
                    {vendorOpen && vendorSearch.trim() && (
                      <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                        {vendors.filter((v: any) => v.name?.toLowerCase().includes(vendorSearch.toLowerCase())).length === 0
                          ? <div className="p-3 text-xs text-muted-foreground">No matching suppliers.</div>
                          : vendors.filter((v: any) => v.name?.toLowerCase().includes(vendorSearch.toLowerCase())).slice(0, 20).map((v: any) => (
                              <button key={v.id} type="button" onClick={() => { setForm({ ...form, vendor_id: v.id }); setVendorSearch(""); setVendorOpen(false); }}
                                className="flex w-full items-center px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors text-left">{v.name}</button>
                            ))
                        }
                      </div>
                    )}
                  </>
                )}
              </div>
            </L>
            <L label="Total invoice amount *"><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
            <L label="Issue date"><input required type="date" className="inp" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></L>
            <L label="BL date"><input type="date" className="inp" value={form.bl_date} onChange={(e) => setForm({ ...form, bl_date: e.target.value })} /></L>
            <L label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} /></L>
            <L label="Due date source">
              <select className="inp" value={form.due_date_source} onChange={(e) => setForm({ ...form, due_date_source: e.target.value })}>
                <option value="invoice">From invoice date</option><option value="bl">From BL date</option>
              </select>
            </L>
            <L label={`Due date (auto: ${termsDays}d net from ${form.due_date_source === "bl" ? "BL" : "invoice"} date)`}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hasDueDate} onChange={(e) => { const v = e.target.checked; setHasDueDate(v); if (!v) setForm({ ...form, due_date: "" }); else setForm({ ...form, due_date: computedDue }); }} />
                  Enable due date
                </label>
                {hasDueDate && <input type="date" className="inp" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />}
              </div>
            </L>
            <L label="Contractual payment terms">
              <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <input type="checkbox" checked={form.has_contractual_due_date} onChange={(e) => setForm({ ...form, has_contractual_due_date: e.target.checked })} />
                Has contractual payment terms
              </label>
            </L>
          </div>

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <L label="Link to sales invoices (optional)">
            <div className="space-y-2">
              {linkedSalesIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {linkedSalesIds.map((sId: string) => {
                    const si = (salesInvoicesQ.data ?? []).find((s: any) => s.id === sId);
                    return (
                      <span key={sId} className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px]">
                        <span className="font-mono truncate max-w-[120px]">{si?.invoice_number ?? sId.slice(0, 8)}</span>
                        {si && <span className="text-muted-foreground">{fmtMoney(si.amount)}</span>}
                        <button type="button" onClick={() => setLinkedSalesIds((prev) => prev.filter((id: string) => id !== sId))} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative" ref={salesRef}>
                <input className="inp" placeholder="Search sales invoices…" value={salesSearch} onChange={(e) => { setSalesSearch(e.target.value); setSalesOpen(true); }} onFocus={() => setSalesOpen(true)} />
                {salesOpen && salesSearch.trim() && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                    {(salesInvoicesQ.data ?? []).filter((s: any) => s.invoice_number?.toLowerCase().includes(salesSearch.toLowerCase())).length === 0
                      ? <div className="p-3 text-xs text-muted-foreground">No matching sales invoices.</div>
                      : (salesInvoicesQ.data ?? []).filter((s: any) => s.invoice_number?.toLowerCase().includes(salesSearch.toLowerCase())).slice(0, 20).map((s: any) => {
                          const alreadySelected = linkedSalesIds.includes(s.id);
                          return (
                            <button key={s.id} type="button" onClick={() => { if (alreadySelected) { setLinkedSalesIds((prev) => prev.filter((id: string) => id !== s.id)); } else { setLinkedSalesIds((prev) => [...prev, s.id]); } setSalesSearch(""); }}
                              className={`flex w-full items-center justify-between px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors ${alreadySelected ? "bg-primary/5" : ""}`}>
                              <div className="flex items-center gap-2 min-w-0">{alreadySelected && <span className="text-primary shrink-0">✓</span>}<span className="font-mono truncate">{s.invoice_number}</span></div>
                              <span className="num text-muted-foreground shrink-0 ml-2">{fmtMoney(s.amount)}</span>
                            </button>
                          );
                        })
                    }
                  </div>
                )}
              </div>
            </div>
          </L>

          {!editing && (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={invEnabled} onChange={(e) => setInvEnabled(e.target.checked)} />
                <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-in / credit)</span>
              </label>
              {invEnabled && (
                <div className="mt-3 space-y-4">
                  {invItems.map((item, idx) => (
                    <div key={idx} className="relative rounded-md border border-border bg-background/40 p-3 pt-5">
                      <button type="button" onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))} className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        <L label="Item *"><input className="inp" value={item.item_name} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, item_name: e.target.value } : it))} /></L>
                        <L label="SKU"><input className="inp" value={item.sku} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, sku: e.target.value } : it))} /></L>
                        <L label="Quantity *"><input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="inp" value={item.quantity} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} /></L>
                        <L label="Unit"><input className="inp" value={item.unit} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} /></L>
                        <L label="Unit cost"><input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="inp" value={item.unit_cost} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_cost: e.target.value } : it))} /></L>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setInvItems((prev) => [...prev, { item_name: "", sku: "", quantity: "", unit: "unit", unit_cost: "" }])}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
                    <Plus className="h-3.5 w-3.5" /> Add item
                  </button>
                </div>
              )}
            </div>
          )}
          <DocumentUploader userId={""} scope="purchase_invoices" docs={docs} onChange={setDocs} hint="Attach the supplier invoice, BL, packing list, or other supporting paperwork." />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editing ? "Save changes" : "Create Draft Invoice"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ── Detail modal ──

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div><div className="mt-0.5">{value}</div></div>;
}

function PurchaseInvoiceDetailModal({ invoice, salesLinks, inventory, onClose }: { invoice: any; salesLinks: any[]; inventory: any[]; onClose: () => void }) {
  const invDocs: DocMeta[] = Array.isArray(invoice.documents) ? invoice.documents : [];
  const vendor = invoice.vendor;

  const openDoc = async (d: DocMeta) => {
    try {
      const encodedPath = d.path.split("/").map(encodeURIComponent).join("/");
      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4444";
      window.open(`${baseUrl}/upload/signed-url/${encodedPath}?token=${token}`, "_blank", "noopener");
    } catch { toast.error("Could not open document"); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3"><h3 className="font-display text-lg">{invoice.invoice_number}</h3><StatusPill status={invoice.status} /></div>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-6 p-5">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Purchase invoice details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Amount" value={fmtMoney(invoice.amount)} />
              <Detail label="Issue date" value={fmtDate(invoice.issue_date)} />
              <Detail label="ERP Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (from ${invoice.due_date_source === "bl" ? "BL" : "invoice"} date)` : "—"} />
              <Detail label="Contractual payment terms" value={invoice.has_contractual_due_date ? "Yes" : "N/A"} />
              {invoice.bl_date && <Detail label="BL date" value={fmtDate(invoice.bl_date)} />}
              <Detail label="Paid date" value={invoice.paid_date ? fmtDate(invoice.paid_date) : "—"} />
              <Detail label="Advance paid date" value={invoice.advance_paid_date ? fmtDate(invoice.advance_paid_date) : "—"} />
              <Detail label="Funded date" value={invoice.funded_date ? fmtDate(invoice.funded_date) : "—"} />
              <Detail label="Created" value={fmtDate(invoice.created_at)} />
              <Detail label="Last updated" value={fmtDate(invoice.updated_at)} />
              {invoice.po_number && <Detail label="PO number" value={invoice.po_number} />}
              {invoice.po_date && <Detail label="PO date" value={fmtDate(invoice.po_date)} />}
            </div>
            {invoice.notes && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                <p className="mt-1 text-xs italic">{invoice.notes}</p>
              </div>
            )}
          </div>

          {vendor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary"><Building2 className="mr-1 inline h-3.5 w-3.5" />Supplier</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={vendor.name} /><Detail label="Contact" value={vendor.contact_name || "—"} /><Detail label="Email" value={vendor.contact_email || "—"} />
                <Detail label="Phone" value={vendor.contact_phone || "—"} /><Detail label="Industry" value={vendor.industry || "—"} />
                {vendor.address_line && <Detail label="Address" value={[vendor.address_line, vendor.city, vendor.country].filter(Boolean).join(", ")} />}
                {vendor.website && <Detail label="Website" value={vendor.website} />}
              </div>
            </div>
          )}

          {invoice.client && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary"><User className="mr-1 inline h-3.5 w-3.5" />Client</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Detail label="Company" value={invoice.client.company_name || "—"} /><Detail label="Contact" value={invoice.client.contact_name || "—"} /><Detail label="Email" value={invoice.client.email || "—"} />
              </div>
            </div>
          )}

          {salesLinks.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary"><Link2 className="mr-1 inline h-3.5 w-3.5" />Linked sales invoices ({salesLinks.length})</h4>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border"><th className="px-4 py-2 text-left font-normal">Invoice</th><th className="px-4 py-2 text-left font-normal">Debtor</th><th className="px-4 py-2 text-right font-normal">Amount</th><th className="px-4 py-2 text-left font-normal">Status</th></tr>
                  </thead>
                  <tbody>
                    {salesLinks.map((s: any) => (
                      <tr key={s.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-mono text-xs"><Link to="/app/invoices" search={{ view: s.id }} className="text-primary hover:underline">{s.invoice_number}</Link></td>
                        <td className="px-4 py-2.5">{s.debtor?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right num">{fmtMoney(s.amount)}</td>
                        <td className="px-4 py-2.5"><StatusPill status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary"><FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({invDocs.length})</h4>
            {invDocs.length === 0 ? <div className="text-xs text-muted-foreground">No documents attached.</div> : (
              <ul className="space-y-1.5">
                {invDocs.map((d) => (
                  <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="truncate" title={d.name}>{d.name}</span><span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span></div>
                    <button type="button" onClick={() => openDoc(d)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary"><Download className="h-3 w-3" /> Open</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary"><Package className="mr-1 inline h-3.5 w-3.5" />Inventory entries ({inventory.length})</h4>
            {inventory.length === 0 ? <div className="text-xs text-muted-foreground">No inventory movements linked.</div> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border"><th className="px-4 py-2 text-left font-normal">Item</th><th className="px-4 py-2 text-left font-normal">SKU</th><th className="px-4 py-2 text-right font-normal">Qty</th><th className="px-4 py-2 text-left font-normal">Unit</th><th className="px-4 py-2 text-right font-normal">Unit cost</th><th className="px-4 py-2 text-left font-normal">Date</th></tr>
                  </thead>
                  <tbody>
                    {inventory.map((m: any) => (
                      <tr key={m.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5">{m.item_name}</td><td className="px-4 py-2.5 text-muted-foreground">{m.sku || "—"}</td>
                        <td className="px-4 py-2.5 text-right num">{Number(m.quantity).toLocaleString()}</td><td className="px-4 py-2.5 text-muted-foreground">{m.unit}</td>
                        <td className="px-4 py-2.5 text-right num">{m.unit_cost != null ? fmtMoney(m.unit_cost) : "—"}</td><td className="px-4 py-2.5">{fmtDate(m.movement_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button></div>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// ── Mass Import Purchase Modal ──

function MassImportPurchaseModal({ onClose, vendors }: { onClose: () => void; vendors: any[] }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [vendorId, setVendorId] = useState("");
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
    const file = e.target.files?.[0]; if (!file) return;
    if (!vendorId) { toast.error("Please select a supplier first"); if (fileRef.current) fileRef.current.value = ""; return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[workbook.SheetNames[0]]);
        const parsed: ImportRow[] = json.map((row: any) => {
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row.invoiceNum ?? "";
          const amt = Number(row.amount ?? row["Amount"] ?? 0);
          let issDate = String(row.issue_date ?? row["Issue Date"] ?? "");
          if (typeof row.issue_date === "number" && !isNaN(row.issue_date)) { const d = new Date((row.issue_date - 25569) * 86400 * 1000); issDate = d.toISOString().slice(0, 10); }
          return { invoice_number: String(invNum).trim(), amount: isNaN(amt) ? 0 : amt, issue_date: issDate };
        }).filter((r) => r.invoice_number && r.amount > 0);
        if (parsed.length === 0) { toast.error("No valid rows found"); return; }
        setRows(parsed); setStep("preview");
      } catch { toast.error("Could not parse file"); }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => await api.post<{ created: any[]; errors: Array<{ invoice_number: string; error: string }> }>("/purchase-invoices/batch", {
      vendor_id: vendorId, payment_terms_days: Number(paymentTermsDays) || 30, due_date_source: dueDateSource, bl_date: blDate || null,
      po_number: poNumber.trim() || null, po_date: poDate || null,
      invoices: rows.map((r) => ({ invoice_number: r.invoice_number, amount: r.amount, issue_date: r.issue_date })),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ created: data.created.length, errors: errList }); setStep("done");
      toast.success(`${data.created.length} created${errList.length > 0 ? `, ${errList.length} failed` : ""}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{step === "form" ? "Mass import purchase invoices" : step === "preview" ? "Preview" : "Complete"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">Upload a spreadsheet with columns: <code className="font-mono text-primary">invoice_number</code>, <code className="font-mono text-primary">amount</code>, <code className="font-mono text-primary">issue_date</code>.</div>
            <L label="Supplier *"><select required value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="inp"><option value="">Select supplier</option>{vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></L>
            <div className="grid grid-cols-2 gap-3">
              <L label="Payment terms (days)"><input type="number" className="inp" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} /></L>
              <L label="Due date source"><select className="inp" value={dueDateSource} onChange={(e) => setDueDateSource(e.target.value as any)}><option value="invoice">From invoice date</option><option value="bl">From BL date</option></select></L>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <L label="PO number"><input className="inp" placeholder="PO-2026-001" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></L>
              <L label="PO date"><input type="date" className="inp" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></L>
            </div>
            <div className="border-t border-border pt-4">
              <L label="Upload Excel / CSV file"><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20" /></L>
            </div>
            <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button></div>
          </div>
        )}
        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="text-xs text-muted-foreground">{rows.length} invoices · Total {fmtMoney(totalAmount)}</div>
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
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center"><div className="text-2xl font-display text-success">{result.created}</div><div className="text-xs text-muted-foreground mt-1">Invoices created</div></div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-xs uppercase tracking-widest text-destructive mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">{result.errors.map((err, i) => <li key={i} className="text-xs text-destructive">{err}</li>)}</ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
