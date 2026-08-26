import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Trash2, CheckCircle2, XCircle, Pencil, Truck, Package, FileText, Undo2, PackageCheck, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/dispatches")({
  validateSearch: (search: Record<string, unknown>) => ({
    so: typeof search?.so === "string" ? search.so : undefined,
  }),
  component: DispatchesPage,
});

type DSPLine = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  dispatched_qty: number;
  delivered_qty: number;
  returned_qty: number;
  unit_price: number;
  discount_pct: number;
  gst_rate: number | null;
  line_value: number;
  notes?: string | null;
};

type DSP = {
  id: string;
  dispatch_number: string;
  goods_sales_order_id: string;
  so_number: string | null;
  customer_name: string | null;
  contact_person: string | null;
  delivery_address: string | null;
  warehouse: string | null;
  dispatch_date: string;
  transporter_name: string | null;
  tracking_number: string | null;
  delivery_challan_number: string | null;
  notes: string | null;
  lines: DSPLine[];
  delivery_date: string | null;
  status: "draft" | "confirmed" | "partially_delivered" | "delivered" | "returned" | "cancelled";
  created_at: string;
};

type SOLine = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  unit_price: number;
  discount_pct: number;
  gst_rate: number | null;
  dispatched_qty: number;
  line_total: number;
};

type SO = {
  id: string;
  so_number: string;
  customer_name: string | null;
  contact_person: string | null;
  delivery_address: string | null;
  status: string;
  lines: SOLine[];
};

type LiveStockRow = {
  key: string;
  product_id: string | null;
  sku: string;
  item: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  inventory_value: number;
  reorder_level: number | null;
  image_url: string | null;
};

