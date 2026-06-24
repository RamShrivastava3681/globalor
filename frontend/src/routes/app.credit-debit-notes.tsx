import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef, useEffect } from "react";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { api } from "@/lib/api-client";
import { Plus, X, Save, Trash2, ScrollText, FileText, ShoppingCart, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/credit-debit-notes")({
  component: CreditDebitNotesPage,
});

type NoteType = "credit" | "debit";

interface NoteEntry {
  id: string;
  type: NoteType;
  noteNumber: string;
  date: string;
  amount: string;
  debtorSupplierName: string;
  linkToInvoice: string;
  reason: string;
  createdAt: string;
}

function CreditDebitNotesPage() {
  const [tab, setTab] = useState<NoteType>("credit");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NoteEntry | null>(null);
  const [entries, setEntries] = useState<NoteEntry[]>(() => {
    try {
      const saved = localStorage.getItem("credit_debit_notes");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const emptyForm = {
    noteNumber: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    debtorSupplierName: "",
    linkToInvoice: "",
    reason: "",
  };

  const [form, setForm] = useState(emptyForm);

  const invoicesQ = useQuery({
    queryKey: ["sales-invoices-mini"],
    queryFn: async () => (await api.get<any[]>("/invoices/mini")) ?? [],
  });

  const purchaseInvoicesQ = useQuery({
    queryKey: ["purchase-invoices-mini"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices/mini")) ?? [],
  });

  const allInvoices = useMemo(() => {
    const sales = (invoicesQ.data ?? []).map((i: any) => ({
      ...i,
      _type: "sales" as const,
      _label: `Sales invoice`,
    }));
    const purchases = (purchaseInvoicesQ.data ?? []).map((i: any) => ({
      ...i,
      _type: "purchase" as const,
      _label: `Purchase invoice`,
    }));
    return [...sales, ...purchases];
  }, [invoicesQ.data, purchaseInvoicesQ.data]);

  const filteredEntries = useMemo(
    () => entries.filter((e) => e.type === tab),
    [entries, tab],
  );

  const saveEntry = () => {
    if (!form.noteNumber.trim()) {
      toast.error("Note number is required");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    if (editing) {
      // Update existing entry
      const updated = entries.map((e) =>
        e.id === editing.id
          ? {
              ...e,
              noteNumber: form.noteNumber.trim(),
              date: form.date,
              amount: form.amount,
              debtorSupplierName: form.debtorSupplierName.trim(),
              linkToInvoice: form.linkToInvoice.trim(),
              reason: form.reason.trim(),
            }
          : e,
      );
      setEntries(updated);
      localStorage.setItem("credit_debit_notes", JSON.stringify(updated));
      toast.success("Note updated");
    } else {
      // Create new entry
      const newEntry: NoteEntry = {
        id: crypto.randomUUID(),
        type: tab,
        noteNumber: form.noteNumber.trim(),
        date: form.date,
        amount: form.amount,
        debtorSupplierName: form.debtorSupplierName.trim(),
        linkToInvoice: form.linkToInvoice.trim(),
        reason: form.reason.trim(),
        createdAt: new Date().toISOString(),
      };
      const updated = [...entries, newEntry];
      setEntries(updated);
      localStorage.setItem("credit_debit_notes", JSON.stringify(updated));
      toast.success(
        `${tab === "credit" ? "Credit" : "Debit"} note saved`,
      );
    }

    setForm(emptyForm);
    setEditing(null);
    setOpen(false);
  };

  const deleteEntry = (entry: NoteEntry) => {
    const noteType = entry.type === "credit" ? "credit" : "debit";
    if (!confirm(`Remove ${noteType} note "${entry.noteNumber}"? This cannot be undone.`)) return;
    const updated = entries.filter((e) => e.id !== entry.id);
    setEntries(updated);
    localStorage.setItem("credit_debit_notes", JSON.stringify(updated));
    toast.success(`${noteType === "credit" ? "Credit" : "Debit"} note removed`);
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (entry: NoteEntry) => {
    setEditing(entry);
    setForm({
      noteNumber: entry.noteNumber,
      date: entry.date,
      amount: entry.amount,
      debtorSupplierName: entry.debtorSupplierName,
      linkToInvoice: entry.linkToInvoice,
      reason: entry.reason,
    });
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Credit & Debit Notes"
        title="Credit / Debit notes"
        description="Record credit and debit adjustments with full traceability."
        actions={
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            New {tab === "credit" ? "credit" : "debit"} note
          </button>
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Tab switcher */}
        <div className="flex gap-2">
          {(["credit", "debit"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-full border px-4 py-1.5 text-xs uppercase tracking-widest transition ${
                tab === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" />
                {s === "credit" ? "Credit note" : "Debit note"}
              </span>
            </button>
          ))}
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Credit notes total">
            <div className="num num-lg text-success">
              {fmtMoney(
                entries
                  .filter((e) => e.type === "credit")
                  .reduce((s, e) => s + Number(e.amount), 0),
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {entries.filter((e) => e.type === "credit").length} entries
            </div>
          </Card>
          <Card title="Debit notes total">
            <div className="num num-lg text-warning">
              {fmtMoney(
                entries
                  .filter((e) => e.type === "debit")
                  .reduce((s, e) => s + Number(e.amount), 0),
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {entries.filter((e) => e.type === "debit").length} entries
            </div>
          </Card>
        </div>

        {/* Entries table */}
        <Card>
          {filteredEntries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {tab === "credit" ? "credit" : "debit"} notes yet. Click
              "New{" "}
              {tab === "credit" ? "credit" : "debit"} note" to add one.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">
                      Note #
                    </th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-right font-normal">
                      Amount (USD)
                    </th>
                    <th className="px-5 py-2 text-left font-normal">
                      Debtor / Supplier
                    </th>
                    <th className="px-5 py-2 text-left font-normal">
                      Link to invoice
                    </th>
                    <th className="px-5 py-2 text-left font-normal">
                      Reason
                    </th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border/60 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3 font-mono text-xs">
                        {e.noteNumber}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {fmtDate(e.date)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right num ${
                          e.type === "credit"
                            ? "text-success"
                            : "text-warning"
                        }`}
                      >
                        {fmtMoney(e.amount)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {e.debtorSupplierName || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {e.linkToInvoice ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <span className="truncate max-w-[120px] block">
                              {e.linkToInvoice}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="max-w-[160px] block truncate text-xs text-muted-foreground"
                          title={e.reason}
                        >
                          {e.reason || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => openEdit(e)}
                            className="text-muted-foreground hover:text-primary transition-colors"
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteEntry(e)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label="Delete entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* New note modal */}
      {open && (
        <NewNoteModal
          type={tab}
          form={form}
          editing={editing}
          onChange={setForm}
          onSave={saveEntry}
          onClose={closeModal}
          allInvoices={allInvoices}
        />
      )}
    </div>
  );
}

function NewNoteModal({
  type,
  form,
  editing,
  onChange,
  onSave,
  onClose,
  allInvoices,
}: {
  type: NoteType;
  form: {
    noteNumber: string;
    date: string;
    amount: string;
    debtorSupplierName: string;
    linkToInvoice: string;
    reason: string;
  };
  editing: NoteEntry | null;
  onChange: (f: typeof form) => void;
  onSave: () => void;
  onClose: () => void;
  allInvoices: Array<{
    id: string;
    invoice_number: string;
    amount: number;
    _type: "sales" | "purchase";
    _label: string;
  }>;
}) {
  const [invSearch, setInvSearch] = useState("");
  const [invOpen, setInvOpen] = useState(false);
  const [selectedInv, setSelectedInv] = useState<{
    invoice_number: string;
    amount: number;
    _type: "sales" | "purchase";
  } | null>(() => {
    // Pre-populate from the editing entry's linkToInvoice
    if (editing?.linkToInvoice) {
      const found = allInvoices.find(
        (i) => i.invoice_number === editing.linkToInvoice,
      );
      if (found) {
        return {
          invoice_number: found.invoice_number,
          amount: found.amount,
          _type: found._type,
        };
      }
    }
    return null;
  });
  const invRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave();
  };

  const filteredInvoices = useMemo(() => {
    if (!invSearch.trim()) return [];
    const q = invSearch.toLowerCase();
    return allInvoices.filter(
      (i) =>
        i.invoice_number.toLowerCase().includes(q) ||
        i.amount?.toString().includes(q),
    ).slice(0, 20);
  }, [invSearch, allInvoices]);

  const selectInvoice = (inv: (typeof allInvoices)[number]) => {
    setSelectedInv(inv);
    onChange({ ...form, linkToInvoice: inv.invoice_number });
    setInvSearch("");
    setInvOpen(false);
  };

  const clearInvoice = () => {
    setSelectedInv(null);
    onChange({ ...form, linkToInvoice: "" });
    setInvSearch("");
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (invRef.current && !invRef.current.contains(e.target as Node)) {
        setInvOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {editing
              ? `Edit ${type === "credit" ? "credit" : "debit"} note`
              : `New ${type === "credit" ? "credit" : "debit"} note`}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field label="Note number *">
            <input
              required
              className="inp"
              placeholder="CN-001 / DN-001"
              value={form.noteNumber}
              onChange={(e) =>
                onChange({ ...form, noteNumber: e.target.value })
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                required
                type="date"
                className="inp"
                value={form.date}
                onChange={(e) => onChange({ ...form, date: e.target.value })}
              />
            </Field>
            <Field label="Amount (USD) *">
              <input
                required
                type="text"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]+)?"
                title="Enter a positive number (e.g. 123.45)"
                className="inp"
                value={form.amount}
                onChange={(e) =>
                  onChange({ ...form, amount: e.target.value })
                }
              />
            </Field>
          </div>

          <Field label="Debtor / Supplier name">
            <input
              className="inp"
              placeholder="Debtor or supplier company name"
              value={form.debtorSupplierName}
              onChange={(e) =>
                onChange({ ...form, debtorSupplierName: e.target.value })
              }
            />
          </Field>

          <Field label="Link to invoice">
            <div className="relative" ref={invRef}>
              {selectedInv ? (
                <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedInv._type === "sales" ? (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-warning" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono truncate">
                          {selectedInv.invoice_number}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {selectedInv._type === "sales"
                            ? "Sales"
                            : "Purchase"}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtMoney(selectedInv.amount)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearInvoice}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Clear invoice selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="inp"
                    placeholder="Search & select invoice…"
                    value={invSearch}
                    onChange={(e) => {
                      setInvSearch(e.target.value);
                      setInvOpen(true);
                    }}
                    onFocus={() => setInvOpen(true)}
                  />
                  {invOpen && invSearch.trim() && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                      {filteredInvoices.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">
                          No matching invoices found.
                        </div>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <button
                            key={`${inv._type}-${inv.id}`}
                            type="button"
                            onClick={() => selectInvoice(inv)}
                            className="flex w-full items-center justify-between px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {inv._type === "sales" ? (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : (
                                <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-warning" />
                              )}
                              <div className="min-w-0 text-left">
                                <span className="font-mono truncate block">
                                  {inv.invoice_number}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {inv._label}
                                </span>
                              </div>
                            </div>
                            <span className="num shrink-0 text-muted-foreground">
                              {fmtMoney(inv.amount)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </Field>

          <Field label="Reason">
            <textarea
              rows={3}
              className="inp resize-none"
              placeholder="Describe the reason for this adjustment…"
              value={form.reason}
              onChange={(e) =>
                onChange({ ...form, reason: e.target.value })
              }
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity"
            >
              <Save className="h-4 w-4" />
              Save note
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
