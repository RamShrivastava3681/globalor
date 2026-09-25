import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoneyINR } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Package, Boxes, CircleDollarSign, Percent, PackageOpen, Check, Eye, Trash2,
} from "lucide-react";
import { toast } from "sonner";

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

// ── Colour vocabulary (shared with backend) ─────────────────────────────────

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

export function ProductSkusPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "INACTIVE">("all");

  // ── Colour dialog state: which master are we adding colours to? ──
  const [colourTargetId, setColourTargetId] = useState<string | null>(null);
  const [selectedColourCodes, setSelectedColourCodes] = useState<string[]>([]);

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
    return map;
  }, [rows]);

  const variantCount = useMemo(() => rows.filter((r) => r.productType === "COLOUR").length, [rows]);

  const colourTarget = colourTargetId ? masters.find((m) => m.id === colourTargetId) ?? null : null;
  const existingColourCodes = useMemo(() => {
    if (!colourTarget) return new Set<string>();
    return new Set(
      (variantsByParent.get(colourTarget.id) ?? [])
        .map((v) => (v.colourCode ?? "").toUpperCase())
        .filter(Boolean),
    );
  }, [colourTarget, variantsByParent]);

  const openColourDialog = (masterId: string) => {
    setColourTargetId(masterId);
    setSelectedColourCodes([]);
  };

  const closeColourDialog = () => {
    if (createColours.isPending) return;
    setColourTargetId(null);
    setSelectedColourCodes([]);
  };

  const createColours = useMutation({
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
      qc.invalidateQueries({ queryKey: ["product-skus"] });
      if (colourTarget) qc.invalidateQueries({ queryKey: ["product-sku-master", colourTarget.id] });
      if (created > 0) toast.success(`${created} colour SKU${created === 1 ? "" : "s"} created under ${colourTarget?.masterSku}`);
      if (failed.length > 0) {
        setSelectedColourCodes(failed.map((f) => f.code));
        toast.error(`${failed.length} could not be created: ${failed[0].message}`);
        return;
      }
      closeColourDialogReset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create colour SKUs"),
  });

  const closeColourDialogReset = () => {
    setColourTargetId(null);
    setSelectedColourCodes([]);
  };

  const removeMaster = useMutation({
    mutationFn: async (id: string) => {
      const variants = variantsByParent.get(id) ?? [];
      if (variants.length > 0) throw new Error("Remove colour variants first (open the master detail page)");
      await api.delete(`/product-skus/${id}`);
    },
    onSuccess: () => {
      toast.success("Master SKU removed");
      qc.invalidateQueries({ queryKey: ["product-skus"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filteredMasters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return masters.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!q) return true;
      const variants = variantsByParent.get(m.id) ?? [];
      return (
        m.productName.toLowerCase().includes(q) ||
        m.masterSku.toLowerCase().includes(q) ||
        (m.brand ?? "").toLowerCase().includes(q) ||
        (m.category ?? "").toLowerCase().includes(q) ||
        (m.itemNumber ?? "").toLowerCase().includes(q) ||
        variants.some(
          (v) =>
            (v.colourSku ?? "").toLowerCase().includes(q) ||
            (v.colourName ?? "").toLowerCase().includes(q),
        )
      );
    });
  }, [masters, variantsByParent, searchQuery, statusFilter]);

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Product Catalogue"
        description="Master SKU is the parent record. Every colour-coded SKU inherits from its master — use the per-row button to add colours."
        actions={
          canEdit ? (
            <button
              onClick={() => navigate({ to: "/app/products-create" })}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover"
            >
              <Plus className="h-4 w-4" /> Create Master SKU
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-4 md:p-8">
        {/* ── Stats ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Package className="h-3.5 w-3.5 text-primary" /> Master SKUs
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">{masters.length}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <PackageOpen className="h-3.5 w-3.5 text-info" /> Colour SKUs
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">{variantCount}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5 text-success" /> Inventory value
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">
              {fmtMoneyINR(rows.reduce((s, p) => s + p.unitPrice, 0))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Percent className="h-3.5 w-3.5 text-warning" /> Avg margin
            </div>
            <div className="mt-2 font-display text-2xl font-semibold">
              {rows.length
                ? `${(rows.reduce((s, p) => s + (p.grossMargin ?? 0), 0) / rows.length).toFixed(1)}%`
                : "—"}
            </div>
          </Card>
        </div>

        {/* ── Master list ── */}
        <Card>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Search masters by name, SKU, brand, category, colour…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 sm:max-w-md"
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
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredMasters.length} of {masters.length} masters
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Master SKU</th>
                  <th className="px-3 py-3 text-left">Colour SKUs</th>
                  <th className="px-3 py-3 text-right">Cost / Price</th>
                  <th className="px-3 py-3 text-right">Margin</th>
                  <th className="px-3 py-3 text-left">HSN / Tax</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {skusQ.isLoading && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!skusQ.isLoading && filteredMasters.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted-foreground">
                      {masters.length === 0 ? (
                        <span>No master SKUs yet. Click <span className="text-foreground">Create Master SKU</span> to start.</span>
                      ) : (
                        "No master SKUs match your filters."
                      )}
                    </td>
                  </tr>
                )}
                {filteredMasters.map((m) => {
                  const variants = variantsByParent.get(m.id) ?? [];
                  return (
                    <tr key={m.id} className={`border-b border-border/60 hover:bg-muted/30 ${m.status === "INACTIVE" ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                            <Package className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{m.productName}</div>
                            <div className="font-mono text-[11px] font-semibold text-primary">{m.masterSku}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              #{m.itemNumber} · {[m.brand, m.gender, m.category, m.modelNumber].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {variants.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No colours yet</span>
                        ) : (
                          <div className="flex max-w-[280px] flex-wrap gap-1.5">
                            {variants.map((v) => (
                              <span key={v.id} title={`${v.colourName} (${v.colourCode})`} className="rounded-md border border-info/25 bg-info/5 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                                {v.colourSku}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] text-muted-foreground">{variants.length} colour{variants.length === 1 ? "" : "s"}</div>
                      </td>
                      <td className="px-3 py-3 text-right num">
                        <div>{fmtMoneyINR(m.unitPrice)}</div>
                        <div className="text-[10px] text-muted-foreground">cost {fmtMoneyINR(m.unitCost)}</div>
                      </td>
                      <td className="px-3 py-3 text-right num font-medium">{m.grossMargin.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{m.hsnCode ?? "—"} · {m.taxPercent}%</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_STYLES[m.status]}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <button
                              onClick={() => openColourDialog(m.id)}
                              title={`Create colour-coded SKUs under ${m.masterSku}`}
                              className="inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:opacity-90"
                            >
                              <PackageOpen className="h-3.5 w-3.5" /> Add Colours
                            </button>
                          )}
                          <Link
                            to="/app/product-sku-detail"
                            search={{ id: m.id } as never}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                          >
                            <Eye className="h-3.5 w-3.5" /> View
                          </Link>
                          {canEdit && (variantsByParent.get(m.id) ?? []).length === 0 && (
                            <button
                              onClick={() => { if (confirm(`Remove master ${m.masterSku}?`)) removeMaster.mutate(m.id); }}
                              className="rounded-md border border-border px-2 py-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
                              aria-label="Delete master"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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

      {/* ── Per-master Create Colour SKUs dialog ── */}
      {colourTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={closeColourDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-colour-skus-title"
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <div>
                <h3 id="create-colour-skus-title" className="font-display text-lg">
                  Create Colour SKUs — <span className="font-mono text-primary">{colourTarget.masterSku}</span>
                </h3>
                <p className="text-xs text-muted-foreground">{colourTarget.productName} · tick colours to generate {colourTarget.masterSku}-CODE</p>
              </div>
              <button type="button" onClick={closeColourDialog} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createColours.mutate(); }}
              className="space-y-5 p-5"
            >
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
                        disabled={alreadyAdded || createColours.isPending}
                        aria-pressed={selected}
                        onClick={() => setSelectedColourCodes((cur) =>
                          cur.includes(colour.code) ? cur.filter((c) => c !== colour.code) : [...cur, colour.code],
                        )}
                        className={`flex min-h-16 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                          selected ? "border-info bg-info/10 text-foreground ring-1 ring-info/30" : "border-border bg-card hover:border-info/50"
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
                      <span key={code} className="rounded-md border border-info/20 bg-card px-2.5 py-1 font-mono text-xs font-medium text-foreground">
                        {colourTarget.masterSku}-{code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Inherited from {colourTarget.masterSku}:</span>{" "}
                {fmtMoneyINR(colourTarget.unitCost)} cost · {fmtMoneyINR(colourTarget.unitPrice)} price · {colourTarget.taxPercent}% tax · HSN {colourTarget.hsnCode ?? "—"} · {colourTarget.unitOfMeasure}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={closeColourDialog} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button
                  type="submit"
                  disabled={createColours.isPending || selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-info px-4 py-2 text-sm font-medium text-info-foreground disabled:opacity-60"
                >
                  {createColours.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
                  Create {selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length} SKU{selectedColourCodes.filter((c) => !existingColourCodes.has(c)).length === 1 ? "" : "s"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
