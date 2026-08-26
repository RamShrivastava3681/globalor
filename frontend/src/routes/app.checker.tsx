import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import {
  ClipboardCheck, Check, X, Lock, Search, Filter, ChevronDown,
  Loader2, AlertTriangle, Clock, FileText, ShoppingCart, FileSignature,
  MessageSquare, ArrowUpRight, Eye, CheckCircle2, CircleAlert,
  SlidersHorizontal, ArrowUpDown, ExternalLink, MoreHorizontal,
  Send, History, Shield, AlertCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/checker")({
  component: CheckerPage,
});

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */

type Row = {
  kind: "sale" | "purchase" | "proforma" | "quotation";
  id: string;
  invoice_number: string;
  amount: number;
  po_number?: string | null;
  advance: number;
  net: number;
  issue_date: string | null;
  due_date: string | null;
  has_contractual_due_date?: boolean;
  party: string;
  client?: string;
  client_id?: string | null;
  noa_status?: string;
  noa_comments?: string | null;
  side?: "sales" | "purchase";
  proforma_number?: string | null;
  proforma_review_comments?: string | null;
  quotation_number?: string | null;
  approval_comments?: string | null;
  revised_count?: number;
};

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function abbrevMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function getUrgency(r: Row): "normal" | "attention" | "urgent" | "critical" {
  const age = r.issue_date ? daysBetween(r.issue_date) : 0;
  if (age >= 5 || (r.amount >= 100_000 && age >= 3)) return "critical";
  if (age >= 3 || r.amount >= 100_000) return "urgent";
  if (age >= 1) return "attention";
  return "normal";
}

const URGENCY_CONFIG = {
  normal: { label: "Normal", color: "text-muted-foreground", dot: "bg-muted-foreground/40", bg: "" },
  attention: { label: "Attention", color: "text-warning", dot: "bg-warning", bg: "bg-warning/5" },
  urgent: { label: "Urgent", color: "text-destructive", dot: "bg-destructive", bg: "bg-destructive/5" },
  critical: { label: "Critical", color: "text-destructive", dot: "bg-destructive", bg: "bg-destructive/5" },
} as const;

