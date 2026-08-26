import { createFileRoute, Link } from "@tanstack/react-router";
import { FilterBar } from "@/components/ui/filter-bar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Trash2, Link2,
  Upload, Database, CheckCircle2, XCircle, Lock, Package, Boxes,
  Wallet, Pencil, ScanBarcode, ImageIcon, FileDown,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

// ── Types ──

type Movement = {
  id: string;
  movement_number: string | null;
  direction: "in" | "out";
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  reason: string | null;
  warehouse: string | null;
  notes: string | null;
  status: "draft" | "confirmed" | "cancelled";
  is_system: boolean;
  movement_date: string;
  invoice?: { id: string; invoice_number: string } | null;
  purchase?: { id: string; invoice_number: string } | null;
  product?: { id: string; name: string; sku: string; image_url: string | null; reorder_level: number | null } | null;
  linked_document_type?: string | null;
  linked_document_number?: string | null;
  created_at: string;
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

type LiveStockResult = {
  rows: LiveStockRow[];
  totals: { skus: number; units: number; value: number; low_stock: number };
};

type ProductOpt = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit_of_measure: string;
  unit_cost: number;
  status: string;
  image_url: string | null;
};

export const REASON_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  stock_adjustment: "Stock adjustment",
  damage: "Damage",
  samples: "Samples / internal use",
  customer_return: "Customer return",
  supplier_return: "Supplier return",
  goods_receipt: "Goods receipt",
  dispatch: "Dispatch",
  sale: "Sales invoice",
  purchase: "Purchase invoice",
};

const IN_REASONS = ["opening_stock", "stock_adjustment", "customer_return"];
const OUT_REASONS = ["stock_adjustment", "damage", "samples", "supplier_return"];

