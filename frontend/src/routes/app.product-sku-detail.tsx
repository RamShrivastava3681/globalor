import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoneyUSD } from "@/components/ledger-ui";
import { Package, Pen, Trash2, Plus, PackageOpen, ArrowLeft, Save, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/product-sku-detail")({
  component: ProductSkuDetailPage,
  validateSearch: (s: Record<string, unknown>) => ({ id: (s.id as string) ?? "" }),
});

type ProductSku = {
  id: string; masterSku: string; parentId: string | null; parentSku: string | null;
  productName: string; itemNumber: string; brand: string | null; gender: string | null; category: string | null; modelNumber: string | null;
  hsnCode: string | null; taxPercent: number; unitOfMeasure: string; unitCost: number; unitPrice: number; grossMargin: number;
  productType: "MASTER" | "COLOUR"; status: "ACTIVE" | "INACTIVE"; colourName: string | null; colourCode: string | null; colourSku: string | null; created_at: string;
};

const STATUS_STYLES: Record<string, string> = { ACTIVE: "border-success/40 bg-success/10 text-success", INACTIVE: "border-border bg-muted text-muted-foreground" };
const COLOUR_NAME_OPTIONS = ["Black","White","Red","Green","Grey","Blue","Navy Blue","Yellow","Orange","Pink","Purple","Brown"] as const;
const colourNameToCode: Record<string,string> = { Black:"BLK",White:"WHT",Red:"RED",Green:"GRN",Grey:"GRY",Blue:"BLU","Navy Blue":"NVY",Yellow:"YLW",Orange:"ORG",Pink:"PNK",Purple:"PUR",Brown:"BRN" };

