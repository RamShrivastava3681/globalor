import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { Loader2, Package, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/products-create")({
  component: CreateProductPage,
});

const UOM_OPTIONS = ["Piece", "Kg", "Litre", "Box", "Set", "Pair", "Carton", "Dozen", "Bottle", "Roll", "Meter", "Gram"];
const TAX_OPTIONS = ["0", "5", "12", "18", "28"];

// Brand is fixed to GLO for every Master SKU — no edit option. Gender removed.
// Format: GLO-CATEGORY-MODEL (e.g. GLO-TS-001).
const FIXED_BRAND = "GLO";

function buildPreviewSku(category: string, model: string): string {
  const b = FIXED_BRAND;
  const cMap: Record<string, string> = { "t-shirt": "TS", tshirt: "TS", ts: "TS", shirt: "SH" };
  const cKey = category.trim().toLowerCase().replace(/\s+/g, "");
  const cRaw = cMap[cKey] ?? category.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 2).padEnd(2, "X");
  const c = cRaw || "GN";
  const digits = model.replace(/\D/g, "");
  const mRaw = digits ? digits.padStart(3, "0").slice(-3) : model.trim().toUpperCase().padStart(3, "0").slice(-3);
  const m = mRaw || "001";
  return `${b}-${c}-${m}`;
}

function CreateProductPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Default HSN prefilled so first submit isn't blocked by empty HSN
  const [form, setForm] = useState({
    productName: "", itemNumber: "", category: "T-Shirt", modelNumber: "001",
    hsnCode: "610910", taxPercent: "18", unitOfMeasure: "Piece", unitCost: "600", unitPrice: "1000",
  });
  // Fixed brand — kept as a constant so the payload / preview always use GLO.
  const brand = FIXED_BRAND;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [skuConflict, setSkuConflict] = useState<{ suggestion?: string; msg?: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewSku = useMemo(() => buildPreviewSku(form.category, form.modelNumber), [form.category, form.modelNumber]);
  const margin = useMemo(() => {
    const cost = Number(form.unitCost), price = Number(form.unitPrice);
    if (!Number.isFinite(cost) || !Number.isFinite(price) || price <= 0) return 0;
    return ((price - cost) / price) * 100;
  }, [form.unitCost, form.unitPrice]);
  const marginColor = margin < 0 ? "text-destructive" : margin < 10 ? "text-warning" : "text-success";

  // Debounced SKU availability check
  useEffect(() => {
    if (!form.category || !form.modelNumber) return;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ exists: boolean; suggestion?: string }>(`/product-skus/validate-sku?sku=${encodeURIComponent(previewSku)}`);
        if (res.exists) setSkuConflict({ suggestion: res.suggestion, msg: `Master SKU "${previewSku}" already exists.` });
        else setSkuConflict(null);
      } catch { /* ignore */ }
    }, 450);
    return () => clearTimeout(t);
  }, [previewSku, form.category, form.modelNumber]);

  const toNum = (v: string) => Number(String(v).replace(/[$,\s]/g, "").trim());
  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        productName: form.productName.trim(),
        itemNumber: form.itemNumber.trim(),
        brand,
        category: form.category.trim(),
        modelNumber: form.modelNumber.trim(),
        hsnCode: form.hsnCode.trim().replace(/\D/g, ""),
        taxPercent: toNum(form.taxPercent),
        unitOfMeasure: form.unitOfMeasure,
        unitCost: toNum(form.unitCost),
        unitPrice: toNum(form.unitPrice),
      };
      const res = await api.post<{ id: string }>("/product-skus", payload);
      return res as unknown as { id: string; masterSku?: string };
    },
    onSuccess: (data: any) => {
      toast.success("Master Product created successfully.");
      qc.invalidateQueries({ queryKey: ["product-skus"] });
      const id = data?.id ?? data?.data?.id;
      if (id) navigate({ to: "/app/product-sku-detail", search: { id } as any });
      else navigate({ to: "/app/product-skus" });
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Failed to create product";
      if (msg.includes("already in use") && msg.includes("Master SKU")) {
        toast.error(msg);
        return;
      }
      toast.error(msg);
      if (e?.suggestion) setSkuConflict({ suggestion: e.suggestion, msg });
      // Map backend field errors to inline errors (e.g. "hsnCode: HSN Code must be...")
      const fieldMap: Record<string, string> = {};
      if (msg.includes(":")) {
        const [field] = msg.split(":");
        const key = field.trim();
        if (["productName","itemNumber","category","modelNumber","hsnCode","taxPercent","unitCost","unitPrice","unitOfMeasure"].includes(key)) {
          fieldMap[key] = msg.split(":").slice(1).join(":").trim();
        }
      }
      if (Object.keys(fieldMap).length) setErrors((prev) => ({ ...prev, ...fieldMap }));
    },
  });

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.productName.trim()) e.productName = "Product Name is required";
    if (!form.itemNumber.trim()) e.itemNumber = "Item Number is required";
    if (!form.category.trim()) e.category = "Category is required";
    if (!form.modelNumber.trim()) e.modelNumber = "Model Number is required";
    const hsnClean = form.hsnCode.trim().replace(/\D/g, "");
    if (!/^[0-9]{4,8}$/.test(hsnClean)) e.hsnCode = "HSN Code must be 4-8 digits";
    const tax = toNum(form.taxPercent);
    if (Number.isNaN(tax) || tax < 0 || tax > 100) e.taxPercent = "Tax % must be 0–100";
    const cost = toNum(form.unitCost);
    if (Number.isNaN(cost) || cost < 0) e.unitCost = "Unit Cost must be ≥ 0";
    const price = toNum(form.unitPrice);
    if (Number.isNaN(price) || price <= 0) e.unitPrice = "Unit Price must be > 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors((prev) => { const n = { ...prev }; delete n[k]; return n; });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) { toast.error("Please fix validation errors"); return; }
    setConfirmOpen(true);
  };

  const doCreate = () => { setConfirmOpen(false); create.mutate(); };

  const applySuggestion = () => {
    if (!skuConflict?.suggestion) return;
    // suggestion like GLO-TS-002 -> extract model number
    const parts = skuConflict.suggestion.split("-");
    const model = parts[parts.length - 1];
    setForm({ ...form, modelNumber: model });
    setSkuConflict(null);
    toast.info(`Model number updated to ${model}`);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Create Product"
        description="Create the master product. The Master SKU is auto-generated as GLO-CATEGORY-MODEL_NUMBER and is unique system-wide."
      />

      <div className="mx-auto max-w-[1080px] p-4 md:p-8 space-y-6">
        {/* ── SKU Preview ── */}
        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              <Package className="h-3.5 w-3.5" /> Master SKU Preview
            </div>
            <span className="rounded-md bg-card border border-primary/20 px-3 py-1.5 font-mono text-sm font-semibold text-primary">{previewSku}</span>
            {skuConflict ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" />{skuConflict.msg}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Available</span>
            )}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">Format: GLO-CATEGORY-MODEL_NUMBER · e.g. GLO-TS-001 · Auto-generated · Read-only</div>
          {skuConflict?.suggestion && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Suggestion:</span>
              <span className="font-mono font-medium text-primary">{skuConflict.suggestion}</span>
              <button onClick={applySuggestion} className="rounded-md border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Apply</button>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── Basic ── */}
          <div className="rounded-xl border border-border bg-card p-5 md:p-6">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Basic Product Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <F label="Product Name *" error={errors.productName}><input placeholder="e.g. Classic Cotton T-Shirt" className={`inp ${errors.productName ? "border-destructive" : ""}`} value={form.productName} onChange={set("productName")} /></F>
              <F label="Item Number *" error={errors.itemNumber}><input placeholder="e.g. ITEM-001" className={`inp font-mono ${errors.itemNumber ? "border-destructive" : ""}`} value={form.itemNumber} onChange={set("itemNumber")} /></F>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Master SKU — automatically generated</label>
                <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm font-medium text-primary">{previewSku}<span className="ml-2 text-[10px] font-normal text-muted-foreground">(read-only)</span></div>
              </div>
              <F label="HSN Code *" error={errors.hsnCode}><input placeholder="e.g. 610910" className={`inp font-mono ${errors.hsnCode ? "border-destructive" : ""}`} value={form.hsnCode} onChange={set("hsnCode")} maxLength={8} /></F>
              <F label="Tax % *" error={errors.taxPercent}>
                <div className="relative"><select className={`inp pr-8 ${errors.taxPercent ? "border-destructive" : ""}`} value={form.taxPercent} onChange={set("taxPercent")}>{TAX_OPTIONS.map((t) => <option key={t} value={t}>{t}%</option>)}<option value="3">3%</option></select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span></div>
              </F>
              <F label="Unit of Measure *"><select className="inp" value={form.unitOfMeasure} onChange={set("unitOfMeasure")}>{UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}</select></F>
            </div>

            <h4 className="mt-6 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">SKU Generation Inputs</h4>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Brand — fixed</label>
                <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm font-medium text-primary">{brand}<span className="ml-2 text-[10px] font-normal text-muted-foreground">(fixed · no edit)</span></div>
              </div>
              <F label="Category *" error={errors.category}><input placeholder="T-Shirt" className={`inp ${errors.category ? "border-destructive" : ""}`} value={form.category} onChange={set("category")} /></F>
              <F label="Model Number *" error={errors.modelNumber}><input placeholder="001" className={`inp font-mono ${errors.modelNumber ? "border-destructive" : ""}`} value={form.modelNumber} onChange={set("modelNumber")} /></F>
            </div>
          </div>

          {/* ── Pricing ── */}
          <div className="rounded-xl border border-border bg-card p-5 md:p-6">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Pricing Information</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <F label="Unit Cost *" error={errors.unitCost}>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input type="text" inputMode="decimal" placeholder="600" className={`inp num pl-7 ${errors.unitCost ? "border-destructive" : ""}`} value={form.unitCost} onChange={set("unitCost")} /></div>
              </F>
              <F label="Unit Price *" error={errors.unitPrice}>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span><input type="text" inputMode="decimal" placeholder="1000" className={`inp num pl-7 ${errors.unitPrice ? "border-destructive" : ""}`} value={form.unitPrice} onChange={set("unitPrice")} /></div>
              </F>
              <F label="Gross Margin % — auto-calculated">
                <div className={`flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm font-semibold ${marginColor}`}>{margin.toFixed(2)}%<span className="ml-2 text-[10px] font-normal text-muted-foreground">(read-only)</span></div>
              </F>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Formula: ((Unit Price − Unit Cost) ÷ Unit Price) × 100 · Example: $600 cost, $1,000 price → 40.00%</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => history.back()} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <button type="submit" disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create Product
            </button>
          </div>
        </form>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Create Master Product?</h3>
            <p className="mt-2 text-sm text-muted-foreground">Master SKU <span className="font-mono font-medium text-primary">{previewSku}</span> will be created. This cannot be changed later.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
              <button onClick={doCreate} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm & Create</button>
            </div>
          </div>
        </div>
      )}

      <style>{`.inp{width:100%;background:var(--color-input,white);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

function F({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>;
}
