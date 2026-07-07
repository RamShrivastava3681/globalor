import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, ShieldAlert, Trash2, Eye, FileText, Building2, AlertTriangle, DollarSign, ArrowUpDown } from "lucide-react";
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
  const [bulkPayDebtor, setBulkPayDebtor] = useState<any | null>(null);
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
  const canPay = canWrite("invoices") || canWrite("funding-queue");

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
                    <th className="px-5 py-2 text-left font-normal">UID</th>
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
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={d.id}>#{d.id.slice(-8).toUpperCase()}</td>
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
                          {canPay && (
                            <button onClick={() => setBulkPayDebtor(d)} className="mr-2 rounded-md border border-primary/50 px-2 py-1 text-xs text-primary hover:bg-primary/10">
                              <DollarSign className="mr-0.5 inline h-3 w-3" />Bulk pay
                            </button>
                          )}
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

      {bulkPayDebtor && (
        <BulkPaymentModal
          debtor={bulkPayDebtor}
          invoices={(invoicesQ.data ?? []).filter((i: any) => i.debtor_id === bulkPayDebtor.id)}
          onClose={() => setBulkPayDebtor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["invoices-for-debtors"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
          }}
        />
      )}
    </div>
  );
}

function DebtorFormModal({ editing, onClose, onDone }: { editing: any | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(() => ({
    name: editing?.name ?? "",
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
          <Section title="Company">
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Name *"><input required maxLength={200} className="inp" value={form.name} onChange={set("name")} /></L>
              <L label="Industry"><input maxLength={100} className="inp" value={form.industry} onChange={set("industry")} /></L>
              <L label="Website"><input type="url" maxLength={255} placeholder="https://" className="inp" value={form.website} onChange={set("website")} /></L>
              <L label="Phone"><input maxLength={40} className="inp" value={form.phone} onChange={set("phone")} /></L>
            </div>
          </Section>

          <Section title="Address">
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
  const overdueCount = invoices.filter((i: any) => i.status === "overdue").length;
  const { canWrite } = useAuth();
  const canEdit = canWrite("invoices");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Filter & sort state
  const [filter, setFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const filteredInvoices = useMemo(() => {
    let result = [...invoices];
    // Apply status filter
    if (filter === "open") {
      result = result.filter((i: any) => i.status !== "paid");
    } else if (filter === "closed") {
      result = result.filter((i: any) => i.status === "paid");
    }
    // Apply sort
    result.sort((a: any, b: any) => {
      const aVal = sortField === "issue" ? (a.issue_date ?? "") : (a.due_date ?? "");
      const bVal = sortField === "issue" ? (b.issue_date ?? "") : (b.due_date ?? "");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return result;
  }, [invoices, filter, sortField, sortOrder]);

  const visibleInvoices = filteredInvoices;

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

  // Average overdue days: for paid invoices, days between due_date and paid_date
  const overdueDaysList = paidInvoices
    .map((i: any) => i.due_date && i.paid_date ? daysBetween(i.due_date, i.paid_date) : null)
    .filter((d: number | null): d is number => d !== null && d >= 0);
  const avgOverdueDays = overdueDaysList.length > 0
    ? Math.round(overdueDaysList.reduce((a, b) => a + b, 0) / overdueDaysList.length)
    : null;

  // Median, max, min payment days
  const sortedPaymentDays = [...paymentDays].sort((a, b) => a - b);
  const medianPaymentDays = paymentDays.length > 0
    ? (paymentDays.length % 2 === 0
      ? Math.round((sortedPaymentDays[paymentDays.length / 2 - 1] + sortedPaymentDays[paymentDays.length / 2]) / 2)
      : sortedPaymentDays[Math.floor(paymentDays.length / 2)])
    : null;
  const maxPaymentDays = paymentDays.length > 0 ? Math.max(...paymentDays) : null;
  const minPaymentDays = paymentDays.length > 0 ? Math.min(...paymentDays) : null;

  // Outstanding, remaining credit, closed count
  const outstanding = totalAmount - totalPaid;
  const remaining = Math.max(0, Number(debtor.credit_limit) - outstanding);
  const closedCount = paidInvoices.length;

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
              <Detail label="Credit limit" value={fmtMoney(debtor.credit_limit)} />
              <Detail label="Risk score" value={debtor.risk_score != null ? `${debtor.risk_score}/100` : "—"} />
              <Detail label="Contact" value={debtor.contact_name || "—"} />
              <Detail label="Email" value={debtor.contact_email || "—"} />
              {debtor.address_line && <Detail label="Address" value={[debtor.address_line, debtor.city, debtor.country].filter(Boolean).join(", ")} />}
              <Detail label="Phone" value={debtor.contact_phone || "—"} />
              <Detail label="City" value={debtor.city || "—"} />
              <Detail label="Country" value={debtor.country || "—"} />
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
            <StatsCard label="Total invoices" value={String(invoices.length)} />
            <StatsCard label="Closed" value={String(closedCount)} accent={closedCount > 0 ? "text-success" : ""} />
            <StatsCard label="Overdue" value={String(overdueCount)} accent={overdueCount > 0 ? "text-destructive" : ""} />
            <StatsCard label="Outstanding" value={fmtMoney(outstanding)} accent={outstanding > 0 ? "text-warning" : "text-success"} />
            <StatsCard label="Total invoiced" value={fmtMoney(totalAmount)} />
            <StatsCard label="Total paid" value={fmtMoney(totalPaid)} />
            <StatsCard label="Avg days" value={avgPaymentDays != null ? `${avgPaymentDays}d` : "—"} />
            <StatsCard label="Median days" value={medianPaymentDays != null ? `${medianPaymentDays}d` : "—"} />
            <StatsCard label="Max days" value={maxPaymentDays != null ? `${maxPaymentDays}d` : "—"} accent={maxPaymentDays != null && maxPaymentDays > 90 ? "text-destructive" : ""} />
            <StatsCard label="Min days" value={minPaymentDays != null ? `${minPaymentDays}d` : "—"} accent={minPaymentDays != null && minPaymentDays > 0 ? "text-success" : ""} />
            <StatsCard label="Avg overdue days" value={avgOverdueDays != null ? `${avgOverdueDays}d` : "—"} accent={avgOverdueDays != null && avgOverdueDays > 0 ? "text-destructive" : ""} />
            <StatsCard label="Remaining" value={fmtMoney(remaining)} accent={remaining > 0 ? "text-success" : "text-muted-foreground"} />
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
            {/* Filter & sort controls */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {["all", "open", "closed"].map((s) => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest transition ${
                    filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}>{s === "all" ? "All" : s === "open" ? "Open" : "Closed"}</button>
              ))}
              <span className="ml-2 h-4 w-px bg-border" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort</span>
              {(["issue", "due"] as const).map((field) => (
                <button key={field}
                  onClick={() => {
                    if (sortField === field) {
                      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    } else {
                      setSortField(field);
                      setSortOrder("asc");
                    }
                  }}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition ${
                    sortField === field
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {field === "issue" ? "Issue date" : "Due date"}
                  {sortField === field && (
                    <span className="text-[9px]">{sortOrder === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              ))}
            </div>
            {visibleInvoices.length === 0 ? (
              <div className="text-xs text-muted-foreground">No invoices match the current filter.</div>
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
                      <th className="px-4 py-2 text-right font-normal">Overdue days</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((inv: any) => {
                      const paymentDays = inv.status === "paid" && inv.issue_date && inv.paid_date
                        ? daysBetween(inv.issue_date, inv.paid_date)
                        : null;
                      const rowOverdueDays = inv.status === "paid" && inv.due_date && inv.paid_date
                        ? Math.max(0, daysBetween(inv.due_date, inv.paid_date))
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
                          <td className={`px-4 py-2.5 text-right num ${rowOverdueDays != null && rowOverdueDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {rowOverdueDays != null ? `${rowOverdueDays}d` : "—"}
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

function BulkPaymentModal({ debtor, invoices, onClose, onDone }: { debtor: any; invoices: any[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sortField, setSortField] = useState<"issue" | "created">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Only open invoices
  const openInvoices = useMemo(() => {
    return invoices.filter((i: any) => i.status !== "paid");
  }, [invoices]);

  // Sorted open invoices
  const sortedInvoices = useMemo(() => {
    const result = [...openInvoices];
    result.sort((a: any, b: any) => {
      const aVal = sortField === "issue" ? (a.issue_date ?? "") : (a.created_at ?? "");
      const bVal = sortField === "issue" ? (b.issue_date ?? "") : (b.created_at ?? "");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return result;
  }, [openInvoices, sortField, sortOrder]);

  const allSelected = sortedInvoices.length > 0 && selectedIds.size === sortedInvoices.length;
  const selectedCount = selectedIds.size;

  // Total amount of selected invoices
  const selectedTotal = sortedInvoices
    .filter((i: any) => selectedIds.has(i.id))
    .reduce((s: number, i: any) => s + Number(i.amount), 0);

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
      setSelectedIds(new Set(sortedInvoices.map((i: any) => i.id)));
    }
  };

  const bulkPay = useMutation({
    mutationFn: async () => {
      const totalAmount = Number(amount);
      if (!totalAmount || totalAmount <= 0) throw new Error("Enter a valid payment amount");
      if (!date) throw new Error("Select a payment date");
      if (selectedIds.size === 0) throw new Error("Select at least one invoice");

      // Get selected invoices in sorted order
      const selected = sortedInvoices.filter((i: any) => selectedIds.has(i.id));

      // Allocate: go through selected invoices in order, deduct full amount from total
      let remaining = totalAmount;
      const items: Array<{ id: string; invoice_number: string; date_received: string; amount_received: number }> = [];

      for (const inv of selected) {
        if (remaining <= 0) break;
        const invoiceAmount = Number(inv.amount);
        const allocated = Math.min(invoiceAmount, remaining);
        items.push({
          id: inv.id,
          invoice_number: inv.invoice_number,
          date_received: date,
          amount_received: allocated,
        });
        remaining -= allocated;
      }

      if (items.length === 0) throw new Error("No invoices to pay");

      return await api.post<{ paid: any[]; not_found: string[]; errors: any[] }>("/invoices/bulk-pay", { items });
    },
    onSuccess: (result) => {
      const count = result.paid?.length ?? 0;
      toast.success(`${count} invoice${count !== 1 ? "s" : ""} marked as paid`);
      if (result.errors?.length > 0) {
        toast.error(`${result.errors.length} invoice${result.errors.length !== 1 ? "s" : ""} failed`);
      }
      if (result.not_found?.length > 0) {
        toast.warning(`${result.not_found.length} invoice${result.not_found.length !== 1 ? "s" : ""} not found`);
      }
      setSelectedIds(new Set());
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to process payment"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg">Bulk payment — {debtor.name}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 p-5">
          {/* Payment fields */}
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-background/40 p-4">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Total amount received</label>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]+(\\.[0-9]+)?"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-10 w-48 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {selectedCount > 0 && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Selected total: {fmtMoney(selectedTotal)} ·
                  {Number(amount) >= selectedTotal ? (
                    <span className="text-success"> enough</span>
                  ) : (
                    <span className="text-destructive"> short by {fmtMoney(selectedTotal - Number(amount))}</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Payment date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Open invoices list */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-widest text-primary">
                <FileText className="mr-1 inline h-3.5 w-3.5" />Open invoices ({openInvoices.length})
              </h4>
            </div>

            {/* Sort controls */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
              {(["issue", "created"] as const).map((field) => (
                <button key={field}
                  onClick={() => {
                    if (sortField === field) {
                      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    } else {
                      setSortField(field);
                      setSortOrder("asc");
                    }
                  }}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                    sortField === field
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {field === "issue" ? "Issue date" : "Created date"}
                  {sortField === field && (
                    <span className="text-[10px]">{sortOrder === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              ))}
            </div>

            {sortedInvoices.length === 0 ? (
              <div className="text-xs text-muted-foreground">No open invoices for this debtor.</div>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="w-10 px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                        />
                      </th>
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-left font-normal">Issue</th>
                      <th className="px-4 py-2 text-left font-normal">Due</th>
                      <th className="px-4 py-2 text-right font-normal">Allocation</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Pre-compute allocations for display
                      let remaining = Number(amount) || 0;
                      return sortedInvoices.map((inv: any) => {
                        const isSelected = selectedIds.has(inv.id);
                        let allocation = 0;
                        if (isSelected && remaining > 0) {
                          allocation = Math.min(Number(inv.amount), remaining);
                          remaining -= allocation;
                        }
                        return (
                          <tr key={inv.id} className={`border-b border-border/60 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                            <td className="w-10 px-2 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(inv.id)}
                                className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs">{inv.invoice_number}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right num">{fmtMoney(inv.amount)}</td>
                            <td className="px-4 py-2.5 text-sm">{fmtDate(inv.issue_date)}</td>
                            <td className="px-4 py-2.5 text-sm">{inv.due_date ? fmtDate(inv.due_date) : "—"}</td>
                            <td className={`px-4 py-2.5 text-right num ${isSelected && allocation > 0 ? "text-success" : "text-muted-foreground"}`}>
                              {isSelected && allocation > 0 ? fmtMoney(allocation) : "—"}
                            </td>
                            <td className="px-4 py-2.5"><StatusPill status={inv.status} /></td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary */}
          {selectedCount > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Selected invoices</span>
                <span>{selectedCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total selected amount</span>
                <span className="num">{fmtMoney(selectedTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount entered</span>
                <span className="num">{fmtMoney(Number(amount) || 0)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 mt-1">
                <span className="text-muted-foreground">Shortfall / surplus</span>
                <span className={`num ${(Number(amount) || 0) >= selectedTotal ? "text-success" : "text-destructive"}`}>
                  {fmtMoney(Math.abs((Number(amount) || 0) - selectedTotal))}
                  {(Number(amount) || 0) >= selectedTotal ? " surplus" : " short"}
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <button
              disabled={bulkPay.isPending || selectedCount === 0 || !Number(amount)}
              onClick={() => bulkPay.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {bulkPay.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DollarSign className="h-4 w-4" />
              )}
              Mark {selectedCount} invoice{selectedCount !== 1 ? "s" : ""} as paid
            </button>
          </div>
        </div>
      </div>
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