export function ProductSkuDetailPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("products");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { id } = Route.useSearch() as { id: string };

  const [view, setView] = useState<"overview" | "edit">("overview");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ colourName: "Black", unitCost: "", unitPrice: "", taxPercent: "", hsnCode: "", status: "ACTIVE" as const });
  const [colourEdit, setColourEdit] = useState<ProductSku | null>(null);

  const master = useQuery({
    queryKey: ["product-sku-master", id],
    queryFn: async () => {
      const res: any = await api.get(`/product-skus/master/${id}`);
      return res as { master: ProductSku; variants: ProductSku[] };
    },
    enabled: !!id,
  });

  const masterData = master.data;
  const mat = masterData?.master as ProductSku | undefined;
  const variants = (masterData?.variants ?? []) as ProductSku[];
  const margin = mat && mat.unitPrice > 0 ? ((mat.unitPrice - mat.unitCost) / mat.unitPrice) * 100 : 0;

  // keep add form defaults in sync when master loads
  const ensureAddDefaults = () => {
    if (!mat) return;
    if (addForm.unitCost === "" && addForm.unitPrice === "" && addForm.taxPercent === "") {
      setAddForm({ colourName: "Black", unitCost: String(mat.unitCost), unitPrice: String(mat.unitPrice), taxPercent: String(mat.taxPercent), hsnCode: mat.hsnCode ?? "", status: "ACTIVE" });
    }
  };

  const saveMaster = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => { await api.patch(`/product-skus/${id}`, payload); },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["product-sku-master", id] }); setView("overview"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const addColour = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        parentProductId: id,
        colourName: addForm.colourName,
        unitCost: addForm.unitCost !== "" ? Number(addForm.unitCost) : undefined,
        unitPrice: addForm.unitPrice !== "" ? Number(addForm.unitPrice) : undefined,
        taxPercent: addForm.taxPercent !== "" ? Number(addForm.taxPercent) : undefined,
        hsnCode: addForm.hsnCode.trim() || undefined,
        status: addForm.status,
      };
      const res: any = await api.post("/product-skus", body);
      return res;
    },
    onSuccess: () => {
      toast.success("Colour variant added");
      qc.invalidateQueries({ queryKey: ["product-sku-master", id] });
      setAddOpen(false);
      setAddForm({ colourName: "Black", unitCost: String(mat?.unitCost ?? ""), unitPrice: String(mat?.unitPrice ?? ""), taxPercent: String(mat?.taxPercent ?? ""), hsnCode: mat?.hsnCode ?? "", status: "ACTIVE" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const editColour = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (!colourEdit) throw new Error("No colour selected");
      await api.patch(`/product-skus/${colourEdit.id}`, body);
    },
    onSuccess: () => { toast.success("Colour updated"); qc.invalidateQueries({ queryKey: ["product-sku-master", id] }); setColourEdit(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeColour = useMutation({
    mutationFn: async (cid: string) => { await api.delete(`/product-skus/${cid}`); },
    onSuccess: () => { toast.success("Colour removed"); qc.invalidateQueries({ queryKey: ["product-sku-master", id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!id) return <div className="p-6 text-center text-sm text-muted-foreground">No product selected. <button onClick={() => navigate({ to: "/app/product-skus" })} className="ml-2 rounded-md border border-border px-3 py-1 text-xs">Back</button></div>;
  if (master.isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (master.isError || !mat) return <div className="p-6 text-center"><p className="text-sm text-muted-foreground">{(master.error as any)?.message ?? "Product not found."}</p><button onClick={() => navigate({ to: "/app/product-skus" })} className="mt-3 rounded-md border border-border px-4 py-2 text-sm">Back to products</button></div>;

  const addColourCode = colourNameToCode[addForm.colourName] ?? "BLK";
  const addColourSku = `${mat.masterSku}-${addColourCode}`;
  const addMargin = Number(addForm.unitPrice) > 0 ? ((Number(addForm.unitPrice) - Number(addForm.unitCost)) / Number(addForm.unitPrice)) * 100 : 0;

  return (
    <div>
      <PageHeader eyebrow="Inventory" title={mat.productName} description={`Master SKU ${mat.masterSku} · Item #${mat.itemNumber}`} actions={canEdit ? <button onClick={() => setView((v) => v === "overview" ? "edit" : "overview")} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"><Pen className="h-3.5 w-3.5" /> Edit product</button> : null} />

      <div className="space-y-6 p-4 md:p-8">
        {/* Overview */}
        <Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Info label="Product Name" value={mat.productName} mono={false} />
            <Info label="Master SKU" value={mat.masterSku} mono accent />
            <Info label="Item Number" value={`#${mat.itemNumber}`} mono />
            <div className="rounded-xl border border-border p-4"><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</div><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[mat.status]}`}>{mat.status}</span></div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Info label="Brand" value={mat.brand ?? "—"} />
            <Info label="Category" value={mat.category ?? "—"} />
            <Info label="Model" value={mat.modelNumber ?? "—"} mono />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Info label="HSN Code" value={mat.hsnCode ?? "—"} mono />
            <Info label="Tax %" value={`${mat.taxPercent}%`} />
            <Info label="Unit" value={mat.unitOfMeasure} />
            <div className="rounded-xl border border-border bg-muted/20 p-4"><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gross Margin</div><div className="font-display text-xl font-semibold text-success">{margin.toFixed(2)}%</div><div className="text-[11px] text-muted-foreground">((Price − Cost) ÷ Price) × 100 · read-only</div></div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Info label="Unit Cost" value={fmtMoneyUSD(mat.unitCost)} large />
            <Info label="Unit Price" value={fmtMoneyUSD(mat.unitPrice)} large />
            <Info label="Margin Value" value={fmtMoneyUSD(mat.unitPrice - mat.unitCost)} large />
          </div>
        </Card>

        {/* SKU Structure */}
        <Card>
          <h3 className="font-display text-sm font-semibold">SKU Structure</h3>
          <div className="mt-3 font-mono text-sm">
            <div className="font-semibold text-primary">{mat.masterSku}</div>
            <div className="mt-2 space-y-1 text-xs">
              {variants.map((v) => <div key={v.id} className="flex items-center gap-2"><PackageOpen className="h-3.5 w-3.5 text-info" /><span className="font-medium text-foreground">{v.colourSku}</span><span className="ml-auto text-muted-foreground">{v.colourName} · {v.colourCode}</span></div>)}
              {variants.length === 0 && <div className="py-2 text-muted-foreground">No colour variants yet.</div>}
            </div>
          </div>
        </Card>

        {/* Colour variants */}
        <Card action={canEdit ? <button onClick={() => { ensureAddDefaults(); setAddOpen(true); }} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"><Plus className="h-3.5 w-3.5" /> Add Colour</button> : undefined}>
          <div className="mb-3 flex items-center gap-2"><h3 className="font-display text-base font-semibold">Colour Variants</h3><span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{variants.length} total</span></div>
          {variants.length > 0 ? (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border"><th className="px-4 py-3 text-left">Colour</th><th className="px-3 py-3 text-left font-mono text-[11px]">Colour SKU</th><th className="px-3 py-3 text-right">Cost</th><th className="px-3 py-3 text-right">Price</th><th className="px-3 py-3 text-right">Margin</th><th className="px-3 py-3 text-center">Status</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
              <tbody>{variants.map((v) => {
                const vm = v.unitPrice > 0 ? ((v.unitPrice - v.unitCost) / v.unitPrice) * 100 : 0;
                return <tr key={v.id} className="border-b border-border/60 hover:bg-muted/30"><td className="px-4 py-3"><span className="font-medium">{v.colourName}</span> <span className="font-mono text-[10px] text-muted-foreground">{v.colourCode}</span></td><td className="px-3 py-3 font-mono text-xs text-primary">{v.colourSku}</td><td className="px-3 py-3 text-right">{fmtMoneyUSD(v.unitCost)}</td><td className="px-3 py-3 text-right">{fmtMoneyUSD(v.unitPrice)}</td><td className="px-3 py-3 text-right font-medium">{vm.toFixed(2)}%</td><td className="px-3 py-3 text-center"><span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[v.status]}`}>{v.status}</span></td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-1"><button onClick={() => setColourEdit(v)} className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary"><Pen className="h-3 w-3" /></button><button onClick={() => { if (confirm(`Remove ${v.colourSku}?`)) removeColour.mutate(v.id); }} className="rounded-md border border-border px-2 py-1 text-xs hover:border-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>;
              })}</tbody></table></div>
          ) : <div className="py-10 text-center text-sm text-muted-foreground">No colour variants yet. Click <span className="text-foreground">+ Add Colour</span> to create one.</div>}
        </Card>

        <Card className="border-info/30 bg-info/5"><div className="flex gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-info/10 text-info"><Package className="h-4 w-4" /></div><div><div className="font-mono text-xs font-medium">{mat.masterSku}</div><div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>Master Product (base)</span>{variants.map((v) => <span key={v.id} className="inline-flex items-center gap-1"><ArrowLeft className="h-2.5 w-2.5" />{v.colourSku}</span>)}</div></div></div><div className="mt-3 text-[10px] text-muted-foreground">Colour variants inherit from master. Future Size: {mat.masterSku}-BLK-S / -M / -L without redesign.</div></Card>
      </div>

      {/* Add Colour modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setAddOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3"><h3 className="font-display text-lg">Add Colour Variant</h3><button onClick={() => setAddOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
                <div className="text-[11px] uppercase tracking-widest text-primary">Live SKU Preview</div>
                <div className="mt-1 font-mono text-sm"><span className="text-muted-foreground">Master SKU:</span> <span className="font-semibold text-primary">{mat.masterSku}</span></div>
                <div className="font-mono text-sm"><span className="text-muted-foreground">Colour SKU:</span> <span className="font-semibold text-primary">{addColourSku}</span></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <F label="Colour Name *"><select className="inp" value={addForm.colourName} onChange={(e) => setAddForm({ ...addForm, colourName: e.target.value })}>{COLOUR_NAME_OPTIONS.map((c) => <option key={c} value={c}>{c} ({colourNameToCode[c]})</option>)}</select></F>
                <F label="Colour Code — auto"><div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm font-medium text-primary">{addColourCode} <span className="ml-2 text-[10px] text-muted-foreground">(read-only)</span></div></F>
                <F label="Colour SKU — auto"><div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-xs font-medium text-primary">{addColourSku}</div></F>
                <F label="Status"><select className="inp" value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value as any })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></F>
                <F label="Unit Cost (prefilled, editable)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={addForm.unitCost} onChange={(e) => setAddForm({ ...addForm, unitCost: e.target.value })} placeholder={String(mat.unitCost)} /></div></F>
                <F label="Unit Price (prefilled, editable)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={addForm.unitPrice} onChange={(e) => setAddForm({ ...addForm, unitPrice: e.target.value })} placeholder={String(mat.unitPrice)} /></div></F>
                <F label="Gross Margin % — auto"><div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm font-semibold text-success">{addMargin.toFixed(2)}%</div></F>
                <F label="Tax % (inherited, editable)"><div className="relative"><input className="inp num" value={addForm.taxPercent} onChange={(e) => setAddForm({ ...addForm, taxPercent: e.target.value })} placeholder={String(mat.taxPercent)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span></div></F>
                <F label="HSN Code (inherited, editable)"><input className="inp font-mono" value={addForm.hsnCode} onChange={(e) => setAddForm({ ...addForm, hsnCode: e.target.value })} placeholder={mat.hsnCode ?? ""} /></F>
              </div>
              <div className="flex justify-end gap-2 border-t border-border pt-4"><button onClick={() => setAddOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button onClick={() => addColour.mutate()} disabled={addColour.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{addColour.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save Colour Variant</button></div>
            </div>
          </div>
        </div>
      )}

      {colourEdit && <ColourEditModal colour={colourEdit} masterSku={mat.masterSku} onSave={(b) => editColour.mutate(b as any)} onClose={() => setColourEdit(null)} />}
      {view === "edit" && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setView("overview")}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3"><h3 className="font-display text-lg">Edit Product</h3><button onClick={() => setView("overview")}><X className="h-4 w-4" /></button></div><EditMasterForm product={mat} onSave={saveMaster.mutate} onClose={() => setView("overview")} /></div></div>}
      <style>{`.inp{width:100%;background:var(--color-input,white);border:1px solid var(--color-border);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

function Info({ label, value, mono, accent, large }: { label: string; value: string; mono?: boolean; accent?: boolean; large?: boolean }) {
  return <div className="rounded-xl border border-border p-4"><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div><div className={`${large ? "font-display text-lg font-semibold" : ""} ${mono ? "font-mono text-sm" : "font-medium"} ${accent ? "text-primary" : ""}`}>{value}</div></div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

function ColourEditModal({ colour, masterSku, onSave, onClose }: { colour: ProductSku; masterSku: string; onSave: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const [f, setF] = useState({ unitCost: String(colour.unitCost), unitPrice: String(colour.unitPrice), taxPercent: String(colour.taxPercent), hsnCode: colour.hsnCode ?? "", status: colour.status });
  const m = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}><div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between border-b border-border px-5 py-3"><h3 className="font-display text-lg">Edit Colour — {colour.colourName} ({colour.colourCode})</h3><button onClick={onClose}><X className="h-4 w-4" /></button></div>
    <form onSubmit={(e) => { e.preventDefault(); onSave({ unitCost: Number(f.unitCost), unitPrice: Number(f.unitPrice), taxPercent: Number(f.taxPercent), hsnCode: f.hsnCode.trim() || null, status: f.status }); }} className="space-y-4 p-5">
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs"><span className="text-muted-foreground">Colour SKU:</span> <span className="font-semibold text-primary">{colour.colourSku}</span> <span className="text-muted-foreground">(read-only)</span></div>
      <div className="grid gap-3 md:grid-cols-2">
        <F label="Unit Cost"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></div></F>
        <F label="Unit Price"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></div></F>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-semibold text-success">{m.toFixed(2)}% <span className="text-[10px] text-muted-foreground">margin (read-only)</span></div>
        <F label="Tax %"><div className="relative"><input className="inp num" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span></div></F>
        <F label="HSN Code"><input className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} /></F>
        <F label="Status"><select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></F>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button type="submit" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Save className="h-4 w-4" /> Save</button></div>
    </form></div></div>;
}

function EditMasterForm({ product, onSave, onClose }: { product: ProductSku; onSave: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const [f, setF] = useState({ productName: product.productName, itemNumber: product.itemNumber, hsnCode: product.hsnCode ?? "", taxPercent: String(product.taxPercent), unitCost: String(product.unitCost), unitPrice: String(product.unitPrice), status: product.status });
  const m = Number(f.unitPrice) > 0 ? ((Number(f.unitPrice) - Number(f.unitCost)) / Number(f.unitPrice)) * 100 : 0;
  return <form onSubmit={(e) => { e.preventDefault(); onSave({ productName: f.productName, itemNumber: f.itemNumber, hsnCode: f.hsnCode, taxPercent: Number(f.taxPercent), unitCost: Number(f.unitCost), unitPrice: Number(f.unitPrice), status: f.status }); }} className="space-y-4 p-5">
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs"><span className="text-muted-foreground">Master SKU:</span> <span className="font-semibold text-primary">{product.masterSku}</span> (read-only)</div>
    <div className="grid gap-3 md:grid-cols-2">
      <F label="Product Name *"><input required className="inp" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></F>
      <F label="Item Number *"><input required className="inp font-mono" value={f.itemNumber} onChange={(e) => setF({ ...f, itemNumber: e.target.value })} /></F>
      <F label="HSN Code"><input className="inp font-mono" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} /></F>
      <F label="Tax %"><input className="inp num" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} /></F>
      <F label="Unit Cost"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></div></F>
      <F label="Unit Price"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input className="inp num pl-7" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></div></F>
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-semibold text-success">{m.toFixed(2)}% margin (read-only)</div>
      <F label="Status"><select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></F>
    </div>
    <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button type="submit" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Save className="h-4 w-4" /> Save changes</button></div>
  </form>;
}
