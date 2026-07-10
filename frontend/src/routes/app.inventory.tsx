import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Trash2, Link2, Upload, Database, FileDown } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { user, canWrite } = useAuth();
  const canEdit = canWrite("stock-movements");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const inventoryItemsQ = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => (await api.get<any[]>("/inventory-items")) ?? [],
  });

  const rows = (movementsQ.data ?? []).filter((m: any) => {
    if (filter !== "all" && m.direction !== filter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.item_name?.toLowerCase().includes(q) ||
      (m.sku ?? "").toLowerCase().includes(q) ||
      m.invoice?.invoice_number?.toLowerCase().includes(q) ||
      m.purchase?.invoice_number?.toLowerCase().includes(q)
    );
  });

  const balances = useMemo(() => {
    // Track purchase costs (stock-in) separately from selling prices (stock-out)
    const m = new Map<string, { sku: string; item: string; unit: string; qty: number; inQty: number; inValue: number }>();
    for (const r of (movementsQ.data ?? []) as any[]) {
      const skuKey = r.sku || r.item_name;
      const k = `${skuKey}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur = m.get(k) ?? { sku: r.sku || "—", item: r.item_name, unit: r.unit, qty: 0, inQty: 0, inValue: 0 };
      cur.qty += sign * Number(r.quantity);
      // Only stock-in movements contribute to inventory cost basis
      if (r.direction === "in") {
        cur.inQty += Number(r.quantity);
        cur.inValue += Number(r.quantity) * Number(r.unit_cost ?? 0);
      }
      m.set(k, cur);
    }
    return [...m.values()].map(c => {
      const avgCost = c.inQty > 0 ? c.inValue / c.inQty : 0;
      return { ...c, unitPrice: avgCost, inventoryValue: c.qty * avgCost };
    }).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [movementsQ.data]);

  const totalTrackingValue = useMemo(() => {
    return (inventoryItemsQ.data ?? []).reduce((sum: number, i: any) => sum + Number(i.extended_cost || 0), 0);
  }, [inventoryItemsQ.data]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stock-movements/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_movements"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteTrackingItem = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory-items/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory_items"] }); toast.success("Item removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock ledger"
        description="Stock-in from purchase invoices (credit) and stock-out from sales invoices (debit)."
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Upload className="h-4 w-4" /> Mass import tracking items
              </button>
              <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> New movement
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* ── Tracking Items ── */}
        {inventoryItemsQ.data && inventoryItemsQ.data.length > 0 && (
          <Card title={
            <span className="inline-flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Inventory tracking items ({inventoryItemsQ.data.length})
            </span>
          }>
            {inventoryItemsQ.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">Item</th>
                      <th className="px-5 py-2 text-left font-normal">Description</th>
                      <th className="px-5 py-2 text-right font-normal">Closing Qty</th>
                      <th className="px-5 py-2 text-right font-normal">Price Sale</th>
                      <th className="px-5 py-2 text-right font-normal">Extended Price</th>
                      <th className="px-5 py-2 text-right font-normal">Unit Cost</th>
                      <th className="px-5 py-2 text-right font-normal">Extended Cost</th>
                      {canEdit && <th className="px-5 py-2 text-right font-normal"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(inventoryItemsQ.data ?? []).map((i: any) => (
                      <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-2.5 font-medium">{i.item}</td>
                        <td className="px-5 py-2.5 text-muted-foreground max-w-[200px] truncate">{i.description || "—"}</td>
                        <td className="px-5 py-2.5 text-right num">{Number(i.closing_quantity).toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right num">{fmtMoney(i.price_sale)}</td>
                        <td className="px-5 py-2.5 text-right num">{fmtMoney(i.extended_price)}</td>
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
                  <tfoot>
                    <tr className="border-t border-border font-medium">
                      <td className="px-5 py-3 text-xs uppercase tracking-widest text-muted-foreground" colSpan={6}>Total extended cost</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(totalTrackingValue)}</td>
                      {canEdit && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        )}

        <Card title="Current balances (from stock movements)">
          {balances.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No items tracked yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">In Stock</th>
                    <th className="px-5 py-2 text-left font-normal">Unit</th>
                    <th className="px-5 py-2 text-right font-normal">Unit price</th>
                    <th className="px-5 py-2 text-right font-normal">Inventory value</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b, bi) => (
                    <tr key={`${b.sku}|${b.unit}`} className="border-b border-border/60">
                      <td className="px-5 py-2.5 font-mono text-[10px] text-muted-foreground" title={b.sku}>#{b.sku === "—" ? b.item.slice(0, 8).toUpperCase() : b.sku.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-2.5 font-mono text-xs">{b.sku}</td>
                      <td className="px-5 py-2.5">{b.item}</td>
                      <td className={`px-5 py-2.5 text-right num ${b.qty < 0 ? "text-destructive" : ""}`}>{b.qty.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{b.unit}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtMoney(b.unitPrice)}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtMoney(b.inventoryValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap gap-2">
          {(["all", "in", "out"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "in" ? "Stock-in" : s === "out" ? "Stock-out" : "All"}</button>
          ))}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search inventory by SKU, item, invoice..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>
        <Card title="Movements">
          {movementsQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No movements.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">SKU</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-right font-normal">Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Price</th>
                    <th className="px-5 py-2 text-right font-normal">Credit</th>
                    <th className="px-5 py-2 text-right font-normal">Debit</th>
                    <th className="px-5 py-2 text-left font-normal">Linked invoice</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: any) => {
                    const totalValue = Number(m.quantity) * Number(m.unit_cost ?? 0);
                    return (
                    <tr key={m.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={m.id}>#{m.id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(m.movement_date)}</td>
                      <td className="px-5 py-3 font-mono text-xs">{m.sku || <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="px-5 py-3">{m.item_name}</td>
                      <td className="px-5 py-3 text-right num">{Number(m.quantity).toLocaleString()} <span className="text-[10px] text-muted-foreground">{m.unit}</span></td>
                      <td className="px-5 py-3 text-right num">{m.unit_cost != null ? fmtMoney(m.unit_cost) : "—"}</td>
                      <td className="px-5 py-3 text-right num text-success">
                        {m.direction === "in" ? <><span>{Number(m.quantity).toLocaleString()} {m.unit}</span><div className="text-[10px]">{fmtMoney(totalValue)}</div></> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right num text-warning">
                        {m.direction === "out" ? <><span>{Number(m.quantity).toLocaleString()} {m.unit}</span><div className="text-[10px]">{fmtMoney(totalValue)}</div></> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {m.invoice ? (
                          <Link to="/app/invoices" search={{ view: m.invoice_id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Link2 className="h-3 w-3" />{m.invoice.invoice_number}</Link>
                        ) : m.purchase ? (
                          <Link to="/app/purchases" search={{ view: m.purchase_invoice_id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Link2 className="h-3 w-3" />{m.purchase.invoice_number}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && (
                          <button onClick={() => del.mutate(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && <NewMovementModal onClose={() => setOpen(false)} />}
      {importOpen && <ImportInventoryItemsModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function NewMovementModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    direction: "in" as "in" | "out",
    item_name: "",
    sku: "",
    quantity: "",
    unit: "unit",
    unit_cost: "",
    notes: "",
    invoice_id: "",
    purchase_invoice_id: "",
    movement_date: new Date().toISOString().slice(0, 10),
  });

  const invoicesQ = useQuery({
    queryKey: ["inv-mini"],
    queryFn: async () => (await api.get<any[]>("/invoices/mini")) ?? [],
  });
  const purchQ = useQuery({
    queryKey: ["pi-mini"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices/mini")) ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.item_name.trim()) throw new Error("Item name required");
      if (!form.quantity || Number(form.quantity) <= 0) throw new Error("Quantity must be > 0");
      await api.post("/stock-movements", {
        direction: form.direction,
        item_name: form.item_name.trim(),
        sku: form.sku || null,
        quantity: Number(form.quantity),
        unit: form.unit || "unit",
        unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
        notes: form.notes || null,
        invoice_id: form.direction === "out" && form.invoice_id ? form.invoice_id : null,
        purchase_invoice_id: form.direction === "in" && form.purchase_invoice_id ? form.purchase_invoice_id : null,
        movement_date: form.movement_date,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_movements"] }); toast.success("Movement recorded"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New stock movement</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm({ ...form, direction: "in" })} className={`rounded-md border px-3 py-2 text-sm ${form.direction === "in" ? "border-success bg-success/10 text-success" : "border-border"}`}>
              <ArrowDownToLine className="mr-2 inline h-4 w-4" /> Stock-in (purchase)
            </button>
            <button type="button" onClick={() => setForm({ ...form, direction: "out" })} className={`rounded-md border px-3 py-2 text-sm ${form.direction === "out" ? "border-warning bg-warning/10 text-warning" : "border-border"}`}>
              <ArrowUpFromLine className="mr-2 inline h-4 w-4" /> Stock-out (sale)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <L label="Item name *"><input required className="inp" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></L>
            <L label="SKU"><input className="inp" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></L>
            <L label="Quantity *"><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 10.5)" className="inp" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></L>
            <L label="Unit"><input className="inp" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg / box / unit" /></L>
            <L label="Unit cost"><input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 49.99)" className="inp" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></L>
            <L label="Date"><input required type="date" className="inp" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} /></L>
          </div>
          {form.direction === "in" ? (
            <L label="Link to purchase invoice (optional)">
              <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
                <option value="">— None —</option>
                {(purchQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.invoice_number}</option>)}
              </select>
            </L>
          ) : (
            <L label="Link to sales invoice (optional)">
              <select className="inp" value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
                <option value="">— None —</option>
                {(invoicesQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.invoice_number}</option>)}
              </select>
            </L>
          )}
          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
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

// ── Mass Import Inventory Items Modal ──

interface ImportRow {
  item: string;
  description: string;
  closing_quantity: number;
  price_sale: number;
  unit_cost: number;
}

function ImportInventoryItemsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    try {
      const wb = XLSX.utils.book_new();
      const headers = ["Item", "Description", "Closing Quantity", "Price Sale", "Unit Cost"];
      const sampleData = [
        ["Widget A", "Standard aluminum widget", 150, 29.99, 18.50],
        ["Widget B", "Premium titanium widget", 75, 59.99, 32.00],
        ["Gadget X", "Electronic gadget with battery", 200, 14.99, 8.75],
        ["Component Y", "Plastic housing component", 500, 3.50, 1.20],
        ["Tool Kit Z", "5-piece tool kit in case", 30, 89.99, 55.00],
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
      ws["!cols"] = [
        { wch: 18 },
        { wch: 30 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Inventory Items");
      XLSX.writeFile(wb, "inventory-import-template.xlsx");
      toast.success("Template downloaded");
    } catch (err) {
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
          const item = row.item ?? row["Item"] ?? row.Item ?? row["Item Name"] ?? row.item_name ?? "";
          const desc = row.description ?? row["Description"] ?? row.Description ?? row.desc ?? "";
          const cq = Number(row.closing_quantity ?? row["Closing Quantity"] ?? row.closingQty ?? row["Closing Qty"] ?? row.qty ?? row.Qty ?? 0);
          const ps = Number(row.price_sale ?? row["Price Sale"] ?? row.priceSale ?? row["Sale Price"] ?? row.unit_price ?? row["Unit Price"] ?? 0);
          const uc = Number(row.unit_cost ?? row["Unit Cost"] ?? row.unitCost ?? row.cost ?? row.Cost ?? 0);

          return {
            item: String(item).trim(),
            description: String(desc).trim(),
            closing_quantity: isNaN(cq) ? 0 : cq,
            price_sale: isNaN(ps) ? 0 : ps,
            unit_cost: isNaN(uc) ? 0 : uc,
          };
        }).filter((r) => r.item.length > 0);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: Item, Description, Closing Quantity, Price Sale, Unit Cost");
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Could not parse the file. Please check the format.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      return await api.post<{ created: number; errors: Array<{ item: string; error: string }> }>("/inventory-items/batch", {
        items: rows.map((r) => ({
          item: r.item,
          description: r.description || null,
          closing_quantity: r.closing_quantity,
          price_sale: r.price_sale,
          unit_cost: r.unit_cost,
        })),
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      const errList = (data.errors ?? []).map((e) => `${e.item}: ${e.error}`);
      setResult({ created: data.created, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created} items imported successfully`);
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <span className="inline-flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              {step === "form" ? "Mass import tracking items" : step === "preview" ? "Preview imported items" : "Import complete"}
            </span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-xs space-y-2">
              <p className="font-medium text-primary">📋 Excel / CSV format</p>
              <p className="text-muted-foreground">
                Upload a spreadsheet (.xlsx, .xls, .csv, .tsv, .ods) with the following columns:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { col: "Item *", desc: "Name of the inventory item" },
                  { col: "Description", desc: "Optional description" },
                  { col: "Closing Quantity", desc: "Number of units on hand (>= 0)" },
                  { col: "Price Sale", desc: "Selling price per unit (>= 0)" },
                  { col: "Unit Cost", desc: "Cost per unit (>= 0)" },
                ].map((f) => (
                  <div key={f.col} className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
                    <code className="font-mono text-primary text-[11px]">{f.col}</code>
                    <span className="text-muted-foreground">— {f.desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                <strong>Extended Price</strong> and <strong>Extended Cost</strong> are auto-calculated from Closing Quantity × Price Sale / Unit Cost.
              </p>
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
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
                >
                  <FileDown className="h-4 w-4" />
                  Download template
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono text-foreground">{fileName}</span> ·
                Found <strong className="text-foreground">{rows.length}</strong> items
                · Total qty: <strong className="text-foreground">{totals.totalQty.toLocaleString()}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>

            <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total extended price</span>
                <span className="font-mono">{fmtMoney(totals.extendedPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total extended cost</span>
                <span className="font-mono">{fmtMoney(totals.extendedCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gross margin</span>
                <span className="font-mono">{totals.extendedPrice > 0 ? `${(((totals.extendedPrice - totals.extendedCost) / totals.extendedPrice) * 100).toFixed(1)}%` : "—"}</span>
              </div>
            </div>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Item</th>
                    <th className="px-5 py-2 text-left font-normal">Description</th>
                    <th className="px-5 py-2 text-right font-normal">Closing Qty</th>
                    <th className="px-5 py-2 text-right font-normal">Price Sale</th>
                    <th className="px-5 py-2 text-right font-normal">Extended Price</th>
                    <th className="px-5 py-2 text-right font-normal">Unit Cost</th>
                    <th className="px-5 py-2 text-right font-normal">Extended Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3 font-medium">{r.item}</td>
                      <td className="px-5 py-3 text-muted-foreground max-w-[180px] truncate">{r.description || "—"}</td>
                      <td className="px-5 py-3 text-right num">{r.closing_quantity.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.price_sale)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.closing_quantity * r.price_sale)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.unit_cost)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.closing_quantity * r.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    <td className="px-5 py-3" colSpan={3}>Totals</td>
                    <td className="px-5 py-3 text-right num">{totals.totalQty.toLocaleString()}</td>
                    <td />
                    <td className="px-5 py-3 text-right num">{fmtMoney(totals.extendedPrice)}</td>
                    <td />
                    <td className="px-5 py-3 text-right num">{fmtMoney(totals.extendedCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button
                disabled={batchImport.isPending}
                onClick={() => batchImport.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {batchImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {rows.length} item{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-6 text-center">
              <Database className="mx-auto h-8 w-8 text-success mb-2" />
              <div className="text-3xl font-display text-success">{result.created}</div>
              <div className="text-xs text-muted-foreground mt-1">Inventory items imported successfully</div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-xs uppercase tracking-widest text-destructive mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-xs text-destructive">{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}

        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}
