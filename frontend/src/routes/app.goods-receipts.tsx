import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Trash2, CheckCircle2, XCircle, Pencil, ScanBarcode, Truck, Package, FileText,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/goods-receipts")({
  validateSearch: (search: Record<string, unknown>) => ({
    po: typeof search?.po === "string" ? search.po : undefined,
  }),
  component: GoodsReceiptsPage,
});

type GRNLine = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  unit_cost: number;
  gst_rate: number | null;
  line_value: number;
  notes?: string | null;
};

type GRN = {
  id: string;
  receipt_number: string;
  goods_purchase_order_id: string;
  po_number: string | null;
  supplier_name: string | null;
  warehouse: string | null;
  received_date: string;
  challan_number: string | null;
  received_by: string | null;
  notes: string | null;
  lines: GRNLine[];
  purchase_invoice_id: string | null;
  status: "draft" | "confirmed" | "cancelled";
  created_at: string;
};

type POLine = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  unit_price: number;
  gst_rate: number | null;
  received_qty: number;
  line_total: number;
};

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  warehouse: string | null;
  status: string;
  lines: POLine[];
};

const GRN_STATUS: Record<GRN["status"], string> = {
  draft: "border-warning/40 bg-warning/10 text-warning",
  confirmed: "border-success/40 bg-success/10 text-success",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

function GoodsReceiptsPage() {
  const { po: preselectedPo } = Route.useSearch();
  const { isAdmin, isChecker, canWrite } = useAuth();
  const canEdit = canWrite("goods-purchase-orders");
  const canOverride = isAdmin || isChecker;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preselectPo, setPreselectPo] = useState<string | undefined>(preselectedPo);
  const [statusFilter, setStatusFilter] = useState<"all" | GRN["status"]>("all");

  const grnsQ = useQuery({
    queryKey: ["goods_grn"],
    queryFn: async () => (await api.get<GRN[]>("/goods-receipts")) ?? [],
  });

  const grns = grnsQ.data ?? [];
  const filtered = useMemo(
    () => (statusFilter === "all" ? grns : grns.filter((g) => g.status === statusFilter)),
    [grns, statusFilter],
  );

  const confirm = useMutation({
    mutationFn: async ({ id, allow_over_receipt }: { id: string; allow_over_receipt: boolean }) => {
      await api.post(`/goods-receipts/${id}/confirm`, { allow_over_receipt });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_grn"] });
      qc.invalidateQueries({ queryKey: ["goods_po"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("GRN confirmed — stock credited");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-receipts/${id}/cancel`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_grn"] });
      qc.invalidateQueries({ queryKey: ["goods_po"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("GRN cancelled — stock reversed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/goods-receipts/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_grn"] }); toast.success("Draft removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Goods receipts (GRN)"
        description="The ONLY stock-in document. Goods arrive against a sent purchase order — record what you received, accepted and rejected, then confirm to credit stock."
        actions={
          canEdit ? (
            <button onClick={() => { setPreselectPo(undefined); setOpen(true); }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New goods receipt
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "draft", "confirmed", "cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s}</button>
          ))}
        </div>

        <Card title="Goods receipts">
          {grnsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No goods receipts yet. Confirm one to credit stock — a receipt is the only document that creates stock-in.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Receipt</th>
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-right font-normal">Accepted</th>
                    <th className="px-5 py-2 text-right font-normal">Rejected</th>
                    <th className="px-5 py-2 text-right font-normal">Value</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => {
                    const accepted = g.lines.reduce((s, l) => s + l.accepted_qty, 0);
                    const rejected = g.lines.reduce((s, l) => s + l.rejected_qty, 0);
                    const value = g.lines.reduce((s, l) => s + l.line_value, 0);
                    return (
                      <tr key={g.id} className={`border-b border-border/60 hover:bg-muted/30 ${g.status === "cancelled" ? "opacity-60" : ""}`}>
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{g.receipt_number}</div>
                          <div className="text-[10px] text-muted-foreground">{fmtDate(g.received_date)}{g.challan_number ? ` · challan ${g.challan_number}` : ""}</div>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-primary">{g.po_number ?? "—"}</td>
                        <td className="px-5 py-3">{g.supplier_name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num text-success">{accepted.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right num text-destructive">{rejected > 0 ? rejected.toLocaleString() : "—"}</td>
                        <td className="px-5 py-3 text-right num font-medium">{fmtMoney(value)}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${GRN_STATUS[g.status]}`}>{g.status}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canEdit && g.status === "draft" && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => confirm.mutate({ id: g.id, allow_over_receipt: false })} disabled={confirm.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10">
                                <CheckCircle2 className="h-3 w-3" /> Confirm & credit stock
                              </button>
                              {canOverride && (
                                <button
                                  onClick={() => { if (window.confirm(`Over-receipt override on ${g.receipt_number}? Only for quantities beyond the PO.`)) confirm.mutate({ id: g.id, allow_over_receipt: true }); }}
                                  disabled={confirm.isPending}
                                  title="Explicit over-receipt override (checker/admin)"
                                  className="rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                                  Override
                                </button>
                              )}
                              <button onClick={() => { if (window.confirm(`Delete draft ${g.receipt_number}?`)) remove.mutate(g.id); }}
                                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          {canEdit && g.status === "confirmed" && (
                            <button onClick={() => { if (window.confirm(`Cancel ${g.receipt_number}? Stock already credited will be reversed.`)) cancel.mutate(g.id); }}
                              className="inline-flex items-center gap-1 rounded-md border border-warning/40 px-2 py-1 text-[11px] text-warning hover:bg-warning/10">
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
            You are a checker/admin — over-receipt confirmations may be approved with an explicit override.
          </p>
        )}
      </div>

      {open && <NewGRNModal preselectPo={preselectPo} canOverride={canOverride} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── Create GRN modal ──

type LineForm = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  ordered_qty: number;
  already_received: number;
  received_qty: string;
  accepted_qty: string;
  rejected_qty: string;
  unit_cost: string;
  gst_rate: number | null;
};

function NewGRNModal({ preselectPo, canOverride, onClose }: { preselectPo?: string; canOverride: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [poId, setPoId] = useState(preselectPo ?? "");
  const [form, setForm] = useState({
    received_date: new Date().toISOString().slice(0, 10),
    challan_number: "",
    received_by: "",
    warehouse: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineForm[]>([]);
  const [scanInput, setScanInput] = useState("");

  const posQ = useQuery({
    queryKey: ["goods_po"],
    queryFn: async () => (await api.get<PO[]>("/goods-purchase-orders")) ?? [],
  });
  const poDetailQ = useQuery({
    queryKey: ["goods_po_detail", poId],
    queryFn: async () => (await api.get<PO>(`/goods-purchase-orders/${poId}`)) ?? null,
    enabled: !!poId,
  });

  const receivablePos = (posQ.data ?? []).filter((p) => p.status === "sent" || p.status === "partially_received");
  const po = poDetailQ.data;

  const selectPo = (id: string) => {
    setPoId(id);
    setLines([]);
    if (!id) return;
    const full = posQ.data?.find((p) => p.id === id);
    if (full) {
      setForm((f) => ({
        ...f,
        warehouse: f.warehouse || full.warehouse || "",
        received_by: f.received_by || "",
      }));
    }
  };

  // Load lines from the PO whenever the selected PO changes.
  useEffect(() => {
    if (!po) return;
    setLines(
      po.lines.map((l) => ({
        product_id: l.product_id,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        ordered_qty: l.ordered_qty,
        already_received: l.received_qty ?? 0,
        received_qty: "",
        accepted_qty: "",
        rejected_qty: "",
        unit_cost: String(l.unit_price ?? 0),
        gst_rate: l.gst_rate ?? null,
      })),
    );
  }, [po]);

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  // Barcode scan: focus the matching line (by sku or name).
  const applyScan = (q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const idx = lines.findIndex((l) => l.sku.toLowerCase() === term || l.name.toLowerCase().includes(term));
    if (idx >= 0) {
      const el = document.getElementById(`grn-line-${idx}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.querySelector<HTMLElement>("input")?.focus();
      setScanInput("");
      toast.success(`Line "${lines[idx].name}"` );
    } else {
      toast.error("No PO line matches that SKU or name");
    }
  };

  const totals = useMemo(() => {
    const accepted = lines.reduce((s, l) => s + (Number(l.accepted_qty) || 0), 0);
    const rejected = lines.reduce((s, l) => s + (Number(l.rejected_qty) || 0), 0);
    const value = lines.reduce((s, l) => s + (Number(l.accepted_qty) || 0) * (Number(l.unit_cost) || 0), 0);
    return { accepted, rejected, value };
  }, [lines]);

  const create = useMutation({
    mutationFn: async () => {
      if (!poId) throw new Error("Pick a purchase order");
      if (!lines.length) throw new Error("No lines — pick a purchase order first");
      const cleanLines = lines.map((l) => {
        const received = Number(l.received_qty);
        const accepted = Number(l.accepted_qty);
        const rejected = Number(l.rejected_qty);
        if (Number.isNaN(received) || received < 0) throw new Error(`Invalid received qty on "${l.name}"`);
        if (Number.isNaN(accepted) || accepted < 0) throw new Error(`Invalid accepted qty on "${l.name}"`);
        if (Number.isNaN(rejected) || rejected < 0) throw new Error(`Invalid rejected qty on "${l.name}"`);
        if (accepted + rejected > received) throw new Error(`Accepted + rejected exceeds received on "${l.name}"`);
        return {
          product_id: l.product_id,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          ordered_qty: l.ordered_qty,
          received_qty: received,
          accepted_qty: accepted,
          rejected_qty: rejected,
          unit_cost: Number(l.unit_cost) || 0,
          gst_rate: l.gst_rate,
        };
      });
      if (totals.accepted <= 0) throw new Error("Enter an accepted quantity — that's what enters stock");
      await api.post("/goods-receipts", {
        goods_purchase_order_id: poId,
        received_date: form.received_date,
        challan_number: form.challan_number || null,
        received_by: form.received_by || null,
        warehouse: form.warehouse || null,
        notes: form.notes || null,
        lines: cleanLines,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_grn"] });
      qc.invalidateQueries({ queryKey: ["goods_po"] });
      toast.success("Goods receipt drafted — confirm it to credit stock");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New goods receipt (GRN)</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <L label="Purchase order *" full>
              <select className="inp" value={poId} onChange={(e) => selectPo(e.target.value)}>
                <option value="">Pick a sent purchase order…</option>
                {receivablePos.map((p) => (
                  <option key={p.id} value={p.id}>{p.po_number} — {p.supplier_name ?? "supplier"} ({p.status.replace("_", " ")})</option>
                ))}
              </select>
            </L>
            <L label="Received date"><input type="date" required className="inp" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></L>
            <L label="Delivery challan #"><input className="inp" value={form.challan_number} onChange={(e) => setForm({ ...form, challan_number: e.target.value })} /></L>
            <L label="Received by"><input className="inp" value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} placeholder="Who signed the delivery?" /></L>
            <L label="Warehouse"><input className="inp" value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="Main / Store A" /></L>
          </div>

          {poId && po && (
            <>
              <div className="relative">
                <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyScan(scanInput); } }}
                  placeholder="Scan barcode / SKU to jump to the line…"
                  className="inp pl-9 font-mono"
                />
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-normal">Item (ordered / already received)</th>
                      <th className="px-3 py-2 text-right font-normal">Received</th>
                      <th className="px-3 py-2 text-right font-normal">Accepted → stock</th>
                      <th className="px-3 py-2 text-right font-normal">Rejected</th>
                      <th className="px-3 py-2 text-right font-normal">Unit cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} id={`grn-line-${i}`} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {l.sku} · ordered {l.ordered_qty.toLocaleString()} {l.unit} · already {l.already_received.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input type="text" inputMode="decimal" className="inp num w-20" placeholder="0"
                            value={l.received_qty} onChange={(e) => setLine(i, { received_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="text" inputMode="decimal" className="inp num w-20" placeholder="0"
                            value={l.accepted_qty} onChange={(e) => setLine(i, { accepted_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="text" inputMode="decimal" className="inp num w-20" placeholder="0"
                            value={l.rejected_qty} onChange={(e) => setLine(i, { rejected_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="text" inputMode="decimal" className="inp num w-24" value={l.unit_cost}
                            onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                <div className="text-muted-foreground">
                  Accepted <strong className="text-success num">{totals.accepted.toLocaleString()}</strong>
                  {totals.rejected > 0 && <> · Rejected <strong className="text-destructive num">{totals.rejected.toLocaleString()}</strong></>}
                </div>
                <div className="font-display text-lg">{fmtMoney(totals.value)}</div>
              </div>
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
                Only the <strong>accepted</strong> quantity enters stock, and only once this receipt is <strong>confirmed</strong>. Rejected goods are recorded for supplier claims — they never touch the balance.
              </p>
              {canOverride && (
                <p className="text-[11px] text-info">
                  As a checker/admin you can confirm this receipt with an explicit over-receipt override if quantities exceed the PO.
                </p>
              )}
            </>
          )}

          {!poId && (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Pick a purchase order that has been <strong>sent</strong> or is <strong>partially received</strong>. Drafts and unapproved POs cannot receive goods.
            </p>
          )}

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={create.isPending || !poId}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Save draft — confirm later
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
