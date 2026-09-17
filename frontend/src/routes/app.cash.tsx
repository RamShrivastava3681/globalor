import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, StatusPill, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { fmtCompact } from "@/lib/format";
import {
  Wallet, TrendingUp, TrendingDown, Repeat, PiggyBank, CalendarClock, AlertTriangle,
  FileText, ShoppingCart, ClipboardList, Store, ArrowDownUp, ArrowUpRight, ArrowDownRight,
  Landmark, Plus, Pencil, Trash2, Settings as SettingsIcon, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import {
  summarize7d, buildForecast, availableForOps, salesInvoiceFigures, purchaseInvoiceFigures,
  isCommittedPO, isPlannedPO, poExpectedDate, nextRecurringDate, expandRecurring, todayYMD,
  type ForecastMode, type ForecastView,
} from "@/lib/cash-forecast";

export const Route = createFileRoute("/app/cash")({
  component: CashPage,
});

const REFRESH = 30_000;

type TabId =
  | "overview" | "accounts" | "settlements" | "recurring" | "commitments"
  | "planned" | "sales" | "inflows" | "outflows" | "tax";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview & Forecast" },
  { id: "accounts", label: "Cash & Bank" },
  { id: "settlements", label: "Settlements" },
  { id: "recurring", label: "Recurring" },
  { id: "commitments", label: "PO Commitments" },
  { id: "planned", label: "Planned POs" },
  { id: "sales", label: "Sales Inflows" },
  { id: "inflows", label: "All Inflows" },
  { id: "outflows", label: "All Outflows" },
  { id: "tax", label: "Tax Ledger" },
];

/* ═══════════ Page ═══════════ */

