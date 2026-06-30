import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Stat, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Activity, Paperclip, X, Link2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { DocumentList, type DocMeta } from "@/components/document-uploader";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin, isTreasury, user } = useAuth();
  const [viewingExpense, setViewingExpense] = useState<any | null>(null);
  const [advanceTab, setAdvanceTab] = useState<"sales" | "purchase">("sales");

  const invoicesQ = useQuery({
    queryKey: ["invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
  });

  const purchasesQ = useQuery({
    queryKey: ["purchase_invoices", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
  });

  const expensesQ = useQuery({
    queryKey: ["expenses", isAdmin ? "all" : user?.id],
    queryFn: async () => (await api.get<any[]>("/expenses")) ?? [],
  });

  const alertsQ = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const data = await api.get<any[]>("/alerts") ?? [];
      return data.slice(0, 8);
    },
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const proformasQ = useQuery({
    queryKey: ["proformas"],
    queryFn: async () => (await api.get<any[]>("/purchase-orders")) ?? [],
  });

  const invoices = invoicesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const proformas = proformasQ.data ?? [];

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => (await api.get<any[]>("/advances")) ?? [],
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
  const overdueCount = invoices.filter((i: any) => i.status === "overdue" || (i.due_date && i.status !== "paid" && daysBetween(i.due_date) > 0)).length;
  const collectionRate = invoices.length ? Math.round((invoices.filter((i: any) => i.status === "paid").length / invoices.length) * 100) : 0;
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalShortPayment = paidInvoices.reduce((s: number, i: any) => s + Number(i.short_payment ?? 0), 0);
  const lateInvoices = paidInvoices.filter((i: any) => Number(i.late_days ?? 0) > 0);
  const avgLateDays = lateInvoices.length
    ? Math.round(lateInvoices.reduce((s: number, i: any) => s + Number(i.late_days), 0) / lateInvoices.length)
    : 0;

  const salesTotal = invoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const purchaseTotal = purchases.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const expenseTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const gross = salesTotal - purchaseTotal;
  const net = gross - expenseTotal;
  const marginPct = salesTotal > 0 ? (gross / salesTotal) * 100 : 0;

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

  const eyebrow = isAdmin ? "Trading console" : isTreasury ? "Treasury desk" : "Trader portal";
  const titleText = isAdmin ? "Portfolio command" : isTreasury ? "Funding overview" : "Trading ledger";

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
          <Link to={isTreasury ? "/app/queue" : "/app/invoices"} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {isTreasury ? "Open funding queue" : isAdmin ? "Open invoice queue" : "New sales invoice"}
          </Link>
        }
      />

      <div className="space-y-8 p-6 md:p-10">
        {!isTreasury && (
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Sales (gross)" value={fmtMoney(salesTotal)} delta={`${invoices.length} invoices`} />
            <Stat label="Cost of goods (purchases)" value={fmtMoney(purchaseTotal)} delta={`${purchases.length} supplier invoices`} />
            <Stat label="Gross income" value={fmtMoney(gross)} delta={`${marginPct.toFixed(1)}% margin`} tone={gross >= 0 ? "good" : "bad"} />
            <Stat label="Net income" value={fmtMoney(net)} delta={`After ${fmtMoney(expenseTotal)} expenses`} tone={net >= 0 ? "good" : "bad"} />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Outstanding (AR)" value={fmtMoney(totalOutstanding)} delta={`${invoices.length} invoices`} />
          <Stat label="Overdue" value={String(overdueCount)} delta={overdueCount > 0 ? "Action required" : "All clean"} tone={overdueCount ? "bad" : "good"} />
          <Stat label="Collection rate" value={`${collectionRate}%`} delta="Lifetime" tone={collectionRate >= 90 ? "good" : "warn"} />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Short payments" value={fmtMoney(totalShortPayment)} delta={`${paidInvoices.filter((i: any) => Number(i.short_payment ?? 0) > 0).length} invoices short paid`} tone={totalShortPayment > 0 ? "bad" : "good"} />
          <Stat label="Avg late days" value={String(avgLateDays)} delta={`${lateInvoices.length} late settlements`} tone={avgLateDays > 0 ? "warn" : "good"} />
          <Stat label="On-time settlements" value={String(paidInvoices.length - lateInvoices.length)} delta={`of ${paidInvoices.length} closed`} tone="good" />
        </div>

        {!isTreasury && (
          <Card title="Gross vs net income" action={<span className="text-xs text-muted-foreground">Current period</span>}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Net income", value: Math.max(0, net), fill: "oklch(0.78 0.14 200)" },
                      { name: "Expenses", value: Math.max(0, expenseTotal), fill: "oklch(0.65 0.22 30)" },
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
                    <Cell key="net" fill="oklch(0.78 0.14 200)" />
                    <Cell key="expenses" fill="oklch(0.65 0.22 30)" />
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "oklch(0.22 0.014 250)", border: "1px solid oklch(0.30 0.014 250)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => [fmtMoney(v), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
              <div>
                <div className="text-xs" style={{ color: "oklch(0.88 0.18 118)" }}>Gross income</div>
                <div className="text-[10px] text-muted-foreground">{fmtMoney(gross)}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: "oklch(0.78 0.14 200)" }}>Net income</div>
                <div className="text-[10px] text-muted-foreground">{fmtMoney(net)}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: "oklch(0.65 0.22 30)" }}>Expenses</div>
                <div className="text-[10px] text-muted-foreground">{fmtMoney(expenseTotal)}</div>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Aging distribution" className="lg:col-span-2">
            <div className="h-64">
              {(() => {
                const chartData = [
                  { name: "Current", amount: aging.current, fill: "oklch(0.88 0.18 118)" },
                  { name: "1–30 days", amount: aging.b1, fill: "oklch(0.78 0.14 200)" },
                  { name: "31–60 days", amount: aging.b2, fill: "oklch(0.85 0.15 80)" },
                  { name: "61–90 days", amount: aging.b3, fill: "oklch(0.75 0.18 50)" },
                  { name: "90+ days", amount: aging.b4, fill: "oklch(0.65 0.22 30)" },
                ];
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid stroke="oklch(0.30 0.014 250)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" stroke="oklch(0.68 0.018 250)" fontSize={11} />
                      <YAxis stroke="oklch(0.68 0.018 250)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: "oklch(0.22 0.014 250)", border: "1px solid oklch(0.30 0.014 250)", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number, name: string) => [fmtMoney(v), name]}
                        cursor={{ fill: "oklch(0.30 0.014 250)" }}
                      />
                      <Bar dataKey="amount" name="Outstanding" radius={[6, 6, 0, 0]}>
                        {chartData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
            {/* Summary stats below chart */}
            <div className="mt-4 grid grid-cols-5 gap-2 border-t border-border pt-4">
              {(() => {
                const total = Object.values(aging).reduce((a: number, x: number) => a + x, 0) || 1;
                return [
                  { label: "Current", val: aging.current, cls: "text-success" },
                  { label: "1–30d", val: aging.b1, cls: "text-info" },
                  { label: "31–60d", val: aging.b2, cls: "text-warning" },
                  { label: "61–90d", val: aging.b3, cls: "text-warning" },
                  { label: "90+d", val: aging.b4, cls: "text-destructive" },
                ].map((b) => (
                  <div key={b.label} className="text-center">
                    <div className={`text-xs font-medium ${b.cls}`}>{b.label}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{fmtMoney(b.val)}</div>
                    <div className="text-[10px] text-muted-foreground">{total > 0 ? `${((b.val / total) * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                ));
              })()}
            </div>
          </Card>

          <Card title="Alerts" action={<Link to="/app/alerts" className="text-xs text-primary">All →</Link>}>
            {(alertsQ.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground"><Activity className="mx-auto mb-2 h-5 w-5" />No alerts</div>
            ) : (
              <ul className="space-y-2">
                {(alertsQ.data ?? []).map((a: any) => (
                  <li key={a.id} className="rounded-md border border-border bg-background/40 p-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${
                        a.severity === "critical" ? "bg-destructive" : a.severity === "warning" ? "bg-warning" : "bg-primary"
                      }`} />
                      <div className="flex-1">
                        <div className="text-sm">{a.message}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{fmtDate(a.created_at)} · {a.type}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Recent invoices" action={<Link to="/app/invoices" className="text-xs text-primary">View all →</Link>}>
          {invoices.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Short pay</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 6).map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className={`px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{i.short_payment != null ? fmtMoney(Number(i.short_payment)) : "—"}</td>
                      <td className={`px-5 py-3 text-right num ${Number(i.late_days) > 0 ? "text-warning" : "text-muted-foreground"}`}>{i.late_days != null ? i.late_days : "—"}</td>
                      <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent proformas" action={<Link to="/app/proformas" className="text-xs text-primary">View all →</Link>}>
          {proformas.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No proformas yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Proforma</th>
                    <th className="px-5 py-2 text-left font-normal">PO #</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Side</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {proformas.slice(0, 6).map((p: any) => (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">{p.proforma_number ?? p.po_number}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{p.po_number}</td>
                      <td className="px-5 py-3">{p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">{p.side}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                          p.proforma_status === "funded" || p.status === "invoiced" ? "border-success/50 text-success"
                          : p.proforma_status === "approved" ? "border-primary/50 text-primary"
                          : p.proforma_status === "rejected" || p.status === "cancelled" ? "border-destructive/50 text-destructive"
                          : "border-warning/50 text-warning"
                        }`}>{p.proforma_status?.replace("_", " ") || p.status}</span>
                      </td>
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
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest transition ${
                      advanceTab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    }`}>{s === "sales" ? "Received from buyer" : "Given to supplier"}</button>
                ))}
              </div>
            </div>
          }
          action={<Link to="/app/advances" className="text-xs text-primary">View all →</Link>}
        >
          {advances.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No advances yet.</div>
          ) : (
            <>
              {/* Summary totals */}
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 transition ${advanceTab === "sales" ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Received from buyers</span>
                    <span className="text-[10px] text-muted-foreground">{advances.filter((a: any) => a.side === "sales").length} advances</span>
                  </div>
                  <div className="mt-1 font-display text-lg text-success">{fmtMoney(salesAdvancesTotal)}</div>
                </div>
                <div className={`rounded-lg border p-3 transition ${advanceTab === "purchase" ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Given to suppliers</span>
                    <span className="text-[10px] text-muted-foreground">{advances.filter((a: any) => a.side === "purchase").length} advances</span>
                  </div>
                  <div className="mt-1 font-display text-lg text-warning">{fmtMoney(purchaseAdvancesTotal)}</div>
                </div>
              </div>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Date</th>
                      <th className="px-5 py-2 text-left font-normal">Linked to</th>
                      <th className="px-5 py-2 text-left font-normal">Party</th>
                      <th className="px-5 py-2 text-right font-normal">Amount</th>
                      <th className="px-5 py-2 text-left font-normal">Status</th>
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
                          <tr key={a.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.advance_date)}</td>
                            <td className="px-5 py-3">
                              {a.order ? (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">
                                  PO {a.order.po_number}
                                </span>
                              ) : a.invoice || a.purchase ? (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">
                                  {(a.invoice?.invoice_number || a.purchase?.invoice_number)}
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-5 py-3">{cp ?? "—"}</td>
                            <td className="px-5 py-3 text-right num text-primary">{fmtMoney(a.amount)}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                                a.status === "applied" ? "border-success/50 text-success"
                                : a.status === "refunded" ? "border-muted text-muted-foreground"
                                : "border-warning/50 text-warning"
                              }`}>{a.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    {advances.filter((a: any) => a.side === advanceTab).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                          No {advanceTab === "sales" ? "advances received from buyers" : "advances given to suppliers"} yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {!isTreasury && (
          <Card title="Recent expenses" action={<Link to="/app/expenses" className="text-xs text-primary">View all →</Link>}>
            {expenses.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No expenses logged.</div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Date</th>
                      <th className="px-5 py-2 text-left font-normal">Category</th>
                      <th className="px-5 py-2 text-left font-normal">Linked transaction</th>
                      <th className="px-5 py-2 text-left font-normal">Description</th>
                      <th className="px-5 py-2 text-right font-normal">Docs</th>
                      <th className="px-5 py-2 text-right font-normal">Amount</th>
                      <th className="px-5 py-2 text-right font-normal" />
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
                        <tr key={e.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3">{fmtDate(e.expense_date)}</td>
                          <td className="px-5 py-3 capitalize">{e.category}</td>
                          <td className="px-5 py-3">
                            {link ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-xs">
                                <Link2 className="h-3 w-3 text-primary" />
                                <span className="text-muted-foreground">{link.kind}</span>
                                <span className="font-mono">{link.num}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unlinked</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">{e.description ?? "—"}</td>
                          <td className="px-5 py-3 text-right">
                            {docCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Paperclip className="h-3 w-3" />{docCount}
                              </span>
                            ) : <span className="text-[10px] text-muted-foreground">—</span>}
                          </td>
                          <td className="px-5 py-3 text-right num">{fmtMoney(e.amount)}</td>
                          <td className="px-5 py-3 text-right">
                            <button onClick={() => setViewingExpense(e)}
                              className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary">Details</button>
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
          <Card title="Debtor concentration" action={<Link to="/app/debtors" className="text-xs text-primary">Manage →</Link>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(debtorsQ.data ?? []).slice(0, 8).map((d: any) => {
                  const exposure = invoices.filter((i: any) => i.debtor_id === d.id && i.status !== "paid").reduce((s: number, i: any) => s + Number(i.amount), 0);
                  return { name: d.name.slice(0, 14), exposure, limit: Number(d.credit_limit) };
                })}>
                  <CartesianGrid stroke="oklch(0.30 0.014 250)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="oklch(0.68 0.018 250)" fontSize={11} />
                  <YAxis stroke="oklch(0.68 0.018 250)" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "oklch(0.22 0.014 250)", border: "1px solid oklch(0.30 0.014 250)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmtMoney(v)} />
                  <Bar dataKey="exposure" fill="oklch(0.88 0.18 118)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="limit" fill="oklch(0.30 0.014 250)" radius={[4, 4, 0, 0]} />
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Expense detail</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={fmtDate(expense.expense_date)} />
            <Field label="Category" value={String(expense.category)} />
            <Field label="Amount" value={fmtMoney(expense.amount)} />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Linked transaction</div>
              <div className="mt-0.5">
                {link ? (
                  <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Link2 className="h-3 w-3" />
                    <span className="text-muted-foreground">{link.kind}</span>
                    <span className="font-mono">{link.num}</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unlinked</span>
                )}
              </div>
            </div>
          </div>
          {expense.description && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">Description</div>
              <p className="text-muted-foreground">{expense.description}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Attachments</div>
            <DocumentList docs={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 capitalize">{value}</div>
    </div>
  );
}
