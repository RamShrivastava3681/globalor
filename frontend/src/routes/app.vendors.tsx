import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Building2, Save, Trash2, Eye, FileText, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/vendors")({
  component: VendorsPage,
});

function VendorsPage() {
  const { user, canWrite } = useAuth();
  const canEdit = canWrite("vendors");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const vendorsQ = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
  });

  const piQ = useQuery({
    queryKey: ["pi-for-vendors"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/vendors/${id}`);
    },
    onSuccess: () => {
      toast.success("Supplier removed");
      qc.invalidateQueries({ queryKey: ["vendors"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const openFor = (id: string) =>
    (piQ.data ?? [])
      .filter((p: any) => p.vendor_id === id && p.status !== "paid")
      .reduce((s: number, p: any) => s + Number(p.amount), 0);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (v: any) => {
    setEditing(v);
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Suppliers"
        description="The vendors you buy from. Track contacts, terms, and open payables."
        actions={
          canEdit ? (
            <button onClick={openNew} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Add supplier
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="p-6 md:p-10">
        <Card>
          {(vendorsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-6 w-6" />
              No suppliers yet.
              <div className="mt-3"><button onClick={openNew} className="text-primary">Add one →</button></div>
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <div className="mb-4 px-5">
                <input type="text" placeholder="Search suppliers by name, industry, contact..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Contact</th>
                    <th className="px-5 py-2 text-left font-normal">Location</th>
                    <th className="px-5 py-2 text-right font-normal">Open AP</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(vendorsQ.data ?? []).filter((v: any) => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return v.name?.toLowerCase().includes(q) || v.industry?.toLowerCase().includes(q) || v.contact_name?.toLowerCase().includes(q) || v.contact_email?.toLowerCase().includes(q) || v.city?.toLowerCase().includes(q);
                  }).map((v: any) => (
                    <tr key={v.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={v.id}>#{v.id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.industry ?? "—"}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div>{v.contact_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{v.contact_email ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {[v.city, v.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(openFor(v.id))}</td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => setViewing(v)} className="mr-2 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary">
                          <Eye className="mr-1 inline h-3 w-3" />View
                        </button>
                        {canEdit && (
                          <>
                            <button onClick={() => openEdit(v)} className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Edit</button>
                            <button onClick={() => { if (confirm(`Remove ${v.name}?`)) remove.mutate(v.id); }}
                              className="ml-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <AddVendorModal
          editing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onCreated={() => qc.invalidateQueries({ queryKey: ["vendors"] })}
        />
      )}

      {viewing && (
        <VendorDetailModal
          vendor={viewing}
          invoices={((piQ.data ?? []).filter((p: any) => p.vendor_id === viewing.id))}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function AddVendorModal({ editing, onClose, onCreated }: { editing: any | null; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState(() => ({
    name: editing?.name ?? "", industry: editing?.industry ?? "",
    address_line: editing?.address_line ?? "", city: editing?.city ?? "", country: editing?.country ?? "", postal_code: editing?.postal_code ?? "", phone: editing?.phone ?? "", website: editing?.website ?? "",
    contact_name: editing?.contact_name ?? "", contact_email: editing?.contact_email ?? "", contact_designation: editing?.contact_designation ?? "", contact_phone: editing?.contact_phone ?? "",
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) throw new Error("Invalid contact email");
      const payload = {
        name: form.name.trim(),
        industry: form.industry || null,
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
        await api.patch(`/vendors/${editing.id}`, payload);
      } else {
        await api.post("/vendors", payload);
      }
    },
    onSuccess: () => { onCreated(); toast.success(editing ? "Supplier updated" : "Supplier added"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit supplier" : "Add supplier"}</h3>
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

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function VendorDetailModal({ vendor, invoices, onClose }: { vendor: any; invoices: any[]; onClose: () => void }) {
  // Filter & sort state
  const [filter, setFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const visibleInvoices = useMemo(() => {
    let result = [...invoices];
    if (filter === "open") {
      result = result.filter((p: any) => p.status !== "paid");
    } else if (filter === "closed") {
      result = result.filter((p: any) => p.status === "paid");
    }
    result.sort((a: any, b: any) => {
      const aVal = sortField === "issue" ? (a.issue_date ?? "") : (a.due_date ?? "");
      const bVal = sortField === "issue" ? (b.issue_date ?? "") : (b.due_date ?? "");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return result;
  }, [invoices, filter, sortField, sortOrder]);

  const totalAmount = invoices.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const paidInvoices = invoices.filter((p: any) => p.status === "paid");
  const totalPaid = paidInvoices.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const openAP = invoices
    .filter((p: any) => p.status !== "paid")
    .reduce((s: number, p: any) => s + Number(p.amount), 0);
  // Average payment days: for paid purchase invoices, days between issue_date and paid_date
  const paymentDays = paidInvoices
    .map((p: any) => p.issue_date && p.paid_date ? daysBetween(p.issue_date, p.paid_date) : null)
    .filter((d: number | null): d is number => d !== null && d >= 0);
  const avgPaymentDays = paymentDays.length > 0
    ? Math.round(paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length)
    : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg">{vendor.name}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{vendor.industry || "—"}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Vendor info summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Supplier details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <Detail label="Contact" value={vendor.contact_name || "—"} />
              <Detail label="Email" value={vendor.contact_email || "—"} />
              <Detail label="Phone" value={vendor.contact_phone || "—"} />
              <Detail label="Website" value={vendor.website || "—"} />
              {vendor.address_line && <Detail label="Address" value={[vendor.address_line, vendor.city, vendor.country].filter(Boolean).join(", ")} />}
              <Detail label="City" value={vendor.city || "—"} />
              <Detail label="Country" value={vendor.country || "—"} />
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatsCard label="Total invoices" value={String(invoices.length)} />
            <StatsCard label="Total invoiced" value={fmtMoney(totalAmount)} />
            <StatsCard label="Total paid" value={fmtMoney(totalPaid)} />
            <StatsCard label="Avg payment days" value={avgPaymentDays != null ? `${avgPaymentDays}d` : "—"} />
            <StatsCard label="Open AP" value={fmtMoney(openAP)} accent={openAP > 0 ? "text-warning" : ""} />
          </div>

          {/* Purchase invoices table */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <ShoppingCart className="mr-1 inline h-3.5 w-3.5" />Purchase invoices ({invoices.length})
            </h4>
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
              <div className="text-xs text-muted-foreground">No purchase invoices match the current filter.</div>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-left font-normal">PO</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-left font-normal">Issue</th>
                      <th className="px-4 py-2 text-left font-normal">Due</th>
                      <th className="px-4 py-2 text-left font-normal">Paid</th>
                      <th className="px-4 py-2 text-right font-normal">Payment days</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((p: any) => {
                      const paymentDays = p.status === "paid" && p.issue_date && p.paid_date
                        ? daysBetween(p.issue_date, p.paid_date)
                        : null;
                      return (
                        <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-4 py-2.5">
                            <Link to="/app/purchases" search={{ view: p.id }} className="font-mono text-xs text-primary hover:underline">
                              {p.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.po_number || "—"}</td>
                          <td className="px-4 py-2.5 text-right num">{fmtMoney(p.amount)}</td>
                          <td className="px-4 py-2.5 text-sm">{fmtDate(p.issue_date)}</td>
                          <td className="px-4 py-2.5 text-sm">{p.due_date ? fmtDate(p.due_date) : "—"}</td>
                          <td className="px-4 py-2.5 text-sm">{p.status === "paid" ? fmtDate(p.paid_date) : "—"}</td>
                          <td className={`px-4 py-2.5 text-right num ${paymentDays != null && paymentDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {paymentDays != null ? `${paymentDays}d` : "—"}
                          </td>
                          <td className="px-4 py-2.5"><StatusPill status={p.status} /></td>
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
