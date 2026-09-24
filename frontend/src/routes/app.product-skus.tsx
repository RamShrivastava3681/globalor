import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoneyINR } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Save, Package, Boxes, CircleDollarSign, Percent, Pen, Trash2, PackageOpen,
} from "lucide-react";import { toast } from "sonner";
export const Route = createFileRoute("/app/product-skus")({
  component: ProductSkusPage,
});

// ── Types ───────────────────────────────────────────────────────────────────

type ProductSku = {
  id: string;
  masterSku: string;
  parentId: string | null;
  parentSku: string | null;
  productName: string;
  itemNumber: string;
  brand: string | null;
  gender: string | null;
  category: string | null;
  modelNumber: string | null;
  hsnCode: string | null;
  taxPercent: number;
  unitOfMeasure: string;
  unitCost: number;
  unitPrice: number;
  grossMargin: number;
  productType: "MASTER" | "COLOUR";
  status: "ACTIVE" | "INACTIVE";
  colourName: string | null;
  colourCode: string | null;
  colourSku: string | null;
  created_at: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-success/40 bg-success/10 text-success",
  INACTIVE: "border-border bg-muted text-muted-foreground",
};

function fmtNumber(v: number | null | undefined): string {
  return v?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—";
}

// ── Page ────────────────────────────────────────────────────────────────────

const COLOUR_OPTIONS = [
  "BLK", "WHT", "RED", "GRN", "GRY", "BLU", "NAV", "YLW", "ORG", "PNK", "PUR", "BRN",
];

const colourLabel = (code: string): string => {
  const map: Record<string, string> = {
    BLK: "Black", WHT: "White", RED: "Red", GRN: "Green", GRY: "Grey",
    BLU: "Blue", NAV: "Navy Blue", YLW: "Yellow", ORG: "Orange", PNK: "Pink",
    PUR: "Purple", BRN: "Brown",
  };
  return map[code] ?? code;
};

const UOM_OPTIONS = ["Piece", "Kg", "Litre", "Box", "Set", "Pair", "Carton", "Dozen", "Bottle", "Roll", "Meter", "Gram"];

const emptyForm = {
  name: "",
  itemNumber: "",
  brand: "",
  gender: "",
  category: "",
  modelNumber: "",
  hsnCode: "",
  taxPercent: "0",
  unitOfMeasure: "Piece",
  unitCost: "600",
  unitPrice: "1000",
  colourCode: "",
  colourName: "",
  status: "ACTIVE" as const,
};

const emptyColourClass = {
  colourCode: "",
  colourName: "",
};