const KIND_CONFIG = {
  sale: { label: "Sale (AR)", icon: FileText, color: "bg-primary/10 text-primary border-primary/20" },
  purchase: { label: "Purchase (AP)", icon: ShoppingCart, color: "bg-warning/10 text-warning border-warning/20" },
  proforma: { label: "Proforma", icon: FileSignature, color: "bg-info/10 text-info border-info/20" },
  quotation: { label: "Quotation", icon: Send, color: "bg-info/10 text-info border-info/20" },
} as const;

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return { open, setOpen, ref };
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function CheckerPage() {
  const { isAdmin, isChecker, user, canWrite } = useAuth();
  const canReview = canWrite("checker-desk");
  const qc = useQueryClient();

  // ── Filters ──
  const [side, setSide] = useState<"all" | "sale" | "purchase" | "proforma" | "quotation">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reviewDrawer, setReviewDrawer] = useState<Row | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);

  // ── Data Queries ──
  const salesQ = useQuery({
    queryKey: ["checker-sales"],
    queryFn: async () => {
      const data = await api.get<any[]>("/invoices") ?? [];
      return data.filter((i: any) => i.status === "submitted");
    },
    refetchInterval: 30_000,
  });

  const purchasesQ = useQuery({
    queryKey: ["checker-purchases"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-invoices") ?? [];
      return data.filter((p: any) => p.status === "submitted");
    },
    refetchInterval: 30_000,
  });

  const proformasQ = useQuery({
    queryKey: ["checker-proformas"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-orders") ?? [];
      return data.filter((p: any) => p.proforma_status === "pending_review");
    },
    refetchInterval: 30_000,
  });

  const quotationsQ = useQuery({
    queryKey: ["checker-quotations"],
    queryFn: async () => {
      const data = await api.get<any[]>("/quotations") ?? [];
      return data.filter((p: any) => p.approval_status === "pending_review");
    },
    refetchInterval: 30_000,
  });

  // ── Mutations (all preserved exactly) ──
  const reviewQuotation = useMutation({
    mutationFn: async ({ id, decision, comments }: { id: string; decision: "approved" | "rejected"; comments?: string }) => {
      await api.post(`/quotations/${id}/review`, { decision, comments: comments || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-quotations"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Quotation pricing reviewed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewProforma = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.post(`/purchase-orders/${id}/review`, { decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      toast.success("Proforma reviewed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewSale = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.patch(`/invoices/${id}`, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewPurchase = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "disputed" }) => {
      await api.patch(`/purchase-invoices/${id}`, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const results = { approved: 0, failed: 0 };
      for (const row of filteredRows) {
        try {
          if (row.kind === "proforma") {
            await api.post(`/purchase-orders/${row.id}/review`, { decision: "approved" });
          } else if (row.kind === "quotation") {
            await api.post(`/quotations/${row.id}/review`, { decision: "approved" });
          } else if (row.kind === "sale") {
            await api.patch(`/invoices/${row.id}`, { status: "approved" });
          } else if (row.kind === "purchase") {
            await api.patch(`/purchase-invoices/${row.id}`, { status: "approved" });
          }
          results.approved++;
        } catch {
          results.failed++;
        }
      }
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["checker-sales"] });
      qc.invalidateQueries({ queryKey: ["checker-purchases"] });
      qc.invalidateQueries({ queryKey: ["checker-proformas"] });
      qc.invalidateQueries({ queryKey: ["checker-quotations"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      toast.success(`Approved ${results.approved} item${results.approved !== 1 ? "s" : ""}${results.failed > 0 ? `, ${results.failed} failed` : ""}`);
      setApproveAllOpen(false);
      setSelectedIds(new Set());
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Bulk approval failed");
      setApproveAllOpen(false);
    },
  });

  // ── Advance lookup (preserved exactly) ──
  const salePos = Array.from(new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)));
  const purPos = Array.from(new Set(((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean)));

  const advLookupQ = useQuery({
    queryKey: ["checker-advances", salePos, purPos],
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
  const advFor = (s: "sales" | "purchase", po?: string | null) => {
    const k = po ? `${s}::${po.trim()}` : "";
    return k ? Number(advMap[k] ?? 0) : 0;
  };

  // ── Build rows ──
  const allRows: Row[] = useMemo(() => [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      const adv = advFor("sales", i.po_number);
      const amt = Number(i.amount);
      return {
        kind: "sale", id: i.id, invoice_number: i.invoice_number, amount: amt,
        po_number: i.po_number, advance: adv, net: Math.max(0, amt - adv),
        issue_date: i.issue_date, due_date: i.due_date,
        party: i.debtor?.name ?? "—", client: i.client?.company_name || i.client?.contact_name || "—", client_id: i.client_id,
        noa_status: i.noa_status, noa_comments: i.noa_comments,
        has_contractual_due_date: i.has_contractual_due_date,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      const adv = advFor("purchase", p.po_number);
      const amt = Number(p.amount);
      return {
        kind: "purchase", id: p.id, invoice_number: p.invoice_number, amount: amt,
        po_number: p.po_number, advance: adv, net: Math.max(0, amt - adv),
        issue_date: p.issue_date, due_date: p.due_date,
        party: p.vendor?.name ?? "—", client: p.client?.company_name || p.client?.contact_name || "—", client_id: p.client_id,
        has_contractual_due_date: p.has_contractual_due_date,
      };
    }),
    ...((proformasQ.data ?? []) as Array<Record<string, any>>).map((p): Row => ({
      kind: "proforma" as const,
      id: p.id,
      invoice_number: p.proforma_number ?? p.po_number,
      amount: Number(p.amount),
      po_number: p.po_number,
      advance: 0,
      net: Number(p.amount),
      issue_date: p.proforma_date ?? p.issue_date,
      due_date: null,
      party: p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—",
      client: p.client?.company_name || p.client?.contact_name || "—",
      side: p.side,
      proforma_number: p.proforma_number,
      proforma_review_comments: p.proforma_review_comments,
      has_contractual_due_date: p.has_contractual_due_date,
    })),
    ...((quotationsQ.data ?? []) as Array<Record<string, any>>).map((p): Row => ({
      kind: "quotation" as const,
      id: p.id,
      invoice_number: p.quotation_number,
      amount: Number(p.grand_total),
      po_number: null,
      advance: 0,
      net: Number(p.grand_total),
      issue_date: p.quotation_date,
      due_date: null,
      party: p.customer_name ?? p.prospect_name ?? "—",
      client: p.client?.company_name || p.client?.contact_name || "—",
      quotation_number: p.quotation_number,
      approval_comments: p.approval_comments,
      revised_count: (p.lines ?? []).filter((l: any) => l.updated_unit_price != null).length,
    })),
  ], [salesQ.data, purchasesQ.data, proformasQ.data, quotationsQ.data, advMap]);

  // ── Filter + Sort ──
  const filteredRows = useMemo(() => allRows
    .filter((r) => {
      let sideMatch: boolean;
      if (side === "all") sideMatch = true;
      else if (side === "sale") sideMatch = r.kind === "sale" || (r.kind === "proforma" && r.side === "sales");
      else if (side === "purchase") sideMatch = r.kind === "purchase" || (r.kind === "proforma" && r.side === "purchase");
      else if (side === "proforma") sideMatch = r.kind === "proforma";
      else if (side === "quotation") sideMatch = r.kind === "quotation";
      else sideMatch = false;
      if (!sideMatch) return false;
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

  // ── Computed stats ──
  const totalCount = filteredRows.length;
  const totalExposure = filteredRows.reduce((s, r) => s + r.net, 0);
  const salesCount = allRows.filter((r) => r.kind === "sale" || (r.kind === "proforma" && r.side === "sales")).length;
  const salesAmount = allRows.filter((r) => r.kind === "sale" || (r.kind === "proforma" && r.side === "sales")).reduce((s, r) => s + r.net, 0);
  const purchaseCount = allRows.filter((r) => r.kind === "purchase" || (r.kind === "proforma" && r.side === "purchase")).length;
  const purchaseAmount = allRows.filter((r) => r.kind === "purchase" || (r.kind === "proforma" && r.side === "purchase")).reduce((s, r) => s + r.net, 0);
  const proformaCount = allRows.filter((r) => r.kind === "proforma").length;
  const proformaAmount = allRows.filter((r) => r.kind === "proforma").reduce((s, r) => s + r.net, 0);
  const quotationCount = allRows.filter((r) => r.kind === "quotation").length;
  const quotationAmount = allRows.filter((r) => r.kind === "quotation").reduce((s, r) => s + r.net, 0);

  // Aging buckets
  const agingBuckets = useMemo(() => {
    const buckets = { today: 0, "1-2": 0, "3-5": 0, "5plus": 0 };
    for (const r of allRows) {
      const age = r.issue_date ? daysBetween(r.issue_date) : 0;
      if (age <= 0) buckets.today++;
      else if (age <= 2) buckets["1-2"]++;
      else if (age <= 5) buckets["3-5"]++;
      else buckets["5plus"]++;
    }
    return buckets;
  }, [allRows]);

  // Priority reviews (top 5 by urgency score)
  const priorityRows = useMemo(() => {
    return [...allRows]
      .map((r) => {
        const age = r.issue_date ? daysBetween(r.issue_date) : 0;
        const urgencyScore = (r.amount >= 100_000 ? 3 : r.amount >= 50_000 ? 2 : 1) + (age >= 5 ? 4 : age >= 3 ? 3 : age >= 1 ? 2 : 0) + (r.kind === "quotation" ? 1 : 0);
        return { ...r, urgencyScore, age };
      })
      .sort((a, b) => b.urgencyScore - a.urgencyScore)
      .slice(0, 5);
  }, [allRows]);

  // Oldest pending
  const oldestPending = useMemo(() => {
    let oldest = 0;
    for (const r of allRows) {
      const age = r.issue_date ? daysBetween(r.issue_date) : 0;
      if (age > oldest) oldest = age;
    }
    return oldest;
  }, [allRows]);

  // ── Selection ──
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.id)));
    }
  }, [selectedIds.size, filteredRows]);

  const selectedAmount = useMemo(() => {
    return filteredRows.filter((r) => selectedIds.has(r.id)).reduce((s, r) => s + r.net, 0);
  }, [selectedIds, filteredRows]);

  const isLoading = salesQ.isLoading || purchasesQ.isLoading || proformasQ.isLoading || quotationsQ.isLoading;

  const eyebrow = "Operations";
  const titleText = "Approval Center";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 md:px-6 bg-[var(--color-surface-subtle)] min-h-screen">

      {/* ═══════════════════════════════════════════════════════════════
         § 2. PREMIUM PAGE HEADER
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
              {canReview
                ? "Review and release financial documents before they enter the funding workflow."
                : "View-only. Only the checker (or admin) can approve invoices into the funding queue."}
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {totalCount > 0 ? `${totalCount} item${totalCount !== 1 ? "s" : ""} require${totalCount === 1 ? "s" : ""} your attention` : "All caught up"}
              </span>
              <span>·</span>
              <span>Last synchronized just now</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoices, customers, suppliers..."
                className="h-9 w-64 rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <CheckerSkeleton />
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════
             § 3. APPROVAL SUMMARY
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Awaiting Review", count: totalCount, amount: totalExposure, filter: "all" as const, accent: "border-l-primary" },
                { label: "Sales", count: salesCount, amount: salesAmount, filter: "sale" as const, accent: "border-l-primary" },
                { label: "Purchases", count: purchaseCount, amount: purchaseAmount, filter: "purchase" as const, accent: "border-l-warning" },
                { label: "Proformas & Quotes", count: proformaCount + quotationCount, amount: proformaAmount + quotationAmount, filter: "all" as const, accent: "border-l-info" },
              ].map((stat) => (
                <button
                  key={stat.label}
                  onClick={() => setSide(stat.filter)}
                  className={`text-left rounded-xl border border-border border-l-[3px] ${stat.accent} bg-card p-4 transition-all hover:shadow-sm ${
                    side === stat.filter ? "ring-1 ring-primary/30 bg-primary/5" : ""
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{stat.label}</div>
                  <div className="mt-1.5 font-mono text-2xl font-bold text-foreground">{stat.count}</div>
                  {stat.amount > 0 && (
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{abbrevMoney(Math.round(stat.amount))}</div>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 4 & 9. WORKLOAD + EXPOSURE
             ═══════════════════════════════════════════════════════════════ */}
          {totalCount > 0 && (
            <section className="grid gap-6 lg:grid-cols-2">
              {/* Workload */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Review Workload</h4>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="font-mono text-lg font-bold text-foreground">{totalCount}</span>
                  <span className="text-xs text-muted-foreground">documents awaiting approval</span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden mb-3">
                  <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.min(100, (totalCount / Math.max(totalCount + 5, 10)) * 100)}%` }} />
                </div>
                {oldestPending > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Oldest pending item: <span className="font-semibold text-foreground">{oldestPending} day{oldestPending !== 1 ? "s" : ""} ago</span></span>
                  </div>
                )}
              </div>

              {/* Exposure */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Approval Exposure</h4>
                <div className="font-mono text-2xl font-bold text-foreground mb-3">{abbrevMoney(Math.round(totalExposure))}</div>
                <div className="space-y-2">
                  {[
                    { label: "Sales", amount: salesAmount, color: "bg-primary" },
                    { label: "Purchases", amount: purchaseAmount, color: "bg-warning" },
                    { label: "Proformas", amount: proformaAmount, color: "bg-info" },
                    { label: "Quotations", amount: quotationAmount, color: "bg-info" },
                  ].filter((x) => x.amount > 0).map((x) => (
                    <div key={x.label} className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${x.color}`} />
                      <span className="text-xs text-muted-foreground flex-1">{x.label}</span>
                      <span className="font-mono text-xs font-semibold text-foreground">{fmtMoney(Math.round(x.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 10. PRIORITY REVIEWS
             ═══════════════════════════════════════════════════════════════ */}
          {priorityRows.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Priority Reviews</h3>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {priorityRows.map((r) => {
                  const urgency = getUrgency(r);
                  const uCfg = URGENCY_CONFIG[urgency];
                  const kCfg = KIND_CONFIG[r.kind];
                  const Icon = kCfg.icon;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setReviewDrawer(r)}
                      className="text-left rounded-xl border border-border bg-card p-3.5 transition-all hover:shadow-sm hover:border-primary/30 group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kCfg.color}`}>
                          <Icon className="h-2.5 w-2.5" />
                          {r.kind === "quotation" ? "Quote" : r.kind === "proforma" ? "Proforma" : r.kind === "sale" ? "Sale" : "Purchase"}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider ${uCfg.color}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${uCfg.dot}`} />
                          {uCfg.label}
                        </span>
                      </div>
                      <div className="font-mono text-lg font-bold text-foreground">{fmtMoney(Math.round(r.net))}</div>
                      <div className="mt-1 text-xs text-muted-foreground truncate">{r.invoice_number}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{r.party}</div>
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        Review <ArrowUpRight className="h-2.5 w-2.5" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 5 & 6. MAIN REVIEW QUEUE
             ═══════════════════════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Needs Your Review</h3>
              <div className="flex items-center gap-2">
                {/* Filter pills */}
                {(["all", "sale", "purchase", "proforma", "quotation"] as const).map((f) => {
                  const labels = { all: "All", sale: "Sales", purchase: "Purchases", proforma: "Proformas", quotation: "Quotes" };
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
                {/* Sort */}
                <button
                  onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-all"
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {sortField === "issue" ? "Issue" : "Due"} {sortOrder === "asc" ? "↑" : "↓"}
                </button>
              </div>
            </div>

            {/* Floating bulk action bar */}
            {selectedIds.size > 0 && canReview && (
              <div className="sticky top-0 z-30 mb-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-card px-4 py-2.5 shadow-lg">
                <span className="text-sm font-semibold text-foreground">{selectedIds.size} selected · {fmtMoney(Math.round(selectedAmount))}</span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    // Approve selected individually
                    for (const r of filteredRows.filter((r) => selectedIds.has(r.id))) {
                      if (r.kind === "proforma") reviewProforma.mutate({ id: r.id, decision: "approved" });
                      else if (r.kind === "quotation") reviewQuotation.mutate({ id: r.id, decision: "approved" });
                      else if (r.kind === "sale") reviewSale.mutate({ id: r.id, decision: "approved" });
                      else reviewPurchase.mutate({ id: r.id, decision: "approved" });
                    }
                    setSelectedIds(new Set());
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success/90 transition"
                >
                  <Check className="h-3.5 w-3.5" /> Approve Selected
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Table */}
            {filteredRows.length === 0 ? (
              /* ═══════════════════════════════════════════════════════════════
                 § 22. EMPTY STATE
                 ═══════════════════════════════════════════════════════════════ */
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">You're all caught up</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">No documents currently require your approval.</p>
                <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Sales invoices</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Purchase invoices</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Proformas</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Quotations</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Table header with select all */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {canReview && (
                          <th className="w-10 px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.size === filteredRows.length && filteredRows.length > 0}
                              onChange={toggleSelectAll}
                              className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                            />
                          </th>
                        )}
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Document</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Client / Supplier</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Submitted</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Age</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Risk</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r) => {
                        const urgency = getUrgency(r);
                        const uCfg = URGENCY_CONFIG[urgency];
                        const kCfg = KIND_CONFIG[r.kind];
                        const Icon = kCfg.icon;
                        const age = r.issue_date ? daysBetween(r.issue_date) : 0;
                        const isSelfCreated = r.kind === "sale" && r.client_id && r.client_id === user?.id && !isAdmin;

                        return (
                          <tr
                            key={`${r.kind}-${r.id}`}
                            className={`border-b border-border/60 transition-colors ${
                              selectedIds.has(r.id) ? "bg-primary/5" : "hover:bg-muted/30"
                            }`}
                          >
                            {canReview && (
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleSelect(r.id)}
                                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kCfg.color}`}>
                                <Icon className="h-2.5 w-2.5" />
                                {r.kind === "quotation" ? "Quote" : r.kind === "proforma" ? `Proforma (${r.side === "sales" ? "AR" : "AP"})` : r.kind === "sale" ? "Sale (AR)" : "Purchase (AP)"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => setReviewDrawer(r)} className="font-mono text-xs font-medium text-foreground hover:text-primary transition-colors">
                                {r.invoice_number}
                              </button>
                              {r.po_number && (
                                <div className="text-[10px] font-mono text-muted-foreground">PO {r.po_number}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm text-foreground">{r.party}</div>
                              {r.client && r.client !== "—" && (
                                <div className="text-[10px] text-muted-foreground">{r.client}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="font-mono text-sm font-semibold text-foreground">{fmtMoney(r.amount)}</div>
                              {r.advance > 0 && (
                                <div className="text-[10px] font-mono text-primary">−{fmtMoney(r.advance)} advance</div>
                              )}
                              <div className={`font-mono text-xs font-bold ${
                                r.kind === "sale" ? "text-success" : r.kind === "quotation" ? "text-info" : "text-warning"
                              }`}>
                                {fmtMoney(r.net)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.issue_date)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-mono ${age >= 3 ? "text-destructive font-semibold" : age >= 1 ? "text-warning" : "text-muted-foreground"}`}>
                                {age === 0 ? "Today" : `${age}d`}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider ${uCfg.color}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${uCfg.dot}`} />
                                {uCfg.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isSelfCreated ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground" title="Segregation of duties: you cannot review an invoice you created">
                                  <Lock className="h-3 w-3" /> Self-created
                                </span>
                              ) : canReview ? (
                                <div className="inline-flex gap-1">
                                  <button
                                    onClick={() => {
                                      if (r.kind === "proforma") reviewProforma.mutate({ id: r.id, decision: "approved" });
                                      else if (r.kind === "quotation") reviewQuotation.mutate({ id: r.id, decision: "approved" });
                                      else if (r.kind === "sale") reviewSale.mutate({ id: r.id, decision: "approved" });
                                      else reviewPurchase.mutate({ id: r.id, decision: "approved" });
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[11px] font-medium text-success hover:bg-success/10 transition"
                                  >
                                    <Check className="h-3 w-3" /> Approve
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (r.kind === "proforma") reviewProforma.mutate({ id: r.id, decision: "rejected" });
                                      else if (r.kind === "quotation") reviewQuotation.mutate({ id: r.id, decision: "rejected" });
                                      else if (r.kind === "sale") reviewSale.mutate({ id: r.id, decision: "rejected" });
                                      else reviewPurchase.mutate({ id: r.id, decision: "disputed" });
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition"
                                  >
                                    <X className="h-3 w-3" /> {r.kind === "purchase" ? "Dispute" : "Reject"}
                                  </button>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  <Lock className="h-3 w-3" /> Checker only
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{filteredRows.length} document{filteredRows.length !== 1 ? "s" : ""}</span>
                  <span>Total exposure: <span className="font-semibold text-foreground">{fmtMoney(Math.round(totalExposure))}</span></span>
                </div>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════════════════════════
             § 8. APPROVAL AGING
             ═══════════════════════════════════════════════════════════════ */}
          {totalCount > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Approval Aging</h3>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex gap-1 h-10 rounded-lg overflow-hidden mb-4">
                  {[
                    { label: "Today", count: agingBuckets.today, color: "bg-primary/60" },
                    { label: "1–2 days", count: agingBuckets["1-2"], color: "bg-primary/80" },
                    { label: "3–5 days", count: agingBuckets["3-5"], color: "bg-warning" },
                    { label: "5+ days", count: agingBuckets["5plus"], color: "bg-destructive" },
                  ].map((b) => (
                    <div
                      key={b.label}
                      className={`${b.color} flex items-center justify-center text-[10px] font-semibold text-white transition-all duration-500`}
                      style={{ width: totalCount > 0 ? `${(b.count / totalCount) * 100}%` : "25%", minWidth: b.count > 0 ? "32px" : "0" }}
                    >
                      {b.count > 0 && `${b.count}`}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Today", count: agingBuckets.today, color: "text-primary" },
                    { label: "1–2 days", count: agingBuckets["1-2"], color: "text-primary" },
                    { label: "3–5 days", count: agingBuckets["3-5"], color: "text-warning" },
                    { label: "5+ days", count: agingBuckets["5plus"], color: "text-destructive" },
                  ].map((b) => (
                    <div key={b.label} className="text-center">
                      <div className={`font-mono text-lg font-bold ${b.color}`}>{b.count}</div>
                      <div className="text-[10px] text-muted-foreground">{b.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             § 20. WORKFLOW BOTTLENECKS
             ═══════════════════════════════════════════════════════════════ */}
          {agingBuckets["5plus"] > 0 && (
            <section className="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">Workflow bottleneck detected</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {agingBuckets["5plus"]} document{agingBuckets["5plus"] !== 1 ? "s" : ""} ha{agingBuckets["5plus"] === 1 ? "s" : "ve"} been awaiting approval for more than 5 days.
                    {agingBuckets["5plus"] >= 3 && " This may indicate a review backlog."}
                  </p>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
         § 14. REVIEW DRAWER
         ═══════════════════════════════════════════════════════════════ */}
      {reviewDrawer && (
        <ReviewDrawer row={reviewDrawer} onClose={() => setReviewDrawer(null)} canReview={canReview} user={user} isAdmin={isAdmin}
          onApprove={() => {
            if (reviewDrawer.kind === "proforma") reviewProforma.mutate({ id: reviewDrawer.id, decision: "approved" });
            else if (reviewDrawer.kind === "quotation") reviewQuotation.mutate({ id: reviewDrawer.id, decision: "approved" });
            else if (reviewDrawer.kind === "sale") reviewSale.mutate({ id: reviewDrawer.id, decision: "approved" });
            else reviewPurchase.mutate({ id: reviewDrawer.id, decision: "approved" });
            setReviewDrawer(null);
          }}
          onReject={() => {
            if (reviewDrawer.kind === "proforma") reviewProforma.mutate({ id: reviewDrawer.id, decision: "rejected" });
            else if (reviewDrawer.kind === "quotation") reviewQuotation.mutate({ id: reviewDrawer.id, decision: "rejected" });
            else if (reviewDrawer.kind === "sale") reviewSale.mutate({ id: reviewDrawer.id, decision: "rejected" });
            else reviewPurchase.mutate({ id: reviewDrawer.id, decision: "disputed" });
            setReviewDrawer(null);
          }}
          isPending={reviewProforma.isPending || reviewQuotation.isPending || reviewSale.isPending || reviewPurchase.isPending}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
         APPROVE ALL MODAL
         ═══════════════════════════════════════════════════════════════ */}
      {approveAllOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setApproveAllOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-display text-lg font-semibold text-foreground">Approve all {totalCount} item{totalCount !== 1 ? "s" : ""}?</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              This will approve every item currently shown. This action cannot be undone. <strong className="text-foreground">Are you sure?</strong>
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setApproveAllOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition">Cancel</button>
              <button
                disabled={approveAllMutation.isPending}
                onClick={() => approveAllMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {approveAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {approveAllMutation.isPending ? "Approving…" : `Approve all ${totalCount}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REVIEW DRAWER
   ═══════════════════════════════════════════════════════════════ */

function ReviewDrawer({
  row,
  onClose,
  canReview,
  user,
  isAdmin,
  onApprove,
  onReject,
  isPending,
}: {
  row: Row;
  onClose: () => void;
  canReview: boolean;
  user: any;
  isAdmin: boolean;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const [comment, setComment] = useState("");
  const urgency = getUrgency(row);
  const uCfg = URGENCY_CONFIG[urgency];
  const kCfg = KIND_CONFIG[row.kind];
  const Icon = kCfg.icon;
  const age = row.issue_date ? daysBetween(row.issue_date) : 0;
  const isSelfCreated = row.kind === "sale" && row.client_id && row.client_id === user?.id && !isAdmin;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "a" && !e.ctrlKey && !e.metaKey && canReview && !isSelfCreated) { e.preventDefault(); onApprove(); }
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && canReview && !isSelfCreated) { e.preventDefault(); onReject(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onApprove, onReject, canReview, isSelfCreated]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-lg bg-card border-l border-border shadow-2xl overflow-y-auto animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-card px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kCfg.color}`}>
                  <Icon className="h-2.5 w-2.5" />
                  {row.kind === "quotation" ? "Quotation" : row.kind === "proforma" ? "Proforma" : row.kind === "sale" ? "Sales Invoice" : "Purchase Invoice"}
                </span>
                <span className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider ${uCfg.color}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${uCfg.dot}`} />
                  {uCfg.label}
                </span>
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">{row.invoice_number}</h2>
              <div className="text-sm text-muted-foreground">{row.party}</div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Amount hero */}
          <div className="rounded-xl border border-border bg-surface-subtle p-5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Pending Amount</div>
            <div className="font-mono text-3xl font-bold text-foreground">{fmtMoney(Math.round(row.net))}</div>
            {row.advance > 0 && (
              <div className="text-xs text-primary mt-1">Less {fmtMoney(row.advance)} advance = {fmtMoney(Math.round(row.net))} net</div>
            )}
          </div>

          {/* Document details */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Document Details</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Document #", value: row.invoice_number },
                { label: "Party", value: row.party },
                { label: "Amount", value: fmtMoney(row.amount) },
                { label: "Net Amount", value: fmtMoney(Math.round(row.net)) },
                { label: "Issue Date", value: fmtDate(row.issue_date) },
                { label: "Due Date", value: fmtDate(row.due_date) },
                { label: "Age", value: age === 0 ? "Today" : `${age} day${age !== 1 ? "s" : ""}` },
                ...(row.po_number ? [{ label: "PO Number", value: row.po_number }] : []),
                ...(row.has_contractual_due_date !== undefined ? [{ label: "Contractual Terms", value: row.has_contractual_due_date ? "Yes" : "N/A" }] : []),
                ...(row.kind === "sale" ? [{ label: "NOA Status", value: row.noa_status ?? "Not sent" }] : []),
                ...(row.kind === "quotation" && row.revised_count ? [{ label: "Revised Prices", value: `${row.revised_count} line${row.revised_count !== 1 ? "s" : ""}` }] : []),
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                  <div className="mt-0.5 text-sm text-foreground font-medium">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Comments */}
          {(row.noa_comments || row.proforma_review_comments || row.approval_comments) && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Existing Comments</h4>
              <div className="rounded-lg border border-border bg-surface-subtle p-3 text-sm text-muted-foreground italic">
                "{row.noa_comments || row.proforma_review_comments || row.approval_comments}"
              </div>
            </div>
          )}

          {/* Review Notes */}
          {canReview && !isSelfCreated && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Review Notes</h4>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add notes for this review..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none"
                rows={3}
              />
            </div>
          )}

          {/* Segregation of duties */}
          {isSelfCreated && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning shrink-0" />
              <span className="text-xs text-muted-foreground">Segregation of duties: you cannot approve an invoice you created.</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {canReview && !isSelfCreated && (
          <div className="sticky bottom-0 border-t border-border bg-card px-6 py-4 flex items-center gap-3">
            <button
              onClick={onReject}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/50 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition"
            >
              <X className="h-4 w-4" />
              {row.kind === "purchase" ? "Dispute" : "Reject"}
            </button>
            <button
              onClick={onApprove}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50 transition"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve & Release
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SKELETON
   ═══════════════════════════════════════════════════════════════ */

function CheckerSkeleton() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-label="Loading approval center">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 skeleton rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-32 skeleton rounded-xl" />
        <div className="h-32 skeleton rounded-xl" />
      </div>
      <div className="h-20 skeleton rounded-xl" />
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
