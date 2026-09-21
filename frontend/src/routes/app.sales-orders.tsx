import { createFileRoute, Link } from "@tanstack/react-router";
import { FilterBar } from "@/components/ui/filter-bar";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Trash2, CheckCircle2, Ban, Truck, Pencil, Package, Wallet, Building2, Boxes, Link2, Quote,
} from "lucide-react";
import { toast } from "sonner";
import { addressOptionsFor, defaultAddressFor } from "@/lib/customerAddresses";

export const Route = createFileRoute("/app/sales-orders")({
  component: SalesOrdersPage,
});

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
  order_date: string;
  customer_id: string | null;
  customer_name: string | null;
  billing_customer_id: string | null;
  billing_customer_name: string | null;
  shipping_customer_id: string | null;
  shipping_customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_name: string | null;
  payment_terms: string | null;
  expected_dispatch_date: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  freight: number | null;
  lines: SOLine[];
  subtotal: number;
  total_discount: number;
  gst_total: number;
  grand_total: number;
  manual_status: "draft" | "confirmed" | "cancelled";
  status: "draft" | "confirmed" | "partially_dispatched" | "fully_dispatched" | "cancelled";
  linked_proforma_id?: string | null;
  linked_proforma_number?: string | null;
  linked_quotation_id?: string | null;
  linked_quotation_number?: string | null;
  created_at: string;
};

type CustomerOpt = {
  id: string;
  name: string;
  contact_name: string | null;
  registered_address: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  addresses?: Array<{
    id: string;
    label: string | null;
    kind: "billing" | "shipping" | "both";
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
    is_default: boolean;
  }> | null;
  payment_terms_days: number | null;
};
type ProductOpt = { id: string; name: string; sku: string; barcode: string | null; unit_of_measure: string; unit_price: number; gst_rate: number | null; status: string };

const STATUS_META: Record<SO["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-warning/40 bg-warning/10 text-warning" },
  confirmed: { label: "Confirmed", cls: "border-primary/40 bg-primary/10 text-primary" },
  partially_dispatched: { label: "Partially dispatched", cls: "border-info/40 bg-info/10 text-info" },
  fully_dispatched: { label: "Fully dispatched", cls: "border-success/40 bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground line-through" },
};

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60", "Advance", "COD", "LC"];
const GST_OPTIONS = ["0", "5", "12", "18", "28"];