function CashPage() {
  const { canWrite } = useAuth();
  const canManage = canWrite("cash");
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("overview");
  const [mode, setMode] = useState<ForecastMode>("DAILY");
  const [view, setView] = useState<ForecastView>("BASE");
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: string; row: any } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: string; row: any } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reconcile, setReconcile] = useState<any | null>(null);

  const q = (key: string, path: string) =>
    useQuery({
      queryKey: ["cash", key],
      queryFn: async () => (await api.get<any[]>(`/cash/${path}`)) ?? [],
      staleTime: REFRESH,
      refetchInterval: REFRESH,
    });
  const accountsQ = q("accounts", "accounts");
  const inflowsQ = q("inflows", "inflows");
  const outflowsQ = q("outflows", "outflows");
  const settlementsQ = q("settlements", "settlements");
  const recurringQ = q("recurring", "recurring");
  const commitmentsQ = q("commitments", "commitments");
  const settingsQ = useQuery({
    queryKey: ["cash", "settings"],
    queryFn: async () => (await api.get<any>("/cash/settings")) ?? { minimum_buffer: 0 },
    staleTime: REFRESH,
    refetchInterval: REFRESH,
  });
  const invoicesQ = useQuery({
    queryKey: ["invoices", "cash"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
    staleTime: REFRESH,
    refetchInterval: REFRESH,
  });
  const pinvoicesQ = useQuery({
    queryKey: ["purchase_invoices", "cash"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
    staleTime: REFRESH,
    refetchInterval: REFRESH,
  });
  const gposQ = useQuery({
    queryKey: ["goods-pos", "cash"],
    queryFn: async () => (await api.get<any[]>("/goods-purchase-orders")) ?? [],
    staleTime: REFRESH,
    refetchInterval: REFRESH,
  });

  const accounts = accountsQ.data ?? [];
  const inflows = inflowsQ.data ?? [];
  const outflows = outflowsQ.data ?? [];
  const settlements = settlementsQ.data ?? [];
  const recurring = recurringQ.data ?? [];
  const commitments = commitmentsQ.data ?? [];
  const buffer = Number(settingsQ.data?.minimum_buffer ?? 0);
  const salesInvoices = invoicesQ.data ?? [];
  const purchaseInvoices = pinvoicesQ.data ?? [];
  const goodsPOs = gposQ.data ?? [];

  const loading = [accountsQ, inflowsQ, outflowsQ, settlementsQ, recurringQ, commitmentsQ, settingsQ, invoicesQ, pinvoicesQ, gposQ].some((x) => x.isPending);

  const summary = useMemo(
    () => summarize7d({ accounts, inflows, outflows, settlements, recurring, commitments, salesInvoices, purchaseInvoices, goodsPOs }),
    [accounts, inflows, outflows, settlements, recurring, commitments, salesInvoices, purchaseInvoices, goodsPOs],
  );
  const forecast = useMemo(
    () => buildForecast({ accounts, inflows, outflows, settlements, recurring, commitments, salesInvoices, purchaseInvoices, goodsPOs, minimumBuffer: buffer, mode, view }),
    [accounts, inflows, outflows, settlements, recurring, commitments, salesInvoices, purchaseInvoices, goodsPOs, buffer, mode, view],
  );

  const invalidateCash = () => qc.invalidateQueries({ queryKey: ["cash"] });
  const del = useMutation({
    mutationFn: async ({ kind, id }: { kind: string; id: string }) => {
      await api.delete(`/cash/${kind}/${id}`);
    },
    onSuccess: () => {
      invalidateCash();
      setDeleting(null);
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const health = forecast.cashStatus;
  const healthLabel = health === "GREEN" ? "Healthy" : health === "AMBER" ? "Attention Required" : "At Risk";
  const shortfall = forecast.alerts.find((a) => a.type === "SHORTFALL_RISK");

  const committedPOs = useMemo(() => goodsPOs.filter((p) => isCommittedPO(p, purchaseInvoices)), [goodsPOs, purchaseInvoices]);
  const plannedPOs = useMemo(() => goodsPOs.filter((p) => isPlannedPO(p)), [goodsPOs]);

  const chartData = forecast.periods.map((p) => ({ name: p.label, closing: p.closingCash, buffer }));

  const kpi1 = [
    { icon: <Wallet className="h-4 w-4 text-primary" />, label: "Available Cash", value: fmtMoney(summary.availableCash), sub: `${summary.activeAccountsCount} active accounts · Proj 7d ${fmtCompact(forecast.projected7d)}`, go: "accounts" as TabId },
    { icon: <ArrowUpRight className="h-4 w-4 text-success" />, label: "Inflows 7d", value: fmtMoney(summary.totalInflows7d), sub: `Direct ${fmtCompact(summary.directInflows7d)} · Settlements ${fmtCompact(summary.settlements7d)}`, go: "inflows" as TabId },
    { icon: <ArrowDownRight className="h-4 w-4 text-destructive" />, label: "Outflows 7d", value: fmtMoney(summary.totalOutflows7d), sub: `Direct ${fmtCompact(summary.directOutflows7d)} · PO ${fmtCompact(summary.approvedPO7d)}`, go: "outflows" as TabId },
    { icon: <Repeat className="h-4 w-4 text-warning" />, label: "Recurring 7d", value: fmtMoney(summary.recurring7d), sub: `${recurring.filter((r) => r.status === "active").length} active schedules`, go: "recurring" as TabId },
    { icon: <TrendingUp className="h-4 w-4 text-primary" />, label: "Projected 7d", value: fmtMoney(forecast.projected7d), sub: "Available + inflows − outflows", go: "overview" as TabId },
    { icon: <PiggyBank className="h-4 w-4 text-primary" />, label: "Projected 30d", value: fmtMoney(forecast.projected30d), sub: `${mode.toLowerCase()} · ${view === "BASE" ? "base" : "with commitments"}`, go: "overview" as TabId },
    { icon: <CalendarClock className="h-4 w-4 text-warning" />, label: "Lowest Cash", value: fmtMoney(forecast.lowestCash), sub: `${forecast.lowestDate ? fmtDate(forecast.lowestDate) : "—"} · buffer ${fmtCompact(buffer)}`, go: "overview" as TabId },
  ];
  const kpi2 = [
    { label: "Overdue Receipts", value: summary.overdueReceipts, go: "sales" as TabId },
    { label: "Supplier Payables", value: summary.supplierPayables, go: "outflows" as TabId },
    { label: "PO Commitments", value: summary.poCommitments, go: "commitments" as TabId },
    { label: "Planned POs", value: summary.plannedPOs, go: "planned" as TabId },
    { label: "Marketplace Inflows 7d", value: summary.marketplaceInflows7d, go: "settlements" as TabId },
    { label: "Sales Inflows 7d", value: summary.salesInflows7d, go: "sales" as TabId },
    { label: "Recurring Outflows 7d", value: summary.recurringOutflows7d, go: "recurring" as TabId },
    { label: "Purchase Outflows 7d", value: summary.purchaseOutflows7d, go: "outflows" as TabId },
  ];
  const kpi3 = [
    { label: "Overdue Collections", value: summary.overdueCollections, go: "inflows" as TabId },
    { label: "Supplier Payments 7d", value: summary.supplierDue7d, go: "outflows" as TabId },
    { label: "Marketplace Balances", value: summary.marketplaceBalance, go: "accounts" as TabId },
    { label: "Marketplace Pending", value: summary.marketplacePending, go: "settlements" as TabId },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Treasury & Liquidity"
        title="Cash Command Centre"
        description="Real-time available cash, forecast, settlements & runway."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <SettingsIcon className="h-4 w-4" /> Settings
              </button>
              <div className="relative">
                <button onClick={() => setQuickAdd((v) => (v === "__menu" ? null : "__menu"))} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  <Plus className="h-4 w-4" /> Quick Add <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {quickAdd === "__menu" && (
                  <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                    {[
                      ["accounts", "Add Account"], ["inflows", "Add Inflow"], ["settlements", "Add Settlement"],
                      ["outflows", "Add Outflow"], ["recurring", "Add Recurring"], ["commitments", "Add Commitment"],
                    ].map(([k, l]) => (
                      <button key={k} onClick={() => setQuickAdd(k)} className="block w-full px-4 py-2 text-left text-sm hover:bg-muted/50">{l}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {loading ? (
          <CashSkeleton />
        ) : (
          <>
            {/* Health banner */}
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${health === "GREEN" ? "border-success/40 bg-success/5" : health === "AMBER" ? "border-warning/40 bg-warning/5" : "border-destructive/40 bg-destructive/5"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${health === "GREEN" ? "bg-success" : health === "AMBER" ? "bg-warning" : "bg-destructive animate-pulse"}`} />
              <span className="text-sm font-semibold">{healthLabel}</span>
              {shortfall && (
                <span className="text-sm text-muted-foreground">
                  Deficit of {fmtMoney(shortfall.amount ?? 0)} by {shortfall.date ? fmtDate(shortfall.date) : "—"}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">Auto-refreshes every 30s</span>
            </div>

            {/* KPI row 1 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {kpi1.map((k) => (
                <button key={k.label} onClick={() => setTab(k.go)} className="rounded-xl border border-border bg-card p-4 text-left shadow-card transition-shadow hover:shadow-card-hover">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">{k.icon}{k.label}</div>
                  <div className="mt-1.5 font-display text-xl font-semibold">{k.value}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{k.sub}</div>
                </button>
              ))}
            </div>

            {/* KPI row 2 */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              {kpi2.map((k) => (
                <button key={k.label} onClick={() => setTab(k.go)} className="rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:border-primary/40">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold">{fmtMoney(k.value)}</div>
                </button>
              ))}
            </div>

            {/* KPI row 3 */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpi3.map((k) => (
                <button key={k.label} onClick={() => setTab(k.go)} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-left hover:border-primary/40">
                  <span className="text-xs text-muted-foreground">{k.label}</span>
                  <span className="font-mono text-sm font-semibold">{fmtMoney(k.value)}</span>
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-border">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap px-3 py-2 text-sm ${tab === t.id ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <OverviewTab forecast={forecast} summary={summary} mode={mode} setMode={setMode} view={view} setView={setView} chartData={chartData} buffer={buffer} />
            )}

            {tab === "accounts" && (
              <DataTable
                title="Cash & Bank Accounts"
                rows={accounts}
                empty="No accounts yet — add your first account."
                canManage={canManage}
                onAdd={() => setQuickAdd("accounts")}
                searchFn={(r, q) => `${r.name} ${r.type} ${r.status}`.toLowerCase().includes(q)}
                statuses={["active", "inactive"]}
                getStatus={(r) => r.status}
                onEdit={(r) => setEditing({ kind: "accounts", row: r })}
                onDelete={(r) => setDeleting({ kind: "accounts", row: r })}
                extra={(r) => (
                  <button onClick={() => setReconcile(r)} className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary">Reconcile</button>
                )}
                columns={[
                  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name },
                  { header: "Type", render: (r) => <StatusPill status={r.type.toLowerCase()} />, sortValue: (r) => r.type },
                  { header: "Current", align: "right", render: (r) => <span className="num">{fmtMoney(r.current_balance)}</span>, sortValue: (r) => Number(r.current_balance) },
                  { header: "Restricted", align: "right", render: (r) => <span className="num">{fmtMoney(r.restricted_balance)}</span>, sortValue: (r) => Number(r.restricted_balance) },
                  { header: "Available", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(availableForOps(r))}</span>, sortValue: (r) => availableForOps(r) },
                  { header: "Status", render: (r) => <StatusPill status={r.status} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "settlements" && (
              <DataTable
                title="Marketplace Settlements"
                rows={settlements}
                empty="No settlements yet."
                canManage={canManage}
                onAdd={() => setQuickAdd("settlements")}
                searchFn={(r, q) => `${r.marketplace_name} ${r.status}`.toLowerCase().includes(q)}
                statuses={["EXPECTED", "DELAYED", "RECEIVED", "DISPUTED"]}
                getStatus={(r) => r.status}
                onEdit={(r) => setEditing({ kind: "settlements", row: r })}
                onDelete={(r) => setDeleting({ kind: "settlements", row: r })}
                columns={[
                  { header: "Marketplace", render: (r) => <span className="flex items-center gap-2 font-medium"><Store className="h-3.5 w-3.5 text-muted-foreground" />{r.marketplace_name}</span>, sortValue: (r) => r.marketplace_name },
                  { header: "Net Expected", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r.net_expected)}</span>, sortValue: (r) => Number(r.net_expected) },
                  { header: "Expected", render: (r) => fmtDate(r.expected_date), sortValue: (r) => r.expected_date },
                  { header: "Actual", render: (r) => fmtDate(r.actual_date), sortValue: (r) => r.actual_date ?? "" },
                  { header: "Status", render: (r) => <StatusPill status={r.status.toLowerCase()} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "recurring" && (
              <DataTable
                title="Recurring Expenses"
                rows={recurring.map((r) => ({
                  ...r,
                  _next: nextRecurringDate(r, todayYMD()),
                  _count7: expandRecurring(r, todayYMD(), new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length,
                }))}
                empty="No recurring expenses yet."
                canManage={canManage}
                onAdd={() => setQuickAdd("recurring")}
                searchFn={(r, q) => `${r.category} ${r.frequency} ${r.status}`.toLowerCase().includes(q)}
                statuses={["active", "paused"]}
                getStatus={(r) => r.status}
                onEdit={(r) => setEditing({ kind: "recurring", row: r })}
                onDelete={(r) => setDeleting({ kind: "recurring", row: r })}
                columns={[
                  { header: "Category", render: (r) => <span className="font-medium">{r.category}</span>, sortValue: (r) => r.category },
                  { header: "Amount", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r.amount)}</span>, sortValue: (r) => Number(r.amount) },
                  { header: "Frequency", render: (r) => r.frequency, sortValue: (r) => r.frequency },
                  { header: "Day", align: "right", render: (r) => r.payment_day, sortValue: (r) => Number(r.payment_day) },
                  { header: "Next", render: (r) => fmtDate(r._next), sortValue: (r) => r._next ?? "" },
                  { header: "In 7d", align: "right", render: (r) => r._count7, sortValue: (r) => r._count7 },
                  { header: "Status", render: (r) => <StatusPill status={r.status} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "commitments" && (
              <div className="space-y-6">
                <DataTable
                  title="Manual Purchase Commitments"
                  rows={commitments}
                  empty="No manual commitments yet."
                  canManage={canManage}
                  onAdd={() => setQuickAdd("commitments")}
                  searchFn={(r, q) => `${r.supplier_name} ${r.status}`.toLowerCase().includes(q)}
                  statuses={["PENDING", "APPROVED", "CANCELLED"]}
                  getStatus={(r) => r.status}
                  onEdit={(r) => setEditing({ kind: "commitments", row: r })}
                  onDelete={(r) => setDeleting({ kind: "commitments", row: r })}
                  columns={[
                    { header: "Supplier", render: (r) => <span className="font-medium">{r.supplier_name}</span>, sortValue: (r) => r.supplier_name },
                    { header: "Amount", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r.expected_payment_amount)}</span>, sortValue: (r) => Number(r.expected_payment_amount) },
                    { header: "Pay Date", render: (r) => fmtDate(r.expected_payment_date), sortValue: (r) => r.expected_payment_date },
                    { header: "Linked PO", render: (r) => r.linked_po ?? "—", sortValue: (r) => r.linked_po ?? "" },
                    { header: "Status", render: (r) => <StatusPill status={r.status.toLowerCase()} />, sortValue: (r) => r.status },
                  ]}
                />
                <POTable title="Checker-Approved Commitments (goods POs)" rows={committedPOs} empty="No approved uninvoiced POs." icon={<ShoppingCart className="h-4 w-4 text-primary" />} />
              </div>
            )}

            {tab === "planned" && (
              <POTable title="Planned POs (draft, not approved)" rows={plannedPOs} empty="No draft POs." icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />} />
            )}

            {tab === "sales" && (
              <DataTable
                title="Sales Inflows (receivables)"
                rows={salesInvoices.filter((i) => i.status !== "rejected" && i.status !== "cancelled").map((i) => ({ ...i, _fig: salesInvoiceFigures(i) }))}
                empty="No open receivables."
                canManage={false}
                searchFn={(r, q) => `${r.invoice_number} ${r.debtor?.name ?? ""} ${r.status}`.toLowerCase().includes(q)}
                statuses={["draft", "submitted", "approved", "advanced", "funded", "paid", "overdue"]}
                getStatus={(r) => r.status}
                columns={[
                  { header: "Invoice", render: (r) => <span className="font-mono text-xs">{r.invoice_number}</span>, sortValue: (r) => r.invoice_number },
                  { header: "Customer", render: (r) => r.debtor?.name ?? "—", sortValue: (r) => r.debtor?.name ?? "" },
                  { header: "Billed", align: "right", render: (r) => <span className="num">{fmtMoney(r._fig.totalDue)}</span>, sortValue: (r) => r._fig.totalDue },
                  { header: "Received", align: "right", render: (r) => <span className="num">{fmtMoney(r._fig.paid)}</span>, sortValue: (r) => r._fig.paid },
                  { header: "Outstanding", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r._fig.outstanding)}</span>, sortValue: (r) => r._fig.outstanding },
                  { header: "Due", render: (r) => fmtDate(r.due_date), sortValue: (r) => r.due_date ?? "" },
                  { header: "Status", render: (r) => <StatusPill status={r.status} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "inflows" && (
              <DataTable
                title="All Expected Inflows"
                rows={inflows}
                empty="No planned inflows — add one."
                canManage={canManage}
                onAdd={() => setQuickAdd("inflows")}
                searchFn={(r, q) => `${r.type} ${r.customer_name ?? ""} ${r.status}`.toLowerCase().includes(q)}
                statuses={["EXPECTED", "OVERDUE", "RECEIVED", "CANCELLED"]}
                getStatus={(r) => r.status}
                onEdit={(r) => setEditing({ kind: "inflows", row: r })}
                onDelete={(r) => setDeleting({ kind: "inflows", row: r })}
                columns={[
                  { header: "Type", render: (r) => <span className="font-medium">{r.type}</span>, sortValue: (r) => r.type },
                  { header: "Customer", render: (r) => r.customer_name ?? "—", sortValue: (r) => r.customer_name ?? "" },
                  { header: "Amount", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r.amount)}</span>, sortValue: (r) => Number(r.amount) },
                  { header: "Expected", render: (r) => fmtDate(r.expected_date), sortValue: (r) => r.expected_date },
                  { header: "Status", render: (r) => <StatusPill status={r.status.toLowerCase()} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "outflows" && (
              <DataTable
                title="All Expected Outflows"
                rows={outflows}
                empty="No planned outflows — add one."
                canManage={canManage}
                onAdd={() => setQuickAdd("outflows")}
                searchFn={(r, q) => `${r.type} ${r.supplier_name ?? ""} ${r.status}`.toLowerCase().includes(q)}
                statuses={["EXPECTED", "OVERDUE", "PAID", "CANCELLED"]}
                getStatus={(r) => r.status}
                onEdit={(r) => setEditing({ kind: "outflows", row: r })}
                onDelete={(r) => setDeleting({ kind: "outflows", row: r })}
                columns={[
                  { header: "Type", render: (r) => <span className="font-medium">{String(r.type).replace(/_/g, " ")}</span>, sortValue: (r) => r.type },
                  { header: "Supplier", render: (r) => r.supplier_name ?? "—", sortValue: (r) => r.supplier_name ?? "" },
                  { header: "Amount", align: "right", render: (r) => <span className="num font-semibold">{fmtMoney(r.amount)}</span>, sortValue: (r) => Number(r.amount) },
                  { header: "Expected", render: (r) => fmtDate(r.expected_date), sortValue: (r) => r.expected_date },
                  { header: "Status", render: (r) => <StatusPill status={r.status.toLowerCase()} />, sortValue: (r) => r.status },
                ]}
              />
            )}

            {tab === "tax" && (
              <TaxLedger invoices={salesInvoices} />
            )}
          </>
        )}
      </div>

      {quickAdd && quickAdd !== "__menu" && (
        <CashFormModal kind={quickAdd} initial={null} onClose={() => setQuickAdd(null)} onSaved={invalidateCash} />
      )}
      {editing && (
        <CashFormModal kind={editing.kind} initial={editing.row} onClose={() => setEditing(null)} onSaved={invalidateCash} />
      )}
      {reconcile && (
        <ReconcileModal row={reconcile} onClose={() => setReconcile(null)} onSaved={invalidateCash} />
      )}
      {deleting && (
        <Modal title="Delete?" onClose={() => setDeleting(null)}>
          <p className="text-sm text-muted-foreground">This will permanently remove the entry. This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button onClick={() => del.mutate({ kind: deleting.kind, id: deleting.row.id })} disabled={del.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </button>
          </div>
        </Modal>
      )}
      {settingsOpen && (
        <SettingsModal buffer={buffer} onClose={() => setSettingsOpen(false)} onSaved={invalidateCash} />
      )}
    </div>
  );
}

/* ═══════════ Overview tab ═══════════ */

function OverviewTab({ forecast, summary, mode, setMode, view, setView, chartData, buffer }: any) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {(["DAILY", "WEEKLY", "MONTHLY"] as ForecastMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 text-xs font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{m}</button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {(["BASE", "WITH_COMMITMENTS"] as ForecastView[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs font-medium ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{v === "BASE" ? "Base" : "With Commitments"}</button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-muted-foreground">Buffer {fmtMoney(buffer)}</span>
        </div>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="cash-close" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip contentStyle={{ fontSize: 12, background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }}
                formatter={(v: any, name: string) => [fmtMoney(Number(v)), name === "closing" ? "Closing" : "Buffer"]} />
              <Area type="monotone" dataKey="closing" stroke="var(--color-primary)" strokeWidth={2} fill="url(#cash-close)" />
              <ReferenceLine y={buffer} stroke="var(--color-destructive)" strokeDasharray="5 5" label={{ value: "Buffer", fontSize: 10, fill: "var(--color-destructive)" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {forecast.alerts.length > 0 && (
        <div className="space-y-2">
          {forecast.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <span>{a.message}</span>
              {a.amount != null && <span className="ml-auto font-mono font-semibold">{fmtMoney(a.amount)}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-normal"></th>
                <th className="px-4 py-3 text-left font-normal">Period</th>
                <th className="px-4 py-3 text-right font-normal">Opening</th>
                <th className="px-4 py-3 text-right font-normal">Inflows</th>
                <th className="px-4 py-3 text-right font-normal">Outflows</th>
                <th className="px-4 py-3 text-right font-normal">Closing</th>
                <th className="px-4 py-3 text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {forecast.periods.map((p: any) => {
                const isOpen = open.has(p.key);
                return (
                  <>
                    <tr key={p.key} className="border-b border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <button onClick={() => toggle(p.key)} className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{p.label} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{p.start}</span></td>
                      <td className="px-4 py-2.5 text-right num">{fmtMoney(p.openingCash)}</td>
                      <td className="px-4 py-2.5 text-right num text-success">+{fmtMoney(p.expectedInflows)}</td>
                      <td className="px-4 py-2.5 text-right num text-destructive">−{fmtMoney(p.expectedOutflows)}</td>
                      <td className="px-4 py-2.5 text-right num font-semibold">{fmtMoney(p.closingCash)}</td>
                      <td className="px-4 py-2.5"><StatusPill status={p.status === "GREEN" ? "paid" : p.status === "AMBER" ? "sent" : "overdue"} /></td>
                    </tr>
                    {isOpen && (
                      <tr key={`${p.key}-x`} className="border-b border-border/60 bg-muted/10">
                        <td colSpan={7} className="px-8 py-3">
                          {p.events.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No dated events in this period.</span>
                          ) : (
                            <ul className="space-y-1 text-xs">
                              {p.events.map((e: any, j: number) => (
                                <li key={j} className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">{e.date} · {e.label}</span>
                                  <span className={`num font-medium ${e.amount >= 0 ? "text-success" : "text-destructive"}`}>{e.amount >= 0 ? "+" : "−"}{fmtMoney(Math.abs(e.amount))}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-success" /> Inflows · next 7 days ({fmtMoney(summary.totalInflows7d)})</h4>
          <EventList events={summary.inflowEvents7d} positive />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingDown className="h-4 w-4 text-destructive" /> Outflows · next 7 days ({fmtMoney(summary.totalOutflows7d)})</h4>
          <EventList events={summary.outflowEvents7d} />
        </div>
      </div>
    </div>
  );
}

function EventList({ events, positive }: { events: any[]; positive?: boolean }) {
  if (events.length === 0) return <div className="py-6 text-center text-xs text-muted-foreground">Nothing dated in this window.</div>;
  return (
    <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
      {events.map((e, i) => (
        <li key={i} className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5">
          <span className="min-w-0 truncate text-muted-foreground">{e.date} · {e.label}</span>
          <span className={`num shrink-0 font-medium ${positive ? "text-success" : "text-destructive"}`}>{positive ? "+" : "−"}{fmtMoney(e.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════ Generic table ═══════════ */

interface DTColumn {
  header: string;
  align?: "left" | "right";
  render: (r: any) => React.ReactNode;
  sortValue?: (r: any) => string | number;
}

interface DTProps {
  title: string;
  rows: any[];
  columns: DTColumn[];
  empty: string;
  canManage?: boolean;
  onAdd?: () => void;
  onEdit?: (r: any) => void;
  onDelete?: (r: any) => void;
  extra?: (r: any) => React.ReactNode;
  searchFn?: (r: any, q: string) => boolean;
  statuses?: string[];
  getStatus?: (r: any) => string;
}

function DataTable({ title, rows, columns, empty, canManage, onAdd, onEdit, onDelete, extra, searchFn, statuses, getStatus }: DTProps) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sortKey, setSortKey] = useState(0);
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    let r = [...rows];
    if (status !== "all" && getStatus) r = r.filter((x) => getStatus(x) === status);
    if (q.trim() && searchFn) {
      const fn = searchFn;
      const needle = q.toLowerCase();
      r = r.filter((x) => fn(x, needle));
    }
    const col = columns[sortKey];
    if (col?.sortValue) {
      const sv = col.sortValue;
      r.sort((a, b) => {
        const av = sv(a);
        const bv = sv(b);
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return asc ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, q, status, sortKey, asc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…"
            className="h-8 w-48 rounded-md border border-border bg-background px-2 text-xs placeholder:text-muted-foreground" />
          {statuses && (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
              <option value="all">All statuses</option>
              {statuses.map((s: string) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {canManage && onAdd && (
            <button onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              {columns.map((c: any, i: number) => (
                <th key={i} onClick={() => { if (sortKey === i) setAsc(!asc); else { setSortKey(i); setAsc(true); } }}
                  className={`cursor-pointer px-4 py-3 font-normal hover:text-foreground ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.header}{sortKey === i ? (asc ? " ↑" : " ↓") : ""}
                </th>
              ))}
              {(canManage || extra) && <th className="px-4 py-3 text-right font-normal">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r: any) => (
              <tr key={r.id} className="border-b border-border/60 hover:bg-muted/20">
                {columns.map((c: any, i: number) => (
                  <td key={i} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""}`}>{c.render(r)}</td>
                ))}
                {(canManage || extra) && (
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {extra?.(r)}
                      {canManage && onEdit && <button onClick={() => onEdit(r)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
                      {canManage && onDelete && <button onClick={() => onDelete(r)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm text-muted-foreground">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground">
        <span>Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:border-primary">Prev</button>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:border-primary">Next</button>
        </div>
      </div>
    </div>
  );
}

function POTable({ title, rows, empty, icon }: any) {
  return (
    <DataTable
      title={title}
      rows={rows}
      empty={empty}
      canManage={false}
      searchFn={(r: any, q: string) => `${r.po_number} ${r.supplier_name ?? ""} ${r.status}`.toLowerCase().includes(q)}
      statuses={["approved", "sent", "partially_received", "draft"]}
      getStatus={(r: any) => r.status}
      columns={[
        { header: "PO", render: (r: any) => <span className="flex items-center gap-2 font-mono text-xs">{icon}{r.po_number}</span>, sortValue: (r: any) => r.po_number },
        { header: "Supplier", render: (r: any) => r.supplier_name ?? "—", sortValue: (r: any) => r.supplier_name ?? "" },
        { header: "Total", align: "right", render: (r: any) => <span className="num font-semibold">{fmtMoney(r.grand_total)}</span>, sortValue: (r: any) => Number(r.grand_total) },
        { header: "Expected", render: (r: any) => fmtDate(poExpectedDate(r)), sortValue: (r: any) => poExpectedDate(r) ?? "" },
        { header: "Status", render: (r: any) => <StatusPill status={r.status} />, sortValue: (r: any) => r.status },
      ]}
    />
  );
}

function TaxLedger({ invoices }: { invoices: any[] }) {
  const rows = invoices
    .filter((i) => i.status !== "rejected" && i.status !== "cancelled")
    .map((i) => ({ ...i, _fig: salesInvoiceFigures(i) }));
  const billed = rows.reduce((s, r) => s + r._fig.totalDue, 0);
  const collected = rows.reduce((s, r) => s + r._fig.paid, 0);
  const outstanding = rows.reduce((s, r) => s + r._fig.outstanding, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Billed", billed], ["Collected", collected], ["Outstanding", outstanding]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{l}</div>
            <div className="mt-1 font-display text-xl font-semibold">{fmtMoney(v as number)}</div>
          </div>
        ))}
      </div>
      <DataTable
        title="Per-Invoice Tax Collection Ledger"
        rows={rows}
        empty="No invoices."
        canManage={false}
        searchFn={(r: any, q: string) => `${r.invoice_number} ${r.debtor?.name ?? ""}`.toLowerCase().includes(q)}
        columns={[
          { header: "Invoice", render: (r: any) => <span className="font-mono text-xs">{r.invoice_number}</span>, sortValue: (r: any) => r.invoice_number },
          { header: "Customer", render: (r: any) => r.debtor?.name ?? "—", sortValue: (r: any) => r.debtor?.name ?? "" },
          { header: "Billed", align: "right", render: (r: any) => <span className="num">{fmtMoney(r._fig.totalDue)}</span>, sortValue: (r: any) => r._fig.totalDue },
          { header: "Collected", align: "right", render: (r: any) => <span className="num">{fmtMoney(r._fig.paid)}</span>, sortValue: (r: any) => r._fig.paid },
          { header: "Outstanding", align: "right", render: (r: any) => <span className="num font-semibold">{fmtMoney(r._fig.outstanding)}</span>, sortValue: (r: any) => r._fig.outstanding },
          { header: "Status", render: (r: any) => <StatusPill status={r.status} />, sortValue: (r: any) => r.status },
        ]}
      />
      <p className="text-[11px] text-muted-foreground">Purchase-side ledger: see All Outflows and Supplier Payables. Billed = grand total less advances; collected = amount received (paid invoices count as fully received).</p>
      <PurchaseLedger />
    </div>
  );
}

function PurchaseLedger() {
  const pinvoicesQ = useQuery({
    queryKey: ["purchase_invoices", "cash"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
    staleTime: REFRESH,
  });
  const rows = (pinvoicesQ.data ?? [])
    .filter((p) => p.status !== "rejected" && p.status !== "cancelled" && p.status !== "disputed")
    .map((p) => ({ ...p, _fig: purchaseInvoiceFigures(p) }));
  return (
    <DataTable
      title="Per-Invoice Purchase Ledger (billed / paid / outstanding)"
      rows={rows}
      empty="No purchase invoices."
      canManage={false}
      searchFn={(r: any, q: string) => `${r.invoice_number} ${r.vendor?.name ?? r.vendor_name ?? ""}`.toLowerCase().includes(q)}
      columns={[
        { header: "Invoice", render: (r: any) => <span className="font-mono text-xs">{r.invoice_number}</span>, sortValue: (r: any) => r.invoice_number },
        { header: "Supplier", render: (r: any) => r.vendor?.name ?? r.vendor_name ?? "—", sortValue: (r: any) => r.vendor?.name ?? "" },
        { header: "Billed", align: "right", render: (r: any) => <span className="num">{fmtMoney(r._fig.totalDue)}</span>, sortValue: (r: any) => r._fig.totalDue },
        { header: "Paid", align: "right", render: (r: any) => <span className="num">{fmtMoney(r._fig.paid)}</span>, sortValue: (r: any) => r._fig.paid },
        { header: "Outstanding", align: "right", render: (r: any) => <span className="num font-semibold">{fmtMoney(r._fig.outstanding)}</span>, sortValue: (r: any) => r._fig.outstanding },
        { header: "Status", render: (r: any) => <StatusPill status={r.status} />, sortValue: (r: any) => r.status },
      ]}
    />
  );
}

/* ═══════════ Modals & forms ═══════════ */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

const KIND_META: Record<string, { title: string; path: string; fields: Array<{ key: string; label: string; kind: "text" | "number" | "date" | "select"; options?: string[] }> }> = {
  accounts: {
    title: "Cash Account", path: "accounts",
    fields: [
      { key: "name", label: "Name", kind: "text" },
      { key: "type", label: "Type", kind: "select", options: ["BANK", "CASH", "MARKETPLACE", "FIXED_DEPOSIT"] },
      { key: "current_balance", label: "Current Balance ($)", kind: "number" },
      { key: "restricted_balance", label: "Restricted Balance ($)", kind: "number" },
      { key: "status", label: "Status", kind: "select", options: ["active", "inactive"] },
    ],
  },
  inflows: {
    title: "Expected Inflow", path: "inflows",
    fields: [
      { key: "type", label: "Type", kind: "text" },
      { key: "customer_name", label: "Customer", kind: "text" },
      { key: "amount", label: "Amount ($)", kind: "number" },
      { key: "expected_date", label: "Expected Date", kind: "date" },
      { key: "status", label: "Status", kind: "select", options: ["EXPECTED", "OVERDUE", "RECEIVED", "CANCELLED"] },
    ],
  },
  settlements: {
    title: "Marketplace Settlement", path: "settlements",
    fields: [
      { key: "marketplace_name", label: "Marketplace", kind: "text" },
      { key: "net_expected", label: "Net Expected ($)", kind: "number" },
      { key: "expected_date", label: "Expected Date", kind: "date" },
      { key: "status", label: "Status", kind: "select", options: ["EXPECTED", "DELAYED", "RECEIVED", "DISPUTED"] },
    ],
  },
  outflows: {
    title: "Expected Outflow", path: "outflows",
    fields: [
      { key: "type", label: "Type", kind: "select", options: ["SUPPLIER_PAYMENT", "OPERATIONAL", "OTHER"] },
      { key: "supplier_name", label: "Supplier", kind: "text" },
      { key: "amount", label: "Amount ($)", kind: "number" },
      { key: "expected_date", label: "Expected Date", kind: "date" },
      { key: "status", label: "Status", kind: "select", options: ["EXPECTED", "OVERDUE", "PAID", "CANCELLED"] },
    ],
  },
  recurring: {
    title: "Recurring Expense", path: "recurring",
    fields: [
      { key: "category", label: "Category", kind: "text" },
      { key: "amount", label: "Amount ($)", kind: "number" },
      { key: "frequency", label: "Frequency", kind: "select", options: ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] },
      { key: "payment_day", label: "Payment Day (1-31; 1-7 Mon-Sun for weekly)", kind: "number" },
      { key: "status", label: "Status", kind: "select", options: ["active", "paused"] },
    ],
  },
  commitments: {
    title: "Purchase Commitment", path: "commitments",
    fields: [
      { key: "supplier_name", label: "Supplier", kind: "text" },
      { key: "expected_payment_amount", label: "Amount ($)", kind: "number" },
      { key: "expected_payment_date", label: "Pay Date", kind: "date" },
      { key: "linked_po", label: "Linked PO (optional)", kind: "text" },
      { key: "status", label: "Status", kind: "select", options: ["PENDING", "APPROVED", "CANCELLED"] },
    ],
  },
};

const NUM_KEYS = new Set(["amount", "current_balance", "restricted_balance", "net_expected", "expected_payment_amount", "payment_day"]);

function CashFormModal({ kind, initial, onClose, onSaved }: { kind: string; initial: any; onClose: () => void; onSaved: () => void }) {
  const meta = KIND_META[kind];
  const [form, setForm] = useState<Record<string, any>>(() => {
    const base: Record<string, any> = {};
    for (const f of meta.fields) base[f.key] = initial?.[f.key] ?? (f.kind === "select" ? f.options?.[0] : "");
    return base;
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {};
      for (const f of meta.fields) {
        const v = form[f.key];
        if (NUM_KEYS.has(f.key)) {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) throw new Error(`${f.label} must be a number >= 0`);
          body[f.key] = f.key === "payment_day" ? Math.floor(n) : Math.round(n * 100) / 100;
        } else if (f.kind === "date") {
          if (!v) throw new Error(`${f.label} is required`);
          body[f.key] = String(v).slice(0, 10);
        } else {
          body[f.key] = v === "" ? null : v;
        }
      }
      if (!initial && (meta.fields.some((f) => f.key === "name" || f.key === "supplier_name" || f.key === "marketplace_name" || f.key === "category") )) {
        const reqKey = meta.fields.find((f) => ["name", "supplier_name", "marketplace_name", "category", "type"].includes(f.key))?.key;
        if (reqKey && !body[reqKey]) throw new Error("Name is required");
      }
      if (initial) await api.patch(`/cash/${meta.path}/${initial.id}`, body);
      else await api.post(`/cash/${meta.path}`, body);
    },
    onSuccess: () => {
      toast.success(initial ? "Updated" : "Created");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed"),
  });

  if (!meta) return null;
  return (
    <Modal title={initial ? `Edit ${meta.title}` : `Add ${meta.title}`} onClose={onClose}>
      <div className="space-y-3">
        {meta.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.kind === "select" ? (
              <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inputCls}>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} min={f.kind === "number" ? 0 : undefined} step={f.key === "payment_day" ? 1 : "0.01"}
                value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inputCls} />
            )}
          </Field>
        ))}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReconcileModal({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [balance, setBalance] = useState(String(row.current_balance ?? 0));
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(balance);
      if (!Number.isFinite(n) || n < 0) throw new Error("Balance must be a number >= 0");
      await api.patch(`/cash/accounts/${row.id}`, { current_balance: Math.round(n * 100) / 100 });
    },
    onSuccess: () => {
      toast.success("Reconciled");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title={`Reconcile ${row.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Available for ops updates instantly: current − restricted = {fmtMoney(Number(balance || 0) - Number(row.restricted_balance || 0))}.</p>
        <Field label="Current Balance ($)"><input type="number" min={0} step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} className={inputCls} /></Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reconcile
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ buffer, onClose, onSaved }: { buffer: number; onClose: () => void; onSaved: () => void }) {
  const [val, setVal] = useState(String(buffer ?? 0));
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) throw new Error("Buffer must be a number >= 0");
      await api.put("/cash/settings", { minimum_buffer: Math.round(n * 100) / 100 });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="Treasury Settings" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Minimum Cash Buffer ($)"><input type="number" min={0} step="0.01" value={val} onChange={(e) => setVal(e.target.value)} className={inputCls} /></Field>
        <p className="text-xs text-muted-foreground">GREEN while every forecast close ≥ buffer · AMBER below 1.2× buffer · RED below buffer.</p>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CashSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-14 animate-pulse rounded-xl bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/40" />)}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-muted/40" />
    </div>
  );
}

// Re-export icons used in KPI defs to keep tree-shaking calm
export const __cashIcons = { Landmark, FileText, ArrowDownUp };
