import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Trash2, Upload, Building2, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

export const Route = createFileRoute("/app/advances")({
  component: AdvancesPage,
});

function AdvancesPage() {
  const { user, isClient, isChecker, isTreasury, canWrite } = useAuth();
  const canEdit = canWrite("advances");
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | "sales" | "purchase">(null);
  const [massImportOpen, setMassImportOpen] = useState(false);
  const [tab, setTab] = useState<"sales" | "purchase">("sales");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => (await api.get<any[]>("/advances")) ?? [],
  });

  const rows = (advancesQ.data ?? []).filter((a: any) => {
    if (a.side !== tab) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const inv = a.side === "sales" ? a.invoice : a.purchase;
    const cp = a.order
      ? (a.side === "sales" ? a.order.debtor?.name : a.order.vendor?.name)
      : (a.side === "sales" ? a.invoice?.debtor?.name : a.purchase?.vendor?.name);
    return (
      a.reference?.toLowerCase().includes(q) ||
      (cp ?? "").toLowerCase().includes(q) ||
      (inv?.invoice_number ?? "").toLowerCase().includes(q) ||
      a.status?.toLowerCase().includes(q) ||
      a.amount?.toString().includes(q)
    );
  });

  const totals = useMemo(() => {
    const r = { sales: 0, purchase: 0 };
    for (const a of (advancesQ.data ?? []) as any[]) {
      if (a.status === "refunded") continue;
      r[a.side as "sales" | "purchase"] += Number(a.amount);
    }
    return r;
  }, [advancesQ.data]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.patch(`/advances/${id}`, { status });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/advances/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Advances"
        title="Advance payments"
        description="Money received from customers or paid to suppliers ahead of the final invoice. Each advance is tied to a specific invoice."
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <button onClick={() => setOpen("sales")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> Sales advance
              </button>
              <button onClick={() => setMassImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/50 px-4 py-2 text-sm text-primary hover:bg-primary/10">
                <Upload className="h-4 w-4" /> Mass import
              </button>
              <button onClick={() => setOpen("purchase")} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm">
                <Plus className="h-4 w-4" /> Purchase advance
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Open sales advances (received)"><div className="num num-lg text-success">{fmtMoney(totals.sales)}</div></Card>
          <Card title="Open purchase advances (paid)"><div className="num num-lg text-warning">{fmtMoney(totals.purchase)}</div></Card>
        </div>

        <div className="flex gap-2">
          {(["sales", "purchase"] as const).map((s) => (
            <button key={s} onClick={() => setTab(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "sales" ? "Sales side" : "Purchase side"}</button>
          ))}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search advances by reference, party, invoice..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>
        <Card>
          {advancesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No advances on this side yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Linked to</th>
                    <th className="px-5 py-2 text-left font-normal">Party</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-right font-normal">PO / Inv amt</th>
                    <th className="px-5 py-2 text-left font-normal">Reference</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a: any) => {
                    const inv = a.side === "sales" ? a.invoice : a.purchase;
                    const linkedAmount = a.order?.amount ?? inv?.amount ?? null;
                    const cp = a.order
                      ? (a.side === "sales" ? a.order.debtor?.name : a.order.vendor?.name)
                      : (a.side === "sales" ? a.invoice?.debtor?.name : a.purchase?.vendor?.name);
                    return (
                      <tr key={a.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={a.id}>#{a.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.advance_date)}</td>
                        <td className="px-5 py-3">                            {a.order ? (
                            <Link to="/app/proformas" search={{ view: a.order.id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <Link2 className="h-3 w-3" />PO {a.order.po_number}
                            </Link>
                          ) : inv ? (
                            <button
                              onClick={async () => {
                                try {
                                  const invId = a.side === "sales" ? a.invoice_id : a.purchase_invoice_id;
                                  if (!invId) { toast.error("Invoice not found"); return; }
                                  const endpoint = a.side === "sales" ? `/invoices/${invId}` : `/purchase-invoices/${invId}`;
                                  const found = await api.get<any>(endpoint);
                                  if (found) setViewingInvoice(found);
                                  else toast.error("Invoice not found");
                                } catch {
                                  toast.error("Failed to load invoice");
                                }
                              }}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Link2 className="h-3 w-3" />{inv.invoice_number}
                            </button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3">{cp ?? "—"}</td>
                        <td className="px-5 py-3 text-right num text-primary">{fmtMoney(a.amount)}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">{linkedAmount != null ? fmtMoney(linkedAmount) : "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{a.reference ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            a.status === "applied" ? "border-success/50 text-success"
                            : a.status === "refunded" ? "border-muted text-muted-foreground"
                            : "border-warning/50 text-warning"
                          }`}>{a.status}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex gap-1">
                            {canEdit && a.status === "open" && (
                              <button onClick={() => setStatus.mutate({ id: a.id, status: "applied" })} className="rounded-md border border-success/50 px-2 py-0.5 text-[10px] text-success hover:bg-success/10">Mark applied</button>
                            )}
                            {canEdit && a.status !== "refunded" && (
                              <button onClick={() => setStatus.mutate({ id: a.id, status: "refunded" })} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">Refunded</button>
                            )}
                            {canEdit && (
                              <button onClick={() => del.mutate(a.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
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

      {open && user && <NewAdvanceModal side={open} onClose={() => setOpen(null)} />}
      {massImportOpen && <MassImportModal onClose={() => setMassImportOpen(false)} />}
      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          onClose={() => setViewingInvoice(null)}
        />
      )}
    </div>
  );
}

function NewAdvanceModal({ side, onClose }: { side: "sales" | "purchase"; onClose: () => void }) {
  const qc = useQueryClient();
  const [linkType, setLinkType] = useState<"po" | "invoice">("po");
  const [form, setForm] = useState({
    purchase_order_id: "",
    invoice_id: "",
    purchase_invoice_id: "",
    amount: "",
    advance_date: new Date().toISOString().slice(0, 10),
    reference: "",
    notes: "",
  });

  const ordersQ = useQuery({
    queryKey: ["adv-po", side],
    queryFn: async () => {
      const orders = await api.get<any[]>("/purchase-orders") ?? [];
      return orders.filter((o: any) => o.side === side && o.status !== "cancelled");
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["adv-inv", side],
    enabled: linkType === "invoice",
    queryFn: async () => {
      if (side === "sales") return (await api.get<any[]>("/invoices/mini")) ?? [];
      return (await api.get<any[]>("/purchase-invoices/mini")) ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      if (linkType === "po") {
        if (!form.purchase_order_id) throw new Error("Pick the purchase order this advance is against");
      } else {
        const id = side === "sales" ? form.invoice_id : form.purchase_invoice_id;
        if (!id) throw new Error("Pick the invoice this advance relates to");
      }
      const payload: Record<string, unknown> = {
        side,
        amount: Number(form.amount),
        advance_date: form.advance_date,
        reference: form.reference || null,
        notes: form.notes || null,
        purchase_order_id: linkType === "po" ? form.purchase_order_id : null,
        invoice_id: linkType === "invoice" && side === "sales" ? form.invoice_id : null,
        purchase_invoice_id: linkType === "invoice" && side === "purchase" ? form.purchase_invoice_id : null,
      };
      await api.post("/advances", payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Advance recorded"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{side === "sales" ? "Sales advance (received)" : "Purchase advance (paid)"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
          <div className="flex gap-2">
            {(["po", "invoice"] as const).map((t) => (
              <button type="button" key={t} onClick={() => setLinkType(t)}
                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition ${
                  linkType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>{t === "po" ? "Against PO" : "Against invoice"}</button>
            ))}
          </div>
          {linkType === "po" ? (
            <L label="Purchase order *">
              <select required className="inp" value={form.purchase_order_id} onChange={(e) => setForm({ ...form, purchase_order_id: e.target.value })}>
                <option value="">Select PO…</option>
                {(ordersQ.data ?? []).map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.po_number} · {(o.debtor?.name ?? o.vendor?.name) ?? ""} · {fmtMoney(o.amount)}
                  </option>
                ))}
              </select>
              {(ordersQ.data ?? []).length === 0 && (
                <p className="mt-1 text-[10px] text-warning">No open {side} proformas yet. Raise one in Proforma invoices first.</p>
              )}
            </L>
          ) : (
            <L label={side === "sales" ? "Sales invoice *" : "Purchase invoice *"}>
              <select required className="inp" value={side === "sales" ? form.invoice_id : form.purchase_invoice_id} onChange={(e) => setForm({ ...form, [side === "sales" ? "invoice_id" : "purchase_invoice_id"]: e.target.value })}>
                <option value="">Select…</option>
                {(invoicesQ.data ?? []).map((i: any) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · {fmtMoney(i.amount)}
                  </option>
                ))}
              </select>
            </L>
          )}
          <div className="grid grid-cols-2 gap-3">
            <L label="Amount *"><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
            <L label="Date"><input required type="date" className="inp" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })} /></L>
          </div>
          <L label="Reference (txn id / cheque #)"><input className="inp" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></L>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function InvoiceDetailModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const debtor = invoice.debtor;
  const invDocs: any[] = Array.isArray(invoice.documents) ? invoice.documents : [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg">{invoice.invoice_number}</h3>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
              invoice.status === "paid" ? "border-success/50 text-success"
              : invoice.status === "overdue" ? "border-destructive/50 text-destructive"
              : invoice.status === "pending" ? "border-warning/50 text-warning"
              : invoice.status === "approved" ? "border-primary/50 text-primary"
              : "border-border text-muted-foreground"
            }`}>{invoice.status}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Invoice summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Invoice details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Amount" value={fmtMoney(invoice.amount)} />
              <Detail label="Amount received" value={invoice.amount_received != null ? fmtMoney(invoice.amount_received) : "—"} />
              <Detail label="Issue date" value={fmtDate(invoice.issue_date)} />
              <Detail label="Due date" value={fmtDate(invoice.due_date)} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net` : "—"} />
              {invoice.bl_date && <Detail label="BL date" value={fmtDate(invoice.bl_date)} />}
              <Detail label="Paid date" value={invoice.paid_date ? fmtDate(invoice.paid_date) : "—"} />
              <Detail label="Advance received" value={invoice.advance_received_date ? fmtDate(invoice.advance_received_date) : "—"} />
              <Detail label="Created" value={fmtDate(invoice.created_at)} />
              <Detail label="Last updated" value={fmtDate(invoice.updated_at)} />
              {invoice.po_number && <Detail label="PO number" value={invoice.po_number} />}
              {invoice.po_date && <Detail label="PO date" value={fmtDate(invoice.po_date)} />}
              {invoice.short_payment != null && <Detail label="Short payment" value={fmtMoney(invoice.short_payment)} />}
              {invoice.late_days != null && <Detail label="Late days" value={String(invoice.late_days)} />}
            </div>
            {invoice.noa_comments && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">NOA comments</div>
                <p className="mt-1 text-xs italic">"{invoice.noa_comments}"</p>
              </div>
            )}
          </div>

          {/* Debtor details (sales invoices) */}
          {debtor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />Debtor
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={debtor.name} />
                <Detail label="Contact" value={debtor.contact_name || "—"} />
                <Detail label="Email" value={debtor.contact_email || "—"} />
                <Detail label="Phone" value={debtor.contact_phone || "—"} />
                <Detail label="Industry" value={debtor.industry || "—"} />
                <Detail label="Credit limit" value={fmtMoney(debtor.credit_limit)} />
                <Detail label="Risk score" value={debtor.risk_score != null ? `${debtor.risk_score}/100` : "—"} />
                {debtor.address_line && <Detail label="Address" value={[debtor.address_line, debtor.city, debtor.country].filter(Boolean).join(", ")} />}
                {debtor.website && <Detail label="Website" value={debtor.website} />}
              </div>
              {debtor.notes && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                  <p className="mt-1 text-xs text-muted-foreground">{debtor.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Vendor details (purchase invoices) */}
          {invoice.vendor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />Supplier
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={invoice.vendor.name} />
                <Detail label="Contact" value={invoice.vendor.contact_name || "—"} />
                <Detail label="Email" value={invoice.vendor.contact_email || "—"} />
                <Detail label="Phone" value={invoice.vendor.contact_phone || "—"} />
                <Detail label="Industry" value={invoice.vendor.industry || "—"} />
                {invoice.vendor.address_line && <Detail label="Address" value={[invoice.vendor.address_line, invoice.vendor.city, invoice.vendor.country].filter(Boolean).join(", ")} />}
                {invoice.vendor.website && <Detail label="Website" value={invoice.vendor.website} />}
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({invDocs.length})
            </h4>
            {invDocs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No documents attached to this invoice.</div>
            ) : (
              <ul className="space-y-1.5">
                {invDocs.map((d: any) => (
                  <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate" title={d.name}>{d.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MassImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Array<{ amount: string; invoice_number: string; advance_date: string; reference: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; matched: number; not_found: string[]; errors: Array<{ invoice_number: string; error: string }> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normaliseDate = (val: unknown): string => {
    if (val == null || val === "") return "";
    // Excel serial date number
    if (typeof val === "number" && !isNaN(val)) {
      const d = new Date((val - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(val).trim();
    if (!s) return "";
    // DD-MM-YYYY or DD/MM/YYYY (Indian/European format)
    const dashMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dashMatch) {
      const [, d, m, y] = dashMatch;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Try parsing: "8 Jan 2025", "8 January 2025", etc.
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return s;
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        // Map column headers — accept common variations
        const parsed = json.map((row) => {
          const keys = Object.keys(row);
          const findKey = (aliases: string[]) => keys.find((k) => aliases.some((a) => k.toLowerCase().includes(a)));

          const invKey = findKey(["invoice", "inv", "invoice#", "inv#", "invoice #", "inv #", "invoice_no"]);
          const amtKey = findKey(["amount", "amt", "advance", "advance amount", "advance_amt", "value"]);
          const dateKey = findKey(["date", "advance_date", "advance date", "date_received", "date received", "received_date", "payment_date"]);
          const refKey = findKey(["reference", "ref", "txn", "transaction", "cheque", "check", "payment_ref"]);

          return {
            invoice_number: invKey ? String(row[invKey] ?? "").trim() : "",
            amount: amtKey ? String(row[amtKey] ?? "").trim() : "",
            advance_date: dateKey ? normaliseDate(row[dateKey]) : "",
            reference: refKey ? String(row[refKey] ?? "").trim() : "",
          };
        }).filter((r) => r.invoice_number && r.amount);

        if (parsed.length === 0) {
          toast.error("Could not find invoice_number and amount columns in the spreadsheet. Make sure your Excel file has columns like 'Invoice Number', 'Amount', and optionally 'Date'.");
          return;
        }

        setRows(parsed);
        setResult(null);
        toast.success(`Parsed ${parsed.length} row${parsed.length !== 1 ? "s" : ""} from spreadsheet`);
      } catch {
        toast.error("Failed to parse the Excel file. Make sure it's a valid .xlsx or .xls file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const importAll = async () => {
    setImporting(true);
    try {
      const items = rows.map((r) => ({
        amount: Number(r.amount),
        invoice_number: r.invoice_number,
        advance_date: r.advance_date || new Date().toISOString().slice(0, 10),
        reference: r.reference || null,
      }));

      // Validate amounts
      for (const item of items) {
        if (!item.amount || item.amount <= 0) {
          throw new Error(`Invalid amount for invoice ${item.invoice_number}: ${item.amount}`);
        }
      }

      const res = await api.post<{
        created: any[];
        matched: Array<{ invoice_number: string; invoice_id: string }>;
        not_found: string[];
        errors: Array<{ invoice_number: string; error: string }>;
      }>("/advances/batch", { items });

      setResult({
        created: res.created.length,
        matched: res.matched.length,
        not_found: res.not_found,
        errors: res.errors,
      });

      qc.invalidateQueries({ queryKey: ["advances"] });

      if (res.created.length > 0) {
        toast.success(`${res.created.length} advance${res.created.length !== 1 ? "s" : ""} imported`);
      }
      if (res.not_found.length > 0) {
        toast.warning(`${res.not_found.length} invoice${res.not_found.length !== 1 ? "s" : ""} not found`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">Mass import sales advances</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          {/* Instructions */}
          <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Expected columns in your Excel file:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li><strong>Invoice Number</strong> — the invoice number as it appears in your invoices (required)</li>
              <li><strong>Amount</strong> — the advance amount received (required)</li>
              <li><strong>Date</strong> — the date the advance was received (optional, defaults to today)</li>
              <li><strong>Reference</strong> — txn ID, cheque number, etc. (optional)</li>
            </ul>
            <p className="mt-2 text-warning">Each advance will be linked to the invoice with a matching invoice number in your system.</p>
          </div>

          {/* File upload */}
          {rows.length === 0 && !result && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-10 text-center transition hover:border-primary/50 hover:bg-muted/20"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">Click to upload Excel file</p>
                <p className="mt-1 text-xs text-muted-foreground">.xlsx or .xls</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && !result && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{rows.length} row{rows.length !== 1 ? "s" : ""} parsed</p>
                <button onClick={() => { setRows([]); setResult(null); }} className="text-xs text-muted-foreground underline hover:text-foreground">Upload different file</button>
              </div>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 text-left font-normal">#</th>
                      <th className="px-5 py-2 text-left font-normal">Invoice number</th>
                      <th className="px-5 py-2 text-right font-normal">Amount</th>
                      <th className="px-5 py-2 text-left font-normal">Date</th>
                      <th className="px-5 py-2 text-left font-normal">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-5 py-2.5 text-right num text-primary">{fmtMoney(Number(r.amount))}</td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground">{r.advance_date || fmtDate(new Date().toISOString().slice(0, 10))}</td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground">{r.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button
                  disabled={importing}
                  onClick={importAll}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import {rows.length} advance{rows.length !== 1 ? "s" : ""}
                </button>
              </div>
            </>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-center">
                  <div className="num text-2xl text-success">{result.created}</div>
                  <div className="text-xs text-muted-foreground">Created</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-3 text-center">
                  <div className="num text-2xl">{result.matched}</div>
                  <div className="text-xs text-muted-foreground">Linked to invoice</div>
                </div>
                <div className={`rounded-lg border p-3 text-center ${result.not_found.length > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-background/40"}`}>
                  <div className={`num text-2xl ${result.not_found.length > 0 ? "text-warning" : ""}`}>{result.not_found.length}</div>
                  <div className="text-xs text-muted-foreground">Not found</div>
                </div>
              </div>

              {result.not_found.length > 0 && (
                <div className="rounded-md border border-warning/20 bg-warning/5 p-3">
                  <p className="mb-2 text-xs font-medium text-warning">Invoices not found in system:</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {result.not_found.map((inv, i) => (
                      <li key={i}>{inv}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <p className="mb-2 text-xs font-medium text-destructive">Errors:</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e.invoice_number}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Close</button>
                {result.not_found.length > 0 && (
                  <button
                    onClick={() => { setRows([]); setResult(null); }}
                    className="inline-flex items-center gap-2 rounded-md border border-primary/50 px-4 py-2 text-sm text-primary hover:bg-primary/10"
                  >
                    Import another file
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <style>{`.num{font-variant-numeric:tabular-nums}`}</style>
      </div>
    </div>
  );
}
