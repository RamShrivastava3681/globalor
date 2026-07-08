import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Stat, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { AnimatedMoney } from "@/components/animated-number";
import { Activity, Paperclip, X, Link2, TrendingUp, FileText, FileSignature, Wallet, Receipt } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { DocumentList, type DocMeta } from "@/components/document-uploader";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

// Chart tooltip style — uses CSS variables for dark mode support
const chartTooltipStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "var(--shadow-card)",
  padding: "8px 12px",
};

function Dashboard() {
  const { isAdmin, isTreasury, user } = useAuth();
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);
  const [advanceTab, setAdvanceTab] = useState<"sales" | "purchase">("sales");

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
    queryFn: async () => {
      const data = await api.get<any[]>("/alerts") ?? [];
      return data.slice(0, 8);
    },
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

  const invoices = invoicesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const proformas = proformasQ.data ?? [];

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => (await api.get<any[]>("/advances")) ?? [],
    refetchInterval: 30_000,
  });
  const advances = advancesQ.data ?? [];

  const salesAdvancesTotal = advances
    .filter((a: any) => a.side === "sales")
    .reduce((s: number, a: any) => s + Number(a.amount), 0);
  const purchaseAdvancesTotal = advances
    .filter((a: any) => a.side === "purchase")
    .reduce((s: number, a: any) => s + Number(a.amount), 0);

  const totalOutstanding = invoices
    .filter((i: any) => i.status !== "paid" && i.status !== "rejected")
    .reduce((s: number, i: any) => s + Number(i.amount), 0);
  const collectedAmount = invoices.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalShortPayment = paidInvoices.reduce((s: number, i: any) => s + Number(i.short_payment ?? 0), 0);

  const paidSalesInvoices = invoices.filter((i: any) => i.status === "paid" && i.issue_date && i.paid_date);
  const avgSalesPayDays = paidSalesInvoices.length > 0
    ? Math.round(paidSalesInvoices.reduce((s: number, i: any) => s + daysBetween(i.issue_date, i.paid_date), 0) / paidSalesInvoices.length)
    : 0;

  const paidPurchaseInvoices = purchases.filter((p: any) => p.status === "paid" && p.issue_date && p.paid_date);
  const avgPurchasePayDays = paidPurchaseInvoices.length > 0
    ? Math.round(paidPurchaseInvoices.reduce((s: number, p: any) => s + daysBetween(p.issue_date, p.paid_date), 0) / paidPurchaseInvoices.length)
    : 0;

  const salesTotal = invoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const purchaseTotal = purchases.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const expenseTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const gross = salesTotal - purchaseTotal;
  const net = gross - expenseTotal;
  const marginPct = salesTotal > 0 ? (gross / salesTotal) * 100 : 0;
  const collectionRate = salesTotal > 0 ? +((collectedAmount / salesTotal) * 100).toFixed(2) : 0;

  const yearMap = new Map<string, number>();
  invoices.forEach((i: any) => {
    if (!i.issue_date) return;
    const year = i.issue_date.slice(0, 4);
    yearMap.set(year, (yearMap.get(year) ?? 0) + Number(i.amount));
  });
  const salesByYear = [...yearMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, amount]) => ({ year: `Sales ${year}`, amount }));

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

  const eyebrow = isAdmin ? "Portfolio overview" : isTreasury ? "Treasury desk" : "Trader dashboard";
  const titleText = isAdmin ? "Executive dashboard" : isTreasury ? "Funding overview" : "Trading overview";

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={titleText}
        description={
          isAdmin
            ? "Live receivables, advances, and risk across every client."
            : isTreasury
              ? "Approved invoices and outstanding advances."
              : "Sales, purchases, and income from your trading book."
        }
        actions={
          <Link to={isTreasury ? "/app/queue" : "/app/invoices"} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] transition-all">
            {isTreasury ? "Open funding queue" : isAdmin ? "Open invoice queue" : "New sales invoice"}
          </Link>
        }
      />

      <div className="space-y-6 p-4 md:p-6">
        {!isTreasury && (
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Sales (gross)" value={fmtMoney(Math.round(salesTotal))} animate numValue={Math.round(salesTotal)} delta={`${invoices.length} invoices`} />
            <Stat label="Cost of goods" value={fmtMoney(Math.round(purchaseTotal))} animate numValue={Math.round(purchaseTotal)} delta={`${purchases.length} supplier invoices`} />
            <Stat label="Gross income" value={fmtMoney(Math.round(gross))} animate numValue={Math.round(gross)} delta={`${marginPct.toFixed(1)}% margin`} tone={gross >= 0 ? "good" : "bad"} />
            <Stat label="Net income" value={fmtMoney(Math.round(net))} animate numValue={Math.round(net)} delta={`After ${fmtMoney(expenseTotal)} expenses`} tone={net >= 0 ? "good" : "bad"} />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Outstanding (AR)" value={fmtMoney(Math.round(totalOutstanding))} animate numValue={Math.round(totalOutstanding)} delta={`${invoices.filter(i => i.status !== "paid" && i.status !== "rejected").length} invoices`} />
          <Stat label="Collection rate" value={`${collectionRate}%`} delta="Lifetime" tone={collectionRate >= 90 ? "good" : "warn"} />
          <Stat label="Short payments" value={fmtMoney(totalShortPayment)} animate numValue={totalShortPayment} delta={`${paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0).length} invoices short paid`} tone={totalShortPayment > 0 ? "bad" : "good"} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Stat label="Avg sales pay days" value={String(avgSalesPayDays)} animate numValue={avgSalesPayDays} format="number" delta={`${paidSalesInvoices.length} settled invoices`} tone={avgSalesPayDays > 0 ? "warn" : "good"} />
          <Stat label="Avg purchases pay days" value={String(avgPurchasePayDays)} animate numValue={avgPurchasePayDays} format="number" delta={`${paidPurchaseInvoices.length} settled invoices`} tone={avgPurchasePayDays > 0 ? "warn" : "good"} />
        </div>

        {!isTreasury && (
          <Card title="Net income vs expenses" action={                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" />Current period</span>}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Net income", value: Math.max(0, net), fill: "#00B8FF" },
                      { name: "Expenses", value: Math.max(0, expenseTotal), fill: "#F59E0B" },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value, percent }: any) =>
                      `${name}: ${fmtMoney(value)} (${(percent * 100).toFixed(1)}%)`
                    }
                    labelLine={true}
                  >
                    <Cell key="net" fill="#00B8FF" />
                    <Cell key="expenses" fill="#F59E0B" />
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(v: number, name: string) => [fmtMoney(v), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
              <div>
                <div className="text-xs font-medium text-success">Gross income</div>
                <div className="text-xs text-muted-foreground"><AnimatedMoney value={Math.round(gross)} /></div>
              </div>
              <div>
                <div className="text-xs font-medium text-primary">Net income</div>
                <div className="text-xs text-muted-foreground"><AnimatedMoney value={Math.round(net)} /></div>
              </div>
              <div>
                <div className="text-xs font-medium text-warning">Expenses</div>
                <div className="text-xs text-muted-foreground"><AnimatedMoney value={expenseTotal} /></div>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Aging distribution" className="lg:col-span-2">
            <div className="h-64">
              {(() => {
                const chartData = [
                  { name: "Current", amount: aging.current, fill: "#16A34A" },
                  { name: "1–30 days", amount: aging.b1, fill: "#00B8FF" },
                  { name: "31–60 days", amount: aging.b2, fill: "#F59E0B" },
                  { name: "61–90 days", amount: aging.b3, fill: "#F97316" },
                  { name: "90+ days", amount: aging.b4, fill: "#DC2626" },
                ];
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(v: number, name: string) => [fmtMoney(v), name]}
                      cursor={{ fill: "var(--color-muted)" }}
                    />
                      <Bar dataKey="amount" name="Outstanding" radius={[6, 6, 0, 0]} barSize={40}>
                        {chartData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 border-t border-border pt-4">
              {(() => {
                const total = Object.values(aging).reduce((a: number, x: number) => a + x, 0) || 1;
                return [
                  { label: "Current", val: aging.current, cls: "text-[#16A34A]" },
                  { label: "1–30d", val: aging.b1, cls: "text-[#00B8FF]" },
                  { label: "31–60d", val: aging.b2, cls: "text-[#F59E0B]" },
                  { label: "61–90d", val: aging.b3, cls: "text-[#F97316]" },
                  { label: "90+d", val: aging.b4, cls: "text-[#DC2626]" },
                ].map((b) => (
                  <div key={b.label} className="text-center">
                    <div className={`text-xs font-semibold ${b.cls}`}>{b.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground"><AnimatedMoney value={b.val} /></div>
                    <div className="text-[11px] text-muted-foreground/70">{total > 0 ? `${((b.val / total) * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                ));
              })()}
            </div>
          </Card>

          <Card title="Alerts" action={<Link to="/app/alerts" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">View all →</Link>}>
            {(alertsQ.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground"><Activity className="mb-3 h-5 w-5 text-border" />No alerts</div>
            ) : (
              <ul className="space-y-2">
                {(alertsQ.data ?? []).map((a: any) => (
                  <li key={a.id} className="rounded-lg border border-border bg-card p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                        a.severity === "critical" ? "bg-destructive" : a.severity === "warning" ? "bg-warning" : "bg-primary"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground">{a.message}</div>
                        <div className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{fmtDate(a.created_at)} · {a.type}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Sales by year"                  action={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" />All time</span>}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesByYear.length > 0 ? salesByYear : [{ year: "No data", amount: 0 }]}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="year" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: number) => fmtMoney(v)}
                  cursor={{ fill: "var(--color-muted)" }}
                />
                <Bar dataKey="amount" name="Sales" fill="#00B8FF" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Recent invoices" action={<Link to="/app/invoices" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">View all →</Link>}>
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground"><FileText className="mb-3 h-6 w-6 text-border" />No invoices yet.</div>
          ) : (
            <div className="-mx-4 md:-mx-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Invoice</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Debtor</th>
                    <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Amount</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Due</th>
                    <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Short pay</th>
                    <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Late days</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 6).map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted transition-colors">
                      <td className="px-4 md:px-5 py-3 font-mono text-xs text-foreground">{i.invoice_number}</td>
                      <td className="px-4 md:px-5 py-3 text-muted-foreground">{i.debtor?.name ?? "—"}</td>
                      <td className="px-4 md:px-5 py-3 text-right num font-medium">{fmtMoney(i.amount)}</td>
                      <td className="px-4 md:px-5 py-3 text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className={`px-4 md:px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{i.short_payment != null ? fmtMoney(Number(i.short_payment)) : "—"}</td>
                      <td className={`px-4 md:px-5 py-3 text-right num ${Number(i.late_days) > 0 ? "text-warning" : "text-muted-foreground"}`}>{i.late_days != null ? i.late_days : "—"}</td>
                      <td className="px-4 md:px-5 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent proformas" action={<Link to="/app/proformas" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">View all →</Link>}>
          {proformas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground"><FileSignature className="mb-3 h-6 w-6 text-border" />No proformas yet.</div>
          ) : (
            <div className="-mx-4 md:-mx-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Proforma</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">PO #</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Counterparty</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Side</th>
                    <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Amount</th>
                    <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {proformas.slice(0, 6).map((p: any) => (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-muted transition-colors">
                      <td className="px-4 md:px-5 py-3 font-mono text-xs">{p.proforma_number ?? p.po_number}</td>
                      <td className="px-4 md:px-5 py-3 font-mono text-xs text-muted-foreground">{p.po_number}</td>
                      <td className="px-4 md:px-5 py-3 text-muted-foreground">{p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—"}</td>
                      <td className="px-4 md:px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">{p.side}</td>
                      <td className="px-4 md:px-5 py-3 text-right num font-medium">{fmtMoney(p.amount)}</td>
                      <td className="px-4 md:px-5 py-3"><StatusPill status={p.proforma_status || p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={
            <div className="flex items-center gap-3">
              <span>Advances</span>
              <div className="flex gap-1">
                {(["sales", "purchase"] as const).map((s) => (
                  <button key={s} onClick={() => setAdvanceTab(s)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                      advanceTab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-input"
                    }`}>{s === "sales" ? "Received from buyer" : "Given to supplier"}</button>
                ))}
              </div>
            </div>
          }
          action={<Link to="/app/advances" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">View all →</Link>}
        >
          {advances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground"><Wallet className="mb-3 h-6 w-6 text-border" />No advances yet.</div>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 transition ${advanceTab === "sales" ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Received from buyers</span>
                    <span className="text-[10px] text-muted-foreground">{advances.filter((a: any) => a.side === "sales").length} advances</span>
                  </div>
                  <div className="mt-1 font-display text-lg text-success"><AnimatedMoney value={salesAdvancesTotal} /></div>
                </div>
                <div className={`rounded-lg border p-3 transition ${advanceTab === "purchase" ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Given to suppliers</span>
                    <span className="text-[10px] text-muted-foreground">{advances.filter((a: any) => a.side === "purchase").length} advances</span>
                  </div>
                  <div className="mt-1 font-display text-lg text-warning"><AnimatedMoney value={purchaseAdvancesTotal} /></div>
                </div>
              </div>
              <div className="-mx-4 md:-mx-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Date</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Linked to</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Party</th>
                      <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Amount</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances
                      .filter((a: any) => a.side === advanceTab)
                      .slice(0, 6)
                      .map((a: any) => {
                        const cp = a.order
                          ? (a.side === "sales" ? a.order.debtor?.name : a.order.vendor?.name)
                          : (a.side === "sales" ? a.invoice?.debtor?.name : a.purchase?.vendor?.name);
                        return (
                          <tr key={a.id} className="border-b border-border/60 hover:bg-muted transition-colors">
                            <td className="px-4 md:px-5 py-3 text-muted-foreground">{fmtDate(a.advance_date)}</td>
                            <td className="px-4 md:px-5 py-3">
                              {a.order ? (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">PO {a.order.po_number}</span>
                              ) : a.invoice || a.purchase ? (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">{(a.invoice?.invoice_number || a.purchase?.invoice_number)}</span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 md:px-5 py-3 text-muted-foreground">{cp ?? "—"}</td>
                            <td className="px-4 md:px-5 py-3 text-right num text-primary font-medium">{fmtMoney(a.amount)}</td>
                            <td className="px-4 md:px-5 py-3"><StatusPill status={a.status} /></td>
                          </tr>
                        );
                      })}
                    {advances.filter((a: any) => a.side === advanceTab).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">No {advanceTab === "sales" ? "advances received from buyers" : "advances given to suppliers"} yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {!isTreasury && (
          <Card title="Recent expenses" action={<Link to="/app/expenses" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">View all →</Link>}>
            {expenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground"><Receipt className="mb-3 h-6 w-6 text-border" />No expenses logged.</div>
            ) : (
              <div className="-mx-4 md:-mx-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Date</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Category</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Linked transaction</th>
                      <th className="px-4 md:px-5 py-2.5 text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Description</th>
                      <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Docs</th>
                      <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted">Amount</th>
                      <th className="px-4 md:px-5 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-muted-foreground bg-muted" />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.slice(0, 6).map((e: any) => {
                      const link = e.invoice?.invoice_number
                        ? { kind: "Sale", num: e.invoice.invoice_number }
                        : e.purchase?.invoice_number
                          ? { kind: "Purchase", num: e.purchase.invoice_number }
                          : null;
                      const docCount = Array.isArray(e.documents) ? e.documents.length : 0;
                      return (
                        <tr key={e.id} className="border-b border-border/60 hover:bg-muted transition-colors">
                          <td className="px-4 md:px-5 py-3">{fmtDate(e.expense_date)}</td>
                          <td className="px-4 md:px-5 py-3 capitalize text-muted-foreground">{e.category}</td>
                          <td className="px-4 md:px-5 py-3">
                            {link ? (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 text-xs shadow-sm">
                                <Link2 className="h-3 w-3 text-primary" />
                                <span className="text-muted-foreground">{link.kind}</span>
                                <span className="font-mono text-foreground">{link.num}</span>
                              </span>
                            ) : <span className="text-xs text-muted-foreground">Unlinked</span>}
                          </td>
                          <td className="px-4 md:px-5 py-3 text-muted-foreground">{e.description ?? "—"}</td>
                          <td className="px-4 md:px-5 py-3 text-right">
                            {docCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Paperclip className="h-3 w-3" />{docCount}</span>
                            ) : <span className="text-[11px] text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 md:px-5 py-3 text-right num font-medium">{fmtMoney(e.amount)}</td>
                          <td className="px-4 md:px-5 py-3 text-right">
                            <button onClick={() => setViewingExpense(e)}
                              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors">Details</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {isAdmin && (debtorsQ.data ?? []).length > 0 && (
          <Card title="Debtor concentration" action={<Link to="/app/debtors" className="text-xs font-medium text-[#00B8FF] hover:text-[#0099D9] transition-colors">Manage →</Link>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(debtorsQ.data ?? []).slice(0, 8).map((d: any) => {
                  const exposure = invoices.filter((i: any) => i.debtor_id === d.id && i.status !== "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
                  return { name: d.name.slice(0, 14), exposure, limit: Number(d.credit_limit) };
                })}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => fmtMoney(v)} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="exposure" name="Exposure" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={32} />
                  <Bar dataKey="limit" name="Credit limit" fill="var(--color-muted)" radius={[4, 4, 0, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {viewingExpense && (
        <ExpenseDetailModal expense={viewingExpense} onClose={() => setViewingExpense(null)} />
      )}
    </div>
  );
}

function ExpenseDetailModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const link = expense.invoice?.invoice_number
    ? { kind: "Sales invoice", num: expense.invoice.invoice_number, to: "/app/invoices" as const }
    : expense.purchase?.invoice_number
      ? { kind: "Purchase invoice", num: expense.purchase.invoice_number, to: "/app/purchases" as const }
      : null;
  const docs: DocMeta[] = Array.isArray(expense.documents) ? expense.documents : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg font-semibold text-foreground">Expense detail</h3>
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
                  <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline">
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
