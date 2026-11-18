import { createFileRoute } from "@tanstack/react-router";
import { FilterBar } from "@/components/ui/filter-bar";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Trash2, CheckCircle2, Send, Ban, Pencil, Package, Wallet, FileSignature, FileText, Boxes, Link2,
} from "lucide-react";
import { toast } from "sonner";
import { addressOptionsFor, defaultAddressFor } from "@/lib/customerAddresses";

export const Route = createFileRoute("/app/purchase-orders")({
  component: PurchaseOrdersPage,
});

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
  po_date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  bill_to_customer_id: string | null;
  bill_to_customer_name: string | null;
  billing_address: string | null;
  ship_to_customer_id: string | null;
  ship_to_customer_name: string | null;
  shipping_address: string | null;
  warehouse: string | null;
  expected_delivery_date: string | null;
  payment_terms: string | null;
  buyer_name: string | null;
  notes: string | null;
  freight: number | null;
  lines: POLine[];
  subtotal: number;
  gst_total: number;
  grand_total: number;
  manual_status: "draft" | "pending_approval" | "approved" | "sent" | "cancelled";
  status: "draft" | "pending_approval" | "approved" | "sent" | "partially_received" | "fully_received" | "cancelled";
  linked_proforma_id?: string | null;
  linked_proforma_number?: string | null;
  created_at: string;
};

type SupplierOption = { id: string; name: string };
type ProductOpt = { id: string; name: string; sku: string; barcode: string | null; unit_of_measure: string; unit_cost: number; gst_rate: number | null; status: string };

const STATUS_META: Record<PO["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-warning/40 bg-warning/10 text-warning" },
  pending_approval: { label: "Awaiting checker", cls: "border-warning/40 bg-warning/10 text-warning" },
  approved: { label: "Approved", cls: "border-primary/40 bg-primary/10 text-primary" },
  sent: { label: "Sent", cls: "border-primary/40 bg-primary/10 text-primary" },
  partially_received: { label: "Partially received", cls: "border-info/40 bg-info/10 text-info" },
  fully_received: { label: "Fully received", cls: "border-success/40 bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground line-through" },
};

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60", "Advance", "COD", "LC"];
const GST_OPTIONS = ["0", "5", "12", "18", "28"];

