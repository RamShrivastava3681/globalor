import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate, fmtMoneyINR } from "@/components/ledger-ui";
import {
  Package, Boxes, CircleDollarSign, Percent, Pen, Trash2, Plus, PackageOpen, Wallet, ArrowLeft, Copy, Save, Loader2, X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/product-sku-detail")({
  component: ProductSkuDetailPage,
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

function fmtNumber(v: number | null | undefined): string {
  return v?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—";
}

// ── Page ────────────────────────────────────────────────────────────────────

export function ProductSkuDetailPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [view, setView] = useState<"overview" | "edit">("overview");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["product-sku", id],
    queryFn: async () => (await api.get<ProductSku>(`/product-skus/${id}`)) ?? null as any,
  });

  const master = useQuery({
    queryKey: ["product-sku-master", id],
    queryFn: async () => {
      const res = await api.get(`/product-skus/master/${id}`);
      return res.data as { master: ProductSku; variants: ProductSku[] };
    },
    enabled: !!id && view === "overview",
  });

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await api.patch(`/product-skus/${id}`, payload);
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["product-sku", id] });
      qc.invalidateQueries({ queryKey: ["product-sku-master", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const addColour = useMutation({
    mutationFn: async (body: { colourCode: string; colourName: string }) => {
      const res = await api.post<{ data: ProductSku }>("/product-skus", {
        parentProductId: id,
        colourCode: body.colourCode,
        colourName: body.colourName,
        unitCost: Number(formDraft.unitCost),
        unitPrice: Number(formDraft.unitPrice),
        taxPercent: Number(formDraft.taxPercent),
        hsnCode: formDraft.hsnCode || null,
        status: "ACTIVE",
      });
      return res.data.data;
    },
    onSuccess: (colour) => {
      toast.success("Colour variant added");
      qc.invalidateQueries({ queryKey: ["product-sku", id] });
      qc.invalidateQueries({ queryKey: ["product-sku-master", id] });
      setFormDraft({ unitCost: String(masterData?.master?.unitCost ?? 0), unitPrice: String(masterData?.master?.unitPrice ?? 0), taxPercent: String(masterData?.master?.taxPercent ?? 0), hsnCode: masterData?.master?.hsnCode ?? "" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const editColour = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await api.patch(`/product-skus/${colourEditId}`, body);
    },
    onSuccess: () => {
      toast.success("Colour updated");
      qc.invalidateQueries({ queryKey: ["product-sku", id] });
      qc.invalidateQueries({ queryKey: ["product-sku-master", id] });
      setColourEditId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeColour = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/product-skus/${id}`);
    },
    onSuccess: () => {
      toast.success("Colour removed");
      qc.invalidateQueries({ queryKey: ["product-sku", id] });
      qc.invalidateQueries({ queryKey: ["product-sku-master", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const masterData = master.data;
  const mat = masterData?.master as ProductSku | undefined;
  const variants = masterData?.variants as ProductSku[] | undefined;

  const [colourEditId, setColourEditId] = useState<string | null>(null);
  const [colourEdit, setColourEdit] = useState<ProductSku | null>(null);
  const [formDraft, setFormDraft] = useState({ unitCost: "600", unitPrice: "1000", taxPercent: "0", hsnCode: "" });

  const masterSku = mat?.masterSku ?? id;
  const margin = mat?.unitPrice > 0 ? ((mat.unitPrice - mat.unitCost) / mat.unitPrice) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !mat) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-muted-foreground">{error?.message ?? "Product SKU not found."}</p>
        <button
          onClick={() => navigate({ to: "/app/product-skus", params: {} })}
          className="mt-3 rounded-md border border-border px-4 py-2 text-sm"
        >
          Back to product SKUs
        </button>
      </div>
    );
  }

  const isMaster = mat.productType === "MASTER";

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title={isMaster ? "Master product" : "Colour variant"}
        description={
          isMaster
            ? `The base product. All colour variants inherit from this record.`
            : `Variant of master SKU <span className="font-mono text-foreground">${masterSku}</span>.`
        }
        actions={
          canEdit && isMaster ? (
            <button
              onClick={() => setView((v) => (v === "overview" ? "edit" : "overview"))}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              <Pen className="h-3.5 w-3.5" /> Edit product
            </button>
          ) : null
        }
      />

      <div className="space-y-6 p-4 md:p-8">
        {/* ── Overview card ── */}
        <Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col justify-center rounded-xl border border-border bg-surface-subtle p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Product name</div>
              <div className="font-display text-lg font-semibold">{mat.productName}</div>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-border bg-surface-subtle p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Master SKU</div>
              <div className="font-mono text-sm font-medium text-primary">{mat.masterSku}</div>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-border bg-surface-subtle p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Item number</div>
              <div className="font-mono text-sm">#{mat.itemNumber}</div>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-border bg-surface-subtle p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</div>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_STYLES[mat.status]}`}>
                {mat.status}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Brand</div>
              <div className="font-medium">{mat.brand ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gender</div>
              <div className="font-medium">{mat.gender ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Category</div>
              <div className="font-medium">{mat.category ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Model</div>
              <div className="font-mono text-sm">{mat.modelNumber ?? "—"}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">HSN code</div>
              <div className="font-mono text-sm">{mat.hsnCode ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Tax %</div>
              <div className="font-medium">{mat.taxPercent}%</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Unit</div>
              <div className="font-medium">{mat.unitOfMeasure}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gross margin</div>
              <div className="font-display text-xl font-semibold text-success">{margin.toFixed(2)}%</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Unit cost</div>
              <div className="font-display text-lg font-semibold">{fmtMoneyINR(mat.unitCost)}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Unit price</div>
              <div className="font-display text-lg font-semibold">{fmtMoneyINR(mat.unitPrice)}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Margin value</div>
              <div className="font-display text-lg font-semibold">{fmtMoneyINR(mat.unitPrice - mat.unitCost)}</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">SKU structure</div>
              <div className="font-mono text-xs">
                <span className="text-primary">{mat.masterSku}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {mat.brand} · {mat.gender} · {mat.category} · {mat.modelNumber}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* ── SKU structure ── */}
        <Card>
          <h3 className="font-display text-base font-semibold">SKU structure</h3>
          <div className="mt-3 overflow-x-auto">
            <div className="inline-block min-w-max font-mono text-sm">
              <span className="text-primary">{mat.masterSku}</span>
              <div className="my-2 h-[1px] bg-border" />
              {variants?.map((v) => (
                <div key={v.id} className="flex items-center gap-2">
                  <PackageOpen className="h-3.5 w-3.5 shrink-0 text-info" />
                  <span className="text-foreground">{v.colourSku}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{v.colourName ?? v.colourCode}</span>
                </div>
              ))}
              {!variants || variants.length === 0 ? (
                <div className="py-3 text-center text-xs text-muted-foreground">No colour variants yet.</div>
              ) : null}
            </div>
          </div>
        </Card>

        {/* ── Colour variants table ── */}
        <Card
          action={
            canEdit ? (
              <>
                <button
                  onClick={() => setView((v) => (v === "overview" ? "edit" : "overview"))}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-primary hover:text-primary"
                >
                  <Pen className="h-3 w-3" /> Edit product
                </button>
                <button
                  onClick={() => addColour.mutate({ colourCode: "BLK", colourName: "Black" })}
                  disabled={addColour.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-active"
                >
                  <Plus className="h-3.5 w-3.5" /> Add colour
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
            )
          }
        >
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-display text-base font-semibold">Colour variants</h3>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {variants?.length ?? 0} total
            </span>
          </div>

          {variants && variants.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left">Colour</th>
                    <th className="px-3 py-3 text-left font-mono text-[11px]">Colour SKU</th>
                    <th className="px-3 py-3 text-right">Cost</th>
                    <th className="px-3 py-3 text-right">Price</th>
                    <th className="px-3 py-3 text-right">Margin</th>
                    <th className="px-3 py-3 text-center">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const vMargin = v.unitPrice > 0 ? ((v.unitPrice - v.unitCost) / v.unitPrice) * 100 : 0;
                    return (
                      <tr key={v.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{v.colourName ?? v.colourCode}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{v.colourCode}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-primary">{v.colourSku}</td>
                        <td className="px-3 py-3 text-right num">{fmtMoneyINR(v.unitCost)}</td>
                        <td className="px-3 py-3 text-right num">{fmtMoneyINR(v.unitPrice)}</td>
                        <td className="px-3 py-3 text-right num font-medium">{vMargin.toFixed(2)}%</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_STYLES[v.status]}`}>
                            {v.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setColourEdit(v)}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                            >
                              <Pen className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Remove colour ${v.colourSku}?`)) {
                                  removeColour.mutate(v.id);
                                }
                              }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No colour variants yet. Click <span className="text-foreground">+ Add colour</span> to create one.
            </div>
          )}
        </Card>

        {/* ── Hierarchy note ── */}
        <Card className="border-info/30 bg-info/5">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              <Package className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-medium text-foreground">
                {mat.masterSku}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Master product (base)</span>
                {variants?.map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1">
                    <ArrowLeft className="h-2.5 w-2.5" />
                    {v.colourSku}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-muted-foreground">
            Colour variants inherit brand, gender, category, model, HSN, tax, unit of measure and pricing
            from the master. Size variants can be added next without changing this structure.
          </div>
        </Card>
      </div>

      {/* ── Add colour modal ── */}
      {addColour.isPending && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45"><Loader2 className="h-6 w-6 animate-spin place-self-center" /></div>}
      {addColour.isSuccess && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45">
          <div className="rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg">Colour variant added</h3>
              <button onClick={() => setView("overview")} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 font-mono text-lg font-medium text-primary">{(addColour.data as ProductSku)?.colourSku}</div>
            <div className="mt-1 text-sm text-muted-foreground">{(addColour.data as ProductSku)?.colourName ?? (addColour.data as ProductSku)?.colourCode}</div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setView("overview")} className="rounded-md border border-border px-4 py-2 text-sm">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Colour edit modal ── */}
      {colourEdit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setColourEdit(null)}>
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">Edit colour variant</h3>
              <button onClick={() => setColourEdit(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <ColourEditModal colour={colourEdit} masterSku={mat.masterSku} onSave={editColour.mutate} onClose={() => setColourEdit(null)} />
          </div>
        </div>
      )}

      {/* ── Edit product modal ── */}
      {view === "edit" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setView("overview")}>
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">Edit product</h3>
              <button onClick={() => setView("overview")} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <EditProductForm masterSku={mat.masterSku} product={mat} onSave={save.mutate} onClose={() => setView("overview")} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Colour edit modal ───────────────────────────────────────────────────────

function ColourEditModal({
  colour,
  masterSku,
  onSave,
  onClose,
}: {
  colour: ProductSku;
  masterSku: string;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    colourName: colour.colourName ?? "",
    colourCode: colour.colourCode ?? "",
    unitCost: String(colour.unitCost),
    unitPrice: String(colour.unitPrice),
    taxPercent: String(colour.taxPercent),
    hsnCode: colour.hsnCode ?? "",
    status: colour.status,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        colourName: f.colourName.trim() || null,
        colourCode: f.colourCode.trim().toUpperCase() || null,
        unitCost: Number(f.unitCost),
        unitPrice: Number(f.unitPrice),
        taxPercent: Number(f.taxPercent),
        hsnCode: f.hsnCode.trim() || null,
        status: f.status,
      };
      payload.grossMargin = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
      await onSave(payload);
    },
    onSuccess: () => {
      toast.success("Colour updated");
      qc.invalidateQueries({ queryKey: ["product-sku", colour.id] });
      qc.invalidateQueries({ queryKey: ["product-sku-master", colour.parentId] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-5 p-5"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <F label="Colour name">
          <input maxLength={80} className="inp" value={f.colourName} onChange={(e) => setF({ ...f, colourName: e.target.value })} placeholder="e.g. Navy Blue" />
        </F>
        <F label="Colour code">
          <select className="inp" value={f.colourCode} onChange={(e) => setF({ ...f, colourCode: e.target.value })}>
            <option value="">— select colour —</option>
            {COLOUR_OPTIONS.map((c) => <option key={c} value={c}>{colourLabel(c)} ({c})</option>)}
          </select>
        </F>
        <F label="HSN code">
          <input maxLength={30} className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} placeholder="inherited" />
        </F>
        <F label="Tax %">
          <div className="relative">
            <input type="text" inputMode="decimal" className="inp num" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} placeholder="inherited" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
          </div>
        </F>
        <F label="Unit cost">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
            <input type="text" inputMode="decimal" className="inp num pl-7" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} placeholder="inherited" />
          </div>
        </F>
        <F label="Unit price">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
            <input type="text" inputMode="decimal" className="inp num pl-7" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} placeholder="inherited" />
          </div>
        </F>
        <F label="Status">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </F>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <div className="min-w-[200px] rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
          {Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0.00}
          %
        </div>
        <div className="text-[10px] text-muted-foreground">Gross margin (auto-calculated · read-only)</div>
        <div className="ml-auto text-right">
          <div className="font-mono text-xs text-primary">{masterSku}-{f.colourCode.toUpperCase() ?? colour.colourCode}</div>
          <div className="text-[10px] text-muted-foreground">Colour SKU (auto-generated · read-only)</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </form>
  );
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

// ── Edit product form (inline modal) ────────────────────────────────────────

function EditProductForm({
  masterSku,
  product,
  onSave,
  onClose,
}: {
  masterSku: string;
  product: ProductSku;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: product.productName,
    itemNumber: product.itemNumber,
    brand: product.brand ?? "",
    gender: product.gender ?? "",
    category: product.category ?? "",
    modelNumber: product.modelNumber ?? "",
    hsnCode: product.hsnCode ?? "",
    taxPercent: String(product.taxPercent),
    unitOfMeasure: product.unitOfMeasure,
    unitCost: String(product.unitCost),
    unitPrice: String(product.unitPrice),
    status: product.status,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...f };
      payload.grossMargin = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
      await onSave(payload);
    },
    onSuccess: () => {
      toast.success("Product updated");
      qc.invalidateQueries({ queryKey: ["product-sku", product.id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-5 p-5"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <F label="Product name *" required>
          <input required maxLength={200} className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </F>
        <F label="Item number *" required>
          <input required maxLength={120} className="inp" value={f.itemNumber} onChange={(e) => setF({ ...f, itemNumber: e.target.value })} />
        </F>
        <F label="Brand">
          <input maxLength={60} className="inp" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        </F>
        <F label="Gender">
          <select className="inp" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
            <option value="">—</option>
            {["Male", "Female", "Unisex", "Kids", "Boys", "Girls", "Infant"].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </F>
        <F label="Category">
          <input maxLength={100} className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </F>
        <F label="Model number">
          <input maxLength={120} className="inp font-mono" value={f.modelNumber} onChange={(e) => setF({ ...f, modelNumber: e.target.value })} />
        </F>
        <F label="HSN code">
          <input maxLength={30} className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} />
        </F>
        <F label="Tax %">
          <div className="relative">
            <input type="text" inputMode="decimal" className="inp num" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} placeholder="0" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
          </div>
        </F>
        <F label="Unit">
          <select className="inp" value={f.unitOfMeasure} onChange={(e) => setF({ ...f, unitOfMeasure: e.target.value })}>
            <option value="">—</option>
            {["Piece", "Kg", "Litre", "Box", "Set", "Pair", "Carton", "Dozen", "Bottle", "Roll", "Meter", "Gram"].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </F>
        <F label="Status">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </F>
        <F label="Unit cost">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
            <input type="text" inputMode="decimal" className="inp num pl-7" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} placeholder="0.00" />
          </div>
        </F>
        <F label="Unit price">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
            <input type="text" inputMode="decimal" className="inp num pl-7" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} placeholder="0.00" />
          </div>
        </F>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[200px] rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-medium text-primary">
          {Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0.00}
          %
        </div>
        <div className="text-[10px] text-muted-foreground">Gross margin (auto-calculated · read-only)</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </form>
  );
}
