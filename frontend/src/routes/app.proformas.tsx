import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, X, Loader2, Trash2, Eye, Building2, User, DollarSign, CheckCircle2, FileText, Download, ArrowUpDown, Upload } from "lucide-react";
import { toast } from "sonner";

import { z } from "zod";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import { getToken } from "@/lib/api-client";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/proformas")({
  validateSearch: z.object({ view: z.string().optional() }),
  component: ProformasPage,
});

type PF = {
  id: string;
  client_id: string;
  side: "sales" | "purchase";
  debtor_id: string | null;
  vendor_id: string | null;
  po_number: string;
  proforma_number: string | null;
  proforma_date: string | null;
  amount: number;
  currency: string;
  issue_date: string;
  status: string;
  proforma_status: string;
  proforma_review_comments: string | null;
  proforma_funded_amount: number | null;
  notes: string | null;
};

function ProformasPage() {
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const { user, isAdmin, isClient, isChecker, isTreasury, isOperations, canWrite } = useAuth();
  const canCreate = canWrite("purchase-orders");
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | "sales" | "purchase">(null);
  const [importOpen, setImportOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [editingPf, setEditingPf] = useState<any | null>(null);
  const [tab, setTab] = useState<"all" | "sales" | "purchase">("all");
  const [queue, setQueue] = useState<"all" | "pending_review" | "approved" | "funded" | "rejected">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");


  const listQ = useQuery({
    queryKey: ["proformas"],
    queryFn: async () => (await api.get<any[]>("/purchase-orders")) ?? [],
  });

  const advancesQ = useQuery({
    queryKey: ["advances"],
    queryFn: async () => (await api.get<any[]>("/advances")) ?? [],
  });

  // Auto-open detail modal when navigating via search param
  const [initialViewDone, setInitialViewDone] = useState(false);
  useEffect(() => {
    if (view && listQ.data && !initialViewDone) {
      const found = (listQ.data as any[]).find((p: any) => p.id === view);
      if (found) {
        setViewing(found);
        setInitialViewDone(true);
        navigate({ to: "/app/proformas", search: { view: undefined }, replace: true });
      }
    }
  }, [view, listQ.data, initialViewDone, navigate]);

  const viewedAdvances = useMemo(() => {
    if (!viewing) return [];
    return (advancesQ.data ?? []).filter((a: any) => a.purchase_order_id === viewing.id);
  }, [viewing, advancesQ.data]);

  const rows = ((listQ.data ?? []) as any[])
    .filter((p: any) => tab === "all" || p.side === tab)
    .filter((p: any) => {
      if (queue === "all") return true;
      if (queue === "approved") return p.proforma_status === "approved";
      return p.proforma_status === queue;
    })
    .filter((p: any) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const cp = p.side === "sales" ? p.debtor?.name : p.vendor?.name;
      return (
        p.proforma_number?.toLowerCase().includes(q) ||
        p.po_number?.toLowerCase().includes(q) ||
        (cp ?? "").toLowerCase().includes(q) ||
        p.side?.toLowerCase().includes(q) ||
        p.proforma_status?.toLowerCase().includes(q)
      );
    })
    .sort((a: any, b: any) => {
      const aVal = (a.proforma_date ?? a.issue_date ?? "9999");
      const bVal = (b.proforma_date ?? b.issue_date ?? "9999");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    });

  const counts = useMemo(() => {
    const arr = (listQ.data ?? []) as PF[];
    return {
      pending_review: arr.filter((p) => p.proforma_status === "pending_review").length,
      approved: arr.filter((p) => p.proforma_status === "approved").length,
      funded: arr.filter((p) => p.proforma_status === "funded").length,
      rejected: arr.filter((p) => p.proforma_status === "rejected").length,
    };
  }, [listQ.data]);

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/purchase-orders/${id}`, { status: "cancelled" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Cancelled"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchase-orders/${id}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Proforma invoices"
        title="Proformas & advances"
        description="Raise a proforma invoice against a PO number to take or release an advance."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button onClick={() => setOpen("sales")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> Sales proforma
              </button>
              <button onClick={() => setOpen("purchase")} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm">
                <Plus className="h-4 w-4" /> Purchase proforma
              </button>
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Upload className="h-4 w-4" /> Mass import
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap gap-2">
          {(["all", "sales", "purchase"] as const).map((s) => (
            <button key={s} onClick={() => setTab(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                tab === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "sales" ? "Sales" : "Purchase"}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ["all", "All stages", null],
            ["pending_review", "Pending review", counts.pending_review],
            ["approved", "Funding queue", counts.approved],
            ["funded", "Funded", counts.funded],
            ["rejected", "Rejected", counts.rejected],
          ] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setQueue(k as typeof queue)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition ${
                queue === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {label}
              {n != null && n > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">{n}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search proformas by number, PO, counterparty..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
          <div className="flex gap-1">
            {(["issue"] as const).map((field) => (
              <button
                key={field}
                onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                  "border-primary bg-primary/10 text-primary"
                }`}
              >
                <ArrowUpDown className="h-3 w-3" />
                Issue date
                <span className="text-[10px]">{sortOrder === "asc" ? "↑" : "↓"}</span>
              </button>
            ))}
          </div>
        </div>

        <Card>
          {listQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No proformas yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Proforma</th>
                    <th className="px-5 py-2 text-left font-normal">PO #</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Side</th>
                    <th className="px-5 py-2 text-right font-normal">Advance amount</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p: any) => {
                    const cp = p.side === "sales" ? p.debtor?.name : p.vendor?.name;
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={p.id}>#{p.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{p.proforma_number ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">{p.proforma_date ? fmtDate(p.proforma_date) : fmtDate(p.issue_date)}</div>
                          {p.proforma_review_comments && (
                            <div className="text-[10px] text-warning mt-0.5" title={p.proforma_review_comments}>“{p.proforma_review_comments}”</div>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{p.po_number}</td>
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{p.client?.company_name || p.client?.contact_name || "—"}</td>}
                        <td className="px-5 py-3">{cp ?? "—"}</td>
                        <td className="px-5 py-3 text-[10px] uppercase tracking-widest text-muted-foreground">{p.side}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3">
                          <StatusPill status={p.status} pStatus={p.proforma_status} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <button onClick={() => setViewing(p)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                              <Eye className="h-3 w-3" /> View
                            </button>
                            {p.proforma_status === "pending_review" && (
                              <span className="text-[10px] uppercase tracking-widest text-warning">Awaiting checker</span>
                            )}
                            {p.proforma_status === "approved" && (
                              <span className="text-[10px] uppercase tracking-widest text-primary">In funding queue</span>
                            )}
                            {p.proforma_status === "funded" && (
                              <span className="text-[10px] uppercase tracking-widest text-success">Funded</span>
                            )}
                            {canCreate && (p.proforma_status === "pending_review" || p.proforma_status === "rejected") && (
                              <button onClick={() => setEditingPf(p)} className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                            )}
                            {canCreate && p.status !== "invoiced" && p.status !== "cancelled" && p.proforma_status !== "funded" && (
                              <button onClick={() => cancel.mutate(p.id)} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button>
                            )}
                            {canCreate && (p.status === "cancelled" || p.proforma_status === "rejected" || p.proforma_status === "pending_review") && (
                              <button onClick={() => { if (confirm(`Remove proforma ${p.proforma_number || p.po_number}?`)) del.mutate(p.id); }} className="text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
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

        <Card title="How this works">
          <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>Operator raises a proforma against a PO number with the advance amount required.</li>
            <li>Checker reviews and approves (or rejects with comments).</li>
            <li>Treasury marks it paid (purchase) or received (sales) — this records an advance entry linked to the PO number.</li>
            <li>When the final invoice is later raised with the same PO number, advances are auto-deducted.</li>
          </ol>
        </Card>
      </div>

      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} />}

      {open && user && <NewProformaModal side={open} onClose={() => setOpen(null)} />}

      {editingPf && (
        <EditProformaModal
          proforma={editingPf}
          onClose={() => setEditingPf(null)}
        />
      )}

      {viewing && (
        <ProformaDetailModal
          proforma={viewing}
          advances={viewedAdvances}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function EditProformaModal({ proforma, onClose }: { proforma: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    amount: String(proforma.amount ?? ""),
    notes: proforma.notes ?? "",
    proforma_number: proforma.proforma_number ?? "",
    proforma_date: proforma.proforma_date ?? new Date().toISOString().slice(0, 10),
  });

  const save = useMutation({
    mutationFn: async () => {
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Amount must be > 0");
      if (!form.proforma_number.trim()) throw new Error("Proforma number is required");
      await api.patch(`/purchase-orders/${proforma.id}`, {
        amount: amt,
        notes: form.notes || null,
        proforma_number: form.proforma_number.trim(),
        proforma_date: form.proforma_date,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Proforma updated"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`Edit proforma — ${proforma.proforma_number || proforma.po_number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
        <L label="Proforma number *"><input required className="inp" value={form.proforma_number} onChange={(e) => setForm({ ...form, proforma_number: e.target.value })} /></L>
        <L label="Proforma date *"><input required type="date" className="inp" value={form.proforma_date} onChange={(e) => setForm({ ...form, proforma_date: e.target.value })} /></L>
        <L label={`Advance amount * (${proforma.currency || "USD"})`}><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
        <L label="Notes"><textarea rows={3} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
        <Actions onClose={onClose} pending={save.isPending} label="Save changes" />
      </form>
    </Modal>
  );
}

function StatusPill({ status, pStatus }: { status: string; pStatus: string }) {
  const label = pStatus && pStatus !== "none" ? pStatus.replace("_", " ") : status;
  const cls =
    pStatus === "funded" || status === "invoiced" ? "border-success/50 text-success"
    : pStatus === "approved" ? "border-primary/50 text-primary"
    : pStatus === "rejected" || status === "cancelled" ? "border-destructive/50 text-destructive"
    : "border-warning/50 text-warning";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>{label}</span>;
}

function NewProformaModal({ side, onClose }: { side: "sales" | "purchase"; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    po_number: "", proforma_number: "", proforma_date: new Date().toISOString().slice(0, 10),
    party_id: "", amount: "", currency: "USD", notes: "",
  });
  const [docs, setDocs] = useState<DocMeta[]>([]);

  const partiesQ = useQuery({
    queryKey: ["pf-parties", side],
    queryFn: async () => {
      if (side === "sales") return (await api.get<any[]>("/debtors")) ?? [];
      return (await api.get<any[]>("/vendors")) ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.po_number.trim()) throw new Error("PO number is required");
      if (!form.proforma_number.trim()) throw new Error("Proforma number is required");
      if (!form.party_id) throw new Error(side === "sales" ? "Pick a debtor" : "Pick a supplier");
      const amt = Number(form.amount);
      if (!amt || amt <= 0) throw new Error("Advance amount must be > 0");
      await api.post("/purchase-orders", {
        side,
        debtor_id: side === "sales" ? form.party_id : null,
        vendor_id: side === "purchase" ? form.party_id : null,
        po_number: form.po_number.trim(),
        proforma_number: form.proforma_number.trim(),
        proforma_date: form.proforma_date,
        amount: amt,
        currency: form.currency,
        notes: form.notes || null,
        documents: docs,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proformas"] }); toast.success("Proforma submitted for review"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`New ${side} proforma`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 p-5">
        <L label="PO number *"><input required className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></L>
        <L label="Proforma number *"><input required className="inp" value={form.proforma_number} onChange={(e) => setForm({ ...form, proforma_number: e.target.value })} placeholder="PF-2026-001" /></L>
        <L label={side === "sales" ? "Debtor *" : "Supplier *"}>
          <select required className="inp" value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
            <option value="">Select…</option>
            {(partiesQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label={`Advance amount * (${form.currency})`}><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
          <L label="Proforma date *"><input required type="date" className="inp" value={form.proforma_date} onChange={(e) => setForm({ ...form, proforma_date: e.target.value })} /></L>
        </div>
        <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
        <DocumentUploader userId={""} scope="purchase_orders" docs={docs} onChange={setDocs}
          hint="Attach the proforma invoice, supplier quote, or other supporting paperwork." />
        <Actions onClose={onClose} pending={create.isPending} label="Submit" />
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-base">{title}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {children}
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Actions({ onClose, pending, label }: { onClose: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
      <button disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function ProformaDetailModal({ proforma, advances, onClose }: { proforma: any; advances: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const cp = proforma.side === "sales" ? proforma.debtor : proforma.vendor;

  const deletePf = useMutation({
    mutationFn: async () => {
      await api.delete(`/purchase-orders/${proforma.id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      toast.success("Proforma deleted");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete proforma"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg">{proforma.proforma_number || proforma.po_number}</h3>
            <StatusPill status={proforma.status} pStatus={proforma.proforma_status} />
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Proforma summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Proforma details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Proforma #" value={proforma.proforma_number || "—"} />
              <Detail label="PO number" value={proforma.po_number} />
              <Detail label="Side" value={proforma.side === "sales" ? "Sales" : "Purchase"} />
              <Detail label="Amount" value={fmtMoney(proforma.amount)} />
              <Detail label="Currency" value={proforma.currency} />
              <Detail label="Proforma date" value={proforma.proforma_date ? fmtDate(proforma.proforma_date) : fmtDate(proforma.issue_date)} />
              <Detail label="Created" value={fmtDate(proforma.created_at)} />
              <Detail label="Last updated" value={fmtDate(proforma.updated_at)} />
              <Detail label="Status" value={proforma.status} />
              <Detail label="Proforma status" value={proforma.proforma_status?.replace("_", " ")} />
            </div>
            {proforma.proforma_review_comments && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Review comments</div>
                <p className="mt-1 text-xs italic">"{proforma.proforma_review_comments}"</p>
              </div>
            )}
            {proforma.notes && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                <p className="mt-1 text-xs text-muted-foreground">{proforma.notes}</p>
              </div>
            )}
          </div>

          {/* Counterparty details */}
          {cp && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />{proforma.side === "sales" ? "Debtor" : "Supplier"}
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={cp.name} />
                <Detail label="Contact" value={cp.contact_name || "—"} />
                <Detail label="Email" value={cp.contact_email || "—"} />
                <Detail label="Phone" value={cp.contact_phone || "—"} />
                {cp.industry && <Detail label="Industry" value={cp.industry} />}
                {cp.address_line && <Detail label="Address" value={[cp.address_line, cp.city, cp.country].filter(Boolean).join(", ")} />}
              </div>
            </div>
          )}

          {/* Client info */}
          {proforma.client && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <User className="mr-1 inline h-3.5 w-3.5" />Client
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Detail label="Company" value={proforma.client.company_name || "—"} />
                <Detail label="Contact" value={proforma.client.contact_name || "—"} />
                <Detail label="Email" value={proforma.client.email || "—"} />
              </div>
            </div>
          )}

          {/* Funding details */}
          {proforma.proforma_status === "funded" && proforma.proforma_funded_amount != null && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-success">
                <DollarSign className="mr-1 inline h-3.5 w-3.5" />Funding details
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Funded amount" value={fmtMoney(proforma.proforma_funded_amount)} />
                <Detail label="Funded date" value={proforma.proforma_funded_at ? fmtDate(proforma.proforma_funded_at) : "—"} />
                <Detail label="Reference" value={proforma.proforma_funding_reference || "—"} />
              </div>
            </div>
          )}

          {/* Documents */}
          {(() => {
            const pDocs: DocMeta[] = Array.isArray(proforma.documents) ? proforma.documents : [];
            return (
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                  <FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({pDocs.length})
                </h4>
                {pDocs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No documents attached to this proforma.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {pDocs.map((d) => (
                      <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate" title={d.name}>{d.name}</span>
                          <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <button type="button" onClick={async () => {
                          try {
                            const encodedPath = d.path.split("/").map(encodeURIComponent).join("/");
                            const token = getToken();
                            const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4444";
                            window.open(`${baseUrl}/upload/signed-url/${encodedPath}?token=${token}`, "_blank", "noopener");
                          } catch {
                            toast.error("Could not open document");
                          }
                        }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                          <Download className="h-3 w-3" /> Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

          {/* Linked advances */}
          {advances.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Linked advances ({advances.length})
              </h4>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Date</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-left font-normal">Reference</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.map((a: any) => (
                      <tr key={a.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5">{fmtDate(a.advance_date)}</td>
                        <td className="px-4 py-2.5 text-right num text-primary">{fmtMoney(a.amount)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{a.reference || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            a.status === "applied" ? "border-success/50 text-success"
                            : a.status === "refunded" ? "border-muted text-muted-foreground"
                            : "border-warning/50 text-warning"
                          }`}>{a.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <div>
              {(proforma.status === "cancelled" || proforma.proforma_status === "rejected" || proforma.proforma_status === "pending_review") && (
                <button
                  onClick={() => {
                    if (confirm(`Permanently delete proforma ${proforma.proforma_number || proforma.po_number}? This cannot be undone.`)) {
                      deletePf.mutate();
                    }
                  }}
                  disabled={deletePf.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {deletePf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </button>
              )}
            </div>
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// ── Mass Import Modal ──

interface ImportRow {
  proforma_number: string;
  proforma_date: string;
  po_number: string;
  amount: number;
}

function MassImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [side, setSide] = useState<"sales" | "purchase">("sales");
  const [partyId, setPartyId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const partiesQ = useQuery({
    queryKey: ["import-parties", side],
    queryFn: async () => {
      if (side === "sales") return (await api.get<any[]>("/debtors")) ?? [];
      return (await api.get<any[]>("/vendors")) ?? [];
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!partyId) {
      toast.error(`Please select a ${side === "sales" ? "debtor" : "supplier"} first`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

        const parsed: ImportRow[] = json.map((row: any, idx: number) => {
          // Try common column name variations
          const pfNum = row.proforma_number ?? row["Proforma Number"] ?? row["Proforma#"] ?? row.proformaNum ?? "";
          const pfDate = row.proforma_date ?? row["Proforma Date"] ?? row.proformaDate ?? row.Date ?? row.date ?? "";
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row["Invoice#"] ?? row.po_number ?? row.PO ?? "";
          const amt = Number(row.proforma_amount ?? row["Proforma Amount"] ?? row.amount ?? row.Amount ?? 0);

          // Normalize date if it's a serial number (Excel date)
          let dateStr = String(pfDate);
          if (typeof pfDate === "number" && !isNaN(pfDate)) {
            const d = new Date((pfDate - 25569) * 86400 * 1000);
            dateStr = d.toISOString().slice(0, 10);
          }

          return {
            proforma_number: String(pfNum).trim(),
            proforma_date: dateStr || "",
            po_number: String(invNum).trim(),
            amount: isNaN(amt) ? 0 : amt,
          };
        }).filter((r) => r.proforma_number && r.amount > 0);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: proforma_number, proforma_date, invoice_number, proforma_amount");
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Could not parse the Excel file. Please check the format.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      const payload = {
        side,
        [side === "sales" ? "debtor_id" : "vendor_id"]: partyId,
        items: rows.map((r) => ({
          proforma_number: r.proforma_number,
          proforma_date: r.proforma_date,
          po_number: r.po_number,
          amount: r.amount,
        })),
      };
      return await api.post<{ created: number; errors: Array<{ proforma_number: string; error: string }> }>("/purchase-orders/batch", payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["proformas"] });
      const errList = (data.errors ?? []).map((e) => `${e.proforma_number}: ${e.error}`);
      setResult({ created: data.created, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created} proformas created successfully`);
      } else {
        toast.success(`${data.created} created, ${errList.length} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "form" ? "Mass import proformas" : step === "preview" ? "Preview imported proformas" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet (.xlsx, .xls, .xlsb, .xlsm), CSV, TSV, or ODS file with columns:{' '}
              <code className="font-mono text-primary">proforma_number</code>,{' '}
              <code className="font-mono text-primary">proforma_date</code>,{' '}
              <code className="font-mono text-primary">invoice_number</code>,{' '}
              <code className="font-mono text-primary">proforma_amount</code>.
              Each row becomes a proforma invoice submitted for review.
            </div>

            <L label="Side *">
              <div className="flex gap-2">
                {(["sales", "purchase"] as const).map((s) => (
                  <button key={s} onClick={() => { setSide(s); setPartyId(""); }}
                    className={`rounded-md border px-4 py-2 text-sm transition ${
                      side === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    }`}>{s === "sales" ? "Sales (Debtor)" : "Purchase (Supplier)"}</button>
                ))}
              </div>
            </L>

            <L label={side === "sales" ? "Debtor *" : "Supplier *"}>
              <select required value={partyId} onChange={(e) => setPartyId(e.target.value)} className="inp">
                <option value="">Select {side === "sales" ? "debtor" : "supplier"}…</option>
                {(partiesQ.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </L>

            <div className="border-t border-border pt-4">
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
                Found <strong className="text-foreground">{rows.length}</strong> proformas
                · Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>

            <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Side</span><span className="capitalize">{side}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{side === "sales" ? "Debtor" : "Supplier"}</span><span>{(partiesQ.data ?? []).find((p: any) => p.id === partyId)?.name ?? "—"}</span></div>
            </div>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Proforma #</th>
                    <th className="px-5 py-2 text-left font-normal">Proforma date</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice / PO #</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3 font-mono text-xs">{r.proforma_number}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.proforma_date)}</td>
                      <td className="px-5 py-3 font-mono text-xs">{r.po_number}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
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
                Import {rows.length} proforma{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.created}</div>
              <div className="text-xs text-muted-foreground mt-1">Proformas created successfully</div>
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
