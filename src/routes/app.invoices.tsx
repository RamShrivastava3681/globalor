import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Send, Copy, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

function InvoicesPage() {
  const { isAdmin, isChecker, isClient, isTreasury, user, canWrite } = useAuth();
  const canReview = isAdmin || isChecker;
  const canCreate = canWrite("invoices");
  const canEdit = canWrite("invoices");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list"],
    queryFn: async () => (await api.get<any[]>("/api/invoices")) ?? [],
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/api/debtors")) ?? [],
  });

  const purchasesQ = useQuery({
    queryKey: ["purchases-for-link"],
    queryFn: async () => (await api.get<any[]>("/api/purchase-invoices/mini")) ?? [],
  });

  const sendNoa = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.post<{ noa_status: string; noa_link: string }>(`/api/invoices/${id}/send-noa`);
      return result;
    },
    onSuccess: (result, id) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const link = `${window.location.origin}/noa/${result.noa_link.replace("/noa/", "")}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success("NOA link copied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/invoices/${id}`);
    },
    onSuccess: () => {
      toast.success("Invoice removed");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const canSendNoa = canWrite("invoices") || canWrite("checker-desk");
  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  const filtered = (invoicesQ.data ?? []).filter((i: any) => filter === "all" || i.status === filter);

  return (
    <div>
      <PageHeader
        eyebrow="Invoices"
        title={isAdmin ? "Invoice queue" : "Your invoices"}
        description={isAdmin ? "Submitted invoices route to the checker for approval before reaching treasury." : "Submit invoices; the checker reviews them before they enter the funding queue."}
        actions={
          canCreate ? (
            <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "advanced", "paid", "overdue", "rejected"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s}</button>
          ))}
        </div>

        <Card>
          {invoicesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => {
                    const adv = (Number(i.amount) * Number(i.advance_rate)) / 100;
                    const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                    const lateDays = i.status === "paid"
                      ? (i.late_days != null ? Number(i.late_days) : 0)
                      : Math.max(0, dpd);
                    return (
                      <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{i.invoice_number}</div>
                          {i.po_number && <div className="text-[10px] text-muted-foreground">PO {i.po_number}{i.po_date ? ` · ${fmtDate(i.po_date)}` : ""}</div>}
                          {i.purchase && (
                            <Link to="/app/purchases" className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                              <Link2 className="h-2.5 w-2.5" /> {i.purchase.invoice_number} · {i.purchase.vendor?.name ?? ""}
                            </Link>
                          )}
                        </td>
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{i.client?.company_name ?? "—"}</td>}
                        <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                        <td className="px-5 py-3 text-right num text-primary">{fmtMoney(adv)}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                        <td className="px-5 py-3">
                          <NoaBadge status={i.noa_status} />
                          {i.noa_comments && <div className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={i.noa_comments}>"{i.noa_comments}"</div>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            {canSendNoa && i.noa_status === "not_sent" && (
                              <button onClick={() => sendNoa.mutate(i.id)} className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                                <Send className="h-3 w-3" /> Send NOA
                              </button>
                            )}
                            {i.noa_status !== "not_sent" && (
                              <button onClick={() => copyNoa(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted">
                                <Copy className="h-3 w-3" /> Copy NOA link
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button onClick={() => { setEditing(i); setOpen(true); }} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                                <button onClick={() => { if (confirm(`Remove invoice ${i.invoice_number}?`)) remove.mutate(i.id); }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {isAdmin && i.status === "pending" && (
                              canReview ? (
                                <Link to="/app/checker" className="text-[10px] uppercase tracking-widest text-primary hover:underline">Review →</Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Awaiting checker</span>
                              )
                            )}
                            {isAdmin && (i.status === "approved" || i.status === "advanced" || i.status === "funded") && (
                              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                            )}
                            {isAdmin && i.status === "paid" && (
                              <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>
                            )}
                          </div>
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

      {open && <InvoiceFormModal editing={editing} onClose={() => { setOpen(false); setEditing(null); }} debtors={debtorsQ.data ?? []} purchases={purchasesQ.data ?? []} />}
    </div>
  );
}

function NoaBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}

function InvoiceFormModal({ editing, onClose, debtors, purchases }: { editing: any | null; onClose: () => void; debtors: any[]; purchases: any[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    invoice_number: editing?.invoice_number ?? "",
    debtor_id: editing?.debtor_id ?? debtors[0]?.id ?? "",
    amount: String(editing?.amount ?? ""),
    advance_rate: String(editing?.advance_rate ?? "80"),
    issue_date: editing?.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: editing?.due_date ?? "",
    po_number: editing?.po_number ?? "",
    po_date: editing?.po_date ?? "",
    purchase_invoice_id: editing?.purchase_invoice_id ?? "",
  }));
  const [docs, setDocs] = useState<DocMeta[]>(editing?.documents ?? []);
  const [inv, setInv] = useState({ enabled: false, item_name: "", sku: "", quantity: "", unit: "unit", unit_cost: "" });

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/api/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a: any) => a.status !== "refunded")
    .reduce((s: number, a: any) => s + Number(a.amount), 0);
  const balanceDue = Math.max(0, Number(form.amount || 0) - advancesTotal);

  const selectedDebtor = debtors.find((d: any) => d.id === form.debtor_id);
  const termsDays = Number(selectedDebtor?.payment_terms_days ?? 30) || 30;
  const computedDue = (() => {
    if (!form.issue_date) return "";
    const d = new Date(form.issue_date);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please add a debtor first.");
      const payload: any = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        advance_rate: Number(form.advance_rate),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: effectiveDue,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        purchase_invoice_id: form.purchase_invoice_id || null,
        documents: docs,
      };
      if (!editing) {
        payload.inventory = inv.enabled ? {
          enabled: true,
          item_name: inv.item_name,
          sku: inv.sku || null,
          quantity: Number(inv.quantity),
          unit: inv.unit,
          unit_cost: inv.unit_cost ? Number(inv.unit_cost) : null,
        } : undefined;
      }
      if (editing) {
        await api.patch(`/api/invoices/${editing.id}`, payload);
      } else {
        await api.post("/api/invoices", payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success(editing ? "Invoice updated" : "Invoice submitted for review.");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit invoice" : "Submit invoice"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
          {debtors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></Field>
              <Field label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></Field>
            </div>
          </div>

          {form.po_number.trim() && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Advances received against PO {form.po_number}</div>
              {poLookupQ.isFetching ? (
                <div className="text-muted-foreground">Looking up…</div>
              ) : (poLookupQ.data?.advances ?? []).length === 0 ? (
                <div className="text-muted-foreground">No advances recorded for this PO number on the sales side.</div>
              ) : (
                <ul className="space-y-0.5">
                  {((poLookupQ.data?.advances ?? []) as any[]).map((a: any) => (
                    <li key={a.id} className="flex justify-between"><span className="text-muted-foreground">{fmtDate(a.advance_date)} {a.reference ? `· ${a.reference}` : ""}</span><span className="num text-primary">{fmtMoney(a.amount)}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span>Total invoice amount</span><span className="num">{fmtMoney(Number(form.amount || 0))}</span>
              </div>
              <div className="flex justify-between"><span>Advance received</span><span className="num text-primary">{fmtMoney(advancesTotal)}</span></div>
              <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                <span>Balance outstanding</span><span className="num">{fmtMoney(balanceDue)}</span>
              </div>
            </div>
          )}

          <Field label="Invoice number"><input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="inp" placeholder="INV-00123" /></Field>
          <Field label="Debtor">
            <select required value={form.debtor_id} onChange={(e) => setForm({ ...form, debtor_id: e.target.value })} className="inp">
              <option value="">Select debtor</option>
              {debtors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total invoice amount (USD)"><input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="inp" /></Field>
            <Field label="Advance % (0–100)"><input required type="number" step="0.1" min="0" max="100" value={form.advance_rate} onChange={(e) => setForm({ ...form, advance_rate: e.target.value })} className="inp" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="inp" /></Field>
            <Field label={`Due date${selectedDebtor ? ` (auto: ${termsDays}d net)` : ""}`}>
              <input type="date" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="inp" />
            </Field>
          </div>

          {!editing && (
            <Field label="Link to purchase invoice (optional)">
              <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
                <option value="">— No link —</option>
                {purchases.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.invoice_number} · {fmtMoney(p.amount)}</option>
                ))}
              </select>
            </Field>
          )}
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            Advance preview: <span className="num text-primary">{fmtMoney((Number(form.amount || 0) * Number(form.advance_rate || 0)) / 100)}</span>
          </div>
          {!editing && (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={inv.enabled} onChange={(e) => setInv({ ...inv, enabled: e.target.checked })} />
                <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-out / debit)</span>
              </label>
              {inv.enabled && (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Field label="Item *"><input className="inp" value={inv.item_name} onChange={(e) => setInv({ ...inv, item_name: e.target.value })} /></Field>
                  <Field label="SKU"><input className="inp" value={inv.sku} onChange={(e) => setInv({ ...inv, sku: e.target.value })} /></Field>
                  <Field label="Quantity *"><input type="number" step="0.001" min="0" className="inp" value={inv.quantity} onChange={(e) => setInv({ ...inv, quantity: e.target.value })} /></Field>
                  <Field label="Unit"><input className="inp" value={inv.unit} onChange={(e) => setInv({ ...inv, unit: e.target.value })} /></Field>
                  <Field label="Unit cost"><input type="number" step="0.01" min="0" className="inp" value={inv.unit_cost} onChange={(e) => setInv({ ...inv, unit_cost: e.target.value })} /></Field>
                </div>
              )}
            </div>
          )}
          <DocumentUploader userId={""} scope="invoices" docs={docs} onChange={setDocs}
            hint="Attach the invoice PDF, BL, packing list, or other supporting paperwork." />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editing ? "Save changes" : "Submit"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
