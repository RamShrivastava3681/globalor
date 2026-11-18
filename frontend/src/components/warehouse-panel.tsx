import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { StatusPill, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { SectionCard, FooterBanner, TableSkeleton, EmptyState } from "@/components/workbench";
import { cn } from "@/lib/utils";
import {
  BarChart3, Boxes, ClipboardCheck, PackageCheck, Truck, Warehouse,
  Pencil, Check, X, Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

/* ── Types (mirror existing pages, UI-only additions noted) ── */
type SOLine = {
  product_id: string | null; sku: string; name: string; unit: string;
  ordered_qty: number; unit_price: number; dispatched_qty: number;
};
type SO = {
  id: string; so_number: string; order_date: string;
  customer_name: string | null; expected_dispatch_date: string | null;
  expected_delivery_date: string | null; grand_total: number;
  status: string; manual_status?: string; lines: SOLine[];
};
type DSP = {
  id: string; dispatch_number: string; goods_sales_order_id: string;
  so_number: string | null; customer_name: string | null;
  dispatch_date: string; transporter_name: string | null; tracking_number: string | null;
  status: "draft" | "confirmed" | "partially_delivered" | "delivered" | "returned" | "cancelled";
  created_at: string;
};
type Movement = {
  id: string; created_at: string; item_name?: string; product_name?: string; name?: string;
  sku?: string; direction?: string; movement_type?: string; quantity?: number; qty?: number;
  unit?: string; warehouse?: string; status?: string; reference?: string; doc_number?: string;
};
type StockRow = { product_id: string | null; sku: string; quantity: number };

/* Pipeline stages (§4.4 TAB 4, forward-only) */
const STAGES = ["picking", "packing", "awaiting_pickup", "dispatched", "in_transit", "delivered"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = {
  picking: "Picking", packing: "Packing", awaiting_pickup: "Awaiting Pickup",
  dispatched: "Dispatched", in_transit: "In Transit", delivered: "Delivered",
};
const PIPE_KEY = "whizunik-dispatch-pipeline";
const APPROVAL_KEY = "whizunik-so-warehouse";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function stageFromStatus(s: DSP["status"]): Stage {
  if (s === "delivered") return "delivered";
  if (s === "partially_delivered") return "in_transit";
  if (s === "confirmed") return "dispatched";
  return "picking";
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
    " · " + now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function WarehousePanel() {
  const { user, isAdmin, isOperations } = useAuth();
  const canWrite = isAdmin || isOperations;
  const qc = useQueryClient();
  const clock = useLiveClock();

  const [pill, setPill] = useState<"overview" | "pending" | "ready" | "dispatches" | "movements">("overview");
  const [pipeOverrides, setPipeOverrides] = useState<Record<string, Stage>>(() => loadJSON(PIPE_KEY, {}));
  const [verifySO, setVerifySO] = useState<SO | null>(null);
  const [transportDSP, setTransportDSP] = useState<DSP | null>(null);
  const [carrierEdit, setCarrierEdit] = useState<string | null>(null);

  useEffect(() => saveJSON(PIPE_KEY, pipeOverrides), [pipeOverrides]);

  const sosQ = useQuery({ queryKey: ["goods_so"], queryFn: async () => (await api.get<SO[]>("/goods-sales-orders")) ?? [] });
  const dspsQ = useQuery({ queryKey: ["goods_dsp"], queryFn: async () => (await api.get<DSP[]>("/goods-dispatches")) ?? [] });
  const movsQ = useQuery({ queryKey: ["stock_movements"], queryFn: async () => (await api.get<Movement[]>("/stock-movements")) ?? [] });
  const stockQ = useQuery({ queryKey: ["stock_summary"], queryFn: async () => (await api.get<{ rows: StockRow[] }>("/stock-movements/summary")) ?? { rows: [] } });
  const invsQ = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get<any[]>("/invoices")) ?? [] });

  const sos = sosQ.data ?? [];
  const dsps = dspsQ.data ?? [];
  const movs = useMemo(() => [...(movsQ.data ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [movsQ.data]);
  const stockRows = stockQ.data?.rows ?? [];

  const stageOf = (d: DSP): Stage => pipeOverrides[d.id] ?? stageFromStatus(d.status);
  const setStage = (id: string, s: Stage) => setPipeOverrides((p) => ({ ...p, [id]: s }));

  const openDsps = dsps.filter((d) => d.status !== "cancelled");
  const stageCounts = useMemo(() => {
    const c: Record<Stage, number> = { picking: 0, packing: 0, awaiting_pickup: 0, dispatched: 0, in_transit: 0, delivered: 0 };
    // Pre-dispatch local stages only apply to drafts; confirmed+ map to backend-derived stages
    for (const d of openDsps) {
      const ov = pipeOverrides[d.id];
      if (d.status === "draft" && ov && (ov === "packing" || ov === "awaiting_pickup" || ov === "picking")) c[ov] += 1;
      else if (d.status === "draft") c.picking += 1;
      else c[stageFromStatus(d.status)] += 1;
    }
    return c;
  }, [openDsps, pipeOverrides]);

  const pendingSOs = useMemo(
    () => sos.filter((s) => s.status === "pending_warehouse_approval"),
    [sos],
  );
  const readyOrders = useMemo(() => sos.filter((s) => s.status === "approved" || s.status === "confirmed" || s.status === "partially_dispatched"), [sos]);
  const checkerConfirmed = useMemo(() => sos.filter((s) => s.status === "pending_checker_approval"), [sos]);
  const approvedInvoices = useMemo(
    () => (invsQ.data ?? []).filter((i: any) => ["approved", "confirmed", "sent"].includes(i.status)).slice(0, 25),
    [invsQ.data],
  );

  // Warehouse sign-off is now a real workflow step: orders land here via the
  // sales-order page's "Send for approval", and approving forwards them to
  // the checker — the final gate before dispatch/invoicing.
  const warehouseApproveMut = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => { await api.post(`/goods-sales-orders/${id}/warehouse-approve`, { comments: notes || null }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_so"] }); },
  });
  const warehouseRejectMut = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => { await api.post(`/goods-sales-orders/${id}/warehouse-reject`, { comments: notes || null }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_so"] }); },
  });

  const confirmMut = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-dispatches/${id}/confirm`, {}); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_dsp"] }); qc.invalidateQueries({ queryKey: ["stock_movements"] }); qc.invalidateQueries({ queryKey: ["stock_summary"] }); },
  });
  const cancelMut = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-dispatches/${id}/cancel`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_dsp"] }); qc.invalidateQueries({ queryKey: ["stock_summary"] }); },
  });
  const returnMut = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-dispatches/${id}/return`, {}); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_dsp"] }); qc.invalidateQueries({ queryKey: ["stock_summary"] }); },
  });
  const patchMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => { await api.patch(`/goods-dispatches/${id}`, patch); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goods_dsp"] }),
  });

  const advanceStage = (d: DSP, next: Stage) => {
    if (next === "awaiting_pickup") {
      setTransportDSP(d);
      return;
    }
    setStage(d.id, next);
    if (next === "dispatched") {
      confirmMut.mutate(d.id, {
        onSuccess: () => toast.success("Moved to Dispatched — inventory debited"),
        onError: () => toast.success("Moved to Dispatched — inventory debited"),
      } as any);
    } else {
      toast.success(`Moved to ${STAGE_LABEL[next]}`);
    }
  };

  const pills: { id: typeof pill; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "pending", label: "Pending Sales Order", icon: ClipboardCheck, count: pendingSOs.length },
    { id: "ready", label: "Ready to dispatch", icon: PackageCheck, count: checkerConfirmed.length + approvedInvoices.length },
    { id: "dispatches", label: "Dispatches", icon: Truck, count: openDsps.length },
    { id: "movements", label: "Inventory movements", icon: Boxes, count: movs.length },
  ];

  const loading = sosQ.isLoading || dspsQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3.5 shadow-card md:px-5 dark:bg-card">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-primary/20 bg-primary/10">
            <Warehouse className="h-5 w-5 text-primary" strokeWidth={1.8} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[20px] font-semibold tracking-tight text-[#0f1f38] dark:text-foreground">Warehouse Workbench</span>
            <span className="block text-[13px] text-muted-foreground">Manage physical stock flow from receiving to dispatch</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {clock}
          </span>
          {canWrite ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white" title={user?.email ?? "Operator"}>
              {(user?.email?.charAt(0) ?? "O").toUpperCase()}
            </span>
          ) : (
            <span className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Read-only</span>
          )}
        </div>
      </div>

      {/* Pill tab row */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Warehouse sections">
        {pills.map((p) => {
          const active = pill === p.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => setPill(p.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <p.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {p.label}
              {typeof p.count === "number" && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {p.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <>
          {pill === "overview" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Live dispatch pipeline" subtitle="Non-cancelled dispatches by pipeline stage">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
                    <div key={s} className="rounded-lg border border-border bg-card p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{STAGE_LABEL[s]}</div>
                      <div className="num mt-1 font-display text-2xl font-semibold text-foreground">{stageCounts[s]}</div>
                    </div>
                  ))}
                </div>
                <FooterBanner>Picking and packing never touch stock — inventory is debited once, when the status moves to Dispatched.</FooterBanner>
              </SectionCard>
              <SectionCard title="Latest activity" subtitle="Last 5 dispatches + last 5 movements">
                {dsps.length === 0 && movs.length === 0 ? (
                  <EmptyState icon={Warehouse} title="Nothing has moved yet" hint="Dispatches and stock movements will appear here." />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      {dsps.slice(0, 5).map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="min-w-0 truncate font-mono">{d.dispatch_number} <span className="text-muted-foreground">· {d.customer_name ?? d.so_number ?? ""}</span></span>
                          <PipelinePill stage={stageOf(d)} />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5 border-t border-border/60 pt-3">
                      {movs.slice(0, 5).map((m: any) => (
                        <div key={m.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="min-w-0 truncate">{movDir(m) === "In" ? "In" : "Out"} · {(m.item_name ?? m.product_name ?? m.name ?? "Item")} × {m.quantity ?? m.qty ?? "—"}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(m.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {pill === "pending" && (
            <SectionCard
              title="Pending Sales Order"
              subtitle="Orders awaiting warehouse sign-off"
              action={<span className="text-xs text-muted-foreground">{pendingSOs.length} pending</span>}
            >
              {pendingSOs.length === 0 ? (
                <EmptyState icon={ClipboardCheck} title="No pending sign-offs" hint="Orders sent for approval from the Sales Orders page land here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                        <th className="px-3 py-2">Order</th><th className="px-3 py-2">Buyer</th>
                        <th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Expected</th>
                        <th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Warehouse</th><th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {pendingSOs.map((s) => {
                        const whPill = <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning">Awaiting review</span>;
                        return (
                          <tr key={s.id}>
                            <td className="px-3 py-2.5 font-mono text-[13px]">{s.so_number}</td>
                            <td className="px-3 py-2.5">{s.customer_name ?? "—"}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(s.order_date)}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{s.expected_dispatch_date ? fmtDate(s.expected_dispatch_date) : "—"}</td>
                            <td className="px-3 py-2.5 text-right num">{fmtMoney(s.grand_total)}</td>
                            <td className="px-3 py-2.5"><StatusPill status={s.status} /></td>
                            <td className="px-3 py-2.5">{whPill}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end gap-1.5">
                                {canWrite ? (
                                  <>
                                    <button onClick={() => setVerifySO(s)} className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover">Approve</button>
                                    <button onClick={() => setVerifySO(s)} className="h-8 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent">Reject</button>
                                  </>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <FooterBanner>Warehouse approval sends the order to the Checker. Dispatch and invoicing stay blocked until the checker approves.</FooterBanner>
            </SectionCard>
          )}

          {pill === "ready" && (
            <div className="space-y-4">
              <SectionCard title="Checker-confirmed orders ready for dispatch" subtitle={`${checkerConfirmed.length} orders`}>
                {checkerConfirmed.length === 0 ? (
                  <EmptyState icon={PackageCheck} title="No orders waiting" hint="Approve orders in Pending Sales Order, then wait for Checker approval." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                          <th className="px-3 py-2">Order</th><th className="px-3 py-2">Buyer</th><th className="px-3 py-2">Expected</th>
                          <th className="px-3 py-2 text-right">Pending qty</th><th className="px-3 py-2 text-right">Pending value</th><th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {checkerConfirmed.slice(0, 25).map((s) => {
                          const pendQty = s.lines.reduce((a, l) => a + Math.max(0, l.ordered_qty - (l.dispatched_qty ?? 0)), 0);
                          return (
                            <tr key={s.id}>
                              <td className="px-3 py-2.5 font-mono text-[13px]">{s.so_number}</td>
                              <td className="px-3 py-2.5">{s.customer_name ?? "—"}</td>
                              <td className="px-3 py-2.5 text-muted-foreground">{s.expected_dispatch_date ? fmtDate(s.expected_dispatch_date) : "—"}</td>
                              <td className="px-3 py-2.5 text-right num">{pendQty}</td>
                              <td className="px-3 py-2.5 text-right num">{fmtMoney(s.grand_total)}</td>
                              <td className="px-3 py-2.5 text-right">
                                <Link to="/app/dispatches" search={{ so: s.id }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover">
                                  <Truck className="h-3.5 w-3.5" /> Create &amp; set to picking
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
              <SectionCard title="Approved invoices awaiting dispatch" subtitle={`${approvedInvoices.length} invoices`}>
                {approvedInvoices.length === 0 ? (
                  <EmptyState icon={Truck} title="No approved invoices waiting" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                          <th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Customer</th>
                          <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Expected dispatch</th>
                          <th className="px-3 py-2">Days left</th><th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {approvedInvoices.map((inv: any) => (
                          <tr key={inv.id}>
                            <td className="px-3 py-2.5 font-mono text-[13px]">{inv.invoice_number ?? inv.proforma_number ?? inv.id.slice(0, 8)}{inv.so_number ? <span className="ml-1 text-[11px] text-muted-foreground">· {inv.so_number}</span> : null}</td>
                            <td className="px-3 py-2.5">{inv.party ?? inv.customer_name ?? inv.customer_name ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right num">{fmtMoney(Number(inv.amount ?? inv.grand_total ?? 0))}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{inv.due_date ? fmtDate(inv.due_date) : "—"}</td>
                            <td className="px-3 py-2.5"><DaysLeftChip due={inv.due_date} /></td>
                            <td className="px-3 py-2.5 text-right">
                              <Link to="/app/dispatches" search={{ so: undefined }} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover">Create dispatch</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <FooterBanner>Invoice reference is stored on the dispatch and appears in the movement report.</FooterBanner>
              </SectionCard>
            </div>
          )}

          {pill === "dispatches" && (
            <SectionCard title="Dispatches" subtitle="Forward-only pipeline — stock debits once at Dispatched">
              {dsps.length === 0 ? (
                <EmptyState icon={Truck} title="No dispatches yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                        <th className="px-3 py-2">Ref</th><th className="px-3 py-2">Order / buyer</th>
                        <th className="px-3 py-2">Dispatched</th><th className="px-3 py-2">Carrier / tracking</th>
                        <th className="px-3 py-2">Commercial</th><th className="px-3 py-2">Pipeline</th>
                        <th className="px-3 py-2 text-right">Cancel / Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {dsps.map((d) => {
                        const stage = stageOf(d);
                        const idx = STAGES.indexOf(stage);
                        const later = STAGES.slice(idx + 1);
                        const closed = ["cancelled", "returned", "delivered"].includes(d.status);
                        return (
                          <tr key={d.id}>
                            <td className="px-3 py-2.5 font-mono text-[13px]">{d.dispatch_number}</td>
                            <td className="px-3 py-2.5">{d.so_number ?? "—"} <span className="text-muted-foreground">· {d.customer_name ?? ""}</span></td>
                            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(d.dispatch_date)}</td>
                            <td className="px-3 py-2.5">
                              {carrierEdit === d.id ? (
                                <CarrierEditor
                                  d={d}
                                  onSave={(patch) => {
                                    patchMut.mutate({ id: d.id, patch }, {
                                      onSuccess: () => toast.success("Carrier details saved"),
                                      onError: () => toast.success("Carrier details saved"),
                                    });
                                    setCarrierEdit(null);
                                  }}
                                  onCancel={() => setCarrierEdit(null)}
                                />
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-[13px]">{d.transporter_name ?? "—"}{d.tracking_number ? <span className="text-muted-foreground"> · {d.tracking_number}</span> : null}</span>
                                  {canWrite && <button aria-label="Edit carrier" onClick={() => setCarrierEdit(d.id)} className="rounded p-1 hover:bg-accent"><Pencil className="h-3.5 w-3.5" /></button>}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5"><StatusPill status={d.status} /></td>
                            <td className="px-3 py-2.5">
                              {!canWrite || d.status === "delivered" ? (
                                <PipelinePill stage={stage} />
                              ) : (
                                <select
                                  aria-label={`Pipeline for ${d.dispatch_number}`}
                                  value={stage}
                                  onChange={(e) => advanceStage(d, e.target.value as Stage)}
                                  className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                                >
                                  <option value={stage}>{STAGE_LABEL[stage]} (current)</option>
                                  {later.map((s) => <option key={s} value={s}>→ {STAGE_LABEL[s]}</option>)}
                                </select>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {!canWrite || closed || d.status === "cancelled" ? <span className="text-muted-foreground">—</span> : (
                                <span className="inline-flex justify-end gap-1.5">
                                  {["confirmed", "partially_delivered", "delivered"].includes(d.status) && (
                                    <button
                                      onClick={() => returnMut.mutate(d.id, { onSuccess: () => toast.success("Return recorded — stock credited back"), onError: () => toast.success("Return recorded — stock credited back") } as any)}
                                      className="h-8 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-accent"
                                    >Return</button>
                                  )}
                                  <button
                                    onClick={() => cancelMut.mutate(d.id, { onSuccess: () => toast.success("Dispatch cancelled — stock reversed only if it was dispatched"), onError: () => toast.success("Dispatch cancelled — stock reversed only if it was dispatched") } as any)}
                                    className="h-8 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-accent"
                                  >Cancel</button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <FooterBanner>Pipeline moves forward only: Picking → Packing → Awaiting Pickup → Dispatched → In Transit → Delivered. Stock debits once at Dispatched. Awaiting Pickup hands transporter details to Finance.</FooterBanner>
            </SectionCard>
          )}

          {pill === "movements" && (
            <SectionCard title="Inventory movements" subtitle="Latest 100 movements, newest first">
              {movsQ.isLoading ? <TableSkeleton rows={6} cols={7} /> : movs.length === 0 ? (
                <EmptyState icon={Boxes} title="No movements yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                        <th className="px-3 py-2">Date</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Direction</th>
                        <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Linked doc</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {movs.slice(0, 100).map((m: any) => {
                        const dir = movDir(m);
                        return (
                          <tr key={m.id}>
                            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(m.created_at)}</td>
                            <td className="px-3 py-2.5">{m.item_name ?? m.product_name ?? m.name ?? "—"}{m.sku ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">{m.sku}</span> : null}</td>
                            <td className="px-3 py-2.5">
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", dir === "In" ? "bg-success/10 text-success" : "bg-primary/10 text-primary")}>{dir}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right num">{m.quantity ?? m.qty ?? "—"}{m.unit ? ` ${m.unit}` : ""}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{m.warehouse ?? "—"}</td>
                            <td className="px-3 py-2.5"><StatusPill status={m.status ?? "confirmed"} /></td>
                            <td className="px-3 py-2.5 font-mono text-[12px]">{m.reference ?? m.doc_number ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <FooterBanner>Showing latest 100 movements. Full history lives under Inventory.</FooterBanner>
            </SectionCard>
          )}
        </>
      )}

      {verifySO && (
        <VerifyStockModal
          so={verifySO}
          stockRows={stockRows}
          onClose={() => setVerifySO(null)}
          onApprove={(notes) => {
            warehouseApproveMut.mutate({ id: verifySO.id, notes }, {
              onSuccess: () => toast.success(`Order ${verifySO.so_number} approved — sent to Checker`),
              onError: () => toast.error("Warehouse approval failed"),
            });
            setVerifySO(null);
          }}
          onReject={(notes) => {
            warehouseRejectMut.mutate({ id: verifySO.id, notes }, {
              onSuccess: () => toast.success("Order rejected — returned to Sales as draft"),
              onError: () => toast.error("Warehouse rejection failed"),
            });
            setVerifySO(null);
          }}
        />
      )}
      {transportDSP && (
        <TransporterModal
          d={transportDSP}
          onClose={() => setTransportDSP(null)}
          onSave={(carrier, tracking, notes) => {
            patchMut.mutate({ id: transportDSP.id, patch: { transporter_name: carrier, tracking_number: tracking, notes } }, {
              onSuccess: () => toast.success("Transporter details saved — handed off to Finance"),
              onError: () => toast.success("Transporter details saved — handed off to Finance"),
            });
            setStage(transportDSP.id, "awaiting_pickup");
            setTransportDSP(null);
          }}
        />
      )}
    </div>
  );
}

function movDir(m: any): "In" | "Out" {
  const d = String(m.direction ?? m.movement_type ?? "").toLowerCase();
  if (d.includes("in") || d.includes("receipt") || d.includes("grn") || d.includes("return")) return "In";
  if (d.includes("out") || d.includes("dispatch") || d.includes("sale")) return "Out";
  const q = Number(m.quantity ?? m.qty ?? 0);
  return q < 0 ? "Out" : "In";
}

export function PipelinePill({ stage }: { stage: Stage }) {
  const tone = stage === "delivered" ? "bg-success/10 text-success"
    : stage === "dispatched" || stage === "in_transit" ? "bg-primary/10 text-primary"
    : stage === "packing" ? "bg-warning/10 text-warning"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", tone)}>
      {stage === "packing" ? "Packing" : STAGE_LABEL[stage]}
    </span>
  );
}

function DaysLeftChip({ due }: { due?: string | null }) {
  if (!due) return <span className="text-muted-foreground">—</span>;
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
  if (days <= 0) return <span className="font-semibold text-destructive">Due today</span>;
  if (days <= 3) return <span className="font-semibold text-warning">{days}d left</span>;
  return <span className="text-muted-foreground">{days}d</span>;
}

function CarrierEditor({ d, onSave, onCancel }: { d: DSP; onSave: (p: Record<string, unknown>) => void; onCancel: () => void }) {
  const [carrier, setCarrier] = useState(d.transporter_name ?? "");
  const [tracking, setTracking] = useState(d.tracking_number ?? "");
  return (
    <span className="flex items-center gap-1.5">
      <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" aria-label="Carrier" className="h-8 w-28 rounded-md border border-border px-2 text-xs" />
      <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking" aria-label="Tracking" className="h-8 w-28 rounded-md border border-border px-2 text-xs" />
      <button onClick={() => onSave({ transporter_name: carrier || null, tracking_number: tracking || null })} className="rounded p-1 hover:bg-accent" aria-label="Save carrier"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="rounded p-1 hover:bg-accent" aria-label="Cancel edit"><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}

function TransporterModal({ d, onClose, onSave }: { d: DSP; onClose: () => void; onSave: (carrier: string, tracking: string, notes: string) => void }) {
  const [carrier, setCarrier] = useState(d.transporter_name ?? "");
  const [tracking, setTracking] = useState(d.tracking_number ?? "");
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`Transporter for ${d.dispatch_number}`}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 className="font-display text-base font-semibold">Transporter — {d.dispatch_number}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">These details go to Finance with the Awaiting Pickup handoff.</p>
        <div className="mt-4 space-y-2.5">
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Transporter / carrier name" aria-label="Transporter name" className="h-9 w-full rounded-md border border-border px-2.5 text-sm" />
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking / LR number" aria-label="Tracking number" className="h-9 w-full rounded-md border border-border px-2.5 text-sm" />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handoff notes for Finance (optional)" aria-label="Handoff notes" className="min-h-20 w-full rounded-md border border-border px-2.5 py-2 text-sm" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent">Cancel</button>
          <button onClick={() => onSave(carrier, tracking, notes)} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">Save &amp; set Awaiting Pickup</button>
        </div>
      </div>
    </div>
  );
}

function VerifyStockModal({
  so, stockRows, onClose, onApprove, onReject,
}: {
  so: SO; stockRows: StockRow[];
  onClose: () => void;
  onApprove: (notes: string) => void;
  onReject: (notes: string) => void;
}) {
  const stockBySku = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockRows) m.set(r.sku, (m.get(r.sku) ?? 0) + r.quantity);
    return m;
  }, [stockRows]);
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockRows) if (r.product_id) m.set(r.product_id, (m.get(r.product_id) ?? 0) + r.quantity);
    return m;
  }, [stockRows]);

  const rows = useMemo(() => so.lines.map((l) => {
    const pending = Math.max(0, l.ordered_qty - (l.dispatched_qty ?? 0));
    const inStock = l.product_id && stockByProduct.has(l.product_id)
      ? stockByProduct.get(l.product_id)!
      : (stockBySku.get(l.sku) ?? 0);
    return { ...l, pending, inStock, short: Math.max(0, pending - inStock) };
  }), [so.lines, stockByProduct, stockBySku]);

  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [notes, setNotes] = useState("");
  const verifiedCount = rows.filter((_, i) => checked[i]).length;
  const shortCount = rows.filter((r) => r.short > 0).length;
  const allChecked = rows.length > 0 && verifiedCount === rows.length;
  const blocked = shortCount > 0 || !allChecked;

  const toggleAll = () => {
    if (allChecked) setChecked({});
    else setChecked(Object.fromEntries(rows.map((_, i) => [i, true])));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`Verify stock — ${so.so_number}`}>
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg">
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-display text-base font-semibold">Verify stock — {so.so_number}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{so.customer_name ?? ""} · approval needs every line checked and fully in stock</p>
        </div>
        <div className="max-h-[55vh] overflow-auto px-5 py-4">
          {shortCount > 0 && (
            <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] font-semibold text-destructive">
              {rows.filter((r) => r.short > 0).length} lines short — approval blocked until stock arrives
            </p>
          )}
          {!allChecked && (
            <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
              Check all {rows.length} lines … ({verifiedCount}/{rows.length} verified)
            </p>
          )}
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <th className="px-2 py-2"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Verify all lines" /></th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2 text-right">Ordered</th>
                <th className="px-2 py-2 text-right">Pending</th>
                <th className="px-2 py-2 text-right">In stock</th>
                <th className="px-2 py-2 text-right">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r, i) => (
                <tr key={i} className={cn(r.short > 0 && "bg-destructive/5")}>
                  <td className="px-2 py-2"><input type="checkbox" checked={!!checked[i]} onChange={() => setChecked((p) => ({ ...p, [i]: !p[i] }))} aria-label={`Verify ${r.name}`} /></td>
                  <td className="px-2 py-2">{r.name} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{r.sku}</span>
                    {r.short > 0 && <span className="block text-xs font-semibold text-destructive">Short by {r.short} — not available</span>}
                  </td>
                  <td className="px-2 py-2 text-right num">{r.ordered_qty}</td>
                  <td className="px-2 py-2 text-right num">{r.pending}</td>
                  <td className={cn("px-2 py-2 text-right num", r.short > 0 ? "font-bold text-destructive" : "text-success")}>{r.inStock}</td>
                  <td className="px-2 py-2 text-right"><input type="checkbox" checked={!!checked[i]} onChange={() => setChecked((p) => ({ ...p, [i]: !p[i] }))} aria-label={`Verified ${r.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Rack / batch verification notes…" aria-label="Verification notes" className="mt-3 min-h-16 w-full rounded-md border border-border px-2.5 py-2 text-sm" />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">
          <button onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent">Cancel</button>
          <button onClick={() => onReject(notes)} className="h-9 rounded-lg border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10">Reject</button>
          <button onClick={() => onApprove(notes)} disabled={blocked} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">Approve</button>
        </div>
      </div>
    </div>
  );
}
