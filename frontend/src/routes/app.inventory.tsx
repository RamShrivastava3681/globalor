import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { user, canWrite } = useAuth();
  const canEdit = canWrite("stock-movements");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const movementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
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

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stock-movements/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_movements"] }); toast.success("Removed"); },
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
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New movement
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <Card title="Current balances">
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
