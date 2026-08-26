import { createFileRoute } from "@tanstack/react-router";
import { FilterBar } from "@/components/ui/filter-bar";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { AnimatedMoney } from "@/components/animated-number";
import { Plus, Loader2, Save, Trash2, X, TrendingUp, Building2, Eye, ArrowUpDown, FileText, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { CounterpartyDashboard } from "@/components/counterparty-dashboard";

export const Route = createFileRoute("/app/suppliers")({
  component: SuppliersPage,
});

type Supplier = {
  id: string;
  company_name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  address_line: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_designation: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  advance_rate: number;
  fee_rate: number;
  notes: string | null;
  created_at: string;
};

const emptyForm = {
  company_name: "",
  industry: "",
  website: "",
  phone: "",
  address_line: "",
  address_line2: "",
  city: "",
  country: "",
  postal_code: "",
  contact_name: "",
  contact_designation: "",
  contact_email: "",
  contact_phone: "",
  advance_rate: 0.8,
  fee_rate: 0.025,
  notes: "",
};

function SuppliersPage() {
  const { canWrite } = useAuth();
  const canEdit = canWrite("suppliers");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewing, setViewing] = useState<Supplier | null>(null);

  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await api.get<any[]>("/suppliers")) ?? [],
  });

  const purchaseInvoicesQ = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.company_name.trim()) throw new Error("Company name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) throw new Error("Invalid contact email");
      const payload = {
        company_name: form.company_name.trim(),
        industry: form.industry || null,
        website: form.website || null,
        phone: form.phone || null,
        address_line: form.address_line || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        country: form.country || null,
        postal_code: form.postal_code || null,
        contact_name: form.contact_name || null,
        contact_designation: form.contact_designation || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        advance_rate: Number(form.advance_rate),
        fee_rate: Number(form.fee_rate),
        notes: form.notes || null,
      };
      if (editing) {
        await api.patch(`/suppliers/${editing.id}`, payload);
      } else {
        await api.post("/suppliers", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Supplier updated" : "Supplier onboarded");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/suppliers/${id}`);
    },
    onSuccess: () => {
      toast.success("Supplier removed");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      company_name: s.company_name,
      industry: s.industry ?? "",
      website: s.website ?? "",
      phone: s.phone ?? "",
      address_line: s.address_line ?? "",
      address_line2: s.address_line2 ?? "",
      city: s.city ?? "",
      country: s.country ?? "",
      postal_code: s.postal_code ?? "",
      contact_name: s.contact_name ?? "",
      contact_designation: s.contact_designation ?? "",
      contact_email: s.contact_email ?? "",
      contact_phone: s.contact_phone ?? "",
      advance_rate: Number(s.advance_rate),
      fee_rate: Number(s.fee_rate),
      notes: s.notes ?? "",
    });
    setOpen(true);
  };

  const suppliers = suppliersQ.data ?? [];
  const purchaseInvoices = purchaseInvoicesQ.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Onboarding"
        title="Suppliers"
        description="The companies whose invoices you finance. Set advance rates, fee rates, and payment terms."
        actions={
          canEdit ? (
            <button onClick={openNew} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Onboard supplier
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="p-6 md:p-10">
        {/* ── Dashboard ── */}
        <CounterpartyDashboard
          kind="supplier"
          parties={suppliers}
          invoices={purchaseInvoices.map((pi: any) => ({
            id: pi.id,
            amount: pi.amount,
            status: pi.status,
            issue_date: pi.issue_date,
            due_date: pi.due_date,
            paid_date: pi.paid_date,
            vendor_id: pi.vendor_id,
          }))}
          loading={suppliersQ.isLoading || purchaseInvoicesQ.isLoading}
        />

        {/* ── Supplier Directory ── */}
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground/50" />
              Supplier directory ({suppliers.length})
            </h3>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left">UID</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Contact</th>
                    <th className="px-4 py-3 text-left">Location</th>
                    <th className="px-4 py-3 text-right">Advance</th>
                    <th className="px-4 py-3 text-right">Fee</th>
                    <th className="px-4 py-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {suppliersQ.isLoading && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td>
                    </tr>
                  )}
                  {!suppliersQ.isLoading && suppliers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-muted-foreground">
                        No suppliers yet. Click <span className="text-foreground">Onboard supplier</span> to add the first one.
                      </td>
                    </tr>
                  )}
                  <div className="mb-4 px-1">
                    <FilterBar
                      searchPlaceholder="Search suppliers by name, industry, contact…"
                      searchValue={searchQuery}
                      onSearchChange={setSearchQuery}
                      statusOptions={[{ label: "All suppliers", value: "all" }]}
                      statusValue="all"
                      onStatusChange={() => {}}
                    />
                  </div>
                  {suppliers.filter((s: any) => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return s.company_name?.toLowerCase().includes(q) || s.industry?.toLowerCase().includes(q) || s.contact_name?.toLowerCase().includes(q) || s.contact_email?.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q);
                  }).map((s: any) => {
                    const supplierInvoices = purchaseInvoices.filter((pi: any) => pi.vendor_id === s.id);
                    const totalSpend = supplierInvoices.reduce((sum: number, pi: any) => sum + Number(pi.amount), 0);
                    const outstandingSpend = supplierInvoices
                      .filter((pi: any) => pi.status !== "paid" && pi.status !== "rejected")
                      .reduce((sum: number, pi: any) => sum + Number(pi.amount), 0);
                    const avgDays = (() => {
                      const paid = supplierInvoices.filter((pi: any) => pi.status === "paid" && pi.issue_date && pi.paid_date);
                      if (paid.length === 0) return null;
                      return Math.round(paid.reduce((s: number, pi: any) => s + daysBetween(pi.issue_date, pi.paid_date), 0) / paid.length);
                    })();
                    return (
                      <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground" title={s.id}>#{s.id.slice(-8).toUpperCase()}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{s.company_name}</div>
                          <div className="text-xs text-muted-foreground">{s.industry ?? "—"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{s.contact_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{s.contact_email ?? ""}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {[s.city, s.country].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-3 text-right num">{(Number(s.advance_rate) * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right num">{(Number(s.fee_rate) * 100).toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setViewing(s)} className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary mr-1">
                            <Eye className="mr-0.5 inline h-3 w-3" />View
                          </button>
                          {canEdit && (
                            <>
                              <button onClick={() => openEdit(s)} className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Edit</button>
                              <button onClick={() => { if (confirm(`Remove ${s.company_name}?`)) remove.mutate(s.id); }}
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
          </Card>
        </div>
      </div>

      {/* ── Supplier Detail Modal ── */}
      {viewing && (
        <SupplierDetailModal
          supplier={viewing}
          invoices={purchaseInvoices.filter((pi: any) => pi.vendor_id === viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <h3 className="font-display text-lg">{editing ? "Edit supplier" : "Onboard new supplier"}</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
              {/* ── Company ── */}
              <Section title="Company">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Company name *"><input required maxLength={200} className="inp" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></F>
                  <F label="Industry"><input maxLength={100} className="inp" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></F>
                  <F label="Website"><input type="url" maxLength={255} placeholder="https://" className="inp" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></F>
                  <F label="Phone"><input maxLength={40} className="inp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></F>
                </div>
              </Section>

              {/* ── Address ── */}
              <Section title="Address">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Address" full><input maxLength={300} className="inp" value={form.address_line} onChange={(e) => setForm({ ...form, address_line: e.target.value })} /></F>
                  <F label="Address" full><input maxLength={300} className="inp" value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} /></F>
                  <F label="City"><input maxLength={100} className="inp" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></F>
                  <F label="Country"><input maxLength={100} className="inp" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></F>
                  <F label="PIN / Postal code"><input maxLength={20} className="inp" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></F>
                </div>
              </Section>

              {/* ── Primary contact ── */}
              <Section title="Primary contact">
                <div className="grid gap-3 md:grid-cols-2">
                  <F label="Contact name"><input maxLength={120} className="inp" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></F>
                  <F label="Designation"><input maxLength={120} className="inp" value={form.contact_designation} onChange={(e) => setForm({ ...form, contact_designation: e.target.value })} /></F>
                  <F label="Email"><input type="email" maxLength={255} className="inp" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></F>
                  <F label="Phone"><input maxLength={40} className="inp" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></F>
                </div>
              </Section>

              {/* ── Terms ── */}
              <Section title="Terms">
                <div className="grid gap-3 md:grid-cols-3">
                  <F label="Advance rate (0–1)"><input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a decimal between 0 and 1 (e.g. 0.8)" className="inp" value={form.advance_rate} onChange={(e) => setForm({ ...form, advance_rate: Number(e.target.value) })} /></F>
                  <F label="Fee rate (0–1)"><input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a decimal between 0 and 1 (e.g. 0.025)" className="inp" value={form.fee_rate} onChange={(e) => setForm({ ...form, fee_rate: Number(e.target.value) })} /></F>
                  <F label="Notes" full><textarea rows={3} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></F>
                </div>
              </Section>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editing ? "Save changes" : "Onboard"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

function SupplierDetailModal({ supplier, invoices, onClose }: { supplier: Supplier; invoices: any[]; onClose: () => void }) {
  const totalAmount = invoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalPaid = paidInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const openCount = invoices.filter((i: any) => i.status !== "paid" && i.status !== "rejected").length;
  const overdueCount = invoices.filter((i: any) => {
    if (i.status === "paid" || i.status === "rejected") return false;
    return i.due_date ? daysBetween(i.due_date) > 0 : false;
  }).length;
  const overdueTotal = invoices
    .filter((i: any) => {
      if (i.status === "paid" || i.status === "rejected") return false;
      return i.due_date ? daysBetween(i.due_date) > 0 : false;
    })
    .reduce((s: number, i: any) => s + Number(i.amount), 0);
  const outstanding = totalAmount - totalPaid;
  const closedCount = paidInvoices.length;

  const payDays = paidInvoices
    .filter((i: any) => i.issue_date && i.paid_date)
    .map((i: any) => daysBetween(i.issue_date, i.paid_date))
    .filter((d: number) => d >= 0);
  const avgPayDays = payDays.length > 0 ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length) : null;

  const [filter, setFilter] = useState<string>("all");
  const filtered = invoices.filter((i: any) => {
    if (filter === "open") return i.status !== "paid" && i.status !== "rejected";
    if (filter === "closed") return i.status === "paid";
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg">{supplier.company_name}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{supplier.industry || "—"}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Supplier info */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Supplier details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <DetailRow label="Company" value={supplier.company_name} />
              <DetailRow label="Industry" value={supplier.industry || "—"} />
              <DetailRow label="Contact" value={supplier.contact_name || "—"} />
              <DetailRow label="Email" value={supplier.contact_email || "—"} />
              <DetailRow label="Phone" value={supplier.contact_phone || "—"} />
              <DetailRow label="Location" value={[supplier.city, supplier.country].filter(Boolean).join(", ") || "—"} />
              <DetailRow label="Advance rate" value={`${(Number(supplier.advance_rate) * 100).toFixed(1)}%`} />
              <DetailRow label="Fee rate" value={`${(Number(supplier.fee_rate) * 100).toFixed(2)}%`} />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <MiniStat label="Total invoices" value={String(invoices.length)} icon={<FileText className="h-3.5 w-3.5" />} />
            <MiniStat label="Total spend" value={fmtMoney(totalAmount)} icon={<DollarSign className="h-3.5 w-3.5" />} />
            <MiniStat label="Outstanding" value={fmtMoney(outstanding)} accent={outstanding > 0 ? "text-warning" : "text-success"} icon={<TrendingUp className="h-3.5 w-3.5" />} />
            <MiniStat label="Overdue" value={overdueCount > 0 ? `${overdueCount} (${fmtMoney(overdueTotal)})` : "None"} accent={overdueCount > 0 ? "text-destructive" : "text-success"} icon={<ArrowUpDown className="h-3.5 w-3.5" />} />
            <MiniStat label="Avg pay days" value={avgPayDays != null ? `${avgPayDays}d` : "—"} icon={<TrendingUp className="h-3.5 w-3.5" />} />
          </div>

          {/* Filter */}
          <FilterBar
            searchPlaceholder="Search invoices…"
            searchValue=""
            onSearchChange={() => {}}
            statusOptions={[
              { label: "All", value: "all" },
              { label: "Open", value: "open" },
              { label: "Closed", value: "closed" },
            ]}
            statusValue={filter}
            onStatusChange={(v) => setFilter(v)}
          />
          <div className="mt-2 text-[10px] text-muted-foreground">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}</div>

          {/* Invoices table */}
          <div className="rounded-lg border border-border bg-background/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left">Invoice</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Issue</th>
                  <th className="px-4 py-2.5 text-left">Due</th>
                  <th className="px-4 py-2.5 text-left">Paid</th>
                  <th className="px-4 py-2.5 text-right">Pay days</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-primary">{inv.invoice_number}</td>
                    <td className="px-4 py-2.5 text-right num font-medium">{fmtMoney(inv.amount)}</td>
                    <td className="px-4 py-2.5 text-sm">{fmtDate(inv.issue_date)}</td>
                    <td className="px-4 py-2.5 text-sm">{fmtDate(inv.due_date)}</td>
                    <td className="px-4 py-2.5 text-sm">{inv.status === "paid" ? fmtDate(inv.paid_date) : "—"}</td>
                    <td className="px-4 py-2.5 text-right num">
                      {inv.status === "paid" && inv.issue_date && inv.paid_date ? `${daysBetween(inv.issue_date, inv.paid_date)}d` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]
                        ${inv.status === "paid" ? "border-success/30 bg-success/10 text-success" : inv.status === "overdue" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{inv.status}</span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-xs text-muted-foreground">No invoices match.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
        {label}
      </div>
      <div className={`mt-1.5 text-base font-semibold num ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
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

function F({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-2" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