const STATUS_STYLES: Record<Movement["status"], string> = {
  draft: "border-warning/40 bg-warning/10 text-warning",
  confirmed: "border-success/40 bg-success/10 text-success",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

// ── Page ──

function InventoryPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("stock-movements");
  // The mass import creates catalogue products too, so anyone who can write
  // products (e.g. clients) can bootstrap their catalogue from Excel.
  const canImport = canEdit || canWrite("products");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "confirmed" | "cancelled">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<Movement[]>("/stock-movements")) ?? [],
  });
  const summaryQ = useQuery({
    queryKey: ["stock_summary"],
    queryFn: async () =>
      (await api.get<LiveStockResult>("/stock-movements/summary")) ?? { rows: [], totals: { skus: 0, units: 0, value: 0, low_stock: 0 } },
  });
  const inventoryItemsQ = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => (await api.get<any[]>("/inventory-items")) ?? [],
  });

  const movements = movementsQ.data ?? [];
  const summary = summaryQ.data ?? { rows: [], totals: { skus: 0, units: 0, value: 0, low_stock: 0 } };

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return movements.filter((m) => {
      if (filter !== "all" && m.direction !== filter) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.item_name?.toLowerCase().includes(q) ||
        (m.sku ?? "").toLowerCase().includes(q) ||
        (m.movement_number ?? "").toLowerCase().includes(q) ||
        (m.warehouse ?? "").toLowerCase().includes(q) ||
        (REASON_LABELS[m.reason ?? ""] ?? "").toLowerCase().includes(q) ||
        m.invoice?.invoice_number?.toLowerCase().includes(q) ||
        m.purchase?.invoice_number?.toLowerCase().includes(q)
      );
    });
  }, [movements, filter, statusFilter, searchQuery]);

  const draftCount = useMemo(() => movements.filter((m) => m.status === "draft").length, [movements]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stock-movements/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("Draft removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const confirmMove = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/stock-movements/${id}/confirm`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("Movement confirmed — stock updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/stock-movements/${id}/cancel`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success("Movement cancelled — dropped from live balance");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteTrackingItem = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory-items/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory_items"] }); toast.success("Item removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (m: Movement) => {
    setEditing(m);
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock ledger"
        description="A document never touches stock — only a confirmed movement does. Live stock is always Σ confirmed stock-in − Σ confirmed stock-out; drafts and cancellations never count."
        actions={
          canImport ? (
            <div className="flex gap-2">
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Upload className="h-4 w-4" /> Mass import items
              </button>
              {canEdit && (
                <button onClick={openNew} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  <Plus className="h-4 w-4" /> New movement
                </button>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* ── Stats ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Boxes className="h-4 w-4 text-primary" />} label="Live SKUs" value={String(summary.totals.skus)}
            hint={summary.totals.low_stock > 0 ? `${summary.totals.low_stock} below reorder level` : "All above reorder level"} />
          <StatTile icon={<Package className="h-4 w-4 text-success" />} label="Units in stock" value={String(summary.totals.units)} />
          <StatTile icon={<Wallet className="h-4 w-4 text-muted-foreground" />} label="Inventory value" value={fmtMoney(summary.totals.value)} />
          <StatTile icon={<CheckCircle2 className="h-4 w-4 text-warning" />} label="Drafts awaiting confirm" value={String(draftCount)}
            hint={draftCount > 0 ? "Drafts don't affect stock yet" : "No pending drafts"} />
        </div>

        {/* ── Live stock ── */}
        <Card title="Live stock (derived from confirmed movements)">
          {summaryQ.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : summary.rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No stock on hand. Record a movement and <span className="text-foreground">confirm</span> it to see live balances.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-right font-normal">In stock</th>
                    <th className="px-5 py-2 text-left font-normal">Unit</th>
                    <th className="px-5 py-2 text-right font-normal">Unit cost</th>
                    <th className="px-5 py-2 text-right font-normal">Inventory value</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((b) => {
                    const low = b.reorder_level != null && b.quantity < b.reorder_level;
                    return (
                      <tr key={b.key} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                              {b.image_url ? (
                                <img src={b.image_url} alt={b.item} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <ImageIcon className="h-4 w-4 text-muted-foreground/60" />
                              )}
                            </div>
                            <span className="font-medium">{b.item}</span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs">{b.sku}</td>
                        <td className={`px-5 py-2.5 text-right num font-medium ${b.quantity < 0 ? "text-destructive" : ""}`}>
                          {b.quantity.toLocaleString()}
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">{b.unit}</td>
                        <td className="px-5 py-2.5 text-right num">{fmtMoney(b.unit_cost)}</td>
                        <td className="px-5 py-2.5 text-right num">{fmtMoney(b.inventory_value)}</td>
                        <td className="px-5 py-2.5">
                          {b.reorder_level == null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : low ? (
                            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-warning">Low</span>
                          ) : (
                            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <td className="px-5 py-3 text-xs uppercase tracking-widest text-muted-foreground" colSpan={5}>Total inventory value</td>
                    <td className="px-5 py-3 text-right num">{fmtMoney(summary.totals.value)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* ── Movements ── */}
        <FilterBar
          searchPlaceholder="Search by SKU, item, movement #, reason, warehouse, invoice…"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          statusOptions={[
            { label: "All directions", value: "all" },
            { label: "Stock-in", value: "in" },
            { label: "Stock-out", value: "out" },
          ]}
          statusValue={filter}
          onStatusChange={(v) => setFilter(v as typeof filter)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Status:</span>
          {(["all", "draft", "confirmed", "cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "Any" : s}</button>
          ))}
        </div>

        <Card title="Movement ledger">
          {movementsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No movements match.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Movement</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">Linked to</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className={`border-b border-border/60 hover:bg-muted/30 ${m.status === "cancelled" ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="font-mono text-[11px]">{m.movement_number ?? "—"}</div>
                        {m.warehouse && <div className="text-[10px] text-muted-foreground">{m.warehouse}</div>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(m.movement_date)}</td>
                      <td className="px-5 py-3">
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          m.direction === "in"
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-warning/40 bg-warning/10 text-warning"
                        }`}>
                          {m.direction === "in" ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
                          {m.direction === "in" ? "In" : "Out"}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{REASON_LABELS[m.reason ?? ""] ?? m.reason ?? "—"}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{m.item_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{m.sku || "—"}</div>
                      </td>
                      <td className="px-5 py-3 text-right num">
                        <span className={m.direction === "in" ? "text-success" : "text-warning"}>
                          {m.direction === "in" ? "+" : "−"}{Number(m.quantity).toLocaleString()}
                        </span>
                        <div className="text-[10px] text-muted-foreground">{m.unit}{m.unit_cost != null ? ` · ${fmtMoney(m.unit_cost)}` : ""}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_STYLES[m.status]}`}>
                          {m.status === "confirmed" && <CheckCircle2 className="h-3 w-3" />}
                          {m.status === "cancelled" && <XCircle className="h-3 w-3" />}
                          {m.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {m.invoice ? (
                          <Link to="/app/invoices" search={{ tab: "list", view: m.invoice.id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Link2 className="h-3 w-3" />{m.invoice.invoice_number}
                          </Link>
                        ) : m.purchase ? (
                          <Link to="/app/purchases" search={{ tab: "list", view: m.purchase.id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Link2 className="h-3 w-3" />{m.purchase.invoice_number}
                          </Link>
                        ) : m.linked_document_number ? (
                          <span className="text-xs text-muted-foreground">{m.linked_document_type}: {m.linked_document_number}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && m.is_system ? (
                          <span title="System-created — manage it from its source document" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Lock className="h-3 w-3" /> System
                          </span>
                        ) : canEdit && m.status === "draft" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => confirmMove.mutate(m.id)} disabled={confirmMove.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10">
                              <CheckCircle2 className="h-3 w-3" /> Confirm
                            </button>
                            <button onClick={() => openEdit(m)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => { if (window.confirm(`Delete draft movement ${m.movement_number}?`)) del.mutate(m.id); }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : canEdit && m.status === "confirmed" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openEdit(m)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => { if (window.confirm(`Cancel movement ${m.movement_number}? It will drop out of the live balance.`)) cancel.mutate(m.id); }}
                              className="rounded-md border border-warning/40 px-2 py-1 text-[11px] text-warning hover:bg-warning/10">
                              <XCircle className="h-3 w-3" /> Cancel
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Legacy tracking items (snapshot imports) ── */}
        {inventoryItemsQ.data && inventoryItemsQ.data.length > 0 && (
          <Card title={
            <span className="inline-flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Legacy tracking items ({inventoryItemsQ.data.length})
            </span>
          }>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">Closing Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Unit Cost</th>
                    <th className="px-5 py-2 text-right font-normal">Extended Cost</th>
                    {canEdit && <th className="px-5 py-2 text-right font-normal"></th>}
                  </tr>
                </thead>
                <tbody>
                  {(inventoryItemsQ.data ?? []).map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{i.item}</div>
                        <div className="text-[10px] text-muted-foreground">{i.description || ""}</div>
                      </td>
                      <td className="px-5 py-2.5 text-right num">{Number(i.closing_quantity).toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtMoney(i.unit_cost)}</td>
                      <td className="px-5 py-2.5 text-right num font-medium">{fmtMoney(i.extended_cost)}</td>
                      {canEdit && (
                        <td className="px-5 py-2.5 text-right">
                          <button onClick={() => deleteTrackingItem.mutate(i.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open && <MovementModal initial={editing} onClose={() => { setOpen(false); setEditing(null); }} />}
      {importOpen && <ImportInventoryItemsModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ── Movement create / edit modal ──

function MovementModal({ initial, onClose }: { initial: Movement | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!initial;

  const [form, setForm] = useState({
    direction: (initial?.direction ?? "in") as "in" | "out",
    product_id: initial?.product?.id ?? "",
    item_name: initial?.item_name ?? "",
    sku: initial?.sku ?? "",
    quantity: initial ? String(initial.quantity) : "",
    unit: initial?.unit ?? "piece",
    unit_cost: initial?.unit_cost != null ? String(initial.unit_cost) : "",
    reason: initial?.reason ?? "opening_stock",
    warehouse: initial?.warehouse ?? "",
    notes: initial?.notes ?? "",
    movement_date: initial?.movement_date ?? new Date().toISOString().slice(0, 10),
  });
  const [scanInput, setScanInput] = useState("");

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<ProductOpt[]>("/products")) ?? [],
  });

  const activeProducts = (productsQ.data ?? []).filter((p) => p.status === "active");
  const reasonOptions = form.direction === "in" ? IN_REASONS : OUT_REASONS;
  // Keep the stored reason visible in the select even if it falls outside the
  // current direction's option list (e.g. edited out-of-band).
  const allReasonOptions = form.reason && !reasonOptions.includes(form.reason) ? [form.reason, ...reasonOptions] : reasonOptions;

  const selectProduct = (p: ProductOpt) => {
    setForm((f) => ({
      ...f,
      product_id: p.id,
      item_name: p.name,
      sku: p.sku,
      unit: p.unit_of_measure || f.unit,
      unit_cost: f.unit_cost === "" ? String(p.unit_cost ?? "") : f.unit_cost,
    }));
  };

  const clearProduct = () => {
    setForm((f) => ({ ...f, product_id: "", item_name: "", sku: "", unit: "piece" }));
  };

  const applyScan = (q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const hit = activeProducts.find(
      (p) => p.sku.toLowerCase() === term || (p.barcode ?? "").toLowerCase() === term || p.name.toLowerCase().includes(term),
    );
    if (hit) {
      selectProduct(hit);
      setScanInput("");
      toast.success(`Picked ${hit.name}`);
    } else {
      toast.error("No active product matches that SKU or barcode");
    }
  };

  const create = useMutation({
    mutationFn: async (status: "draft" | "confirmed") => {
      const product = form.product_id ? activeProducts.find((p) => p.id === form.product_id) : undefined;
      const qty = Number(form.quantity);
      if (!product && !form.item_name.trim()) throw new Error("Pick a product or enter an item name");
      if (!form.reason) throw new Error("Select a reason");
      if (!form.quantity || Number.isNaN(qty) || qty <= 0) throw new Error("Quantity must be > 0");

      const payload = {
        direction: form.direction,
        product_id: form.product_id || null,
        item_name: product ? undefined : form.item_name.trim(),
        sku: product ? undefined : form.sku.trim() || null,
        quantity: qty,
        unit: product ? product.unit_of_measure : form.unit.trim() || "unit",
        unit_cost: form.unit_cost.trim() === "" ? null : Number(form.unit_cost),
        reason: form.reason,
        warehouse: form.warehouse.trim() || null,
        notes: form.notes.trim() || null,
        movement_date: form.movement_date,
      };

      if (editing && initial) {
        await api.patch(`/stock-movements/${initial.id}`, payload);
      } else {
        await api.post("/stock-movements", { ...payload, status });
      }
    },
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["stock_summary"] });
      toast.success(editing ? "Movement updated" : status === "confirmed" ? "Movement confirmed — stock updated" : "Draft saved — confirm it to affect stock");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reasonLabel = (r: string) => REASON_LABELS[r] ?? r;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? `Edit movement ${initial?.movement_number ?? ""}` : "New stock movement"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate("draft"); }} className="space-y-4 p-5">
          {/* Direction */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={editing} onClick={() => setForm({ ...form, direction: "in", reason: "opening_stock" })}
              className={`rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${form.direction === "in" ? "border-success bg-success/10 text-success" : "border-border"}`}>
              <ArrowDownToLine className="mr-2 inline h-4 w-4" /> Stock-in (credit)
            </button>
            <button type="button" disabled={editing} onClick={() => setForm({ ...form, direction: "out", reason: "damage" })}
              className={`rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${form.direction === "out" ? "border-warning bg-warning/10 text-warning" : "border-border"}`}>
              <ArrowUpFromLine className="mr-2 inline h-4 w-4" /> Stock-out (debit)
            </button>
          </div>

          {/* Scan + product picker */}
          {!editing && (
            <>
              <L label="Scan barcode / SKU (enter to pick)">
                <div className="relative">
                  <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyScan(scanInput); } }}
                    placeholder="Scan or type a barcode / SKU…"
                    className="inp pl-9 font-mono"
                  />
                </div>
              </L>
              <L label="Catalogue product (optional — snapshots name, SKU & unit)">
                <select className="inp" value={form.product_id} onChange={(e) => {
                  const id = e.target.value;
                  const p = activeProducts.find((x) => x.id === id);
                  if (p) selectProduct(p);
                  else clearProduct();
                }}>
                  <option value="">Free text (no product)</option>
                  {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
              </L>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <L label="Item name *">
              <input required={!form.product_id} disabled={!!form.product_id} className="inp disabled:opacity-60" value={form.item_name}
                onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder={form.product_id ? "From product" : "Widget A"} />
            </L>
            <L label="SKU">
              <input disabled={!!form.product_id} className="inp font-mono disabled:opacity-60" value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={form.product_id ? "From product" : "SKU-…"} />
            </L>
            <L label="Quantity *">
              <input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Positive number, up to 3 decimals (e.g. 10.5)"
                className="inp" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </L>
            <L label="Unit">
              <input disabled={!!form.product_id} className="inp disabled:opacity-60" value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg / box / piece" />
            </L>
            <L label="Reason *">
              <select className="inp" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                {allReasonOptions.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
              </select>
            </L>
            <L label="Unit cost">
              <input type="text" inputMode="decimal" className="inp num" value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} placeholder="0.00" />
            </L>
            <L label="Warehouse">
              <input className="inp" value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="Main / Store A" />
            </L>
            <L label="Date">
              <input required type="date" className="inp" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} />
            </L>
          </div>

          <L label="Notes">
            <textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </L>

          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
            {form.direction === "in" ? "Stock-in adds" : "Stock-out removes"} <strong>{form.quantity || "0"} {form.unit || "unit"}</strong> of {form.item_name || "the item"} — but only once you <strong>confirm</strong>. Drafts never affect stock.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            {!editing && (
              <button type="submit" disabled={create.isPending}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60">
                {create.isPending && create.variables === "draft" && <Loader2 className="h-4 w-4 animate-spin" />}
                Save draft
              </button>
            )}
            <button type="button" disabled={create.isPending}
              onClick={() => create.mutate("confirmed")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && create.variables === "confirmed" && <Loader2 className="h-4 w-4 animate-spin" />}
              <CheckCircle2 className="h-4 w-4" />
              {editing ? "Save changes" : "Save & confirm"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// ── Mass Import Inventory Items Modal (legacy snapshot tracking) ──

interface ImportRow {
  item: string;
  sku: string;
  description: string;
  closing_quantity: number;
  price_sale: number;
  unit_cost: number;
  mrp: number;
}

function ImportInventoryItemsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; products_created: number; products_linked: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    try {
      const wb = XLSX.utils.book_new();
      const headers = ["SKU", "Item", "Description", "Closing Quantity", "Price Sale", "Unit Cost", "MRP"];
      const sampleData = [
        ["WDG-A01", "Widget A", "Standard aluminum widget", 150, 29.99, 18.50, 39.99],
        ["WDG-B02", "Widget B", "Premium titanium widget", 75, 59.99, 32.00, 79.99],
        ["GDG-X10", "Gadget X", "Electronic gadget with battery", 200, 14.99, 8.75, 24.99],
        ["CMP-Y20", "Component Y", "Plastic housing component", 500, 3.50, 1.20, 6.99],
        ["TLS-Z30", "Tool Kit Z", "5-piece tool kit in case", 30, 89.99, 55.00, 129.99],
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
      ws["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, "Inventory Items");
      XLSX.writeFile(wb, "inventory-import-template.xlsx");
      toast.success("Template downloaded");
    } catch {
      toast.error("Failed to download template");
    }
  };

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
          const item = row.item ?? row["Item"] ?? row.Item ?? row["Item Name"] ?? row.item_name ?? row["Product Name"] ?? row.product_name ?? row.productName ?? "";
          const sku = row.sku ?? row.SKU ?? row["SKU"] ?? row["Sku"] ?? row.sku_code ?? row["SKU Code"] ?? "";
          const desc = row.description ?? row["Description"] ?? row.Description ?? row.desc ?? "";
          const cq = Number(row.closing_quantity ?? row["Closing Quantity"] ?? row.closingQty ?? row["Closing Qty"] ?? row.qty ?? row.Qty ?? 0);
          const ps = Number(row.price_sale ?? row["Price Sale"] ?? row.priceSale ?? row["Sale Price"] ?? row.unit_price ?? row["Unit Price"] ?? 0);
          const uc = Number(row.unit_cost ?? row["Unit Cost"] ?? row.unitCost ?? row.cost ?? row.Cost ?? 0);
          const mrp = Number(row.mrp ?? row.MRP ?? row["MRP"] ?? row["Max Retail Price"] ?? row["MRP Price"] ?? row.mrp_price ?? 0);
          return {
            item: String(item).trim(),
            sku: String(sku).trim(),
            description: String(desc).trim(),
            closing_quantity: isNaN(cq) ? 0 : cq,
            price_sale: isNaN(ps) ? 0 : ps,
            unit_cost: isNaN(uc) ? 0 : uc,
            mrp: isNaN(mrp) ? 0 : mrp,
          };
        }).filter((r) => r.item.length > 0);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: SKU, Item, Description, Closing Quantity, Price Sale, Unit Cost, MRP");
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch {
        toast.error("Could not parse the file. Please check the format.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      return await api.post<{ created: number; products_created: number; products_linked: number; errors: Array<{ item: string; error: string }> }>("/inventory-items/batch", {
        items: rows.map((r) => ({
          item: r.item,
          sku: r.sku || null,
          description: r.description || null,
          closing_quantity: r.closing_quantity,
          price_sale: r.price_sale,
          unit_cost: r.unit_cost,
          mrp: r.mrp || null,
        })),
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["forecast-variables"] });
      const errList = (data.errors ?? []).map((e) => `${e.item}: ${e.error}`);
      setResult({
        created: data.created,
        products_created: data.products_created ?? 0,
        products_linked: data.products_linked ?? 0,
        errors: errList,
      });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created} items imported — ${data.products_created ?? 0} catalogue products created`);
      } else {
        toast.success(`${data.created} imported, ${errList.length} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      extendedPrice: acc.extendedPrice + r.closing_quantity * r.price_sale,
      extendedCost: acc.extendedCost + r.closing_quantity * r.unit_cost,
      totalQty: acc.totalQty + r.closing_quantity,
    }), { extendedPrice: 0, extendedCost: 0, totalQty: 0 });
  }, [rows]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <span className="inline-flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              {step === "form" ? "Mass import items" : step === "preview" ? "Preview imported items" : "Import complete"}
            </span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-xs space-y-2">
              <p className="font-medium text-primary">📋 Excel / CSV format</p>
              <p className="text-muted-foreground">Upload a spreadsheet (.xlsx, .xls, .csv, .tsv, .ods) with these columns. Every new SKU automatically becomes a <strong className="text-foreground">product catalogue entry</strong>, and the <strong className="text-foreground">forecasting</strong> page picks it up right away.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { col: "SKU", desc: "Unique code — creates/looks up the catalogue product" },
                  { col: "Item *", desc: "Product name (also the catalogue product name)" },
                  { col: "Description", desc: "Optional description" },
                  { col: "Closing Quantity", desc: "Number of units on hand (>= 0)" },
                  { col: "Price Sale", desc: "Selling price per unit (>= 0, optional)" },
                  { col: "Unit Cost", desc: "Cost per unit (>= 0)" },
                  { col: "MRP", desc: "Maximum retail price per unit (optional)" },
                ].map((f) => (
                  <div key={f.col} className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
                    <code className="font-mono text-primary text-[11px]">{f.col}</code>
                    <span className="text-muted-foreground">— {f.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <L label="Upload Excel / CSV file *">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                    onChange={handleFile}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                  />
                </L>
              </div>
              <div className="flex items-end justify-end">
                <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                  <FileDown className="h-4 w-4" /> Download template
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">{fileName}</span> — {rows.length} rows parsed
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setStep("form"); setRows([]); }} className="rounded-md border border-border px-3 py-1.5 text-xs">Back</button>
                <button onClick={() => batchImport.mutate()} disabled={batchImport.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
                  {batchImport.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import {rows.length} items
                </button>
              </div>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-normal">SKU</th>
                    <th className="px-3 py-2 text-left font-normal">Item</th>
                    <th className="px-3 py-2 text-right font-normal">Qty</th>
                    <th className="px-3 py-2 text-right font-normal">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-normal">MRP</th>
                    <th className="px-3 py-2 text-right font-normal">Ext. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-[11px]">{r.sku || "—"}</td>
                      <td className="px-3 py-2">{r.item}{r.description && <span className="ml-1 text-[10px] text-muted-foreground">— {r.description}</span>}</td>
                      <td className="px-3 py-2 text-right num">{r.closing_quantity.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right num">{fmtMoney(r.unit_cost)}</td>
                      <td className="px-3 py-2 text-right num">{fmtMoney(r.mrp)}</td>
                      <td className="px-3 py-2 text-right num">{fmtMoney(r.closing_quantity * r.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Totals</td>
                    <td className="px-3 py-2 text-right num">{totals.totalQty.toLocaleString()}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right num">{fmtMoney(totals.extendedCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="p-5">
            <div className="mb-4 rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
              <div className="font-medium text-success">✅ {result?.created} items imported</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {result?.products_created ?? 0} catalogue products created · {result?.products_linked ?? 0} linked to existing products
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Forecast snapshots were recomputed — check the <span className="font-medium text-foreground">Forecasting</span> page.</div>
              {result && result.errors.length > 0 && (
                <div className="mt-2 text-xs text-destructive">
                  {result.errors.length} failed:
                  <ul className="mt-1 list-disc pl-5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
