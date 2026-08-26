import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, useRef, useMemo } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { AnimatedMoney } from "@/components/animated-number";
import {
  Banknote, CheckCircle2, Lock, ArrowDownToLine, ArrowUpFromLine,
  Loader2, X, DollarSign, History, ChevronDown, ArrowUpRight,
  ArrowDownRight, Search, Clock, AlertTriangle, ArrowRight,
  FileText, ShoppingCart, FileSignature, Send, TrendingUp, TrendingDown,
  CheckCircle, AlertCircle, Upload, CircleDot, Minus,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/queue")({
  component: QueuePage,
});

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function diffDaysUTC(from?: string | null, to?: string | null): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function abbrevMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

type Row = {
  kind: "sale" | "purchase" | "proforma";
  id: string;
  invoice_number: string;
  amount: number;
  po_number: string | null;
  advance: number;
  balance: number;
  due_date: string | null;
  issue_date: string | null;
  has_contractual_due_date?: boolean;
  status: string;
  party: string;
  client?: string;
  side?: "sales" | "purchase";
  proforma_number?: string | null;
  currency?: string;
};

const KIND_CONFIG = {
  sale: { label: "Sale (AR)", icon: FileText, color: "bg-primary/10 text-primary border-primary/20" },
  purchase: { label: "Purchase (AP)", icon: ShoppingCart, color: "bg-warning/10 text-warning border-warning/20" },
  proforma: { label: "Proforma", icon: FileSignature, color: "bg-info/10 text-info border-info/20" },
} as const;

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function QueuePage() {
  const { isAdmin, isTreasury: isTreasuryRole, canWrite } = useAuth();
  const canAct = canWrite("funding-queue");
  const isTreasury = canAct;
  const qc = useQueryClient();

  // ── Filters ──
  const [side, setSide] = useState<"all" | "sale" | "purchase" | "proforma">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"issue" | "due">("due");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Payment history
  const [payHistoryOpen, setPayHistoryOpen] = useState(false);
  const [payHistoryFilter, setPayHistoryFilter] = useState<"all" | "debtor" | "supplier">("all");

  const payHistoryQ = useQuery({
    queryKey: ["payments-history", payHistoryFilter],
    enabled: payHistoryOpen,
    queryFn: async () => {
      const params = payHistoryFilter !== "all" ? `?party_type=${payHistoryFilter}` : "";
      return (await api.get<any>(`/payments/history${params}`)) ?? { payments: [], totals: {} };
    },
  });

  // ── Data Queries ──
  const salesQ = useQuery({
    queryKey: ["queue-sales"],
    queryFn: async () => {
      const data = await api.get<any[]>("/invoices") ?? [];
      return data.filter((i: any) => ["approved", "funded", "advanced", "overdue"].includes(i.status));
    },
    refetchInterval: 30_000,
  });

  const purchasesQ = useQuery({
    queryKey: ["queue-purchases"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-invoices") ?? [];
      return data.filter((p: any) => ["approved", "funded", "advanced", "overdue"].includes(p.status));
    },
    refetchInterval: 30_000,
  });

  const proformasQ = useQuery({
    queryKey: ["queue-proformas"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-orders") ?? [];
      return data.filter((p: any) => p.proforma_status === "approved");
    },
    refetchInterval: 30_000,
  });

  // ── Advance lookup (preserved exactly) ──
  const salePos = Array.from(new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)));
  const purPos = Array.from(new Set(((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean)));

  const advLookupQ = useQuery({
    queryKey: ["queue-advances", salePos, purPos],
    enabled: salePos.length > 0 || purPos.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {};
      const allAdvances = await api.get<any[]>("/advances") ?? [];
      for (const po of salePos) {
        const orders = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(po)}`);
        const salesOrders = (orders.proformas ?? []).filter((o: any) => o.side === "sales");
        const pfIds = salesOrders.map((o: any) => o.id);
        const advs = allAdvances.filter((a: any) => pfIds.includes(a.purchase_order_id) && a.status !== "refunded");
        map[`sales::${po}`] = advs.reduce((s: number, a: any) => s + Number(a.amount), 0);
      }
      for (const po of purPos) {
        const orders = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(po)}`);
        const purOrders = (orders.proformas ?? []).filter((o: any) => o.side === "purchase");
        const pfIds = purOrders.map((o: any) => o.id);
        const advs = allAdvances.filter((a: any) => pfIds.includes(a.purchase_order_id) && a.status !== "refunded");
        map[`purchase::${po}`] = advs.reduce((s: number, a: any) => s + Number(a.amount), 0);
      }
      return map;
    },
  });
  const advMap = advLookupQ.data ?? {};
  const advFor = (s: "sales" | "purchase", po?: string | null) =>
    po ? Number(advMap[`${s}::${po.trim()}`] ?? 0) : 0;

  // ── Mutations (all preserved exactly) ──
  const closeSale = useMutation({
    mutationFn: async ({ id, amount_received, receipt_date, amount, due_date, paid_note }: { id: string; amount_received: number; receipt_date: string; amount: number; due_date: string | null; paid_note: string }) => {
      const short_payment = Math.max(0, +(amount - amount_received).toFixed(2));
      const late_days = diffDaysUTC(due_date, receipt_date);
      await api.patch(`/invoices/${id}`, {
        status: "paid", paid_date: receipt_date, amount_received, receipt_date, short_payment, late_days, paid_note: paid_note || null,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const ld = diffDaysUTC(vars.due_date, vars.receipt_date);
      const sp = Math.max(0, +(vars.amount - vars.amount_received).toFixed(2));
      toast.success(`Invoice closed · ${ld} late day${ld === 1 ? "" : "s"}${sp > 0 ? ` · short ${fmtMoney(sp)}` : ""}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const payPurchase = useMutation({
    mutationFn: async ({ id, paid_date, paid_amount, paid_note }: { id: string; paid_date: string; paid_amount: number; paid_note: string }) => {
      await api.patch(`/purchase-invoices/${id}`, { status: "paid", paid_date, paid_amount, paid_note: paid_note || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      toast.success("Balance paid");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [closeFor, setCloseFor] = useState<Row | null>(null);
  const [payFor, setPayFor] = useState<Row | null>(null);
  const [fundPf, setFundPf] = useState<Row | null>(null);
  const [massCloseOpen, setMassCloseOpen] = useState(false);
  const [massImportApReceiptsOpen, setMassImportApReceiptsOpen] = useState(false);

  const fundProforma = useMutation({
    mutationFn: async ({ id, amount, reference, advance_date }: { id: string; amount: number; reference: string; advance_date: string }) => {
      await api.post(`/purchase-orders/${id}/fund`, { amount, reference: reference || null, advance_date });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success("Advance recorded");
      setFundPf(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // ── Build rows (preserved exactly) ──
  const allRows: Row[] = useMemo(() => [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      const amount = Number(i.amount);
      const advance = advFor("sales", i.po_number);
      return {
        kind: "sale", id: i.id, invoice_number: i.invoice_number, amount,
        po_number: i.po_number ?? null, advance,
        balance: Math.max(0, amount - advance),
        due_date: i.due_date, issue_date: i.issue_date,
        status: i.status, party: i.debtor?.name ?? "—", client: i.client?.company_name || i.client?.contact_name || "—",
        has_contractual_due_date: i.has_contractual_due_date,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      const amount = Number(p.amount);
      const advance = advFor("purchase", p.po_number);
      return {
        kind: "purchase", id: p.id, invoice_number: p.invoice_number, amount,
        po_number: p.po_number ?? null, advance,
        balance: Math.max(0, amount - advance),
        due_date: p.due_date, issue_date: p.issue_date,
        status: p.status, party: p.vendor?.name ?? "—", client: p.client?.company_name || p.client?.contact_name || "—",
        has_contractual_due_date: p.has_contractual_due_date,
      };
    }),
    ...((proformasQ.data ?? []) as Array<Record<string, any>>).map((p): Row => ({
      kind: "proforma" as const,
      id: p.id,
      invoice_number: p.proforma_number ?? p.po_number,
      amount: Number(p.amount),
      po_number: p.po_number ?? null,
      advance: 0,
      balance: Number(p.amount),
      due_date: null,
      issue_date: p.proforma_date ?? p.issue_date,
      status: p.proforma_status,
      party: p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—",
      client: p.client?.company_name || p.client?.contact_name || "—",
      side: p.side,
      proforma_number: p.proforma_number,
      currency: p.currency,
      has_contractual_due_date: p.has_contractual_due_date,
    })),
  ], [salesQ.data, purchasesQ.data, proformasQ.data, advMap]);

  // ── Filter + Sort ──
  const filteredRows = useMemo(() => allRows
    .filter((r) => {
      if (side === "all") return true;
      if (side === "sale") return r.kind === "sale" || (r.kind === "proforma" && r.side === "sales");
      if (side === "purchase") return r.kind === "purchase" || (r.kind === "proforma" && r.side === "purchase");
      if (side === "proforma") return r.kind === "proforma";
      return r.kind === side;
    })
    .filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return r.invoice_number?.toLowerCase().includes(q) || r.party?.toLowerCase().includes(q) || r.client?.toLowerCase().includes(q) || r.po_number?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aVal = sortField === "issue" ? (a.issue_date ?? "9999") : (a.due_date ?? "9999");
      const bVal = sortField === "issue" ? (b.issue_date ?? "9999") : (b.due_date ?? "9999");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    }), [allRows, side, searchQuery, sortField, sortOrder]);

  // ── Computed metrics ──
  const balanceToPay = allRows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.balance, 0);
  const balanceToReceive = allRows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.balance, 0);
  const advancesAppliedOut = allRows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.advance, 0);
  const advancesAppliedIn = allRows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.advance, 0);

  const saleRows = filteredRows.filter((r) => r.kind === "sale");
  const purchaseRows = filteredRows.filter((r) => r.kind === "purchase");
  const proformaRows = filteredRows.filter((r) => r.kind === "proforma");

  const fundingReady = filteredRows.reduce((s, r) => s + r.balance, 0);
  const expectedInflows = balanceToReceive;
  const expectedOutflows = balanceToPay;
  const netPosition = expectedInflows - expectedOutflows;

  // Priority items (top 5 by urgency)
  const priorityRows = useMemo(() => {
    return [...filteredRows]
      .map((r) => {
        const age = r.issue_date ? daysBetween(r.issue_date) : 0;
        const dueDays = r.due_date ? daysBetween(r.due_date) : 999;
        const urgencyScore = (r.balance >= 50_000 ? 3 : r.balance >= 10_000 ? 2 : 1)
          + (dueDays <= 3 ? 3 : dueDays <= 7 ? 2 : 0)
          + (r.kind === "sale" ? 1 : 0);
        return { ...r, urgencyScore, age, dueDays };
      })
      .sort((a, b) => b.urgencyScore - a.urgencyScore)
      .slice(0, 5);
  }, [filteredRows]);

  // Timeline (upcoming movements by date)
  const timeline = useMemo(() => {
    const movements: Array<{ date: string; label: string; amount: number; kind: "in" | "out"; party: string }> = [];
    for (const r of filteredRows) {
      const date = r.due_date || r.issue_date;
      if (!date) continue;
      if (r.kind === "sale") {
        movements.push({ date, label: "Expected collection", amount: r.balance, kind: "in", party: r.party });
      } else if (r.kind === "purchase") {
        movements.push({ date, label: "Supplier payment", amount: r.balance, kind: "out", party: r.party });
      }
    }
    return movements.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }, [filteredRows]);

  // Exceptions
  const exceptions = useMemo(() => {
    const exs: Array<{ title: string; detail: string; row: Row }> = [];
    for (const r of filteredRows) {
      if (r.due_date && daysBetween(r.due_date) > 0 && r.kind !== "proforma") {
        exs.push({ title: "Overdue invoice", detail: `${r.invoice_number} · ${r.party} · ${daysBetween(r.due_date)} days overdue`, row: r });
      }
      if (r.advance > 0 && r.advance >= r.amount) {
        exs.push({ title: "Advance exceeds balance", detail: `${r.invoice_number} · Advance ${fmtMoney(r.advance)} ≥ Invoice ${fmtMoney(r.amount)}`, row: r });
      }
    }
    return exs;
  }, [filteredRows]);

  const isLoading = salesQ.isLoading || purchasesQ.isLoading || proformasQ.isLoading;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 md:px-6 bg-[var(--color-surface-subtle)] min-h-screen">

      {/* ═══════════════════════════════════════════════════════════════
         § 1. PREMIUM HEADER
         ═══════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              Treasury Desk
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Funding Queue
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Manage approved funding, settlements, advances, and incoming collections from one treasury workspace.
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Treasury data synchronized
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isTreasury && (
              <>
                <button onClick={() => setMassCloseOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition">
                  <Upload className="h-3.5 w-3.5" /> Upload AR receipts
                </button>
                <button onClick={() => setMassImportApReceiptsOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/5 transition">
                  <DollarSign className="h-3.5 w-3.5" /> Upload AP receipts
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {isLoading ? (
        <QueueSkeleton />
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════
             § 3. TREASURY OVERVIEW
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Funding Ready", value: fundingReady, count: filteredRows.length, icon: Banknote, accent: "border-l-primary", filter: "all" as const },
                { label: "Supplier Payments Due", value: balanceToPay, count: purchaseRows.length, icon: ArrowUpFromLine, accent: "border-l-warning", filter: "purchase" as const },
                { label: "Expected Collections", value: balanceToReceive, count: saleRows.length, icon: ArrowDownToLine, accent: "border-l-success", filter: "sale" as const },
                { label: "Advance Exposure", value: advancesAppliedIn + advancesAppliedOut, count: 0, icon: DollarSign, accent: "border-l-info", filter: "all" as const },
              ].map((stat) => (
                <button
                  key={stat.label}
                  onClick={() => setSide(stat.filter)}
                  className={`text-left rounded-xl border border-border border-l-[3px] ${stat.accent} bg-card p-4 transition-all hover:shadow-sm ${
                    side === stat.filter ? "ring-1 ring-primary/30 bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{stat.label}</span>
                    <stat.icon className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                  <div className="font-mono text-2xl font-bold text-foreground">{abbrevMoney(Math.round(stat.value))}</div>
                  {stat.count > 0 && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{stat.count} document{stat.count !== 1 ? "s" : ""}</div>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 4. TREASURY NET POSITION
             ═══════════════════════════════════════════════════════════════ */}
          {filteredRows.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Treasury Position</h3>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
                  {/* Inflow */}
                  <div className="text-center flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-success font-semibold mb-1">Expected Inflows</div>
                    <div className="font-mono text-2xl font-bold text-success">{abbrevMoney(Math.round(expectedInflows))}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{saleRows.length} collections</div>
                  </div>

                  {/* Arrow */}
                  <div className="flex flex-col items-center gap-1">
                    <Minus className="h-4 w-4 text-muted-foreground/40" />
                  </div>

                  {/* Outflow */}
                  <div className="text-center flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Expected Outflows</div>
                    <div className="font-mono text-2xl font-bold text-warning">{abbrevMoney(Math.round(expectedOutflows))}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{purchaseRows.length} payments</div>
                  </div>

                  {/* Equals */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="text-lg text-muted-foreground/40 font-light">=</div>
                  </div>

                  {/* Net */}
                  <div className="text-center flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Net Queue Position</div>
                    <div className={`font-mono text-2xl font-bold ${netPosition >= 0 ? "text-success" : "text-destructive"}`}>
                      {netPosition >= 0 ? "+" : ""}{abbrevMoney(Math.round(netPosition))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Queue-based expected position</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 10. PRIORITY SETTLEMENTS
             ═══════════════════════════════════════════════════════════════ */}
          {priorityRows.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Priority Settlements</h3>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {priorityRows.map((r) => {
                  const kCfg = KIND_CONFIG[r.kind];
                  const Icon = kCfg.icon;
                  const dueDays = r.due_date ? daysBetween(r.due_date) : null;
                  const isOverdue = dueDays !== null && dueDays > 0;
                  return (
                    <div key={r.id} className="rounded-xl border border-border bg-card p-3.5 transition-all hover:shadow-sm hover:border-primary/30 group">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kCfg.color}`}>
                          <Icon className="h-2.5 w-2.5" />
                          {r.kind === "sale" ? "AR" : r.kind === "purchase" ? "AP" : "Proforma"}
                        </span>
                        {isOverdue && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-destructive">
                            <AlertTriangle className="h-2.5 w-2.5" /> {dueDays}d overdue
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-lg font-bold text-foreground">{fmtMoney(Math.round(r.balance))}</div>
                      <div className="mt-1 text-xs text-muted-foreground truncate font-medium">{r.invoice_number}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{r.party}</div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        {r.due_date ? `Due ${fmtDate(r.due_date)}` : `Issued ${fmtDate(r.issue_date)}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 6. MAIN SETTLEMENT QUEUE
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready for Settlement</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Approved financial documents waiting for payment or receipt.</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative hidden sm:block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search invoices, PO, counterparty..."
                    className="h-8 w-56 rounded-lg border border-border bg-card pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                {/* Filter pills */}
                {(["all", "sale", "purchase", "proforma"] as const).map((f) => {
                  const labels = { all: "All", sale: "Sales", purchase: "Purchases", proforma: "Proformas" };
                  return (
                    <button
                      key={f}
                      onClick={() => setSide(f)}
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                        side === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-input"
                      }`}
                    >
                      {labels[f]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main table */}
            {filteredRows.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle className="h-6 w-6 text-success" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">Queue is clear</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">No approved items currently in the funding queue.</p>
                <p className="mt-1 text-xs text-muted-foreground">Approved invoices will appear here for settlement.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Document</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Counterparty</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Gross</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Advance</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net Balance</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Due</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Days</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</th>
                        <th className="sticky right-0 bg-card px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hidden md:table-cell">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r) => {
                        const kCfg = KIND_CONFIG[r.kind];
                        const Icon = kCfg.icon;
                        const dpd = r.due_date && r.status !== "paid" ? daysBetween(r.due_date) : 0;
                        const lateDays = Math.max(0, dpd);
                        const action = <QueueAction row={r} isTreasury={isTreasury} onCloseSale={setCloseFor} onPayPurchase={() => setPayFor(r)} onFundPf={setFundPf} />;

                        return (
                          <Fragment key={`${r.kind}-${r.id}`}>
                            <tr className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kCfg.color}`}>
                                  <Icon className="h-2.5 w-2.5" />
                                  {r.kind === "sale" ? "Sale" : r.kind === "proforma" ? `Proforma (${r.side === "sales" ? "AR" : "AP"})` : "Purchase"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-mono text-xs font-medium text-foreground">{r.invoice_number}</div>
                                {r.po_number && <div className="text-[10px] font-mono text-muted-foreground">PO {r.po_number}</div>}
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-foreground">{r.party}</div>
                                {r.client && r.client !== "—" && <div className="text-[10px] text-muted-foreground">{r.client}</div>}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.amount)}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-primary">{r.advance > 0 ? `−${fmtMoney(r.advance)}` : "—"}</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${r.kind === "sale" ? "text-success" : "text-warning"}`}>
                                {fmtMoney(r.balance)}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.due_date)}</td>
                              <td className="px-4 py-3">
                                {r.kind === "proforma" ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : lateDays > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                                    {lateDays}d overdue
                                  </span>
                                ) : r.due_date ? (
                                  <span className="text-xs text-muted-foreground">
                                    {(() => { const due = r.due_date ? daysBetween(new Date().toISOString().slice(0, 10), r.due_date) : 0; return due > 0 ? `${due}d` : "Today"; })()}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                  r.status === "approved" ? "border-primary/20 bg-primary/5 text-primary" :
                                  r.status === "funded" ? "border-success/20 bg-success/5 text-success" :
                                  r.status === "advanced" ? "border-info/20 bg-info/5 text-info" :
                                  r.status === "overdue" ? "border-destructive/20 bg-destructive/5 text-destructive" :
                                  "border-border text-muted-foreground"
                                }`}>
                                  {r.status.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="sticky right-0 bg-card px-4 py-3 text-right hidden md:table-cell">{action}</td>
                            </tr>
                            <tr className="border-b border-border/60 md:hidden">
                              <td colSpan={10} className="px-4 pb-3 pt-0 text-left">
                                <div className="flex justify-start">{action}</div>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{filteredRows.length} document{filteredRows.length !== 1 ? "s" : ""}</span>
                  <span>Total balance: <span className="font-semibold text-foreground">{fmtMoney(Math.round(fundingReady))}</span></span>
                </div>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 11. UPCOMING TREASURY MOVEMENTS
             ═══════════════════════════════════════════════════════════════ */}
          {timeline.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Upcoming Treasury Movements</h3>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="space-y-0">
                  {timeline.map((m, idx) => {
                    const dateObj = parseYMD(m.date);
                    const monthDay = dateObj
                      ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : m.date.slice(5);
                    return (
                      <div key={idx} className="flex items-center gap-4 py-2.5 border-b border-border/40 last:border-0">
                        <div className="w-16 text-center">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            {dateObj ? dateObj.toLocaleDateString("en-US", { month: "short" }) : ""}
                          </div>
                          <div className="font-mono text-sm font-bold text-foreground">
                            {dateObj ? dateObj.getDate() : ""}
                          </div>
                        </div>
                        <div className={`h-8 w-0.5 rounded-full ${m.kind === "in" ? "bg-success" : "bg-warning"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground font-medium">{m.label}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{m.party}</div>
                        </div>
                        <div className={`font-mono text-sm font-bold ${m.kind === "in" ? "text-success" : "text-warning"}`}>
                          {m.kind === "in" ? "+" : "−"}{fmtMoney(Math.round(m.amount))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 19. TREASURY EXCEPTIONS
             ═══════════════════════════════════════════════════════════════ */}
          {exceptions.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Treasury Exceptions</h3>
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
                {exceptions.map((ex, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">{ex.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{ex.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {exceptions.length === 0 && filteredRows.length > 0 && (
            <section className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-center gap-3">
              <CheckCircle className="h-4 w-4 text-success shrink-0" />
              <span className="text-sm text-muted-foreground">No treasury exceptions. All items are within normal parameters.</span>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             PAYMENT HISTORY
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setPayHistoryOpen(!payHistoryOpen)}
                className="flex w-full items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <span className="font-display text-sm font-semibold text-foreground">Payment History</span>
                  {payHistoryQ.data && (
                    <span className="text-[11px] text-muted-foreground">{payHistoryQ.data.totals?.total_events ?? 0} records</span>
                  )}
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${payHistoryOpen ? "rotate-180" : ""}`} />
              </button>

              {payHistoryOpen && (
                <div className="border-t border-border p-5 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: "all" as const, label: "All" },
                      { key: "debtor" as const, label: "Debtors (AR)" },
                      { key: "supplier" as const, label: "Suppliers (AP)" },
                    ]).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setPayHistoryFilter(opt.key)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider font-semibold transition ${
                          payHistoryFilter === opt.key
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.key === "debtor" ? <ArrowDownRight className="h-3 w-3 text-success" /> :
                         opt.key === "supplier" ? <ArrowUpRight className="h-3 w-3 text-warning" /> : null}
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {payHistoryQ.isLoading ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading...
                    </div>
                  ) : (payHistoryQ.data?.payments ?? []).length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No paid invoices yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</th>
                            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Party</th>
                            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
                            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Invoice</th>
                            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</th>
                            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Received</th>
                            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Late</th>
                            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(payHistoryQ.data?.payments ?? []).map((p: any) => {
                            const isDebtor = p.type === "debtor_payment";
                            const paidAmount = p.amount_received ?? p.amount;
                            return (
                              <tr key={`${p.type}-${p.id}`} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3 text-xs font-mono">{p.paid_date ? fmtDate(p.paid_date) : "—"}</td>
                                <td className="px-4 py-3 text-xs font-medium">
                                  <span className="inline-flex items-center gap-1.5">
                                    {isDebtor ? <ArrowDownRight className="h-3 w-3 text-success" /> : <ArrowUpRight className="h-3 w-3 text-warning" />}
                                    {p.party_name}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold ${
                                    isDebtor ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                                  }`}>
                                    {isDebtor ? "Receipt" : "Payment"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">{p.invoice_number}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(p.amount)}</td>
                                <td className={`px-4 py-3 text-right font-mono text-xs font-medium ${isDebtor ? "text-success" : "text-warning"}`}>
                                  {fmtMoney(paidAmount)}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${(p.late_days ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                  {p.late_days != null ? p.late_days : "—"}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate" title={p.paid_note ?? ""}>
                                  {p.paid_note || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
         MODALS (all preserved exactly)
         ═══════════════════════════════════════════════════════════════ */}
      {closeFor && (
        <CloseSaleModal
          row={closeFor}
          onClose={() => setCloseFor(null)}
          onSubmit={(vals) => {
            closeSale.mutate(
              { id: closeFor.id, amount: closeFor.balance, due_date: closeFor.due_date, ...vals },
              { onSuccess: () => setCloseFor(null) },
            );
          }}
        />
      )}

      {payFor && (
        <PayPurchaseModal
          row={payFor}
          onClose={() => setPayFor(null)}
          onSubmit={(vals) => {
            payPurchase.mutate(
              { id: payFor.id, paid_date: vals.paid_date, paid_amount: vals.paid_amount, paid_note: vals.paid_note },
              { onSuccess: () => setPayFor(null) },
            );
          }}
        />
      )}

      {fundPf && (
        <FundProformaModal
          row={fundPf}
          onClose={() => setFundPf(null)}
          onSubmit={(vals) => {
            fundProforma.mutate(
              { id: fundPf.id, ...vals },
              { onSuccess: () => setFundPf(null) },
            );
          }}
        />
      )}

      {massCloseOpen && (
        <MassCloseModal
          salesData={salesQ.data ?? []}
          onClose={() => setMassCloseOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["queue-sales"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
            qc.invalidateQueries({ queryKey: ["queue-purchases"] });
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            setMassCloseOpen(false);
          }}
        />
      )}

      {massImportApReceiptsOpen && (
        <MassImportPurchaseReceiptsModal
          purchasesData={purchasesQ.data ?? []}
          onClose={() => setMassImportApReceiptsOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["queue-purchases"] });
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            setMassImportApReceiptsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   QUEUE ACTION (preserved exactly)
   ═══════════════════════════════════════════════════════════════ */

function QueueAction({ row, isTreasury, onCloseSale, onPayPurchase, onFundPf }: {
  row: Row; isTreasury: boolean; onCloseSale: (row: Row) => void; onPayPurchase: () => void; onFundPf?: (row: Row) => void;
}) {
  if (!isTreasury) {
    return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"><Lock className="h-3 w-3" /> Treasury only</span>;
  }
  if (row.kind === "proforma") {
    return (
      <button onClick={() => onFundPf?.(row)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10 transition">
        <ArrowDownToLine className="h-3 w-3" /> {row.side === "sales" ? "Mark received" : "Fund"}
      </button>
    );
  }
  if (row.kind === "sale") {
    return (
      <button onClick={() => onCloseSale(row)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10 transition">
        <ArrowDownToLine className="h-3 w-3" /> Record receipt
      </button>
    );
  }
  if (row.balance <= 0) {
    return (
      <button onClick={onPayPurchase} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10 transition">
        <CheckCircle2 className="h-3 w-3" /> Mark settled
      </button>
    );
  }
  return (
    <button onClick={onPayPurchase} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10 transition">
      <ArrowUpFromLine className="h-3 w-3" /> Pay balance
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MODALS (all preserved exactly — no changes to business logic)
   ═══════════════════════════════════════════════════════════════ */

function FundProformaModal({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (v: { amount: number; reference: string; advance_date: string }) => void }) {
  const [amt, setAmt] = useState(String(row.amount));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-lg font-semibold text-foreground">{row.side === "sales" ? "Mark advance received" : "Fund advance"} · {row.invoice_number}</h3>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ amount: Number(amt), reference: ref, advance_date: date }); }} className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>PO #</span><span className="font-mono text-foreground">{row.po_number ?? "—"}</span></div>
            <div className="flex justify-between"><span>Party</span><span className="text-foreground">{row.party}</span></div>
            <div className="flex justify-between"><span>Advance amount</span><span className="font-mono text-foreground">{fmtMoney(row.amount)}</span></div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount ({row.currency ?? "USD"}) *</span>
            <input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date *</span>
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reference</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Wire ref / transaction id" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition">Confirm</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ImportRow {
  invoice_number: string;
  date_received: string;
  amount_received: number;
  paid_note: string;
}

function MassCloseModal({ salesData, onClose, onDone }: { salesData: any[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [result, setResult] = useState<{ closed: number; not_found: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const inv of salesData) { map.set(inv.invoice_number, inv); }
    return map;
  }, [salesData]);

  const preview = useMemo(() => {
    const matched: Array<{ invoice_number: string; date_received: string; amount_received: number; paid_note: string; invoice: any }> = [];
    const unmatched: ImportRow[] = [];
    for (const r of rows) {
      const inv = invoiceMap.get(r.invoice_number);
      if (inv) matched.push({ ...r, invoice: inv });
      else unmatched.push(r);
    }
    return { matched, unmatched };
  }, [rows, invoiceMap]);

  const totalAmount = useMemo(() => preview.matched.reduce((s, r) => s + r.amount_received, 0), [preview.matched]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
          const dateRec = row.date_received ?? row["Date Received"] ?? row.dateReceived ?? row["Receipt Date"] ?? row.receipt_date ?? row.ReceiptDate ?? "";
          const amtRec = Number(row.amount_received ?? row["Amount Received"] ?? row.amountReceived ?? row["Amount"] ?? row.Amount ?? 0);
          const noteVal = row.paid_note ?? row["Note"] ?? row["Payment Note"] ?? row["paid_note"] ?? row.note ?? "";
          let dateStr = String(dateRec);
          if (typeof dateRec === "number" && !isNaN(dateRec)) {
            const d = new Date((dateRec - 25569) * 86400 * 1000);
            dateStr = d.toISOString().slice(0, 10);
          }
          return {
            invoice_number: String(invNum).trim(),
            date_received: dateStr || "",
            amount_received: isNaN(amtRec) ? 0 : amtRec,
            paid_note: String(noteVal).trim(),
          };
        }).filter((r) => r.invoice_number && r.date_received);
        if (parsed.length === 0) { toast.error("No valid rows found. Expected columns: invoice_number, date_received, amount_received"); return; }
        setRows(parsed);
        setStep("preview");
      } catch { toast.error("Could not parse the Excel file. Please check the format."); }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchClose = useMutation({
    mutationFn: async () => {
      return await api.post<{ closed: any[]; not_found: string[]; errors: Array<{ invoice_number: string; error: string }> }>("/invoices/batch-close", {
        paid_note: paidNote || null,
        items: preview.matched.map((r) => ({
          invoice_number: r.invoice_number, date_received: r.date_received,
          amount_received: r.amount_received, paid_note: r.paid_note || null,
        })),
      });
    },
    onSuccess: (data) => {
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ closed: data.closed.length, not_found: preview.unmatched.map((r) => r.invoice_number), errors: errList });
      setStep("done");
      if (errList.length === 0 && preview.unmatched.length === 0) toast.success(`${data.closed.length} invoices closed successfully`);
      else toast.success(`${data.closed.length} closed, ${errList.length + preview.unmatched.length} skipped`);
      qc.invalidateQueries({ queryKey: ["queue-sales"] }); qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] }); qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {step === "upload" ? "Upload AR receipts" : step === "preview" ? "Preview matched receipts" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {step === "upload" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet with columns: <code className="font-mono text-primary">invoice_number</code>, <code className="font-mono text-primary">date_received</code>, <code className="font-mono text-primary">amount_received</code>.
            </div>
            <div className="border-t border-border pt-4">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Upload Excel / CSV file *</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods" onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Default payment note (optional)</span>
              <textarea rows={2} value={paidNote} onChange={(e) => setPaidNote(e.target.value)} placeholder="Applied to all invoices unless overridden per row..." className="w-full rounded-md border border-border bg-background p-2.5 text-sm placeholder:text-muted-foreground/50" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
            </div>
          </div>
        )}
        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono text-foreground">{fileName}</span> · <strong className="text-success">{preview.matched.length}</strong> matches · <strong className="text-warning">{preview.unmatched.length}</strong> unmatched · Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("upload")} className="text-xs text-primary hover:underline">Change file</button>
            </div>
            {preview.unmatched.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Not found ({preview.unmatched.length})</div>
                <div className="flex flex-wrap gap-1">
                  {preview.unmatched.map((r) => (
                    <span key={r.invoice_number} className="inline-flex items-center rounded-md border border-warning/30 px-2 py-0.5 text-[10px] font-mono text-warning">{r.invoice_number}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">#</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Invoice</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Party</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Received</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Short</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matched.map((r, idx) => {
                    const short = Math.max(0, +(r.invoice.amount - r.amount_received).toFixed(2));
                    return (
                      <tr key={r.invoice_number} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-4 py-3">{r.invoice.debtor?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.invoice.amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-success">{fmtMoney(r.amount_received)}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${short > 0 ? "text-destructive" : "text-muted-foreground"}`}>{short > 0 ? fmtMoney(short) : "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono">{r.date_received}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate" title={r.paid_note || paidNote || ""}>{r.paid_note || paidNote || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
              <button disabled={batchClose.isPending || preview.matched.length === 0} onClick={() => batchClose.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {batchClose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Close {preview.matched.length} invoice{preview.matched.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.closed}</div>
              <div className="text-xs text-muted-foreground mt-1">Invoices closed successfully</div>
            </div>
            {result.not_found.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-2">Not found ({result.not_found.length})</div>
                <div className="flex flex-wrap gap-1">
                  {result.not_found.map((inv) => (
                    <span key={inv} className="inline-flex items-center rounded-md border border-warning/30 px-2 py-0.5 text-[10px] font-mono text-warning">{inv}</span>
                  ))}
                </div>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-destructive font-semibold mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">
                  {result.errors.map((err, i) => (<li key={i} className="text-xs text-destructive">{err}</li>))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onDone} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CloseSaleModal({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (v: { amount_received: number; receipt_date: string; paid_note: string }) => void }) {
  const [amt, setAmt] = useState(String(row.balance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const short = Math.max(0, +(row.balance - Number(amt || 0)).toFixed(2));
  const late = diffDaysUTC(row.due_date, date);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-lg font-semibold text-foreground">Record receipt · {row.invoice_number}</h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-muted-foreground space-y-1">
            <div>Gross: <span className="font-mono text-foreground">{fmtMoney(row.amount)}</span></div>
            {row.advance > 0 && <div>Advance received: <span className="font-mono text-primary">−{fmtMoney(row.advance)}</span></div>}
            <div>Balance expected: <span className="font-mono text-success">{fmtMoney(row.balance)}</span> · Due {fmtDate(row.due_date)}</div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount received</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Receipt date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background p-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Note (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this payment..." className="w-full rounded-lg border border-border bg-background p-2.5 text-sm placeholder:text-muted-foreground/50" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-surface-subtle p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Short payment</div>
              <div className={`font-mono text-lg font-bold ${short > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(short)}</div>
            </div>
            <div className="rounded-md border border-border bg-surface-subtle p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Late days</div>
              <div className={`font-mono text-lg font-bold ${late > 0 ? "text-warning" : "text-success"}`}>{late}</div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
          <button onClick={() => onSubmit({ amount_received: Number(amt), receipt_date: date, paid_note: note })}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition">Record receipt</button>
        </div>
      </div>
    </div>
  );
}

function PayPurchaseModal({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (v: { paid_date: string; paid_amount: number; paid_note: string }) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amountPaid, setAmountPaid] = useState(() => String(row.balance));
  const [note, setNote] = useState("");
  const short = Math.max(0, +(row.balance - Number(amountPaid || 0)).toFixed(2));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-lg font-semibold text-foreground">
          {row.balance <= 0 ? "Mark settled" : "Record payment"} · {row.invoice_number}
        </h3>
        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-muted-foreground space-y-1">
            <div>Supplier: <span className="text-foreground">{row.party}</span></div>
            <div>Gross: <span className="font-mono text-foreground">{fmtMoney(row.amount)}</span></div>
            {row.advance > 0 && <div>Advance paid: <span className="font-mono text-primary">−{fmtMoney(row.advance)}</span></div>}
            <div>Balance: <span className="font-mono text-warning">{fmtMoney(row.balance)}</span></div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Payment date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount paid</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background pl-7 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" />
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Note (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." className="w-full rounded-lg border border-border bg-background p-2.5 text-sm placeholder:text-muted-foreground/50" />
          </label>
          {short > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              Short payment: {fmtMoney(short)}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
          <button disabled={!date || !amountPaid} onClick={() => onSubmit({ paid_date: date, paid_amount: Number(amountPaid), paid_note: note })}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 hover:bg-primary-hover transition">
            <DollarSign className="h-4 w-4" />
            {row.balance <= 0 ? "Mark settled" : `Pay ${fmtMoney(Number(amountPaid) || row.balance)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ApReceiptRow {
  invoice_number: string;
  amount_received: number;
  date_received: string;
  paid_note?: string;
}

function MassImportPurchaseReceiptsModal({ purchasesData, onClose, onDone }: { purchasesData: any[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [rows, setRows] = useState<ApReceiptRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [defaultPaidNote, setDefaultPaidNote] = useState("");
  const [result, setResult] = useState<{ closed: number; not_found: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const piByNumber = useMemo(() => {
    const map = new Map<string, any>();
    for (const pi of purchasesData) { map.set(pi.invoice_number, pi); }
    return map;
  }, [purchasesData]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
        const parsed: ApReceiptRow[] = json.map((row: any) => {
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row.invoiceNum ?? row.Invoice ?? row["Invoice#"] ?? "";
          const amt = Number(row.amount_received ?? row.amount ?? row["Amount"] ?? row.Amount ?? row.received ?? row["Amount Received"] ?? 0);
          const recDate = row.date_received ?? row["Date Received"] ?? row.date ?? row.Date ?? row.receipt_date ?? row["Payment Date"] ?? row.payment_date ?? "";
          const noteVal = row.paid_note ?? row["Note"] ?? row["Payment Note"] ?? row["paid_note"] ?? row.note ?? "";
          let dateStr = "";
          if (typeof recDate === "number" && !isNaN(recDate)) {
            const d = new Date((recDate - 25569) * 86400 * 1000);
            if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
          } else if (typeof recDate === "string") {
            const cleaned = recDate.trim();
            if (cleaned) {
              const d = new Date(cleaned);
              if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
              else if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) dateStr = cleaned;
            }
          }
          return {
            invoice_number: String(invNum).trim(),
            amount_received: isNaN(amt) ? 0 : amt,
            date_received: dateStr,
            paid_note: String(noteVal).trim() || undefined,
          };
        }).filter((r) => r.invoice_number && r.amount_received >= 0 && r.date_received);
        if (parsed.length === 0) { toast.error("No valid rows found. Expected columns: invoice_number, amount_received, date_received"); return; }
        setRows(parsed);
        setStep("preview");
      } catch { toast.error("Could not parse the file. Please check the format."); }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchClose = useMutation({
    mutationFn: async () => {
      const items = rows.map((r) => ({
        invoice_number: r.invoice_number, date_received: r.date_received,
        amount_received: r.amount_received, paid_note: r.paid_note || defaultPaidNote || null,
      }));
      return await api.post<{ closed: any[]; not_found: string[]; errors: Array<{ invoice_number: string; error: string }> }>("/purchase-invoices/batch-close", { items });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ closed: data.closed.length, not_found: data.not_found ?? [], errors: errList });
      setStep("done");
      if (errList.length === 0 && (data.not_found ?? []).length === 0) toast.success(`${data.closed.length} purchase invoices marked as paid`);
      else { const issues = [...errList, ...(data.not_found ?? []).map((n: string) => `${n}: Not found`)]; toast.success(`${data.closed.length} closed, ${issues.length} issues`); }
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount_received, 0), [rows]);
  const matched = useMemo(() => rows.filter((r) => piByNumber.has(r.invoice_number)), [rows, piByNumber]);
  const unmatched = useMemo(() => rows.filter((r) => !piByNumber.has(r.invoice_number)), [rows, piByNumber]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {step === "form" ? "Upload AP receipts" : step === "preview" ? "Preview receipts" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs text-muted-foreground">
              <strong className="text-success">Excel format:</strong> Upload a spreadsheet with columns: <code className="font-mono text-success">invoice_number</code>, <code className="font-mono text-success">amount_received</code>, <code className="font-mono text-success">date_received</code>.
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Default payment note (optional)</label>
              <textarea rows={2} value={defaultPaidNote} onChange={(e) => setDefaultPaidNote(e.target.value)} placeholder="Applied to all rows unless a per-row paid_note is provided..." className="w-full rounded-md border border-border bg-background p-2.5 text-sm placeholder:text-muted-foreground/50" />
            </div>
            <div className="border-t border-border pt-4">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Upload Excel / CSV file *</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods" onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-success/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-success hover:file:bg-success/20" />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
            </div>
          </div>
        )}
        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono text-foreground">{fileName}</span> · <strong className="text-foreground">{rows.length}</strong> receipts · <strong className="text-success">{matched.length}</strong> matched · <strong className="text-warning">{unmatched.length}</strong> not found · Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>
            {unmatched.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Not found ({unmatched.length})</div>
                <div className="flex flex-wrap gap-1">
                  {unmatched.map((r) => (
                    <span key={r.invoice_number} className="inline-flex items-center rounded-md border border-warning/30 px-2 py-0.5 text-[10px] font-mono text-warning">{r.invoice_number}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">#</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Invoice</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Received</th>
                    <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Short</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</th>
                    <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((r, idx) => {
                    const pi = piByNumber.get(r.invoice_number);
                    const diff = pi ? r.amount_received - Number(pi.amount) : 0;
                    const rowNote = r.paid_note || defaultPaidNote || "";
                    return (
                      <tr key={r.invoice_number} className={`border-b border-border/60 hover:bg-muted/30 ${diff < 0 ? "bg-warning/5" : ""}`}>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{pi ? fmtMoney(pi.amount) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {fmtMoney(r.amount_received)}
                          {diff < 0 && <span className="ml-1 text-[10px] text-muted-foreground">(short {fmtMoney(Math.abs(diff))})</span>}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>{diff < 0 ? fmtMoney(Math.abs(diff)) : "—"}</td>
                        <td className="px-4 py-3 text-xs">{r.date_received ? fmtDate(r.date_received) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate" title={rowNote}>{rowNote || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition">Cancel</button>
              <button disabled={batchClose.isPending || matched.length === 0} onClick={() => batchClose.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {batchClose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                Close {rows.length} purchase invoice{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.closed}</div>
              <div className="text-xs text-muted-foreground mt-1">Purchase invoices marked as paid</div>
            </div>
            {result.not_found.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-2">Not found ({result.not_found.length})</div>
                <ul className="space-y-1">
                  {result.not_found.map((n, i) => (<li key={i} className="text-xs text-warning">{n}</li>))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-destructive font-semibold mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">
                  {result.errors.map((err, i) => (<li key={i} className="text-xs text-destructive">{err}</li>))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onDone} className="rounded-md bg-success px-4 py-2 text-sm font-medium text-white">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SKELETON
   ═══════════════════════════════════════════════════════════════ */

function QueueSkeleton() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-label="Loading treasury">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 skeleton rounded-xl" />
        ))}
      </div>
      <div className="h-24 skeleton rounded-xl" />
      <div className="rounded-xl border border-border bg-card">
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 skeleton" />
          ))}
        </div>
      </div>
    </div>
  );
}