export function SalesOrdersPage() {
  const { user, canWrite } = useAuth();
  const canEdit = canWrite("goods-sales-orders");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SO | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SO["status"]>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"created" | "due">("created");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const sosQ = useQuery({
    queryKey: ["goods_so"],
    queryFn: async () => (await api.get<SO[]>("/goods-sales-orders")) ?? [],
  });

  const sos = sosQ.data ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sos
      .filter((so) => {
        if (statusFilter !== "all" && so.status !== statusFilter) return false;
        if (!q) return true;
        return (
          so.so_number.toLowerCase().includes(q) ||
          (so.customer_name ?? "").toLowerCase().includes(q) ||
          (so.delivery_address ?? "").toLowerCase().includes(q) ||
          so.lines.some((l) => l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const aVal = sortField === "created" ? (a.created_at ?? "") : (a.expected_delivery_date ?? "9999");
        const bVal = sortField === "created" ? (b.created_at ?? "") : (b.expected_delivery_date ?? "9999");
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === "asc" ? cmp : -cmp;
      });
  }, [sos, statusFilter, searchQuery, sortField, sortOrder]);

  const stats = useMemo(() => {
    const openValue = sos.filter((s) => s.status === "confirmed" || s.status === "partially_dispatched").reduce((s, o) => s + o.grand_total, 0);
    return {
      total: sos.length,
      awaiting: sos.filter((s) => s.status === "draft").length,
      openValue,
      dispatched: sos.filter((s) => s.status === "fully_dispatched").length,
    };
  }, [sos]);

  const confirm = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-sales-orders/${id}/confirm`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_so"] }); toast.success("Sales order confirmed — goods can now be dispatched"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => { await api.post(`/goods-sales-orders/${id}/cancel`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_so"] }); toast.success("Sales order cancelled"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/goods-sales-orders/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goods_so"] }); toast.success("Draft removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Sales orders"
        description="A sales order is a commitment, never a stock event. Only a confirmed dispatch note reduces inventory. Confirm the order, then dispatch goods."
        actions={
          canEdit ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New sales order
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Package className="h-4 w-4 text-primary" />} label="Total SOs" value={String(stats.total)} />
          <StatTile icon={<CheckCircle2 className="h-4 w-4 text-warning" />} label="Awaiting confirmation" value={String(stats.awaiting)}
            hint={stats.awaiting > 0 ? "Drafts — not yet committed" : "None pending"} />
          <StatTile icon={<Wallet className="h-4 w-4 text-muted-foreground" />} label="Open order value" value={fmtMoney(stats.openValue)} />
          <StatTile icon={<Boxes className="h-4 w-4 text-success" />} label="Fully dispatched" value={String(stats.dispatched)} />
        </div>

        <FilterBar
          searchPlaceholder="Search by SO number, customer, address, item…"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          statusOptions={[
            { label: "All statuses", value: "all" },
            { label: "Draft", value: "draft" },
            { label: "Confirmed", value: "confirmed" },
            { label: "Partially dispatched", value: "partially_dispatched" },
            { label: "Fully dispatched", value: "fully_dispatched" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          statusValue={statusFilter}
          onStatusChange={(v) => setStatusFilter(v as typeof statusFilter)}
          sortOptions={[
            { field: "created", label: "Created" },
            { field: "due", label: "Delivery date" },
          ]}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={(f) => setSortField(f as typeof sortField)}
          onSortOrderChange={(o) => setSortOrder(o)}
        />

        <Card title="Sales orders">
          {sosQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {sos.length === 0 ? "No sales orders yet. Create one to commit to a customer." : "No sales orders match your filters."}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">SO</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-left font-normal">Delivery</th>
                    <th className="px-5 py-2 text-right font-normal">Units</th>
                    <th className="px-5 py-2 text-right font-normal">Total</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((so) => (
                    <tr key={so.id} className={`border-b border-border/60 hover:bg-muted/30 ${so.status === "cancelled" ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <button onClick={() => setDetail(so)} className="font-mono text-xs text-primary hover:underline">{so.so_number}</button>
                        <div className="text-[10px] text-muted-foreground">{fmtDate(so.order_date)} · {so.lines.length} line{so.lines.length !== 1 ? "s" : ""}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{so.customer_name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{so.contact_person ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{so.delivery_address ?? "—"}</td>
                      <td className="px-5 py-3 text-right num">{so.lines.reduce((s, l) => s + l.ordered_qty, 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right num font-medium">{fmtMoney(so.grand_total)}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_META[so.status].cls}`}>{STATUS_META[so.status].label}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && so.status === "draft" && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => confirm.mutate(so.id)} disabled={confirm.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
                              <CheckCircle2 className="h-3 w-3" /> Confirm
                            </button>
                            <button onClick={() => { if (window.confirm(`Delete draft ${so.so_number}?`)) remove.mutate(so.id); }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        {(so.status === "confirmed" || so.status === "partially_dispatched") && (
                          <Link to="/app/dispatches" search={{ so: so.id }}
                            className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10">
                            <Truck className="h-3 w-3" /> Dispatch goods
                          </Link>
                        )}
                        {(so.status === "draft" || so.status === "confirmed") && canEdit && (
                          <button onClick={() => { if (window.confirm(`Cancel ${so.so_number}?`)) cancel.mutate(so.id); }}
                            className="ml-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                            <Ban className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && <NewSOModal salespersonDefault={user?.email ?? ""} onClose={() => setOpen(false)} />}
      {detail && <SODetailModal so={detail} onClose={() => setDetail(null)} />}
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

function SODetailModal({ so, onClose }: { so: SO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <span className="font-mono text-primary">{so.so_number}</span>
            <span className={`ml-2 rounded-full border px-2 py-0.5 align-middle text-[10px] uppercase tracking-wider ${STATUS_META[so.status].cls}`}>{STATUS_META[so.status].label}</span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            {so.linked_proforma_id && (
              <Detail label="From proforma">
                <span className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/5 px-2 py-0.5 text-[10px] text-success">
                  <Link2 className="h-3 w-3" /> {so.linked_proforma_number ?? so.linked_proforma_id}
                </span>
              </Detail>
            )}
            {so.linked_quotation_id && (
              <Detail label="From quotation">
                <span className="inline-flex items-center gap-1 rounded-md border border-info/40 bg-info/5 px-2 py-0.5 text-[10px] text-info">
                  <Quote className="h-3 w-3" /> {so.linked_quotation_number ?? so.linked_quotation_id}
                </span>
              </Detail>
            )}
            <Detail label="Bill to">{so.billing_customer_name ?? so.customer_name ?? "—"}</Detail>
            <Detail label="Ship to">{so.shipping_customer_name ?? so.customer_name ?? "—"}</Detail>
            <Detail label="Contact">{so.contact_person ?? "—"}</Detail>
            <Detail label="Salesperson">{so.salesperson_name ?? "—"}</Detail>
            <Detail label="Order date">{fmtDate(so.order_date)}</Detail>
            <Detail label="Payment terms">{so.payment_terms ?? "—"}</Detail>
            <Detail label="Expected dispatch">{so.expected_dispatch_date ? fmtDate(so.expected_dispatch_date) : "—"}</Detail>
            <Detail label="Billing">{so.billing_address ?? "—"}</Detail>
            <Detail label="Delivery">{so.delivery_address ?? "—"}</Detail>
            <Detail label="Expected delivery">{so.expected_delivery_date ? fmtDate(so.expected_delivery_date) : "—"}</Detail>
          </div>
          {so.notes && <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{so.notes}</p>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Item</th>
                  <th className="px-3 py-2 text-left font-normal">SKU</th>
                  <th className="px-3 py-2 text-right font-normal">Ordered</th>
                  <th className="px-3 py-2 text-right font-normal">Dispatched</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-right font-normal">Disc</th>
                  <th className="px-3 py-2 text-right font-normal">GST</th>
                  <th className="px-3 py-2 text-right font-normal">Line total</th>
                </tr>
              </thead>
              <tbody>
                {so.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{l.sku}</td>
                    <td className="px-3 py-2 text-right num">{l.ordered_qty.toLocaleString()} <span className="text-[10px] text-muted-foreground">{l.unit}</span></td>
                    <td className={`px-3 py-2 text-right num ${l.dispatched_qty > 0 ? "text-success" : "text-muted-foreground"}`}>
                      {l.dispatched_qty > 0 ? l.dispatched_qty.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(l.unit_price)}</td>
                    <td className="px-3 py-2 text-right num">{l.discount_pct > 0 ? `${l.discount_pct}%` : "—"}</td>
                    <td className="px-3 py-2 text-right num">{l.gst_rate != null ? `${l.gst_rate}%` : "—"}</td>
                    <td className="px-3 py-2 text-right num font-medium">{fmtMoney(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr><td colSpan={7} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Subtotal</td><td className="px-3 py-2 text-right num">{fmtMoney(so.subtotal)}</td></tr>
                <tr><td colSpan={7} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Discount</td><td className="px-3 py-2 text-right num">− {fmtMoney(so.total_discount)}</td></tr>
                <tr><td colSpan={7} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">GST</td><td className="px-3 py-2 text-right num">{fmtMoney(so.gst_total)}</td></tr>
                <tr><td colSpan={7} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Freight</td><td className="px-3 py-2 text-right num">{fmtMoney(so.freight ?? 0)}</td></tr>
                <tr><td colSpan={7} className="px-3 py-2 text-xs uppercase tracking-widest text-foreground">Grand total</td><td className="px-3 py-2 text-right num text-base">{fmtMoney(so.grand_total)}</td></tr>
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
  discount_pct: string;
  gst_rate: string;
};

function NewSOModal({ salespersonDefault, onClose }: { salespersonDefault: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    billing_customer_id: "",
    billing_address: "",
    billing_addr_key: "",
    same_as_billing: true,
    shipping_customer_id: "",
    delivery_address: "",
    shipping_addr_key: "",
    contact_person: "",
    salesperson_name: salespersonDefault,
    payment_terms: "Net 30",
    expected_dispatch_date: "",
    expected_delivery_date: "",
    freight: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineForm[]>([{ product_id: "", name: "", sku: "", unit: "piece", ordered_qty: "", unit_price: "", discount_pct: "0", gst_rate: "0" }]);

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<ProductOpt[]>("/products")) ?? [],
  });
  const customersQ = useQuery({
    queryKey: ["customer-options"],
    queryFn: async () => (await api.get<CustomerOpt[]>("/customers")) ?? [],
  });

  const activeProducts = (productsQ.data ?? []).filter((p) => p.status === "active");
  const customers = customersQ.data ?? [];
  const billCustomer = customers.find((c) => c.id === form.billing_customer_id);
  const shipCustomer = customers.find((c) => c.id === form.shipping_customer_id);
  const billAddrOpts = addressOptionsFor(billCustomer, "billing");
  const shipAddrOpts = addressOptionsFor(shipCustomer, "shipping");

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = activeProducts.find((x) => x.id === productId);
    if (!p) {
      setLine(i, { product_id: "", name: "", sku: "", unit: "piece", unit_price: "" });
      return;
    }
    setLine(i, {
      product_id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit_of_measure,
      gst_rate: String(p.gst_rate ?? 0),
      unit_price: p.unit_price > 0 ? String(p.unit_price) : "",
    });
  };

  const pickBillingCustomer = (id: string) => {
    const d = customers.find((x) => x.id === id);
    const addr = d ? defaultAddressFor(d, "billing") : "";
    setForm((f) => ({
      ...f,
      billing_customer_id: id,
      contact_person: d?.contact_name ?? "",
      billing_address: addr,
      billing_addr_key: "",
      payment_terms: d?.payment_terms_days ? `Net ${d.payment_terms_days}` : f.payment_terms,
      ...(f.same_as_billing
        ? {
            shipping_customer_id: id,
            delivery_address: d ? defaultAddressFor(d, "shipping") || addr : "",
            shipping_addr_key: "",
          }
        : {}),
    }));
  };

  const pickShippingCustomer = (id: string) => {
    const d = customers.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      shipping_customer_id: id,
      delivery_address: d ? defaultAddressFor(d, "shipping") : "",
      shipping_addr_key: "",
    }));
  };

  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0), 0);
    const discount = lines.reduce((s, l) => s + (Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.discount_pct) || 0) / 100, 0);
    const taxable = gross - discount;
    const gst = lines.reduce((s, l) => s + ((Number(l.ordered_qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100)) * (Number(l.gst_rate) || 0) / 100, 0);
    const freight = Number(form.freight) || 0;
    return { gross, discount, taxable, gst, freight, grand: taxable + gst + freight };
  }, [lines, form.freight]);

  const create = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one line");
      for (const l of lines) {
        if (!l.name.trim()) throw new Error("Every line needs a product or item name");
        if (!l.ordered_qty || Number(l.ordered_qty) <= 0) throw new Error("Ordered qty must be > 0 on every line");
        if (Number(l.unit_price) < 0) throw new Error("Unit price must be >= 0");
      }
      const shipId = form.same_as_billing ? form.billing_customer_id : form.shipping_customer_id;
      const shipAddr = form.same_as_billing ? form.billing_address : form.delivery_address;
      await api.post("/goods-sales-orders", {
        customer_id: form.billing_customer_id || null,
        billing_customer_id: form.billing_customer_id || null,
        shipping_customer_id: shipId || null,
        contact_person: form.contact_person || null,
        billing_address: form.billing_address || null,
        delivery_address: shipAddr || null,
        salesperson_name: form.salesperson_name || null,
        payment_terms: form.payment_terms || null,
        expected_dispatch_date: form.expected_dispatch_date || null,
        expected_delivery_date: form.expected_delivery_date || null,
        freight: form.freight.trim() === "" ? null : Number(form.freight),
        notes: form.notes || null,
        lines: lines.map((l) => ({
          product_id: l.product_id || null,
          name: l.name.trim(),
          sku: l.sku.trim() || null,
          unit: l.unit.trim() || "unit",
          ordered_qty: Number(l.ordered_qty),
          unit_price: Number(l.unit_price) || 0,
          discount_pct: Number(l.discount_pct) || 0,
          gst_rate: Number(l.gst_rate),
        })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      toast.success("Sales order created — confirm it before dispatching");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New sales order</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-5 p-5">
          <Section title="Billing & shipping">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Bill to (customer) *">
                <select className="inp" value={form.billing_customer_id} onChange={(e) => pickBillingCustomer(e.target.value)}>
                  <option value="">—</option>
                  {customers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </L>
              <L label="Billing address (saved)">
                <select
                  className="inp"
                  value={form.billing_addr_key}
                  disabled={!form.billing_customer_id}
                  onChange={(e) => {
                    const opt = billAddrOpts.find((o) => o.key === e.target.value);
                    setForm({ ...form, billing_addr_key: e.target.value, billing_address: opt ? opt.full : form.billing_address });
                  }}
                >
                  <option value="">{billAddrOpts.length ? "Pick a saved address…" : "No saved addresses — type below"}</option>
                  {billAddrOpts.map((o) => <option key={o.key} value={o.key}>{o.label} — {o.full.slice(0, 60)}</option>)}
                </select>
              </L>
              <L label="Contact person"><input className="inp" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></L>
              <L label="Billing address (details)" full>
                <input className="inp" value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} placeholder="Fetched from the customer — editable" />
              </L>
              <label className="flex items-center gap-2 text-sm md:col-span-3">
                <input
                  type="checkbox"
                  checked={form.same_as_billing}
                  onChange={(e) => {
                    const same = e.target.checked;
                    setForm((f) => ({
                      ...f,
                      same_as_billing: same,
                      ...(same
                        ? { shipping_customer_id: f.billing_customer_id, delivery_address: f.billing_address, shipping_addr_key: f.billing_addr_key }
                        : {}),
                    }));
                  }}
                />
                Shipping same as billing
              </label>
              {!form.same_as_billing && (
                <>
                  <L label="Ship to (customer)">
                    <select className="inp" value={form.shipping_customer_id} onChange={(e) => pickShippingCustomer(e.target.value)}>
                      <option value="">—</option>
                      {customers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </L>
                  <L label="Shipping address (saved)" full>
                    <select
                      className="inp"
                      value={form.shipping_addr_key}
                      disabled={!form.shipping_customer_id}
                      onChange={(e) => {
                        const opt = shipAddrOpts.find((o) => o.key === e.target.value);
                        setForm({ ...form, shipping_addr_key: e.target.value, delivery_address: opt ? opt.full : form.delivery_address });
                      }}
                    >
                      <option value="">{shipAddrOpts.length ? "Pick a saved address…" : "No saved addresses — type below"}</option>
                      {shipAddrOpts.map((o) => <option key={o.key} value={o.key}>{o.label} — {o.full.slice(0, 60)}</option>)}
                    </select>
                  </L>
                  <L label="Delivery address (details)" full>
                    <input className="inp" value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} placeholder="Fetched from the customer — editable" />
                  </L>
                </>
              )}
            </div>
          </Section>

          <Section title="Terms & schedule">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Payment terms">
                <select className="inp" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
                  {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </L>
              <L label="Salesperson"><input className="inp" value={form.salesperson_name} onChange={(e) => setForm({ ...form, salesperson_name: e.target.value })} /></L>
              <L label="Expected dispatch"><input type="date" className="inp" value={form.expected_dispatch_date} onChange={(e) => setForm({ ...form, expected_dispatch_date: e.target.value })} /></L>
              <L label="Expected delivery"><input type="date" className="inp" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} /></L>
              <L label="Freight"><input type="text" inputMode="decimal" className="inp num" value={form.freight} onChange={(e) => setForm({ ...form, freight: e.target.value })} /></L>
            </div>
          </Section>

          <Section title="Lines — snapshot from the catalogue">
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <select className="inp" value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">Pick product…</option>
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <input className="inp" placeholder="Item name (free text)" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Qty" value={l.ordered_qty} onChange={(e) => setLine(i, { ordered_qty: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Price" title="Defaults to the product selling price" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Disc%" title="Discount percentage 0–100 (GST applies to the discounted value)" value={l.discount_pct} onChange={(e) => setLine(i, { discount_pct: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <select className="inp" value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: e.target.value })}>
                      {GST_OPTIONS.map((g) => <option key={g} value={g}>{g}%</option>)}
                    </select>
                  </div>
                  <div className="flex items-center justify-end sm:col-span-1">
                    <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="text-[9px] text-muted-foreground sm:col-span-11">
                    {l.product_id ? `${l.sku} · ${l.unit} · selling price ${fmtMoney(Number(l.unit_price) || 0)}` : "Free-text line — pick a product to auto-fill the selling price"}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLines((ls) => [...ls, { product_id: "", name: "", sku: "", unit: "piece", ordered_qty: "", unit_price: "", discount_pct: "0", gst_rate: "0" }])}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/5">
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </Section>

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              Gross <span className="num">{fmtMoney(totals.gross)}</span> · Discount <span className="num">− {fmtMoney(totals.discount)}</span> · GST <span className="num">{fmtMoney(totals.gst)}</span> · Freight <span className="num">{fmtMoney(totals.freight)}</span>
            </div>
            <div className="font-display text-lg">{fmtMoney(totals.grand)}</div>
          </div>
          <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> A sales order never reduces inventory — only a confirmed dispatch does.
          </p>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Create sales order
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
