import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import {
  Plus, Loader2, Save, Trash2, X, Package, PackageOpen, Check,
  Boxes, CircleDollarSign, Percent, Pen, ChevronDown, ChevronRight, Eye,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/products")({
  component: ProductsPage,
});

// ── Master / Colour SKU type (mirrors /product-skus API) ──
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

const COLOUR_OPTIONS = [
  { name: "Black", code: "BLK", swatch: "bg-black" },
  { name: "White", code: "WHT", swatch: "border border-border bg-white" },
  { name: "Red", code: "RED", swatch: "bg-red-600" },
  { name: "Green", code: "GRN", swatch: "bg-green-600" },
  { name: "Grey", code: "GRY", swatch: "bg-gray-500" },
  { name: "Blue", code: "BLU", swatch: "bg-blue-600" },
  { name: "Navy Blue", code: "NVY", swatch: "bg-blue-950" },
  { name: "Yellow", code: "YLW", swatch: "bg-yellow-400" },
  { name: "Orange", code: "ORG", swatch: "bg-orange-500" },
  { name: "Pink", code: "PNK", swatch: "bg-pink-500" },
  { name: "Purple", code: "PUR", swatch: "bg-purple-600" },
  { name: "Brown", code: "BRN", swatch: "bg-amber-800" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-success/40 bg-success/10 text-success",
  INACTIVE: "border-border bg-muted text-muted-foreground",
};

function ProductsPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "INACTIVE">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Dialog state ──
  // Button 2 (per-master): which master are we adding colour SKUs to?
  const [colourTargetId, setColourTargetId] = useState<string | null>(null);
  const [selectedColourCodes, setSelectedColourCodes] = useState<string[]>([]);
  // Optimised edits
  const [editingMaster, setEditingMaster] = useState<ProductSku | null>(null);
  const [editingColour, setEditingColour] = useState<ProductSku | null>(null);

  const skusQ = useQuery({
    queryKey: ["product-skus"],
    queryFn: async () => (await api.get<ProductSku[]>("/product-skus")) ?? [],
  });

  const rows = skusQ.data ?? [];
  const masters = useMemo(() => rows.filter((r) => r.productType === "MASTER"), [rows]);
  const variantsByParent = useMemo(() => {
    const map = new Map<string, ProductSku[]>();
    for (const r of rows) {
      if (r.productType === "COLOUR" && r.parentId) {
        const list = map.get(r.parentId) ?? [];
        list.push(r);
        map.set(r.parentId, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.colourSku ?? "").localeCompare(b.colourSku ?? ""));
    return map;
  }, [rows]);

  const variantCount = useMemo(() => rows.filter((r) => r.productType === "COLOUR").length, [rows]);

  const colourTarget = colourTargetId ? (masters.find((m) => m.id === colourTargetId) ?? null) : null;
  const existingColourCodes = useMemo(() => {
    if (!colourTarget) return new Set<string>();
    return new Set(
      (variantsByParent.get(colourTarget.id) ?? [])
        .map((v) => (v.colourCode ?? "").toUpperCase())
        .filter(Boolean),
    );
  }, [colourTarget, variantsByParent]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = (ids: string[]) => setExpanded(new Set(ids));
  const collapseAll = () => setExpanded(new Set());

  const openColourDialog = (masterId: string) => {
    setColourTargetId(masterId);
    setSelectedColourCodes([]);
    setExpanded((prev) => new Set(prev).add(masterId));
  };
  const closeColourDialog = () => {
    if (createColourSkus.isPending) return;
    setColourTargetId(null);
    setSelectedColourCodes([]);
  };

  const invalidate = (masterId?: string) => {
    qc.invalidateQueries({ queryKey: ["product-skus"] });
    if (masterId) qc.invalidateQueries({ queryKey: ["product-sku-master", masterId] });
  };

  // ── Button 2 action: create colour-coded SKUs under the row's master ──
  const createColourSkus = useMutation({
    mutationFn: async () => {
      if (!colourTarget) throw new Error("Select a master SKU");
      const colours = COLOUR_OPTIONS.filter(
        (c) => selectedColourCodes.includes(c.code) && !existingColourCodes.has(c.code),
      );
      if (colours.length === 0) throw new Error("Select at least one available colour");
      const results = await Promise.allSettled(
        colours.map((c) =>
          api.post<ProductSku>("/product-skus", {
            parentProductId: colourTarget.id,
            colourName: c.name,
            colourCode: c.code,
            status: "ACTIVE",
          }),
        ),
      );
      return {
        created: results.filter((r) => r.status === "fulfilled").length,
        failed: results.flatMap((r, i) =>
          r.status === "rejected"
            ? [{ code: colours[i].code, message: r.reason instanceof Error ? r.reason.message : "Unknown error" }]
            : [],
        ),
      };
    },
    onSuccess: ({ created, failed }) => {
      invalidate(colourTarget?.id);
      if (created > 0) toast.success(`${created} SKU${created === 1 ? "" : "s"} created under ${colourTarget?.masterSku}`);
      if (failed.length > 0) {
        setSelectedColourCodes(failed.map((f) => f.code));
        toast.error(`${failed.length} could not be created: ${failed[0].message}`);
        return;
      }
      setColourTargetId(null);
      setSelectedColourCodes([]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create SKUs"),
  });

  // ── Optimised edit: master (only backend-editable fields) ──
  const patchMaster = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!editingMaster) throw new Error("No master selected");
      await api.patch(`/product-skus/${editingMaster.id}`, payload);
    },
    onSuccess: () => {
      toast.success("Master SKU updated");
      invalidate(editingMaster?.id);
      setEditingMaster(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update master"),
  });

  // ── Optimised edit: colour variant ──
  const patchColour = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!editingColour) throw new Error("No colour selected");
      await api.patch(`/product-skus/${editingColour.id}`, payload);
    },
    onSuccess: () => {
      toast.success("Colour SKU updated");
      invalidate(editingColour?.parentId ?? undefined);
      setEditingColour(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update colour"),
  });

  const removeSku = useMutation({
    mutationFn: async (sku: ProductSku) => {
      if (sku.productType === "MASTER" && (variantsByParent.get(sku.id) ?? []).length > 0) {
        throw new Error("Remove its colour variants first");
      }
      await api.delete(`/product-skus/${sku.id}`);
    },
    onSuccess: (_d, sku) => {
      toast.success(sku.productType === "MASTER" ? "Master SKU removed" : `Colour ${sku.colourSku} removed`);
      invalidate(sku.parentId ?? sku.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filteredMasters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return masters
      .filter((m) => {
        if (statusFilter !== "all" && m.status !== statusFilter) return false;
        if (!q) return true;
        const variants = variantsByParent.get(m.id) ?? [];
        return (
          m.productName.toLowerCase().includes(q) ||
          m.masterSku.toLowerCase().includes(q) ||
          (m.itemNumber ?? "").toLowerCase().includes(q) ||
          (m.brand ?? "").toLowerCase().includes(q) ||
          (m.category ?? "").toLowerCase().includes(q) ||
          variants.some(
            (v) =>
              (v.colourSku ?? "").toLowerCase().includes(q) ||
              (v.colourName ?? "").toLowerCase().includes(q) ||
              (v.colourCode ?? "").toLowerCase().includes(q),
          )
        );
      })
      .sort((a, b) => a.masterSku.localeCompare(b.masterSku));
  }, [masters, variantsByParent, searchQuery, statusFilter]);

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Product Catalogue"
        description="Master SKU is the parent. Expand a master to see its nested colour-coded SKUs. Use the per-row button to add colours."
        actions={
          canEdit ? (
            <button
              onClick={() => navigate({ to: "/app/products-create" })}
              title="Create a Master SKU — productName, itemNumber, brand, category, model, HSN, tax, UOM, cost, price"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Package className="h-4 w-4" /> Create Master SKU
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        {/* ── Stats ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Boxes className="h-4 w-4 text-primary" />} label="Master SKUs" value={String(masters.length)} />
          <StatTile icon={<PackageOpen className="h-4 w-4 text-info" />} label="Colour SKUs" value={String(variantCount)} />
          <StatTile icon={<CircleDollarSign className="h-4 w-4 text-success" />} label="Inventory value" value={fmtMoney(rows.reduce((s, p) => s + p.unitPrice, 0))} />
          <StatTile
            icon={<Percent className="h-4 w-4 text-warning" />}
            label="Avg margin"
            value={rows.length ? `${(rows.reduce((s, p) => s + (p.grossMargin ?? 0), 0) / rows.length).toFixed(1)}%` : "—"}
          />
        </div>

        {/* ── Nested Master → Colour catalogue ── */}
        <Card>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
            <input
              type="text"
              placeholder="Search masters, colours, brand, category…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 lg:max-w-md"
            />
            <div className="flex gap-1 rounded-lg border border-border p-1">
              {(["all", "ACTIVE", "INACTIVE"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${
                    statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {s === "all" ? s : s.toLowerCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 lg:ml-auto">
              <span className="text-xs text-muted-foreground">{filteredMasters.length} of {masters.length} masters</span>
              <button onClick={() => expandAll(filteredMasters.map((m) => m.id))} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-primary hover:text-primary">Expand all</button>
              <button onClick={collapseAll} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">Collapse</button>
            </div>
          </div>

          {skusQ.isLoading && <div className="p-10 text-center text-sm text-muted-foreground">Loading catalogue…</div>}
          {!skusQ.isLoading && filteredMasters.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {masters.length === 0 ? (
                <span>No master SKUs yet. Click <span className="text-foreground">Create Master SKU</span> above.</span>
              ) : (
                "No masters match your filters."
              )}
            </div>
          )}

          <div className="divide-y divide-border">
            {filteredMasters.map((m) => {
              const variants = variantsByParent.get(m.id) ?? [];
              const isOpen = expanded.has(m.id);
              return (
                <div key={m.id} className={m.status === "INACTIVE" ? "opacity-70" : ""}>
                  {/* Master row */}
                  <div className="flex flex-col gap-3 p-4 hover:bg-muted/20 md:flex-row md:items-center">
                    <button onClick={() => toggleExpand(m.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={isOpen}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                        <Package className="h-4 w-4 text-primary" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.productName}</span>
                        <span className="block font-mono text-[11px] font-semibold text-primary">{m.masterSku}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          #{m.itemNumber} · {[m.brand, m.category, m.modelNumber].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-4 text-right">
                      <div className="num text-sm">
                        <div>{fmtMoney(m.unitPrice)}</div>
                        <div className="text-[10px] text-muted-foreground">cost {fmtMoney(m.unitCost)} · {m.grossMargin.toFixed(1)}%</div>
                      </div>
                      <span className={`hidden rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase md:inline-flex ${STATUS_STYLES[m.status]}`}>{m.status}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{variants.length} colour{variants.length === 1 ? "" : "s"}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {canEdit && (
                        <button
                          onClick={() => openColourDialog(m.id)}
                          title={`Create colour-coded SKUs under ${m.masterSku}`}
                          className="inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:opacity-90"
                        >
                          <PackageOpen className="h-3.5 w-3.5" /> Add Colours
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => setEditingMaster(m)}
                          title="Edit master pricing / identity"
                          className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                        >
                          <Pen className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => navigate({ to: "/app/product-sku-detail", search: { id: m.id } as never })}
                        title="Open master detail"
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Nested colours */}
                  {isOpen && (
                    <div className="border-t border-border/60 bg-muted/10 px-4 py-3 md:ml-14 md:mr-4 md:rounded-lg md:border md:mb-4">
                      {variants.length === 0 ? (
                        <div className="flex flex-wrap items-center gap-3 py-2 text-xs text-muted-foreground">
                          <span>No colour variants yet under <span className="font-mono font-medium text-foreground">{m.masterSku}</span>.</span>
                          {canEdit && (
                            <button onClick={() => openColourDialog(m.id)} className="inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground">
                              <Plus className="h-3.5 w-3.5" /> Create first colour
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              <tr className="border-b border-border/60">
                                <th className="px-3 py-2 text-left">Colour</th>
                                <th className="px-3 py-2 text-left">Colour SKU</th>
                                <th className="px-3 py-2 text-right">Cost</th>
                                <th className="px-3 py-2 text-right">Price</th>
                                <th className="px-3 py-2 text-right">Margin</th>
                                <th className="px-3 py-2 text-left">HSN / Tax</th>
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {variants.map((v) => (
                                <tr key={v.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                                  <td className="px-3 py-2">
                                    <span className="font-medium">{v.colourName}</span>{" "}
                                    <span className="font-mono text-[10px] text-muted-foreground">{v.colourCode}</span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs font-medium text-primary">{v.colourSku}</td>
                                  <td className="px-3 py-2 text-right num">{fmtMoney(v.unitCost)}</td>
                                  <td className="px-3 py-2 text-right num">{fmtMoney(v.unitPrice)}</td>
                                  <td className="px-3 py-2 text-right num font-medium">{v.grossMargin.toFixed(2)}%</td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">{v.hsnCode ?? "—"} · {v.taxPercent}%</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[v.status]}`}>{v.status}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="flex justify-end gap-1">
                                      {canEdit && (
                                        <button onClick={() => setEditingColour(v)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary" title="Edit colour">
                                          <Pen className="h-3 w-3" />
                                        </button>
                                      )}
                                      {canEdit && (
                                        <button
                                          onClick={() => { if (confirm(`Remove colour ${v.colourSku}?`)) removeSku.mutate(v); }}
                                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                                          title="Remove colour"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Button-2 dialog: per-master Create Colour SKUs ── */}
      {colourTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={closeColourDialog}>
          <div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <div>
                <h3 className="font-display text-lg">Create Colour SKUs — <span className="font-mono text-info">{colourTarget.masterSku}</span></h3>
                <p className="text-xs text-muted-foreground">{colourTarget.productName} · tick colours to generate {colourTarget.masterSku}-CODE</p>
              </div>
              <button type="button" onClick={closeColourDialog} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createColourSkus.mutate(); }} className="space-y-5 p-5">
              <div>
                <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Colours *</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {COLOUR_OPTIONS.map((colour) => {
                    const alreadyAdded = existingColourCodes.has(colour.code);
                    const selected = selectedColourCodes.includes(colour.code);
                    return (
                      <button
                        key={colour.code}
                        type="button"
                        disabled={alreadyAdded || createColourSkus.isPending}
                        aria-pressed={selected}
                        onClick={() => setSelectedColourCodes((cur) => (cur.includes(colour.code) ? cur.filter((c) => c !== colour.code) : [...cur, colour.code]))}
                        className={`flex min-h-16 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                          selected ? "border-info bg-info/10 ring-1 ring-info/30" : "border-border bg-card hover:border-info/50"
                        }`}
                      >
                        <span className={`h-5 w-5 shrink-0 rounded-full ${colour.swatch}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium">{colour.name}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground">{alreadyAdded ? "Added" : colour.code}</span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-info" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedColourCodes.length > 0 && (
                <div className="rounded-lg border border-info/30 bg-info/5 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-info">SKU Preview</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedColourCodes.map((code) => (
                      <span key={code} className="rounded-md border border-info/20 bg-card px-2.5 py-1 font-mono text-xs font-medium">{colourTarget.masterSku}-{code}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Inherited from {colourTarget.masterSku}:</span>{" "}
                {fmtMoney(colourTarget.unitCost)} cost · {fmtMoney(colourTarget.unitPrice)} price · {colourTarget.taxPercent}% tax · HSN {colourTarget.hsnCode ?? "—"} · {colourTarget.unitOfMeasure}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={closeColourDialog} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button
                  type="submit"
                  disabled={createColourSkus.isPending || selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-info px-4 py-2 text-sm font-medium text-info-foreground disabled:opacity-60"
                >
                  {createColourSkus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
                  Create {selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length} SKU{selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length === 1 ? "" : "s"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Optimised edit: master ── */}
      {editingMaster && (
        <MasterEditDialog
          master={editingMaster}
          pending={patchMaster.isPending}
          onClose={() => setEditingMaster(null)}
          onSave={(payload) => patchMaster.mutate(payload)}
        />
      )}

      {/* ── Optimised edit: colour ── */}
      {editingColour && (
        <ColourEditDialog
          colour={editingColour}
          pending={patchColour.isPending}
          onClose={() => setEditingColour(null)}
          onSave={(payload) => patchColour.mutate(payload)}
        />
      )}

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
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

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// Master edit: only backend-editable fields (system SKU parts are read-only)
function MasterEditDialog({ master, pending, onSave, onClose }: { master: ProductSku; pending: boolean; onSave: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const [f, setF] = useState({
    productName: master.productName,
    itemNumber: master.itemNumber,
    hsnCode: master.hsnCode ?? "",
    taxPercent: String(master.taxPercent),
    unitOfMeasure: master.unitOfMeasure,
    unitCost: String(master.unitCost),
    unitPrice: String(master.unitPrice),
    status: master.status,
  });
  const margin = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Edit Master — <span className="font-mono text-primary">{master.masterSku}</span></h3>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              productName: f.productName.trim(),
              itemNumber: f.itemNumber.trim(),
              hsnCode: f.hsnCode.trim(),
              taxPercent: Number(f.taxPercent),
              unitOfMeasure: f.unitOfMeasure.trim(),
              unitCost: Number(f.unitCost),
              unitPrice: Number(f.unitPrice),
              status: f.status,
            });
          }}
          className="space-y-4 p-5"
        >
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
            <span className="text-muted-foreground">Master SKU:</span> <span className="font-semibold text-primary">{master.masterSku}</span>{" "}
            <span className="text-muted-foreground">(read-only · {master.brand} · {master.category} · {master.modelNumber})</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <F label="Product Name *"><input required className="inp" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></F>
            <F label="Item Number *"><input required className="inp font-mono" value={f.itemNumber} onChange={(e) => setF({ ...f, itemNumber: e.target.value })} /></F>
            <F label="HSN Code"><input className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} /></F>
            <F label="Tax %"><input className="inp num" inputMode="decimal" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} /></F>
            <F label="Unit of Measure"><input className="inp" value={f.unitOfMeasure} onChange={(e) => setF({ ...f, unitOfMeasure: e.target.value })} /></F>
            <F label="Status">
              <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </F>
            <F label="Unit Cost *"><input required className="inp num" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></F>
            <F label="Unit Price *"><input required className="inp num" inputMode="decimal" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></F>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-semibold text-success">{margin.toFixed(2)}% margin (auto)</div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save master
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ColourEditDialog({ colour, pending, onSave, onClose }: { colour: ProductSku; pending: boolean; onSave: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const [f, setF] = useState({
    colourName: colour.colourName ?? "",
    unitCost: String(colour.unitCost),
    unitPrice: String(colour.unitPrice),
    taxPercent: String(colour.taxPercent),
    hsnCode: colour.hsnCode ?? "",
    status: colour.status,
  });
  const margin = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">Edit Colour — {colour.colourName} ({colour.colourCode})</h3>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              colourName: f.colourName.trim(),
              unitCost: Number(f.unitCost),
              unitPrice: Number(f.unitPrice),
              taxPercent: Number(f.taxPercent),
              hsnCode: f.hsnCode.trim() || null,
              status: f.status,
            });
          }}
          className="space-y-4 p-5"
        >
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
            <span className="text-muted-foreground">Colour SKU:</span> <span className="font-semibold text-primary">{colour.colourSku}</span> <span className="text-muted-foreground">(read-only)</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <F label="Colour Name"><input className="inp" value={f.colourName} onChange={(e) => setF({ ...f, colourName: e.target.value })} /></F>
            <F label="Status">
              <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </F>
            <F label="Unit Cost"><input className="inp num" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></F>
            <F label="Unit Price"><input className="inp num" inputMode="decimal" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></F>
            <F label="Tax %"><input className="inp num" inputMode="decimal" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} /></F>
            <F label="HSN Code"><input className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} /></F>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-semibold text-success">{margin.toFixed(2)}% margin (auto)</div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save colour
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