export function PurchaseOrdersPage() {
  const { user, canWrite } = useAuth();
  const canEdit = canWrite("goods-purchase-orders");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PO | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | PO["status"]>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"created" | "due">("created");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const posQ = useQuery({
    queryKey: ["goods_po"],
    queryFn: async () => (await api.get<PO[]>("/goods-purchase-orders")) ?? [],
  });

  const pos = posQ.data ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pos
      .filter((po) => {
        if (statusFilter !== "all" && po.status !== statusFilter) return false;
        if (!q) return true;
        return (
          po.po_number.toLowerCase().includes(q) ||
          (po.supplier_name ?? "").toLowerCase().includes(q) ||
          (po.warehouse ?? "").toLowerCase().includes(q) ||
          po.lines.some((l) => l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const aVal = sortField === "created" ? (a.created_at ?? "") : (a.expected_delivery_date ?? "9999");
        const bVal = sortField === "created" ? (b.created_at ?? "") : (b.expected_delivery_date ?? "9999");
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === "asc" ? cmp : -cmp;
      });
  }, [pos, statusFilter, searchQuery, sortField, sortOrder]);

  const stats = useMemo(() => {
    const openValue = pos.filter((p) => p.status === "sent" || p.status === "partially_received").reduce((s, p) => s + p.grand_total, 0);
    return {
      total: pos.length,
      awaiting: pos.filter((p) => p.status === "draft" || p.status === "pending_approval" || p.status === "approved").length,
      openValue,
      received: pos.filter((p) => p.status === "fully_received").length,
    };
  }, [pos]);

  // Maker action: send a draft to the checker. Approval itself happens ONLY
  // on the checker desk — never on this screen.
  const submit = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-purchase-orders/${id}/submit`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_po"] }); toast.success("Purchase order sent to checker for approval"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  // Legacy: POs approved before the maker–checker gate still need a manual send.
  const send = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-purchase-orders/${id}/send`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_po"] }); toast.success("Purchase order marked sent — goods can now be received"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-purchase-orders/${id}/cancel`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_po"] }); toast.success("Purchase order cancelled"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/goods-purchase-orders/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_po"] }); toast.success("Purchase order removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase orders"
        description="A purchase order is a commitment, never a stock event. Create → send to checker → checker approves & sends → receive."
        actions={
          canEdit ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New purchase order
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Package className="h-4 w-4 text-primary" />} label="Total POs" value={String(stats.total)} />
          <StatTile icon={<FileSignature className="h-4 w-4 text-warning" />} label="Awaiting approval" value={String(stats.awaiting)}
            hint={stats.awaiting > 0 ? "Draft or approved — not yet sent" : "None pending"} />
          <StatTile icon={<Wallet className="h-4 w-4 text-muted-foreground" />} label="Open commitment" value={fmtMoney(stats.openValue)} />
          <StatTile icon={<Boxes className="h-4 w-4 text-success" />} label="Fully received" value={String(stats.received)} />
        </div>

        <FilterBar
          searchPlaceholder="Search by PO number, supplier, warehouse, item…"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          statusOptions={[
            { label: "All statuses", value: "all" },
            { label: "Draft", value: "draft" },
            { label: "Awaiting checker", value: "pending_approval" },
            { label: "Approved", value: "approved" },
            { label: "Sent", value: "sent" },
            { label: "Partially received", value: "partially_received" },
            { label: "Fully received", value: "fully_received" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          statusValue={statusFilter}
          onStatusChange={(v) => setStatusFilter(v as typeof statusFilter)}
          sortOptions={[
            { field: "created", label: "Created" },
            { field: "due", label: "Due date" },
          ]}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={(f) => setSortField(f as typeof sortField)}
          onSortOrderChange={(o) => setSortOrder(o)}
        />

        <Card title="Purchase orders">
          {posQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {pos.length === 0 ? "No purchase orders yet. Create one to commit to a supplier." : "No purchase orders match your filters."}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Warehouse</th>
                    <th className="px-5 py-2 text-right font-normal">Units</th>
                    <th className="px-5 py-2 text-right font-normal">Total</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((po) => (
                    <tr key={po.id} className={`border-b border-border/60 hover:bg-muted/30 ${po.status === "cancelled" ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <button onClick={() => setDetail(po)} className="font-mono text-xs text-primary hover:underline">{po.po_number}</button>
                        <div className="text-[10px] text-muted-foreground">{fmtDate(po.po_date)} · {po.lines.length} line{po.lines.length !== 1 ? "s" : ""}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{po.supplier_name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{po.payment_terms ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{po.warehouse ?? "—"}</td>
                      <td className="px-5 py-3 text-right num">{po.lines.reduce((s, l) => s + l.ordered_qty, 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right num font-medium">{fmtMoney(po.grand_total)}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_META[po.status].cls}`}>{STATUS_META[po.status].label}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canEdit && po.status === "draft" && (
                            <button onClick={() => submit.mutate(po.id)} disabled={submit.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
                              <Send className="h-3 w-3" /> Send for approval
                            </button>
                          )}
                          {po.status === "pending_approval" && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 px-2 py-1 text-[11px] text-warning">
                              <CheckCircle2 className="h-3 w-3" /> Awaiting checker
                            </span>
                          )}
                          {canEdit && po.status === "approved" && (
                            <button onClick={() => send.mutate(po.id)} disabled={send.isPending}
                              title="Legacy order approved before the checker gate — mark it sent to unblock receiving"
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
                              <Send className="h-3 w-3" /> Mark sent
                            </button>
                          )}
                          {(po.status === "sent" || po.status === "partially_received") && (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                              Inbound — receive via GRN tab
                            </span>
                          )}
                          {(po.status === "draft" || po.status === "approved" || po.status === "sent") && canEdit && (
                            <button onClick={() => { if (window.confirm(`Cancel ${po.po_number}?`)) cancel.mutate(po.id); }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                              <Ban className="h-3 w-3" />
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={() => { if (window.confirm(`Remove ${po.po_number} regardless of status (${po.status})? This cannot be undone.`)) remove.mutate(po.id); }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                              title={`Remove ${po.po_number} — works on any status`}>
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && <NewPOModal buyerDefault={user?.email ?? ""} onClose={() => setOpen(false)} />}
      {detail && <PODetailModal po={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-2 font-display text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ── Detail modal ──

function PODetailModal({ po, onClose }: { po: PO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <span className="font-mono text-primary">{po.po_number}</span>
            <span className={`ml-2 rounded-full border px-2 py-0.5 align-middle text-[10px] uppercase tracking-wider ${STATUS_META[po.status].cls}`}>{STATUS_META[po.status].label}</span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            {po.linked_proforma_id && (
              <Detail label="From proforma">
                <span className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/5 px-2 py-0.5 text-[10px] text-success">
                  <Link2 className="h-3 w-3" /> {po.linked_proforma_number ?? po.linked_proforma_id}
                </span>
              </Detail>
            )}
            <Detail label="Supplier">{po.supplier_name ?? "—"}</Detail>
            <Detail label="Bill to">{[po.bill_to_customer_name, po.billing_address].filter(Boolean).join(" — ") || "—"}</Detail>
            <Detail label="Ship to">{[po.ship_to_customer_name, po.shipping_address].filter(Boolean).join(" — ") || "—"}</Detail>
            <Detail label="Warehouse">{po.warehouse ?? "—"}</Detail>
            <Detail label="Expected delivery">{po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : "—"}</Detail>
            <Detail label="PO date">{fmtDate(po.po_date)}</Detail>
            <Detail label="Payment terms">{po.payment_terms ?? "—"}</Detail>
            <Detail label="Buyer">{po.buyer_name ?? "—"}</Detail>
          </div>
          {po.notes && <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{po.notes}</p>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Item</th>
                  <th className="px-3 py-2 text-left font-normal">SKU</th>
                  <th className="px-3 py-2 text-right font-normal">Ordered</th>
                  <th className="px-3 py-2 text-right font-normal">Received</th>
                  <th className="px-3 py-2 text-right font-normal whitespace-nowrap">Unit cost</th>
                  <th className="px-3 py-2 text-right font-normal">GST</th>
                  <th className="px-3 py-2 text-right font-normal whitespace-nowrap">Line total</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{l.sku}</td>
                    <td className="px-3 py-2 text-right num whitespace-nowrap">{l.ordered_qty.toLocaleString()} <span className="text-[10px] text-muted-foreground">{l.unit}</span></td>
                    <td className={`px-3 py-2 text-right num whitespace-nowrap ${l.received_qty > 0 ? "text-success" : "text-muted-foreground"}`}>
                      {l.received_qty > 0 ? l.received_qty.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right num whitespace-nowrap" title={String(l.unit_price)}>{fmtMoney(l.unit_price)}</td>
                    <td className="px-3 py-2 text-right num whitespace-nowrap">{l.gst_rate != null ? `${l.gst_rate}%` : "—"}</td>
                    <td className="px-3 py-2 text-right num font-medium whitespace-nowrap" title={String(l.line_total)}>{fmtMoney(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Subtotal</td><td className="px-3 py-2 text-right num">{fmtMoney(po.subtotal)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">GST</td><td className="px-3 py-2 text-right num">{fmtMoney(po.gst_total)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Freight</td><td className="px-3 py-2 text-right num">{fmtMoney(po.freight ?? 0)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-foreground">Grand total</td><td className="px-3 py-2 text-right num text-base">{fmtMoney(po.grand_total)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className="mt-0.5 font-medium">{children}</div></div>;
}

// ── Create modal ──

type LineForm = {
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  ordered_qty: string;
  unit_price: string;
  gst_rate: string;
};

function NewPOModal({ buyerDefault, onClose }: { buyerDefault: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    supplier_id: "",
    bill_to_customer_id: "",
    billing_address: "",
    billing_addr_key: "",
    same_as_billing: true,
    ship_to_customer_id: "",
    shipping_address: "",
    shipping_addr_key: "",
    warehouse: "",
    expected_delivery_date: "",
    payment_terms: "Net 30",
    buyer_name: buyerDefault,
    freight: "",
    notes: "",
    also_create: "none" as "none" | "proforma" | "purchase_invoice",
  });
  const [lines, setLines] = useState<LineForm[]>([{ product_id: "", name: "", sku: "", unit: "piece", ordered_qty: "", unit_price: "", gst_rate: "0" }]);

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<ProductOpt[]>("/products")) ?? [],
  });
  const suppliersQ = useQuery({
    queryKey: ["supplier-options"],
    queryFn: async () => {
      const [suppliers, vendors] = await Promise.all([
        api.get<any[]>("/suppliers").catch(() => []),
        api.get<any[]>("/vendors").catch(() => []),
      ]);
      return [
        ...(suppliers ?? []).map((s) => ({ id: s.id, name: s.company_name })),
        ...(vendors ?? []).map((v) => ({ id: v.id, name: v.name })),
      ].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))) as SupplierOption[];
    },
  });
  const lastPricesQ = useQuery({
    queryKey: ["po_last_prices"],
    queryFn: async () => (await api.get<Record<string, number>>("/goods-purchase-orders/last-prices")) ?? {},
  });
  const customersQ = useQuery({
    queryKey: ["customer-options-po"],
    queryFn: async () => (await api.get<any[]>("/customers")) ?? [],
  });

  const activeProducts = (productsQ.data ?? []).filter((p) => p.status === "active");
  const supplierOptions = suppliersQ.data ?? [];
  const lastPrices = lastPricesQ.data ?? {};
  const customers = customersQ.data ?? [];
  const billCustomer = customers.find((c: any) => c.id === form.bill_to_customer_id);
  const shipCustomer = customers.find((c: any) => c.id === form.ship_to_customer_id);
  const billAddrOpts = addressOptionsFor(billCustomer, "billing");
  const shipAddrOpts = addressOptionsFor(shipCustomer, "shipping");

  const pickBillTo = (id: string) => {
    const c = customers.find((x: any) => x.id === id);
    const addr = c ? defaultAddressFor(c, "billing") : "";
    setForm((f) => ({
      ...f,
      bill_to_customer_id: id,
      billing_address: addr,
      billing_addr_key: "",
      ...(f.same_as_billing
        ? { ship_to_customer_id: id, shipping_address: c ? defaultAddressFor(c, "shipping") : addr, shipping_addr_key: "" }
        : {}),
    }));
  };

  const pickShipTo = (id: string) => {
    const c = customers.find((x: any) => x.id === id);
    setForm((f) => ({
      ...f,
      ship_to_customer_id: id,
      shipping_address: c ? defaultAddressFor(c, "shipping") : "",
      shipping_addr_key: "",
    }));
  };

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = activeProducts.find((x) => x.id === productId);
    if (!p) {
      setLine(i, { product_id: "", name: "", sku: "", unit: "piece", unit_price: "" });
      return;
    }
    const suggested = lastPrices[p.id] ?? p.unit_cost ?? 0;
    setLine(i, {
      product_id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit_of_measure,
      gst_rate: String(p.gst_rate ?? 0),
      unit_price: suggested > 0 ? String(suggested) : "",
    });
  };

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0), 0);
    const gst = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.gst_rate) || 0) / 100, 0);
    const freight = Number(form.freight) || 0;
    return { subtotal, gst, freight, grand: subtotal + gst + freight };
  }, [lines, form.freight]);

  const create = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one line");
      for (const l of lines) {
        if (!l.name.trim()) throw new Error("Every line needs a product or item name");
        if (!l.ordered_qty || Number(l.ordered_qty) <= 0) throw new Error("Ordered qty must be > 0 on every line");
        if (Number(l.unit_price) < 0) throw new Error("Unit price must be >= 0");
      }
      const supplier = supplierOptions.find((s) => s.id === form.supplier_id);
      const shipId = form.same_as_billing ? form.bill_to_customer_id : form.ship_to_customer_id;
      const shipAddr = form.same_as_billing ? form.billing_address : form.shipping_address;
      await api.post("/goods-purchase-orders", {
        supplier_id: form.supplier_id || null,
        supplier_name: supplier?.name ?? null,
        bill_to_customer_id: form.bill_to_customer_id || null,
        billing_address: form.billing_address || null,
        ship_to_customer_id: shipId || null,
        shipping_address: shipAddr || null,
        warehouse: form.warehouse || null,
        expected_delivery_date: form.expected_delivery_date || null,
        payment_terms: form.payment_terms || null,
        buyer_name: form.buyer_name || null,
        freight: form.freight.trim() === "" ? null : Number(form.freight),
        notes: form.notes || null,
        also_create: form.also_create === "none" ? null : form.also_create,
        lines: lines.map((l) => ({
          product_id: l.product_id || null,
          name: l.name.trim(),
          sku: l.sku.trim() || null,
          unit: l.unit.trim() || "unit",
          ordered_qty: Number(l.ordered_qty),
          unit_price: Number(l.unit_price) || 0,
          gst_rate: Number(l.gst_rate),
        })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_po"] });
      qc.invalidateQueries({ queryKey: ["po_last_prices"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      toast.success(form.also_create === "none" ? "Purchase order created" : `Purchase order created with ${form.also_create}`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New purchase order</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
          <Section title="Details">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Supplier" full>
                <select className="inp" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">—</option>
                  {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </L>
              <L label="Warehouse"><input className="inp" value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="Main / Store A" /></L>
              <L label="Expected delivery"><input type="date" className="inp" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} /></L>
              <L label="Payment terms">
                <select className="inp" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
                  {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </L>
              <L label="Buyer"><input className="inp" value={form.buyer_name} onChange={(e) => setForm({ ...form, buyer_name: e.target.value })} /></L>
              <L label="Freight"><input type="text" inputMode="decimal" className="inp num" value={form.freight} onChange={(e) => setForm({ ...form, freight: e.target.value })} /></L>
            </div>
          </Section>

          <Section title="Billing & shipping">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Bill to (customer)">
                <select className="inp" value={form.bill_to_customer_id} onChange={(e) => pickBillTo(e.target.value)}>
                  <option value="">—</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </L>
              <L label="Billing address">
                <select
                  className="inp"
                  value={form.billing_addr_key}
                  disabled={!form.bill_to_customer_id}
                  onChange={(e) => {
                    const opt = billAddrOpts.find((o) => o.key === e.target.value);
                    setForm({ ...form, billing_addr_key: e.target.value, billing_address: opt ? opt.full : form.billing_address });
                  }}
                >
                  <option value="">{billAddrOpts.length ? "Pick a saved address…" : "No saved addresses — type below"}</option>
                  {billAddrOpts.map((o) => <option key={o.key} value={o.key}>{o.label} — {o.full.slice(0, 60)}</option>)}
                </select>
              </L>
              <L label="Billing address (details)" full>
                <input className="inp" value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} placeholder="Fetched from the customer — editable" />
              </L>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.same_as_billing}
                  onChange={(e) => {
                    const same = e.target.checked;
                    setForm((f) => ({
                      ...f,
                      same_as_billing: same,
                      ...(same
                        ? { ship_to_customer_id: f.bill_to_customer_id, shipping_address: f.billing_address, shipping_addr_key: f.billing_addr_key }
                        : {}),
                    }));
                  }}
                />
                Shipping same as billing
              </label>
              {!form.same_as_billing && (
                <>
                  <L label="Ship to (customer)">
                    <select className="inp" value={form.ship_to_customer_id} onChange={(e) => pickShipTo(e.target.value)}>
                      <option value="">—</option>
                      {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </L>
                  <L label="Shipping address">
                    <select
                      className="inp"
                      value={form.shipping_addr_key}
                      disabled={!form.ship_to_customer_id}
                      onChange={(e) => {
                        const opt = shipAddrOpts.find((o) => o.key === e.target.value);
                        setForm({ ...form, shipping_addr_key: e.target.value, shipping_address: opt ? opt.full : form.shipping_address });
                      }}
                    >
                      <option value="">{shipAddrOpts.length ? "Pick a saved address…" : "No saved addresses — type below"}</option>
                      {shipAddrOpts.map((o) => <option key={o.key} value={o.key}>{o.label} — {o.full.slice(0, 60)}</option>)}
                    </select>
                  </L>
                  <L label="Shipping address (details)" full>
                    <input className="inp" value={form.shipping_address} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} placeholder="Fetched from the customer — editable" />
                  </L>
                </>
              )}
            </div>
          </Section>

          <Section title="Lines — snapshot from the catalogue">
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-12">
                  <div className="min-w-0 sm:col-span-4">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Product</div>
                    <select className="inp" aria-label="Product" value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">Pick product…</option>
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 sm:col-span-3">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Item name</div>
                    <input className="inp" placeholder="Item name (free text)" aria-label="Item name" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                  </div>
                  <div className="min-w-0 sm:col-span-1">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Qty</div>
                    <input className="inp num" placeholder="Qty" aria-label="Ordered quantity" value={l.ordered_qty} onChange={(e) => setLine(i, { ordered_qty: e.target.value })} />
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Unit cost</div>
                    <input className="inp num" placeholder="0.00" aria-label="Unit cost" title={l.unit_price ? `Unit cost: ${l.unit_price} — last PO/GRN price suggested automatically` : "Last PO/GRN price suggested automatically"} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                  </div>
                  <div className="min-w-0 sm:col-span-1">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">GST %</div>
                    <select className="inp" aria-label="GST rate" value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: e.target.value })}>
                      {GST_OPTIONS.map((g) => <option key={g} value={g}>{g}%</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 sm:col-span-1">
                    <div className="mb-1 hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">&nbsp;</div>
                    <div className="flex items-center justify-end">
                      <button type="button" title="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-[9px] text-muted-foreground sm:col-span-11">
                    {l.product_id ? `${l.sku} · ${l.unit}` : "Free-text line — pick a product to auto-suggest the last PO/GRN price"}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLines((ls) => [...ls, { product_id: "", name: "", sku: "", unit: "piece", ordered_qty: "", unit_price: "", gst_rate: "0" }])}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/5">
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </Section>

          <Section title="Also create (optional, mutually exclusive)">
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                { v: "none", label: "Save PO only", icon: <Package className="h-4 w-4" /> },
                { v: "proforma", label: "Supplier proforma", icon: <FileSignature className="h-4 w-4" /> },
                { v: "purchase_invoice", label: "Purchase invoice", icon: <FileText className="h-4 w-4" /> },
              ] as const).map((o) => (
                <button key={o.v} type="button" onClick={() => setForm({ ...form, also_create: o.v })}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${form.also_create === o.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {o.icon}{o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {form.also_create === "proforma" && "Creates a supplier proforma in pending_review for the funding pipeline."}
              {form.also_create === "purchase_invoice" && "Creates a draft purchase invoice (PI-{PO#}) billed at the PO total."}
              {form.also_create === "none" && "Just the purchase order — a commitment, no accounting impact."}
            </p>
          </Section>

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              Subtotal <span className="num">{fmtMoney(totals.subtotal)}</span> · GST <span className="num">{fmtMoney(totals.gst)}</span> · Freight <span className="num">{fmtMoney(totals.freight)}</span>
            </div>
            <div className="font-display text-lg">{fmtMoney(totals.grand)}</div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Create purchase order
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>{children}</div>;
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-3" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
