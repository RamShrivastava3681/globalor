import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import { Plus, Loader2, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

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
  payment_terms_days: number;
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
  payment_terms_days: 30,
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

  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await api.get<any[]>("/suppliers")) ?? [],
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
        payment_terms_days: Number(form.payment_terms_days) || 30,
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
      payment_terms_days: Number(s.payment_terms_days) || 30,
      advance_rate: Number(s.advance_rate),
      fee_rate: Number(s.fee_rate),
      notes: s.notes ?? "",
    });
    setOpen(true);
  };

  const suppliers = suppliersQ.data ?? [];

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
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-3 text-left">Company</th>
                  <th className="px-3 py-3 text-left">Contact</th>
                  <th className="px-3 py-3 text-left">Location</th>
                  <th className="px-3 py-3 text-right">Advance</th>
                  <th className="px-3 py-3 text-right">Fee</th>
                  <th className="px-3 py-3 text-right">Terms</th>
                  <th className="px-3 py-3" />
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
                {suppliers.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <div className="font-medium">{s.company_name}</div>
                      <div className="text-xs text-muted-foreground">{s.industry ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{s.contact_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.contact_email ?? ""}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {[s.city, s.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-3 text-right num">{(Number(s.advance_rate) * 100).toFixed(1)}%</td>
                    <td className="px-3 py-3 text-right num">{(Number(s.fee_rate) * 100).toFixed(2)}%</td>
                    <td className="px-3 py-3 text-right text-muted-foreground">Net {s.payment_terms_days}</td>
                    <td className="px-3 py-3 text-right">
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
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
                  <F label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: Number(e.target.value) })} /></F>
                  <F label="Advance rate (0–1)"><input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" title="Enter a decimal between 0 and 1 (e.g. 0.8)" className="inp" value={form.advance_rate} onChange={(e) => setForm({ ...form, advance_rate: Number(e.target.value) })} /></F>
                  <F label="Fee rate (0–1)"><input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" title="Enter a decimal between 0 and 1 (e.g. 0.025)" className="inp" value={form.fee_rate} onChange={(e) => setForm({ ...form, fee_rate: Number(e.target.value) })} /></F>
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