const DSP_STATUS: Record<DSP["status"], string> = {
  draft: "border-warning/40 bg-warning/10 text-warning",
  confirmed: "border-primary/40 bg-primary/10 text-primary",
  partially_delivered: "border-info/40 bg-info/10 text-info",
  delivered: "border-success/40 bg-success/10 text-success",
  returned: "border-warning/40 bg-warning/10 text-warning",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

function DispatchesPage() {
  const { so: preselectedSo } = Route.useSearch();
  const { isAdmin, isChecker, canWrite } = useAuth();
  const canEdit = canWrite("goods-sales-orders");
  const canOverride = isAdmin || isChecker;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preselectSo, setPreselectSo] = useState<string | undefined>(preselectedSo);
  const [statusFilter, setStatusFilter] = useState<"all" | DSP["status"]>("all");
  const [deliverTarget, setDeliverTarget] = useState<DSP | null>(null);
  const [returnTarget, setReturnTarget] = useState<DSP | null>(null);

  const dspsQ = useQuery({
    queryKey: ["goods_dsp"],
    queryFn: async () => (await api.get<DSP[]>("/goods-dispatches")) ?? [],
  });

  const dsps = dspsQ.data ?? [];
  const filtered = useMemo(
    () => (statusFilter === "all" ? dsps : dsps.filter((d) => d.status === statusFilter)),
    [dsps, statusFilter],
  );

  const invalidateStock = () => {
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    qc.invalidateQueries({ queryKey: ["stock_summary"] });
  };

  const confirm = useMutation({
    mutationFn: async ({ id, allow_over_dispatch }: { id: string; allow_over_dispatch: boolean }) => {
      const res = await api.post<{ stock_warning?: string | null }>(`/goods-dispatches/${id}/confirm`, { allow_over_dispatch });
      if (res?.stock_warning) toast.warning(res.stock_warning);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_dsp"] });
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      invalidateStock();
      toast.success("Dispatch confirmed — stock debited");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-dispatches/${id}/cancel`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_dsp"] });
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      invalidateStock();
      toast.success("Dispatch cancelled — stock reversed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/goods-dispatches/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_dsp"] }); toast.success("Draft removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Dispatches"
        description="The ONLY stock-out document. Goods leave against a confirmed sales order — record what you dispatch, then confirm to debit stock. Deliver and return update the dispatch, not the stock."
        actions={
          canEdit ? (
            <button onClick={() => { setPreselectSo(undefined); setOpen(true); }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New dispatch
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "draft", "confirmed", "partially_delivered", "delivered", "returned", "cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s.replace("_", " ")}</button>
          ))}
        </div>

        <Card title="Dispatches">
          {dspsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No dispatches yet. Confirm one to dispatch stock — a dispatch is the only document that reduces inventory.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Dispatch</th>
                    <th className="px-5 py-2 text-left font-normal">SO</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-right font-normal">Dispatched</th>
                    <th className="px-5 py-2 text-right font-normal">Value</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const dispatched = d.lines.reduce((s, l) => s + l.dispatched_qty, 0);
                    const delivered = d.lines.reduce((s, l) => s + l.delivered_qty, 0);
                    const returned = d.lines.reduce((s, l) => s + l.returned_qty, 0);
                    const value = d.lines.reduce((s, l) => s + l.line_value, 0);
                    return (
                      <tr key={d.id} className={`border-b border-border/60 hover:bg-muted/30 ${d.status === "cancelled" || d.status === "returned" ? "opacity-60" : ""}`}>
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{d.dispatch_number}</div>
                          <div className="text-[10px] text-muted-foreground">{fmtDate(d.dispatch_date)}{d.transporter_name ? ` · ${d.transporter_name}` : ""}</div>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-primary">{d.so_number ?? "—"}</td>
                        <td className="px-5 py-3">{d.customer_name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num text-warning">{dispatched.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num font-medium">{fmtMoney(value)}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${DSP_STATUS[d.status]}`}>{d.status.replace("_", " ")}</span>
                          {(delivered > 0 || returned > 0) && (
                            <div className="mt-0.5 text-[9px] text-muted-foreground">
                              {delivered > 0 && <span className="text-success">{delivered.toLocaleString()} delivered</span>}
                              {delivered > 0 && returned > 0 && " · "}
                              {returned > 0 && <span className="text-warning">{returned.toLocaleString()} returned</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canEdit && d.status === "draft" && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => confirm.mutate({ id: d.id, allow_over_dispatch: false })} disabled={confirm.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10">
                                <CheckCircle2 className="h-3 w-3" /> Confirm & dispatch
                              </button>
                              {canOverride && (
                                <button
                                  onClick={() => { if (window.confirm(`Over-dispatch override on ${d.dispatch_number}? Only for quantities beyond the SO.`)) confirm.mutate({ id: d.id, allow_over_dispatch: true }); }}
                                  disabled={confirm.isPending}
                                  title="Explicit over-dispatch override (checker/admin)"
                                  className="rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                                  Override
                                </button>
                              )}
                              <button onClick={() => { if (window.confirm(`Delete draft ${d.dispatch_number}?`)) remove.mutate(d.id); }}
                                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          {(d.status === "confirmed" || d.status === "partially_delivered") && canEdit && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => setDeliverTarget(d)}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
                                <PackageCheck className="h-3 w-3" /> Deliver
                              </button>
                              <button onClick={() => setReturnTarget(d)}
                                className="inline-flex items-center gap-1 rounded-md border border-warning/40 px-2 py-1 text-[11px] text-warning hover:bg-warning/10">
                                <Undo2 className="h-3 w-3" /> Return
                              </button>
                            </div>
                          )}
                          {d.status === "draft" && canEdit && (
                            <button onClick={() => { if (window.confirm(`Cancel draft ${d.dispatch_number}?`)) cancel.mutate(d.id); }}
                              className="ml-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                              <XCircle className="h-3 w-3" />
                            </button>
                          )}
                          {(d.status === "confirmed" || d.status === "partially_delivered") && canEdit && (
                            <button onClick={() => { if (window.confirm(`Cancel ${d.dispatch_number}? Stock already debited will be credited back.`)) cancel.mutate(d.id); }}
                              className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-warning/40 px-2 py-1 text-[11px] text-warning hover:bg-warning/10">
                              <XCircle className="h-3 w-3" /> Cancel & reverse
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {canOverride && (
          <p className="text-[11px] text-muted-foreground">
            You are a checker/admin — over-dispatch confirmations may be approved with an explicit override.
          </p>
        )}
      </div>

      {open && <NewDispatchModal preselectSo={preselectSo} canOverride={canOverride} onClose={() => setOpen(false)} />}
      {deliverTarget && <DeliverModal dsp={deliverTarget} onClose={() => setDeliverTarget(null)} />}
      {returnTarget && <ReturnModal dsp={returnTarget} onClose={() => setReturnTarget(null)} />}
    </div>
  );
}

// ── Create dispatch modal ──

type LineForm = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  already_dispatched: number;
  pending: number;
  dispatched_qty: string;
  unit_price: number;
  discount_pct: number;
  gst_rate: number | null;
};

function NewDispatchModal({ preselectSo, canOverride, onClose }: { preselectSo?: string; canOverride: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [soId, setSoId] = useState(preselectSo ?? "");
  const [form, setForm] = useState({
    dispatch_date: new Date().toISOString().slice(0, 10),
    transporter_name: "",
    tracking_number: "",
    delivery_challan_number: "",
    warehouse: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineForm[]>([]);

  const sosQ = useQuery({
    queryKey: ["goods_so"],
    queryFn: async () => (await api.get<SO[]>("/goods-sales-orders")) ?? [],
  });
  const soDetailQ = useQuery({
    queryKey: ["goods_so_detail", soId],
    queryFn: async () => (await api.get<SO>(`/goods-sales-orders/${soId}`)) ?? null,
    enabled: !!soId,
  });
  const stockQ = useQuery({
    queryKey: ["stock_summary"],
    queryFn: async () => (await api.get<{ rows: LiveStockRow[] }>("/stock-movements/summary")) ?? { rows: [] },
  });

  const dispatchableSos = (sosQ.data ?? []).filter((s) => s.status === "confirmed" || s.status === "partially_dispatched");
  const so = soDetailQ.data;
  const stockRows = stockQ.data?.rows ?? [];

  // Live availability is derived at RENDER time from this map, never snapshot
  // into line state — the summary query may resolve after the SO detail, and a
  // snapshot would silently leave the in-stock column empty (and kill the
  // soft warning) in exactly that ordering.
  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockRows) {
      if (r.product_id) m.set(`p:${r.product_id}`, r.quantity);
      if (r.sku) m.set(`s:${r.sku}`, r.quantity);
    }
    return m;
  }, [stockRows]);

  const availableFor = (l: LineForm): number | null => {
    const v = stockMap.get(l.product_id ? `p:${l.product_id}` : `s:${l.sku}`);
    return v != null ? v : null;
  };

  // Load lines from the SO whenever the selected SO changes.
  useEffect(() => {
    if (!so) return;
    setLines(
      so.lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        ordered_qty: l.ordered_qty,
        already_dispatched: l.dispatched_qty ?? 0,
        pending: Math.max(0, (l.ordered_qty ?? 0) - (l.dispatched_qty ?? 0)),
        dispatched_qty: "",
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        gst_rate: l.gst_rate,
      })),
    );
  }, [so]);

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const totals = useMemo(() => {
    const dispatched = lines.reduce((s, l) => s + (Number(l.dispatched_qty) || 0), 0);
    const value = lines.reduce((s, l) => s + (Number(l.dispatched_qty) || 0) * l.unit_price * (1 - l.discount_pct / 100), 0);
    return { dispatched, value };
  }, [lines]);

  const hasStockWarnings = useMemo(
    () => lines.some((l) => { const a = availableFor(l); return a != null && (Number(l.dispatched_qty) || 0) > a; }),
    [lines, stockMap],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!soId) throw new Error("Pick a sales order");
      if (!lines.length) throw new Error("No lines — pick a sales order first");
      const cleanLines = lines.map((l) => {
        const dispatched = Number(l.dispatched_qty);
        if (Number.isNaN(dispatched) || dispatched <= 0) throw new Error(`Dispatched qty must be > 0 on \"${l.name}\"`);
        if (dispatched > l.pending && !canOverride) throw new Error(`Over-dispatch on \"${l.name}\" (${dispatched} > ${l.pending} pending) — requires checker/admin override`);
        return {
          product_id: l.product_id,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          ordered_qty: l.ordered_qty,
          dispatched_qty: dispatched,
          unit_price: l.unit_price,
          discount_pct: l.discount_pct,
          gst_rate: l.gst_rate,
        };
      });
      if (totals.dispatched <= 0) throw new Error("Enter a dispatched quantity — that's what leaves stock");
      await api.post("/goods-dispatches", {
        goods_sales_order_id: soId,
        dispatch_date: form.dispatch_date,
        transporter_name: form.transporter_name || null,
        tracking_number: form.tracking_number || null,
        delivery_challan_number: form.delivery_challan_number || null,
        warehouse: form.warehouse || null,
        notes: form.notes || null,
        lines: cleanLines,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_dsp"] });
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      toast.success("Dispatch drafted — confirm it to debit stock");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New dispatch note</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <L label="Sales order *" full>
              <select className="inp" value={soId} onChange={(e) => { setSoId(e.target.value); setLines([]); }}>
                <option value="">Pick a confirmed sales order…</option>
                {dispatchableSos.map((s) => (
                  <option key={s.id} value={s.id}>{s.so_number} — {s.customer_name ?? "customer"} ({s.status.replace("_", " ")})</option>
                ))}
              </select>
            </L>
            <L label="Dispatch date"><input type="date" required className="inp" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} /></L>
            <L label="Transporter"><input className="inp" value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} placeholder="Carrier / lorry / courier" /></L>
            <L label="Tracking / AWB"><input className="inp" value={form.tracking_number} onChange={(e) => setForm({ ...form, tracking_number: e.target.value })} /></L>
            <L label="Delivery challan #"><input className="inp" value={form.delivery_challan_number} onChange={(e) => setForm({ ...form, delivery_challan_number: e.target.value })} /></L>
            <L label="Warehouse"><input className="inp" value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="Main / Store A" /></L>
          </div>

          {soId && so && (
            <>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-normal">Item (ordered / pending / in stock)</th>
                      <th className="px-3 py-2 text-right font-normal">Dispatch → stock</th>
                      <th className="px-3 py-2 text-right font-normal">Price</th>
                      <th className="px-3 py-2 text-right font-normal">Disc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {l.sku} · ordered {l.ordered_qty.toLocaleString()} {l.unit} · pending {l.pending.toLocaleString()}
                            {(() => { const a = availableFor(l); return a != null ? (
                              <span className={a < (Number(l.dispatched_qty) || 0) ? " text-destructive" : " text-success"}>
                                {" "}· in stock {a.toLocaleString()}
                              </span>
                            ) : null; })()}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input type="text" inputMode="decimal" className="inp num w-24" placeholder="0"
                            value={l.dispatched_qty} onChange={(e) => setLine(i, { dispatched_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right num">{fmtMoney(l.unit_price)}</td>
                        <td className="px-3 py-2 text-right num">{l.discount_pct > 0 ? `${l.discount_pct}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                <div className="text-muted-foreground">
                  Dispatching <strong className="text-warning num">{totals.dispatched.toLocaleString()}</strong> units
                </div>
                <div className="font-display text-lg">{fmtMoney(totals.value)}</div>
              </div>
              {hasStockWarnings && (
                <p className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Some lines exceed live available stock — stock can go negative. The system warns but does not block.
                </p>
              )}
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
                The <strong>dispatched</strong> quantity leaves stock, and only once this note is <strong>confirmed</strong>. Deliveries and returns update the note — they never touch the balance again.
              </p>
              {canOverride && (
                <p className="text-[11px] text-info">
                  As a checker/admin you can confirm this dispatch with an explicit over-dispatch override if quantities exceed the SO.
                </p>
              )}
            </>
          )}

          {!soId && (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Pick a sales order that has been <strong>confirmed</strong> or is <strong>partially dispatched</strong>. Drafts and cancelled SOs cannot dispatch goods.
            </p>
          )}

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={create.isPending || !soId}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              Save draft — confirm later
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ── Mark delivered modal ──

function DeliverModal({ dsp, onClose }: { dsp: DSP; onClose: () => void }) {
  const qc = useQueryClient();
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState(
    dsp.lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      remaining: Math.max(0, l.dispatched_qty - l.delivered_qty),
      delivered_qty: "",
    })),
  );

  const markDelivered = useMutation({
    mutationFn: async () => {
      const clean = lines.map((l) => {
        const qty = Number(l.delivered_qty);
        if (Number.isNaN(qty) || qty < 0) throw new Error(`Invalid delivered qty on \"${l.name}\"`);
        if (qty > l.remaining) throw new Error(`Delivered qty exceeds remaining on \"${l.name}\" (${l.remaining})`);
        return { sku: l.sku, delivered_qty: qty };
      });
      if (clean.every((c) => c.delivered_qty === 0)) throw new Error("Enter a delivered quantity");
      await api.post(`/goods-dispatches/${dsp.id}/deliver`, { delivery_date: deliveryDate, lines: clean });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_dsp"] });
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      toast.success("Delivery recorded — no stock impact (already debited)");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Mark delivered — <span className="font-mono text-primary">{dsp.dispatch_number}</span></h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); markDelivered.mutate(); }} className="space-y-4 p-5">
          <L label="Delivery date"><input type="date" className="inp" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></L>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Item</th>
                  <th className="px-3 py-2 text-right font-normal">Remaining</th>
                  <th className="px-3 py-2 text-right font-normal">Delivered now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 text-right num text-muted-foreground">{l.remaining.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <input type="text" inputMode="decimal" className="inp num w-24" placeholder="0"
                        value={l.delivered_qty} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, delivered_qty: e.target.value } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">Delivery has no stock impact — goods were already debited at dispatch confirm.</p>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={markDelivered.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {markDelivered.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Record delivery
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Record return modal ──

function ReturnModal({ dsp, onClose }: { dsp: DSP; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState(
    dsp.lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      remaining: Math.max(0, l.dispatched_qty - l.returned_qty),
      returned_qty: "",
    })),
  );

  const recordReturn = useMutation({
    mutationFn: async () => {
      const clean = lines.map((l) => {
        if (l.returned_qty.trim() === "") return { sku: l.sku, returned_qty: null }; // blank = full return
        const qty = Number(l.returned_qty);
        if (Number.isNaN(qty) || qty < 0) throw new Error(`Invalid returned qty on \"${l.name}\"`);
        if (qty > l.remaining) throw new Error(`Returned qty exceeds remaining on \"${l.name}\" (${l.remaining})`);
        return { sku: l.sku, returned_qty: qty };
      });
      await api.post(`/goods-dispatches/${dsp.id}/return`, { lines: clean });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_dsp"] });
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("Return recorded — stock credited back in, dispatch closed");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Record return — <span className="font-mono text-primary">{dsp.dispatch_number}</span></h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); recordReturn.mutate(); }} className="space-y-4 p-5">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Item</th>
                  <th className="px-3 py-2 text-right font-normal">Remaining</th>
                  <th className="px-3 py-2 text-right font-normal">Returned (blank = all)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 text-right num text-muted-foreground">{l.remaining.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <input type="text" inputMode="decimal" className="inp num w-24" placeholder="all"
                        value={l.returned_qty} onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, returned_qty: e.target.value } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
            <Undo2 className="h-3.5 w-3.5 shrink-0" /> Returning credits stock back <strong>in</strong> (reason “Customer return”) and revokes the SO's dispatched qty so it can be re-dispatched. The dispatch closes as <strong>returned</strong>.
          </p>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={recordReturn.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {recordReturn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Record return & credit stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
