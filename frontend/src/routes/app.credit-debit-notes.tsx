import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef, useEffect } from "react";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Plus, X, Save, Trash2, ScrollText, FileText, ShoppingCart, Pencil, Send, Check, Clock, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";


export const Route = createFileRoute("/app/credit-debit-notes")({
  component: CreditDebitNotesPage,
});

type NoteType = "credit" | "debit";
type NoteStatus = "pending" | "approved" | "rejected" | "received" | "paid";

interface NoteEntry {
  id: string;
  type: NoteType;
  note_number: string;
  date: string;
  amount: number;
  debtor_supplier_name: string | null;
  linked_invoice_id: string | null;
  linked_invoice_type: "sales" | "purchase" | null;
  reason: string | null;
  status: NoteStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  settled_at: string | null;
  settled_by: string | null;
  created_at: string;
  updated_at: string;
  linkedInvoice?: { invoice_number: string; amount: number; status: string } | null;
}

function CreditDebitNotesPage() {
  const { canWrite } = useAuth();
  const canCreate = canWrite("invoices");
  const qc = useQueryClient();
  const [tab, setTab] = useState<NoteType>("credit");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<NoteEntry | null>(null);

  const notesQ = useQuery({
    queryKey: ["credit-debit-notes"],
    queryFn: async () => (await api.get<NoteEntry[]>("/credit-debit-notes")) ?? [],
  });

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

  const createNote = useMutation({
    mutationFn: async (data: any) => {
      await api.post("/credit-debit-notes", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      toast.success("Note submitted for checker review");
      setOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/credit-debit-notes/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      toast.success("Note removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const notes = notesQ.data ?? [];
  const filteredEntries = useMemo(
    () => notes.filter((e) => e.type === tab),
    [notes, tab],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Credit & Debit Notes"
        title="Credit / Debit notes"
        description="Record credit and debit adjustments with full traceability. Notes go to checker for approval, then to funding queue for settlement."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button
                onClick={() => { setEditing(null); setOpen(true); }}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                New {tab === "credit" ? "credit" : "debit"} note
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
              >
                <Upload className="h-4 w-4" />
                Mass import
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only
            </span>
          )
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
                notes
                  .filter((e) => e.type === "credit")
                  .reduce((s, e) => s + Number(e.amount), 0),
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {notes.filter((e) => e.type === "credit").length} entries
            </div>
          </Card>
          <Card title="Debit notes total">
            <div className="num num-lg text-warning">
              {fmtMoney(
                notes
                  .filter((e) => e.type === "debit")
                  .reduce((s, e) => s + Number(e.amount), 0),
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {notes.filter((e) => e.type === "debit").length} entries
            </div>
          </Card>
        </div>

        {/* Entries table */}
        <Card>
          {notesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {tab === "credit" ? "credit" : "debit"} notes yet. Click
              "New {tab === "credit" ? "credit" : "debit"} note" to add one.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Note #</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-right font-normal">Amount (USD)</th>
                    <th className="px-5 py-2 text-left font-normal">Debtor / Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Link to invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Reason</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border/60 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={e.id}>#{e.id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-3 font-mono text-xs">{e.note_number}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(e.date)}</td>
                      <td className={`px-5 py-3 text-right num ${e.type === "credit" ? "text-success" : "text-warning"}`}>
                        {fmtMoney(e.amount)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{e.debtor_supplier_name || "—"}</td>
                      <td className="px-5 py-3">
                        {e.linkedInvoice ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span className="text-primary font-mono">{e.linkedInvoice.invoice_number}</span>
                            <span className={`text-[10px] ${e.linked_invoice_type === "sales" ? "text-primary" : "text-warning"}`}>
                              ({e.linked_invoice_type === "sales" ? "Sales" : "Purchase"})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="max-w-[160px] block truncate text-xs text-muted-foreground" title={e.reason || ""}>
                          {e.reason || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <NoteStatusPill status={e.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex gap-1">
                          {e.status === "pending" && canCreate && (
                            <>
                              <button
                                onClick={() => deleteNote.mutate(e.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                aria-label="Delete entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {e.status !== "pending" && (
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {e.status === "approved" ? "In queue" : e.status === "received" || e.status === "paid" ? "Settled" : ""}
                            </span>
                          )}
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

      {open && (
        <NewNoteModal
          type={tab}
          editing={editing}
          allInvoices={allInvoices}
          onSave={(data) => createNote.mutate(data)}
          onClose={() => { setOpen(false); setEditing(null); }}
        />
      )}

      {importOpen && (
        <MassImportNotesModal
          type={tab}
          allInvoices={allInvoices}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

function NoteStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "border-warning/50 text-warning" },
    approved: { label: "Approved", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    received: { label: "Received", cls: "border-primary/50 text-primary" },
    paid: { label: "Paid", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? { label: status, cls: "border-border text-muted-foreground" };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}

function NewNoteModal({
  type,
  editing,
  onSave,
  onClose,
  allInvoices,
}: {
  type: NoteType;
  editing: NoteEntry | null;
  onSave: (data: any) => void;
  onClose: () => void;
  allInvoices: Array<{
    id: string;
    invoice_number: string;
    amount: number;
    _type: "sales" | "purchase";
    _label: string;
  }>;
}) {
  const [noteNumber, setNoteNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [debtorSupplierName, setDebtorSupplierName] = useState("");
  const [reason, setReason] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [invOpen, setInvOpen] = useState(false);
  const [selectedInv, setSelectedInv] = useState<{
    id: string;
    invoice_number: string;
    amount: number;
    _type: "sales" | "purchase";
  } | null>(null);
  const invRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteNumber.trim()) { toast.error("Note number is required"); return; }
    if (!amount || Number(amount) <= 0) { toast.error("Amount must be greater than 0"); return; }

    onSave({
      type,
      note_number: noteNumber.trim(),
      date,
      amount: Number(amount),
      debtor_supplier_name: debtorSupplierName.trim() || null,
      linked_invoice_id: selectedInv?.id || null,
      linked_invoice_type: selectedInv?._type || null,
      reason: reason.trim() || null,
    });
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
    setInvSearch("");
    setInvOpen(false);
  };

  const clearInvoice = () => {
    setSelectedInv(null);
    setInvSearch("");
  };

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
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            New {type === "credit" ? "credit" : "debit"} note
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field label="Note number *">
            <input required className="inp" placeholder="CN-001 / DN-001" value={noteNumber} onChange={(e) => setNoteNumber(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input required type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Amount (USD) *">
              <input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>

          <Field label="Debtor / Supplier name">
            <input className="inp" placeholder="Debtor or supplier company name" value={debtorSupplierName} onChange={(e) => setDebtorSupplierName(e.target.value)} />
          </Field>

          <Field label="Link to invoice (adjusts invoice amount on settlement)">
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
                        <span className="text-xs font-mono truncate">{selectedInv.invoice_number}</span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {selectedInv._type === "sales" ? "Sales" : "Purchase"}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{fmtMoney(selectedInv.amount)}</div>
                    </div>
                  </div>
                  <button type="button" onClick={clearInvoice} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" aria-label="Clear invoice selection">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <input className="inp" placeholder="Search & select invoice…" value={invSearch} onChange={(e) => { setInvSearch(e.target.value); setInvOpen(true); }} onFocus={() => setInvOpen(true)} />
                  {invOpen && invSearch.trim() && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                      {filteredInvoices.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">No matching invoices found.</div>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <button key={`${inv._type}-${inv.id}`} type="button" onClick={() => selectInvoice(inv)}
                            className="flex w-full items-center justify-between px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {inv._type === "sales" ? (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : (
                                <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-warning" />
                              )}
                              <div className="min-w-0 text-left">
                                <span className="font-mono truncate block">{inv.invoice_number}</span>
                                <span className="text-[10px] text-muted-foreground">{inv._label}</span>
                              </div>
                            </div>
                            <span className="num shrink-0 text-muted-foreground">{fmtMoney(inv.amount)}</span>
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
            <textarea rows={3} className="inp resize-none" placeholder="Describe the reason for this adjustment…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>

          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
            <div className="flex items-center gap-2">
              <Send className="h-3.5 w-3.5" />
              <span>This note will be submitted to the <strong>checker</strong> for approval, then routed to the <strong>funding queue</strong> for settlement.</span>
            </div>
            {selectedInv && (
              <div className="mt-2 text-muted-foreground">
                {type === "credit"
                  ? `When received, $${fmtMoney(Number(amount || 0))} will be deducted from invoice ${selectedInv.invoice_number}.`
                  : `When paid, $${fmtMoney(Number(amount || 0))} will be added to invoice ${selectedInv.invoice_number}.`
                }
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Cancel</button>
            <button type="submit" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity">
              <Save className="h-4 w-4" />
              Submit for review
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ── Mass Import Modal ──

interface ImportRow {
  note_number: string;
  amount: number;
  date: string;
  debtor_supplier_name: string;
  invoice_number: string;
}

function MassImportNotesModal({
  type,
  allInvoices,
  onClose,
}: {
  type: NoteType;
  allInvoices: Array<{
    id: string;
    invoice_number: string;
    amount: number;
    _type: "sales" | "purchase";
  }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invoiceLookup = useMemo(() => {
    const m = new Map<string, { id: string; _type: "sales" | "purchase" }>();
    for (const inv of allInvoices) {
      m.set(inv.invoice_number.toLowerCase(), { id: inv.id, _type: inv._type });
    }
    return m;
  }, [allInvoices]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

        const parsed: ImportRow[] = json.map((row: any) => {
          const noteNum = row.note_number ?? row["Note Number"] ?? row["Note#"] ?? "";
          const amt = Number(row.amount ?? row["Amount"] ?? row.Amount ?? 0);
          const dt = row.date ?? row["Date"] ?? row.Date ?? "";
          const debtorSupplier = row.debtor_supplier_name ?? row.supplier ?? row.debtor ?? row["Debtor/Supplier"] ?? "";
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row["Invoice#"] ?? "";

          // Normalize date if serial number
          let dateStr = "";
          if (typeof dt === "number" && !isNaN(dt)) {
            const d = new Date((dt - 25569) * 86400 * 1000);
            if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
          } else if (typeof dt === "string") {
            const cleaned = dt.trim();
            if (cleaned) {
              const d = new Date(cleaned);
              if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
              else if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) dateStr = cleaned;
            }
          }

          return {
            note_number: String(noteNum).trim(),
            amount: isNaN(amt) ? 0 : amt,
            date: dateStr,
            debtor_supplier_name: String(debtorSupplier).trim(),
            invoice_number: String(invNum).trim(),
          };
        }).filter((r) => r.note_number && r.amount > 0 && r.date);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: note_number, amount, date");
          if (fileRef.current) fileRef.current.value = "";
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Could not parse the file. Please check the format.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      return await api.post<{ created: number; errors: Array<{ row: number; error: string }> }>("/credit-debit-notes/batch", {
        type,
        notes: rows.map((r) => ({
          note_number: r.note_number,
          amount: r.amount,
          date: r.date,
          debtor_supplier_name: r.debtor_supplier_name || null,
          linked_invoice_number: r.invoice_number || null,
          reason: null,
        })),
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      const errList = (data.errors ?? []).map((e) => `Row ${e.row}: ${e.error}`);
      setResult({ created: data.created, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created} ${type} notes created successfully`);
      } else {
        toast.success(`${data.created} created, ${errList.length} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const notesWithInvoiceStatus = useMemo(() =>
    rows.map((r) => ({
      ...r,
      invoice_found: r.invoice_number ? invoiceLookup.has(r.invoice_number.toLowerCase()) : null,
    })),
    [rows, invoiceLookup],
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "form" ? `Mass import ${type} notes` : step === "preview" ? "Preview imported notes" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet (.xlsx, .xls, .csv) with columns:{' '}
              <code className="font-mono text-primary">note_number</code>,{' '}
              <code className="font-mono text-primary">amount</code>,{' '}
              <code className="font-mono text-primary">date</code>.
              Optional columns:{' '}
              <code className="font-mono text-muted-foreground">debtor_supplier_name</code>,{' '}
              <code className="font-mono text-muted-foreground">invoice_number</code>.
              Each row becomes a {type} note. All notes will be created as <strong>pending</strong> and go to the checker for approval.
            </div>

            <div className="border-t border-border pt-4">
              <Field label={`Upload Excel / CSV file *`}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                  onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                />
              </Field>
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
                Found <strong className="text-foreground">{rows.length}</strong> {type} notes
                · Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Note #</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Debtor / Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {notesWithInvoiceStatus.map((r, idx) => (
                    <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-5 py-3 font-mono text-xs">{r.note_number}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.date)}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{r.debtor_supplier_name || "—"}</td>
                      <td className="px-5 py-3 text-xs">
                        {r.invoice_number ? (
                          <span className={`font-mono ${r.invoice_found ? "text-primary" : "text-destructive"}`}>
                            {r.invoice_number}
                            {r.invoice_found === false && <span className="ml-1 text-[10px]">(not found)</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
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
                Import {rows.length} {type} note{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.created}</div>
              <div className="text-xs text-muted-foreground mt-1">{type === "credit" ? "Credit" : "Debit"} notes created successfully</div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
