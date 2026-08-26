import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import {
  Plus, Loader2, Save, Trash2, X, Package, Boxes, CircleDollarSign, Percent, ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  barcode_type: "EAN-13" | "UPC-A" | "QR" | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  gender: string | null;
  size: string | null;
  color: string | null;
  model: string | null;
  season: string | null;
  image_url: string | null;
  unit_price: number;
  unit_cost: number;
  mrp: number | null;
  minimum_gross_margin_percentage: number | null;
  gst_rate: number | null;
  unit_of_measure: string;
  units_per_carton: number | null;
  reorder_level: number | null;
  max_stock: number | null;
  lead_time_days: number;
  safety_stock_days: number;
  supplier_id: string | null;
  supplier_name?: string | null;
  supplier_product_code: string | null;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
  hsn_code: string | null;
  status: "active" | "inactive";
  created_at: string;
};

type CatalogueSettings = {
  id: string;
  default_minimum_margin: number;
};

type SupplierOption = { id: string; name: string };

const emptyForm = {
  name: "",
  sku: "",
  description: "",
  barcode: "",
  barcode_type: "",
  category: "",
  subcategory: "",
  brand: "",
  gender: "",
  size: "",
  color: "",
  model: "",
  season: "",
  image_url: "",
  unit_price: "",
  unit_cost: "",
  mrp: "",
  minimum_gross_margin_percentage: "", // percent, e.g. "40"; blank = inherit
  gst_rate: "0",
  unit_of_measure: "piece",
  units_per_carton: "",
  reorder_level: "",
  max_stock: "",
  lead_time_days: "30",
  safety_stock_days: "30",
  supplier_id: "",
  supplier_product_code: "",
  minimum_order_quantity: "",
  order_multiple: "",
  hsn_code: "",
  status: "active",
};

const UOM_OPTIONS = ["piece", "pair", "carton", "box", "dozen", "set", "roll", "meter", "kg", "gram", "litre", "bottle", "pack"];

function ProductsPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<Product[]>("/products")) ?? [],
  });
  const settingsQ = useQuery({
    queryKey: ["catalogue-settings"],
    queryFn: async () => (await api.get<CatalogueSettings>("/catalogue-settings")) ?? { default_minimum_margin: 0.4 },
  });
  const suppliersQ = useQuery({
    queryKey: ["supplier-options"],
    queryFn: async () => {
      const [suppliers, vendors] = await Promise.all([
        api.get<any[]>("/suppliers").catch(() => []),
        api.get<any[]>("/vendors").catch(() => []),
      ]);
      const opts: SupplierOption[] = [
        ...(suppliers ?? []).map((s) => ({ id: s.id, name: s.company_name })),
        ...(vendors ?? []).map((v) => ({ id: v.id, name: v.name })),
      ];
      return opts;
    },
  });

  const defaultMargin = settingsQ.data?.default_minimum_margin ?? 0.4;
  const supplierOptions = suppliersQ.data ?? [];
  const supplierName = (id: string | null) => supplierOptions.find((s) => s.id === id)?.name ?? null;

  const effectiveMargin = (p: Product) => p.minimum_gross_margin_percentage ?? defaultMargin;

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      if (!name) throw new Error("Product name is required");
      const unitPrice = Number(form.unit_price);
      const unitCost = Number(form.unit_cost);
      if (Number.isNaN(unitPrice) || unitPrice < 0) throw new Error("Unit price must be a valid number >= 0");
      if (Number.isNaN(unitCost) || unitCost < 0) throw new Error("Unit cost must be a valid number >= 0");

      // Optional numeric fields: blank → null; non-numeric → null (never NaN).
      const num = (v: string) => {
        const t = v.trim();
        if (t === "") return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const int = (v: string) => {
        const n = num(v);
        return n == null ? null : Math.trunc(n);
      };

      const margin = num(form.minimum_gross_margin_percentage);
      if (margin !== null && (margin < 1 || margin > 99)) {
        throw new Error("Margin must be between 1% and 99%");
      }

      const payload = {
        name,
        sku: form.sku.trim() || null,
        description: form.description.trim() || null,
        barcode: form.barcode.trim() || null,
        barcode_type: form.barcode_type || null,
        category: form.category.trim() || null,
        subcategory: form.subcategory.trim() || null,
        brand: form.brand.trim() || null,
        gender: form.gender.trim() || null,
        size: form.size.trim() || null,
        color: form.color.trim() || null,
        model: form.model.trim() || null,
        season: form.season.trim() || null,
        image_url: form.image_url.trim() || null,
        unit_price: unitPrice,
        unit_cost: unitCost,
        mrp: num(form.mrp),
        minimum_gross_margin_percentage: margin === null ? null : margin / 100,
        gst_rate: num(form.gst_rate),
        unit_of_measure: form.unit_of_measure.trim() || "piece",
        units_per_carton: num(form.units_per_carton),
        reorder_level: num(form.reorder_level),
        max_stock: num(form.max_stock),
        lead_time_days: int(form.lead_time_days) ?? 30,
        safety_stock_days: int(form.safety_stock_days) ?? 30,
        supplier_id: form.supplier_id || null,
        supplier_product_code: form.supplier_product_code.trim() || null,
        minimum_order_quantity: num(form.minimum_order_quantity),
        order_multiple: num(form.order_multiple),
        hsn_code: form.hsn_code.trim() || null,
        status: form.status,
      };
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
      } else {
        await api.post("/products", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Product updated" : "Product added to catalogue");
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [marginInput, setMarginInput] = useState("");

  const saveSettings = useMutation({
    mutationFn: async () => {
      const margin = Number(marginInput);
      if (Number.isNaN(margin) || margin < 1 || margin > 99) throw new Error("Default margin must be between 1% and 99%");
      await api.put("/catalogue-settings", { default_minimum_margin: margin / 100 });
    },
    onSuccess: () => {
      toast.success("Catalogue default margin updated");
      qc.invalidateQueries({ queryKey: ["catalogue-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/products/${id}`);
    },
    onSuccess: () => {
      toast.success("Product removed");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku,
      description: p.description ?? "",
      barcode: p.barcode ?? "",
      barcode_type: p.barcode_type ?? "",
      category: p.category ?? "",
      subcategory: p.subcategory ?? "",
      brand: p.brand ?? "",
      gender: p.gender ?? "",
      size: p.size ?? "",
      color: p.color ?? "",
      model: p.model ?? "",
      season: p.season ?? "",
      image_url: p.image_url ?? "",
      unit_price: String(p.unit_price),
      unit_cost: String(p.unit_cost),
      mrp: p.mrp != null ? String(p.mrp) : "",
      minimum_gross_margin_percentage: p.minimum_gross_margin_percentage != null ? String(Math.round(p.minimum_gross_margin_percentage * 100)) : "",
      gst_rate: p.gst_rate != null ? String(p.gst_rate) : "0",
      unit_of_measure: p.unit_of_measure,
      units_per_carton: p.units_per_carton != null ? String(p.units_per_carton) : "",
      reorder_level: p.reorder_level != null ? String(p.reorder_level) : "",
      max_stock: p.max_stock != null ? String(p.max_stock) : "",
      lead_time_days: String(p.lead_time_days ?? 30),
      safety_stock_days: String(p.safety_stock_days ?? 30),
      supplier_id: p.supplier_id ?? "",
      supplier_product_code: p.supplier_product_code ?? "",
      minimum_order_quantity: p.minimum_order_quantity != null ? String(p.minimum_order_quantity) : "",
      order_multiple: p.order_multiple != null ? String(p.order_multiple) : "",
      hsn_code: p.hsn_code ?? "",
      status: p.status,
    });
    setOpen(true);
  };

  const products = productsQ.data ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.subcategory ?? "").toLowerCase().includes(q) ||
        (p.supplier_name ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const active = products.filter((p) => p.status === "active");
    const below = active.filter((p) => (p.minimum_gross_margin_percentage ?? defaultMargin) < defaultMargin);
    return {
      total: products.length,
      active: active.length,
      inactive: products.length - active.length,
      below,
    };
  }, [products, defaultMargin]);

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Products"
        description="The master data every purchase order, GRN, quotation, sales order, dispatch and invoice references. Line items are snapshots — editing a product never alters old documents."
        actions={
          canEdit ? (
            <button onClick={openNew} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Add product
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        {/* ── Stats ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Boxes className="h-4 w-4 text-primary" />} label="Total SKUs" value={String(stats.total)} />
          <StatTile icon={<Package className="h-4 w-4 text-success" />} label="Active" value={String(stats.active)} />
          <StatTile icon={<CircleDollarSign className="h-4 w-4 text-muted-foreground" />} label="Inactive" value={String(stats.inactive)} />
          <StatTile
            icon={<Percent className="h-4 w-4 text-warning" />}
            label="Below default margin"
            value={String(stats.below.length)}
            hint={stats.below.length > 0 ? "Products with no floor protection" : "All products covered"}
          />
        </div>

        {/* ── Catalogue settings ── */}
        {canEdit && (
          <Card>
            <div className="flex flex-wrap items-center gap-4 p-5">
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-medium">Default minimum margin</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Products without their own margin inherit this floor ({Math.round(defaultMargin * 100)}% today). The floor protects your pricing strategy.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`${Math.round(defaultMargin * 100)}%`}
                  value={marginInput}
                  onChange={(e) => setMarginInput(e.target.value)}
                  className="h-10 w-28 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  onClick={() => saveSettings.mutate()}
                  disabled={saveSettings.isPending || marginInput.trim() === ""}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {saveSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ── List ── */}
        <Card>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Search by name, SKU, brand, category, barcode, supplier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all sm:max-w-md"
            />
            <div className="flex gap-1 rounded-lg border border-border p-1">
              {(["all", "active", "inactive"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${
                    statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {products.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-3 py-3 text-left">Category</th>
                  <th className="px-3 py-3 text-right">Sale / Cost</th>
                  <th className="px-3 py-3 text-right">Margin</th>
                  <th className="px-3 py-3 text-right">GST</th>
                  <th className="px-3 py-3 text-left">Supplier</th>
                  <th className="px-3 py-3 text-right">Reorder</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {productsQ.isLoading && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!productsQ.isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted-foreground">
                      {products.length === 0 ? (
                        <>No products yet. Click <span className="text-foreground">Add product</span> to start your catalogue.</>
                      ) : (
                        "No products match your filters."
                      )}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => {
                  const margin = effectiveMargin(p);
                  const belowFloor = margin < defaultMargin;
                  return (
                    <tr key={p.id} className={`border-b border-border/60 hover:bg-muted/30 ${p.status === "inactive" ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <ImageIcon className="h-4 w-4 text-muted-foreground/60" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{p.name}</span>
                              {p.status === "inactive" && (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">Inactive</span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        <div>{[p.brand, p.category].filter(Boolean).join(" · ") || "—"}</div>
                        <div className="text-[10px]">{[p.color, p.size, p.model].filter(Boolean).join(" / ") || ""}</div>
                      </td>
                      <td className="px-3 py-3 text-right num">
                        <div>{fmtMoney(p.unit_price)}</div>
                        <div className="text-[10px] text-muted-foreground">cost {fmtMoney(p.unit_cost)}</div>
                      </td>
                      <td className="px-3 py-3 text-right num">
                        <span className={belowFloor ? "text-warning" : ""}>
                          {p.minimum_gross_margin_percentage != null ? `${Math.round(margin * 100)}%` : `${Math.round(margin * 100)}%*`}
                        </span>
                        {belowFloor && <div className="text-[10px] text-warning">below default</div>}
                      </td>
                      <td className="px-3 py-3 text-right num">{p.gst_rate != null ? `${p.gst_rate}%` : "—"}</td>
                      <td className="px-3 py-3 text-xs">{p.supplier_name ?? (p.supplier_id ? supplierName(p.supplier_id) ?? "—" : "—")}</td>
                      <td className="px-3 py-3 text-right num">
                        {p.reorder_level != null ? p.reorder_level : "—"}
                        {p.lead_time_days > 0 && <div className="text-[10px] text-muted-foreground">LT {p.lead_time_days}d</div>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {canEdit && (
                          <>
                            <button onClick={() => openEdit(p)} className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Edit</button>
                            <button
                              onClick={() => { if (confirm(`Remove ${p.name} (${p.sku})? Existing documents keep their snapshots.`)) remove.mutate(p.id); }}
                              className="ml-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-[10px] text-muted-foreground">
            * inherits the catalogue default margin
          </div>
        </Card>
      </div>

      {/* ── Create / Edit modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">{editing ? `Edit ${editing.name}` : "Add product to catalogue"}</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
              {/* ── Identity ── */}
              <Section title="Identity">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Product name *"><input required maxLength={200} className="inp" value={form.name} onChange={set("name")} /></F>
                  <F label="SKU (blank = auto-generate)"><input maxLength={64} placeholder="SKU-XXXXXXXX" className="inp font-mono" value={form.sku} onChange={set("sku")} /></F>
                  <F label="Description" full><textarea rows={2} maxLength={2000} className="inp" value={form.description} onChange={set("description")} /></F>
                  <F label="Category"><input maxLength={100} className="inp" value={form.category} onChange={set("category")} /></F>
                  <F label="Subcategory"><input maxLength={100} className="inp" value={form.subcategory} onChange={set("subcategory")} /></F>
                  <F label="Brand"><input maxLength={120} className="inp" value={form.brand} onChange={set("brand")} /></F>
                  <F label="Model"><input maxLength={120} className="inp" value={form.model} onChange={set("model")} /></F>
                  <F label="Gender"><select className="inp" value={form.gender} onChange={set("gender")}>
                    <option value="">—</option>
                    {["Male", "Female", "Unisex", "Kids", "Boys", "Girls", "Infant"].map((g) => <option key={g} value={g}>{g}</option>)}
                  </select></F>
                  <F label="Size"><input maxLength={40} placeholder="S / M / L / XL / 42" className="inp" value={form.size} onChange={set("size")} /></F>
                  <F label="Color"><input maxLength={60} className="inp" value={form.color} onChange={set("color")} /></F>
                  <F label="Season"><input maxLength={40} className="inp" value={form.season} onChange={set("season")} /></F>
                  <F label="Image URL (signed S3 or CDN)"><input maxLength={500} className="inp" value={form.image_url} onChange={set("image_url")} /></F>
                </div>
              </Section>

              {/* ── Barcode ── */}
              <Section title="Barcode">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Barcode value"><input maxLength={64} placeholder="Scan or type" className="inp font-mono" value={form.barcode} onChange={set("barcode")} /></F>
                  <F label="Barcode type"><select className="inp" value={form.barcode_type} onChange={set("barcode_type")}>
                    <option value="">—</option>
                    <option value="EAN-13">EAN-13</option>
                    <option value="UPC-A">UPC-A</option>
                    <option value="QR">QR</option>
                  </select></F>
                </div>
              </Section>

              {/* ── Pricing ── */}
              <Section title="Pricing">
                <div className="grid gap-3 md:grid-cols-3">
                  <F label="Selling price *"><input type="text" inputMode="decimal" required className="inp num" value={form.unit_price} onChange={set("unit_price")} /></F>
                  <F label="Purchase cost *"><input type="text" inputMode="decimal" required className="inp num" value={form.unit_cost} onChange={set("unit_cost")} /></F>
                  <F label="MRP (max retail)"><input type="text" inputMode="decimal" className="inp num" value={form.mrp} onChange={set("mrp")} /></F>
                  <F label="Min gross margin % (blank = inherit)">
                    <div className="relative">
                      <input type="text" inputMode="decimal" placeholder={`${Math.round(defaultMargin * 100)}%`} className="inp num pr-8" value={form.minimum_gross_margin_percentage} onChange={set("minimum_gross_margin_percentage")} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  </F>
                  <F label="GST rate"><select className="inp" value={form.gst_rate} onChange={set("gst_rate")}>
                    {["0", "5", "12", "18", "28"].map((g) => <option key={g} value={g}>{g}%</option>)}
                  </select></F>
                  <F label="HSN code"><input maxLength={30} className="inp font-mono" value={form.hsn_code} onChange={set("hsn_code")} /></F>
                </div>
                {form.minimum_gross_margin_percentage.trim() === "" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Inherits the catalogue default of {Math.round(defaultMargin * 100)}%.
                  </p>
                )}
              </Section>

              {/* ── Logistics ── */}
              <Section title="Logistics & stock">
                <div className="grid gap-3 md:grid-cols-3">
                  <F label="Unit of measure">
                    <input list="uom-options" maxLength={40} className="inp" value={form.unit_of_measure} onChange={set("unit_of_measure")} />
                    <datalist id="uom-options">{UOM_OPTIONS.map((u) => <option key={u} value={u} />)}</datalist>
                  </F>
                  <F label="Units per carton"><input type="text" inputMode="decimal" className="inp num" value={form.units_per_carton} onChange={set("units_per_carton")} /></F>
                  <F label="Reorder level"><input type="text" inputMode="decimal" className="inp num" value={form.reorder_level} onChange={set("reorder_level")} /></F>
                  <F label="Max stock"><input type="text" inputMode="decimal" className="inp num" value={form.max_stock} onChange={set("max_stock")} /></F>
                  <F label="Lead time (days)"><input type="text" inputMode="numeric" className="inp num" value={form.lead_time_days} onChange={set("lead_time_days")} /></F>
                  <F label="Safety stock (days)"><input type="text" inputMode="numeric" className="inp num" value={form.safety_stock_days} onChange={set("safety_stock_days")} /></F>
                  <F label="Supplier">
                    <select className="inp" value={form.supplier_id} onChange={set("supplier_id")}>
                      <option value="">—</option>
                      {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </F>
                  <F label="Supplier product code"><input maxLength={100} className="inp" value={form.supplier_product_code} onChange={set("supplier_product_code")} /></F>
                  <F label="Min order qty"><input type="text" inputMode="decimal" className="inp num" value={form.minimum_order_quantity} onChange={set("minimum_order_quantity")} /></F>
                  <F label="Order multiple"><input type="text" inputMode="decimal" className="inp num" value={form.order_multiple} onChange={set("order_multiple")} /></F>
                  <F label="Status">
                    <select className="inp" value={form.status} onChange={set("status")}>
                      <option value="active">Active — appears in pickers</option>
                      <option value="inactive">Inactive — hidden from pickers</option>
                    </select>
                  </F>
                </div>
              </Section>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editing ? "Save changes" : "Add product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>
      {children}
    </div>
  );
}

function F({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