export function ProductSkusPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductSku | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState(emptyForm);
  const [colourForm, setColourForm] = useState(emptyColourClass);

  const products = useQuery({
    queryKey: ["product-skus"],
    queryFn: async () => (await api.get<ProductSku[]>("/product-skus")) ?? [],
  });

  const masterCount = useMemo(() => {
    return (products.data ?? []).filter((p) => p.productType === "MASTER").length;
  }, [products.data]);

  const variantCount = useMemo(() => {
    return (products.data ?? []).filter((p) => p.productType === "COLOUR").length;
  }, [products.data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      const name = form.name.trim();
      if (!name) throw new Error("Product name is required");
      payload.productName = name;

      const item = form.itemNumber.trim();
      if (!item) throw new Error("Item number is required");
      payload.itemNumber = item;

      if (form.brand.trim()) payload.brand = form.brand.trim();
      if (form.gender.trim()) payload.gender = form.gender.trim();
      if (form.category.trim()) payload.category = form.category.trim();
      if (form.modelNumber.trim()) payload.modelNumber = form.modelNumber.trim();
      if (form.hsnCode.trim() !== "") payload.hsnCode = form.hsnCode.trim();

      const tax = Number(form.taxPercent);
      if (Number.isNaN(tax)) throw new Error("Tax % must be a valid number");
      if (tax < 0 || tax > 100) throw new Error("Tax % must be between 0 and 100");
      payload.taxPercent = tax;

      if (form.unitOfMeasure.trim()) payload.unitOfMeasure = form.unitOfMeasure.trim();

      const unitCost = Number(form.unitCost);
      if (Number.isNaN(unitCost) || unitCost < 0) throw new Error("Unit cost must be a valid number >= 0");
      payload.unitCost = Math.round(unitCost * 100) / 100;

      const unitPrice = Number(form.unitPrice);
      if (Number.isNaN(unitPrice) || unitPrice <= 0) throw new Error("Unit price must be a valid number > 0");
      payload.unitPrice = Math.round(unitPrice * 100) / 100;

      const isColour = !!editing && editing.productType === "COLOUR";
      if (isColour) {
        payload.parentProductId = editing!.id;
        if (colourForm.colourCode.trim()) payload.colourCode = colourForm.colourCode.trim().toUpperCase();
        if (colourForm.colourName.trim()) payload.colourName = colourForm.colourName.trim();
        payload.colourSku = `${editing!.masterSku.toUpperCase()}-${colourForm.colourCode.trim().toUpperCase()}`;
      } else {
        payload.isMaster = true;
      }

      payload.grossMargin = payload.unitPrice > 0
        ? Math.round(((payload.unitPrice - payload.unitCost) / payload.unitPrice) * 10000) / 100
        : 0;
      payload.status = form.status;

      if (isColour) {
        await api.patch(`/product-skus/${editing!.id}`, payload);
      } else {
        await api.post("/product-skus", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing?.productType === "COLOUR" ? "Colour variant added" : "Master product created");
      qc.invalidateQueries({ queryKey: ["product-skus"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setColourForm(emptyColourClass);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/product-skus/${id}`);
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["product-skus"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setColourForm(emptyColourClass);
    setOpen(true);
  };

  const openEdit = (p: ProductSku) => {
    setEditing(p);
    setForm({
      name: p.productName,
      itemNumber: p.itemNumber,
      brand: p.brand ?? "",
      gender: p.gender ?? "",
      category: p.category ?? "",
      modelNumber: p.modelNumber ?? "",
      hsnCode: p.hsnCode ?? "",
      taxPercent: String(p.taxPercent),
      unitOfMeasure: p.unitOfMeasure,
      unitCost: String(p.unitCost),
      unitPrice: String(p.unitPrice),
      colourCode: "",
      colourName: "",
      status: p.status,
    });
    setColourForm(emptyColourClass);
    setOpen(true);
  };

  const set = (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const productsData = products.data ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return productsData.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.productName.toLowerCase().includes(q) ||
        p.masterSku.toLowerCase().includes(q) ||
        (p.colourName ?? "").toLowerCase().includes(q) ||
        (p.colourSku ?? "").toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [productsData, searchQuery, statusFilter]);

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Product SKUs"
        description="Master product + its colour variants. The master SKU is the parent record; every colour SKU inherits from it."
        actions={
          canEdit ? (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-active"
            >
              <Plus className="h-4 w-4" /> Add product / colour
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-4 md:p-8">
        {/* ── Stats ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            className="p-4"
            action={
              <button
                onClick={openNew}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="h-3 w-3" /> New
              </button>
            }
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Package className="h-3.5 w-3.5 text-primary" /> Master products
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">{masterCount}</div>
          </Card>
          <Card
            className="p-4"
            action={
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                <Boxes className="h-3.5 w-3.5" /> Variants
              </button>
            }
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <PackageOpen className="h-3.5 w-3.5 text-info" /> Colour variants
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">{variantCount}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5 text-success" /> Inventory value
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">
              {fmtMoneyINR(
                (products.data ?? []).reduce((s, p) => s + p.unitPrice * 1, 0)
              )}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Percent className="h-3.5 w-3.5 text-warning" /> Avg margin
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">
              {productsData.length
                ? `${Math.round(
                    productsData.reduce((s, p) => s + p.grossMargin, 0) /
                      productsData.filter((p) => p.grossMargin > 0).length *
                      100
                  )}%`
                : "—"}
            </div>
          </Card>
        </div>

        {/* ── Filters + table ── */}
        <Card>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Search by name, SKU, colour, brand, category…"
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
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} of {productsData.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-3 py-3 text-left">SKU Structure</th>
                  <th className="px-3 py-3 text-right">Cost</th>
                  <th className="px-3 py-3 text-right">Price</th>
                  <th className="px-3 py-3 text-right">Margin</th>
                  <th className="px-3 py-3 text-left">HSN / Tax</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {products.isLoading && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td>
                  </tr>
                )}
                {!products.isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted-foreground">
                      {productsData.length === 0
                        ? "No product SKUs yet. Click <span className='text-foreground'>Add product</span> to start."
                        : "No product SKUs match your filters."}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => {
                  const isMaster = p.productType === "MASTER";
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-border/60 hover:bg-muted/30 ${
                        p.status === "INACTIVE" ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                            {isMaster ? (
                              <Package className="h-4 w-4 text-primary" />
                            ) : (
                              <PackageOpen className="h-4 w-4 text-info" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{p.productName}</span>
                              {!isMaster && (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                                  Colour
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {isMaster ? p.masterSku : p.colourSku}
                              {p.colourName ? ` · ${p.colourName}` : ""}
                              {p.itemNumber ? ` · #${p.itemNumber}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-[11px]">
                          {isMaster ? (
                            <>
                              <span className="text-primary">{p.masterSku}</span>
                              <br />
                              <span className="text-muted-foreground">
                                {p.brand} · {p.gender} · {p.category} · {p.modelNumber}
                              </span>
                            </>
                          ) : (
                            <span className="text-primary">{p.colourSku}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right num">{fmtMoneyINR(p.unitCost)}</td>
                      <td className="px-3 py-3 text-right num">{fmtMoneyINR(p.unitPrice)}</td>
                      <td className="px-3 py-3 text-right num font-medium">{p.grossMargin.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {p.hsnCode ?? "—"} · {p.taxPercent}%
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_STYLES[p.status]}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && (
                            <>
                              <button
                                onClick={() => openEdit(p)}
                                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                              >
                                <Pen className="h-3 w-3" />
                              </button>
                              {!isMaster && (
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Remove colour ${p.colourSku}?`)) {
                                      remove.mutate(p.id);
                                    }
                                  }}
                                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">
                {editing ? "Edit colour variant" : "Create product / colour"}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
              className="space-y-5 p-5"
            >
              {/* ── Identity ── */}
              <Section title="Product identity">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Product name *" required>
                    <input
                      required
                      maxLength={200}
                      className="inp"
                      value={form.name}
                      onChange={set("name")}
                    />
                  </F>
                  <F label="Item number *" required>
                    <input
                      maxLength={120}
                      className="inp"
                      value={form.itemNumber}
                      onChange={set("itemNumber")}
                    />
                  </F>
                  <F label="Brand">
                    <input
                      maxLength={60}
                      className="inp"
                      value={form.brand}
                      onChange={set("brand")}
                      placeholder="e.g. AD"
                    />
                  </F>
                  <F label="Gender">
                    <select className="inp" value={form.gender} onChange={set("gender")}>
                      <option value="">—</option>
                      {["Male", "Female", "Unisex", "Kids", "Boys", "Girls", "Infant"].map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </F>
                  <F label="Category">
                    <input
                      maxLength={100}
                      className="inp"
                      value={form.category}
                      onChange={set("category")}
                      placeholder="e.g. T-Shirt"
                    />
                  </F>
                  <F label="Model number">
                    <input
                      maxLength={120}
                      className="inp font-mono"
                      value={form.modelNumber}
                      onChange={set("modelNumber")}
                      placeholder="e.g. TS"
                    />
                  </F>
                  <F label="HSN code">
                    <input
                      maxLength={30}
                      className="inp font-mono"
                      value={form.hsnCode}
                      onChange={set("hsnCode")}
                      placeholder="e.g. 620122"
                    />
                  </F>
                  <F label="Tax % *" required>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        className="inp num"
                        value={form.taxPercent}
                        onChange={set("taxPercent")}
                        placeholder="0"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                  </F>
                </div>
              </Section>

              {/* ── Unit of measure ── */}
              <Section title="Unit of measure">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Unit of measure">
                    <select className="inp" value={form.unitOfMeasure} onChange={set("unitOfMeasure")}>
                      <option value="">—</option>
                      {UOM_OPTIONS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </F>
                </div>
              </Section>

              {/* ── Pricing + SKU ── */}
              <Section title="Pricing & SKU">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Unit cost *" required>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ₹
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        className="inp num pl-7"
                        value={form.unitCost}
                        onChange={set("unitCost")}
                        placeholder="0.00"
                      />
                    </div>
                  </F>
                  <F label="Unit price *" required>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ₹
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        className="inp num pl-7"
                        value={form.unitPrice}
                        onChange={set("unitPrice")}
                        placeholder="0.00"
                      />
                    </div>
                  </F>
                  {editing ? (
                    <>
                      <F label="Master SKU (inherited)" required>
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
                          {editing.masterSku}
                          <span className="text-[10px] font-normal text-muted-foreground">
                            (inherited)
                          </span>
                        </div>
                      </F>
                      <F label="Colour code">
                        <select
                          className="inp"
                          value={colourForm.colourCode}
                          onChange={(e) => setColourForm({ ...colourForm, colourCode: e.target.value })}
                        >
                          <option value="">— select colour —</option>
                          {COLOUR_OPTIONS.map((c) => (
                            <option key={c} value={c}>{colourLabel(c)} ({c})</option>
                          ))}
                        </select>
                      </F>
                    </>
                  ) : (
                    <F label="Master SKU (read-only)" required>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
                        {emptyFormMasterSku()}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          (auto-generated)
                        </span>
                      </div>
                    </F>
                  )}
                  <F label="Gross margin %">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
                      {Number(form.unitPrice) > 0
                        ? ((Number(form.unitPrice) - Number(form.unitCost)) / Number(form.unitPrice)) * 100
                        : 0
                        .toFixed(2)
                        .replace(".", "%")}
                      %
                    </div>
                  </F>
                </div>
              </Section>

              {/* ── Colour variant detail (shown for a colour being added) ── */}
              {!editing && (
                <div className="border-t border-border pt-4">
                  <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">Colour variant</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    <F label="Colour name *" required>
                      <select
                        required
                        className="inp"
                        value={colourForm.colourCode}
                        onChange={(e) => setColourForm({ ...colourForm, colourCode: e.target.value })}
                      >
                        <option value="">Select a colour…</option>
                        {COLOUR_OPTIONS.map((c) => (
                          <option key={c} value={c}>{colourLabel(c)} ({c})</option>
                        ))}
                      </select>
                    </F>
                    <F label="Colour SKU (read-only)" required>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
                        {colourForm.colourCode
                          ? `${emptyFormMasterSku()}-${colourForm.colourCode.toUpperCase()}`
                          : "—"}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          (auto-generated)
                        </span>
                      </div>
                    </F>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 shadow-sm hover:bg-primary-hover active:bg-primary-active"
                >
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editing ? "Save changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Derived SKU helpers ─────────────────────────────────────────────────────

const now = new Date();
const yearSuffix = String(now.getFullYear()).slice(-2);

function emptyFormMasterSku(): string {
  return `AD-M-TS-${yearSuffix}001`;
}

// ── Sections ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>
      {children}
    </div>
  );
}

function F({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
