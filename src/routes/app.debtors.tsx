import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, ShieldAlert, Trash2, Eye, FileText, Building2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/app/debtors")({
  component: DebtorsPage,
});

function DebtorsPage() {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const debtorsQ = useQuery({
    queryKey: ["debtors-full"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices-for-debtors"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/debtors/${id}`);
    },
    onSuccess: () => {
      toast.success("Debtor removed");
      qc.invalidateQueries({ queryKey: ["debtors-full"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const canEdit = canWrite("debtors");

  return (
    <div>
      <PageHeader
        eyebrow="Counterparties"
        title="Debtor book"
        description="Credit limits, risk scores, and payment terms for every payer."
        actions={
          canEdit && (
            <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Add debtor
            </button>
          )
        }
      />

      <div className="p-6 md:p-10">
        <Card>
          {(debtorsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <ShieldAlert className="mx-auto mb-3 h-6 w-6" />
              No debtors yet.
              {canEdit && <div className="mt-3"><button onClick={() => { setEditing(null); setOpen(true); }} className="text-primary">Add one →</button></div>}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <div className="mb-4 px-5">
                <input type="text" placeholder="Search debtors by name, industry, city..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Name</th>
                    <th className="px-5 py-2 text-left font-normal">Industry</th>
                    <th className="px-5 py-2 text-right font-normal">Credit limit</th>
                    <th className="px-5 py-2 text-left font-normal">Risk</th>
                    {canEdit && <th className="px-5 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {(debtorsQ.data ?? []).filter((d: any) => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return d.name?.toLowerCase().includes(q) || d.industry?.toLowerCase().includes(q) || d.city?.toLowerCase().includes(q) || d.country?.toLowerCase().includes(q) || d.contact_name?.toLowerCase().includes(q);
                  }).map((d: any) => {
                    const riskTone = d.risk_score >= 75 ? "text-success" : d.risk_score >= 50 ? "text-warning" : "text-destructive";
                    return (
                      <tr key={d.id} className="border-b border-border/60">
                        <td className="px-5 py-3 font-medium">{d.name}</td>
                        <td className="px-5 py-3 text-muted-foreground">{d.industry ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(d.credit_limit)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div className={`h-full ${d.risk_score >= 75 ? "bg-success" : d.risk_score >= 50 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${d.risk_score}%` }} />
                            </div>
                            <span className={`num text-xs ${riskTone}`}>{d.risk_score}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => setViewing(d)} className="mr-2 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary">
                            <Eye className="mr-1 inline h-3 w-3" />View
                          </button>
                          {canEdit && (
                            <>
                              <button onClick={() => { setEditing(d); setOpen(true); }} className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Edit</button>
                              <button onClick={() => { if (confirm(`Remove ${d.name}?`)) remove.mutate(d.id); }}
                                className="ml-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
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

      {open && <DebtorFormModal editing={editing} onClose={() => { setOpen(false); setEditing(null); }} onDone={() => qc.invalidateQueries({ queryKey: ["debtors-full"] })} />}

      {viewing && (
        <DebtorDetailModal
          debtor={viewing}
          invoices={(invoicesQ.data ?? []).filter((i: any) => i.debtor_id === viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function DebtorFormModal({ editing, onClose, onDone }: { editing: any | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(() => ({
    name: editing?.name ?? "",
    registration_no: editing?.registration_no ?? "",
    relationship_since: editing?.relationship_since ?? "",
    industry: editing?.industry ?? "",
    credit_limit: String(editing?.credit_limit ?? "100000"),
    risk_score: String(editing?.risk_score ?? "70"),
    address_line: editing?.address_line ?? "",
    city: editing?.city ?? "",
    country: editing?.country ?? "",
    postal_code: editing?.postal_code ?? "",
    phone: editing?.phone ?? "",
    website: editing?.website ?? "",
    contact_name: editing?.contact_name ?? "",
    contact_email: editing?.contact_email ?? "",
    contact_designation: editing?.contact_designation ?? "",
    contact_phone: editing?.contact_phone ?? "",
  }));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) throw new Error("Invalid contact email");

      const payload = {
        name: form.name.trim(),
        registration_no: form.registration_no || null,
        relationship_since: form.relationship_since || null,
        industry: form.industry || null,
        credit_limit: Number(form.credit_limit),
        risk_score: Number(form.risk_score),
        address_line: form.address_line || null,
        city: form.city || null,
        country: form.country || null,
        postal_code: form.postal_code || null,
        phone: form.phone || null,
        website: form.website || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_designation: form.contact_designation || null,
        contact_phone: form.contact_phone || null,
      };

      if (editing) {
        await api.patch(`/debtors/${editing.id}`, payload);
      } else {
        await api.post("/debtors", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Debtor updated" : "Debtor added");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit debtor" : "Add debtor"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          <Section title="Legal Entity">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Legal Entity Name *"><input required maxLength={200} className="inp" value={form.name} onChange={set("name")} /></L>
              <L label="Registration No."><input maxLength={100} className="inp" value={form.registration_no} onChange={set("registration_no")} /></L>
              <L label="Industry"><input maxLength={100} className="inp" value={form.industry} onChange={set("industry")} /></L>
              <L label="Relationship Since"><input type="date" className="inp" value={form.relationship_since} onChange={set("relationship_since")} /></L>
            </div>
          </Section>

          <Section title="Registered Address">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Address" full><input maxLength={300} className="inp" value={form.address_line} onChange={set("address_line")} /></L>
              <L label="City"><input maxLength={100} className="inp" value={form.city} onChange={set("city")} /></L>
              <L label="Country"><input maxLength={100} className="inp" value={form.country} onChange={set("country")} /></L>
              <L label="PIN / Postal code"><input maxLength={20} className="inp" value={form.postal_code} onChange={set("postal_code")} /></L>
            </div>
          </Section>

          <Section title="Primary contact">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Contact name"><input maxLength={120} className="inp" value={form.contact_name} onChange={set("contact_name")} /></L>
              <L label="Designation"><input maxLength={120} className="inp" value={form.contact_designation} onChange={set("contact_designation")} /></L>
              <L label="Email"><input type="email" maxLength={255} className="inp" value={form.contact_email} onChange={set("contact_email")} /></L>
              <L label="Phone"><input maxLength={40} className="inp" value={form.contact_phone} onChange={set("contact_phone")} /></L>
            </div>
          </Section>

          <Section title="Credit terms">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Credit limit"><input required type="number" min="0" className="inp" value={form.credit_limit} onChange={set("credit_limit")} /></L>
              <L label="Risk score (0–100)"><input required type="number" min="0" max="100" className="inp" value={form.risk_score} onChange={set("risk_score")} /></L>
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function DebtorDetailModal({ debtor, invoices, onClose }: { debtor: any; invoices: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const totalAmount = invoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalPaid = paidInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0);

  const { canWrite } = useAuth();
  const canEdit = canWrite("invoices");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const allSelected = invoices.length > 0 && selectedIds.size === invoices.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i: any) => i.id)));
    }
  };

  // Bulk delete mutation
  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post("/invoices/bulk-delete", { ids });
    },
    onSuccess: () => {
      const count = selectedIds.size;
      toast.success(`${count} invoice${count !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["invoices-for-debtors"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete invoices"),
  });

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setConfirmOpen(true);
  };

  // Average payment days: for paid invoices, days between issue_date and paid_date
  const paymentDays = paidInvoices
    .map((i: any) => i.issue_date && i.paid_date ? daysBetween(i.issue_date, i.paid_date) : null)
    .filter((d: number | null): d is number => d !== null && d >= 0);
  const avgPaymentDays = paymentDays.length > 0
    ? Math.round(paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length)
    : null;


  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg">{debtor.name}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{debtor.industry || "—"}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Debtor info summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Debtor details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <Detail label="Legal Entity Name" value={debtor.name} />
              {debtor.registration_no && <Detail label="Registration No." value={debtor.registration_no} />}
              <Detail label="Industry" value={debtor.industry || "—"} />
              {debtor.relationship_since && <Detail label="Relationship Since" value={debtor.relationship_since} />}
              <Detail label="Credit limit" value={fmtMoney(debtor.credit_limit)} />
              <Detail label="Risk score" value={debtor.risk_score != null ? `${debtor.risk_score}/100` : "—"} />
              <Detail label="Contact" value={debtor.contact_name || "—"} />
              <Detail label="Email" value={debtor.contact_email || "—"} />
              {debtor.address_line && <Detail label="Registered Address" value={[debtor.address_line, debtor.city, debtor.country].filter(Boolean).join(", ")} />}
              <Detail label="Phone" value={debtor.contact_phone || "—"} />
              <Detail label="City" value={debtor.city || "—"} />
              <Detail label="Country" value={debtor.country || "—"} />
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
            <StatsCard label="Total invoices" value={String(invoices.length)} />
            <StatsCard label="Total invoiced" value={fmtMoney(totalAmount)} />
            <StatsCard label="Total paid" value={fmtMoney(totalPaid)} />
            <StatsCard label="Avg payment days" value={avgPaymentDays != null ? `${avgPaymentDays}d` : "—"} />

          </div>

          {/* Invoices table */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-widest text-primary">
                <FileText className="mr-1 inline h-3.5 w-3.5" />Linked invoices ({invoices.length})
              </h4>
              {canEdit && selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDelete.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-all"
                >
                  {bulkDelete.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete {selectedIds.size}
                </button>
              )}
            </div>
            {invoices.length === 0 ? (
              <div className="text-xs text-muted-foreground">No invoices linked to this debtor.</div>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      {canEdit && (
                        <th className="w-10 px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                          />
                        </th>
                      )}
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-left font-normal">Issue</th>
                      <th className="px-4 py-2 text-left font-normal">Due</th>
                      <th className="px-4 py-2 text-left font-normal">Paid</th>
                      <th className="px-4 py-2 text-right font-normal">Payment days</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.sort((a: any, b: any) => b.issue_date?.localeCompare(a.issue_date ?? "") ?? 0).map((inv: any) => {
                      const paymentDays = inv.status === "paid" && inv.issue_date && inv.paid_date
                        ? daysBetween(inv.issue_date, inv.paid_date)
                        : null;

                      const isSelected = selectedIds.has(inv.id);
                      return (
                        <tr key={inv.id} className={`border-b border-border/60 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                          {canEdit && (
                            <td className="w-10 px-2 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(inv.id)}
                                className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                              />
                            </td>
                          )}
                          <td className="px-4 py-2.5">
                            <Link to="/app/invoices" search={{ view: inv.id }} className="font-mono text-xs text-primary hover:underline">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right num">{fmtMoney(inv.amount)}</td>
                          <td className="px-4 py-2.5 text-sm">{fmtDate(inv.issue_date)}</td>
                          <td className="px-4 py-2.5 text-sm">{inv.due_date ? fmtDate(inv.due_date) : "—"}</td>
                          <td className="px-4 py-2.5 text-sm">{inv.status === "paid" ? fmtDate(inv.paid_date) : "—"}</td>
                          <td className={`px-4 py-2.5 text-right num ${paymentDays != null && paymentDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {paymentDays != null ? `${paymentDays}d` : "—"}
                          </td>

                          <td className="px-4 py-2.5"><StatusPill status={inv.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete {selectedIds.size} invoice{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected invoice{selectedIds.size !== 1 ? "s" : ""} will be permanently removed from the ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDelete.mutate(Array.from(selectedIds))}
              disabled={bulkDelete.isPending}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDelete.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatsCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold num ${accent ?? ""}`}>{value}</div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>
      {children}
    </div>
  );
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
