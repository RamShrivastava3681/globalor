import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, Fragment } from "react";
import { api } from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { BalanceSheetEditor } from "@/components/balance-sheet-editor";
import { BookOpen, Plus, X, Loader2, Trash2, Pencil, AlertTriangle, Calculator, ScrollText, Check, Ban, Scale, LineChart } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/accounting")({
  component: AccountingPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "chart-of-accounts",
  }),
});

const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
] as const;

const SUB_TYPES: { value: string; label: string; type: string }[] = [
  { value: "fixed_asset", label: "Fixed Asset", type: "asset" },
  { value: "bank", label: "Bank", type: "asset" },
  { value: "cash", label: "Cash", type: "asset" },
  { value: "petty_cash", label: "Petty Cash", type: "asset" },
  { value: "current_asset", label: "Current Asset", type: "asset" },
  { value: "current_liability", label: "Current Liability", type: "liability" },
  { value: "share_capital", label: "Share Capital", type: "equity" },
  { value: "retained_earnings", label: "Retained Earnings", type: "equity" },
  { value: "other", label: "Other", type: "" },
];

const TYPE_COLORS: Record<string, string> = {
  asset: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800",
  liability: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800",
  equity: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800",
  revenue: "text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-950 dark:border-violet-800",
  expense: "text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950 dark:border-rose-800",
};

function AccountingPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        eyebrow="Accounting"
        title="General ledger"
        description="Manage your chart of accounts and record manual journal entries."
      />

      {/* Tabs */}
      <div className="border-b border-border bg-card px-4 md:px-6">
        <div className="flex gap-0">
          <button
            onClick={() => navigate({ to: "/app/accounting", search: { tab: "chart-of-accounts" } })}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              tab === "chart-of-accounts"
                ? "border-[#00B8FF] text-[#00B8FF]"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Chart of Accounts
          </button>
          <button
            onClick={() => navigate({ to: "/app/accounting", search: { tab: "manual-journal" } })}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              tab === "manual-journal"
                ? "border-[#00B8FF] text-[#00B8FF]"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <ScrollText className="h-4 w-4" />
            Manual Journal
          </button>
          <button
            onClick={() => navigate({ to: "/app/accounting", search: { tab: "trial-balance" } })}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              tab === "trial-balance"
                ? "border-[#00B8FF] text-[#00B8FF]"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Scale className="h-4 w-4" />
            Trial Balance
          </button>
          <button
            onClick={() => navigate({ to: "/app/accounting", search: { tab: "balance-sheet" } })}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              tab === "balance-sheet"
                ? "border-[#00B8FF] text-[#00B8FF]"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <LineChart className="h-4 w-4" />
            Balance Sheet
          </button>
        </div>
      </div>

      <div className="p-6 md:p-10">
        {tab === "chart-of-accounts" && <ChartOfAccounts />}
        {tab === "manual-journal" && <ManualJournal />}
        {tab === "trial-balance" && <TrialBalance />}
        {tab === "balance-sheet" && <BalanceSheetTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CHART OF ACCOUNTS TAB
// ═══════════════════════════════════════════════════════════════

function ChartOfAccounts() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const accountsQ = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: async () => (await api.get<any[]>("/accounts")) ?? [],
  });

  return (
    <Card
      title="Chart of Accounts"
      action={
        <button
          onClick={() => { setEditing(null); setOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all"
        >
          <Plus className="h-3.5 w-3.5" /> Add account
        </button>
      }
    >
      {accountsQ.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (accountsQ.data ?? []).length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>No accounts yet. Add your first account to get started.</p>
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left font-normal">Code</th>
                <th className="px-6 py-3 text-left font-normal">Name</th>
                <th className="px-6 py-3 text-left font-normal">Type</th>
                <th className="px-6 py-3 text-left font-normal">Description</th>
                <th className="px-6 py-3 text-center font-normal">Status</th>
                <th className="px-6 py-3 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(accountsQ.data ?? []).map((acc: any) => {
                const typeStyle = TYPE_COLORS[acc.type] || "text-gray-600 bg-gray-50 border-gray-200";
                return (
                  <tr key={acc.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{acc.code}</td>
                    <td className="px-6 py-3 font-medium">{acc.name}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${typeStyle}`}>
                        {acc.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground max-w-[200px] truncate">{acc.description || "—"}</td>
                    <td className="px-6 py-3 text-center">
                      {acc.is_active !== false ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                          <Ban className="h-3 w-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => { setEditing(acc); setOpen(true); }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary transition-all"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <AccountFormModal
          editing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onDone={() => qc.invalidateQueries({ queryKey: ["chart-of-accounts"] })}
        />
      )}
    </Card>
  );
}

function AccountFormModal({ editing, onClose, onDone }: { editing: any | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState(() => ({
    code: editing?.code ?? "",
    name: editing?.name ?? "",
    type: editing?.type ?? "asset",
    sub_type: editing?.sub_type ?? "",
    description: editing?.description ?? "",
  }));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // Filter available sub_types based on selected type
  const availableSubTypes = SUB_TYPES.filter((st) => st.type === "" || st.type === form.type);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim()) throw new Error("Account code is required");
      if (!form.name.trim()) throw new Error("Account name is required");

      const payload: Record<string, unknown> = { ...form };
      if (!payload.sub_type) delete payload.sub_type;

      if (editing) {
        await api.patch(`/accounts/${editing.id}`, payload);
      } else {
        await api.post("/accounts", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Account updated" : "Account created");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">{editing ? "Edit account" : "Add account"}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <L label="Account code *">
              <input required className="inp" value={form.code} onChange={set("code")} placeholder="e.g. 1000" maxLength={20} />
            </L>
            <L label="Account type *">
              <select className="inp" value={form.type} onChange={set("type")}>
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </L>
          </div>
          <L label="Account name *">
            <input required className="inp" value={form.name} onChange={set("name")} placeholder="e.g. Cash at Bank" maxLength={200} />
          </L>
          <L label="Financial statement classification">
            <select className="inp" value={form.sub_type} onChange={set("sub_type")}>
              <option value="">Auto (based on type)</option>
              {availableSubTypes.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
            </select>
          </L>
          <L label="Description">
            <input className="inp" value={form.description} onChange={set("description")} placeholder="Optional description" maxLength={500} />
          </L>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create account"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MANUAL JOURNAL TAB
// ═══════════════════════════════════════════════════════════════

function ManualJournal() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  const entriesQ = useQuery({
    queryKey: ["journal-entries"],
    queryFn: async () => (await api.get<any[]>("/journal-entries")) ?? [],
  });

  const accountsQ = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: async () => (await api.get<any[]>("/accounts")) ?? [],
  });

  const accountMap = Object.fromEntries(
    (accountsQ.data ?? []).map((a: any) => [a.id, a])
  );

  return (
    <>
      <Card
        title="Manual Journal Entries"
        action={
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> New entry
          </button>
        }
      >
        {entriesQ.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (entriesQ.data ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <ScrollText className="mx-auto mb-3 h-8 w-8 opacity-30" />
            <p>No journal entries yet. Create your first manual journal entry.</p>
          </div>
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-left font-normal">Date</th>
                  <th className="px-6 py-3 text-left font-normal">Reference</th>
                  <th className="px-6 py-3 text-left font-normal">Description</th>
                  <th className="px-6 py-3 text-right font-normal">Debits</th>
                  <th className="px-6 py-3 text-right font-normal">Credits</th>
                  <th className="px-6 py-3 text-center font-normal">Status</th>
                  <th className="px-6 py-3 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(entriesQ.data ?? []).map((entry: any) => (
                  <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-3">{fmtDate(entry.entry_date)}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{entry.reference || "—"}</td>
                    <td className="px-6 py-3 max-w-[250px] truncate">{entry.description || "—"}</td>
                    <td className="px-6 py-3 text-right num font-medium">{fmtMoney(entry.total_debits)}</td>
                    <td className="px-6 py-3 text-right num font-medium">{fmtMoney(entry.total_credits)}</td>
                    <td className="px-6 py-3 text-center">
                      {entry.status === "posted" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                          Posted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => setViewing(entry)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary transition-all"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <JournalEntryFormModal
          onClose={() => setOpen(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ["journal-entries"] })}
        />
      )}

      {viewing && (
        <JournalEntryDetailModal
          entry={viewing}
          accountMap={accountMap}
          onClose={() => setViewing(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ["journal-entries"] })}
        />
      )}
    </>
  );
}

function JournalEntryFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([
    { account_id: "", description: "", debit_amount: "", credit_amount: "" },
    { account_id: "", description: "", debit_amount: "", credit_amount: "" },
  ]);

  const accountsQ = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: async () => (await api.get<any[]>("/accounts")) ?? [],
  });

  const activeAccounts = (accountsQ.data ?? []).filter((a: any) => a.is_active !== false);

  const addLine = () => {
    setLines([...lines, { account_id: "", description: "", debit_amount: "", credit_amount: "" }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: string, value: string) => {
    const newLines = lines.map((line, i) => {
      if (i !== idx) return line;
      // Clear the other amount field when one is set
      if (field === "debit_amount" && value) {
        return { ...line, debit_amount: value, credit_amount: "" };
      }
      if (field === "credit_amount" && value) {
        return { ...line, credit_amount: value, debit_amount: "" };
      }
      return { ...line, [field]: value };
    });
    setLines(newLines);
  };

  const totalDebits = lines.reduce((s, l) => s + (Number(l.debit_amount) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (Number(l.credit_amount) || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.001;

  const save = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("Entry date is required");

      const validLines = lines.filter((l) => l.account_id);
      if (validLines.length < 2) throw new Error("At least two account lines are required");
      if (!isBalanced) throw new Error(`Debits (${totalDebits.toFixed(2)}) must equal credits (${totalCredits.toFixed(2)})`);

      return await api.post("/journal-entries", {
        entry_date: date,
        reference: reference || "",
        description: description || "",
        lines: validLines.map((l) => ({
          account_id: l.account_id,
          description: l.description,
          debit_amount: Number(l.debit_amount) || 0,
          credit_amount: Number(l.credit_amount) || 0,
        })),
      });
    },
    onSuccess: () => {
      toast.success("Journal entry posted");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create entry"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">New Journal Entry</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          {/* Header fields */}
          <div className="grid gap-4 sm:grid-cols-3">
            <L label="Date *">
              <input type="date" required className="inp" value={date} onChange={(e) => setDate(e.target.value)} />
            </L>
            <L label="Reference">
              <input className="inp" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. JE-001" maxLength={100} />
            </L>
            <L label="Description">
              <input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" maxLength={500} />
            </L>
          </div>

          {/* Journal lines */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-widest text-primary">Journal lines</h4>
              <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-normal w-[30%]">Account</th>
                    <th className="px-3 py-2 text-left font-normal w-[30%]">Description</th>
                    <th className="px-3 py-2 text-right font-normal">Debit</th>
                    <th className="px-3 py-2 text-right font-normal">Credit</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx} className="border-t border-border/50">
                      <td className="px-3 py-1.5">
                        <select
                          className="inp text-xs"
                          value={line.account_id}
                          onChange={(e) => updateLine(idx, "account_id", e.target.value)}
                        >
                          <option value="">Select account</option>
                          {activeAccounts.map((a: any) => (
                            <option key={a.id} value={a.id}>
                              [{a.code}] {a.name} ({a.type})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          className="inp text-xs"
                          value={line.description}
                          onChange={(e) => updateLine(idx, "description", e.target.value)}
                          placeholder="Line description"
                          maxLength={200}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="inp text-xs text-right num"
                          value={line.debit_amount}
                          onChange={(e) => updateLine(idx, "debit_amount", e.target.value)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="inp text-xs text-right num"
                          value={line.credit_amount}
                          onChange={(e) => updateLine(idx, "credit_amount", e.target.value)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {lines.length > 2 && (
                          <button type="button" onClick={() => removeLine(idx)} className="text-muted-foreground hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals row */}
            <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2">
              <div className="flex items-center gap-2 text-xs">
                {isBalanced ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Balanced
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-rose-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> Out of balance by {fmtMoney(Math.abs(totalDebits - totalCredits))}
                  </span>
                )}
              </div>
              <div className="flex gap-6 text-xs">
                <span className="text-muted-foreground">Debits: <strong className="num text-foreground">{fmtMoney(totalDebits)}</strong></span>
                <span className="text-muted-foreground">Credits: <strong className="num text-foreground">{fmtMoney(totalCredits)}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <button
              disabled={save.isPending || !isBalanced}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Check className="h-4 w-4" />
              Post entry
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function JournalEntryDetailModal({ entry, accountMap, onClose, onDone }: { entry: any; accountMap: Record<string, any>; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/journal-entries/${entry.id}`);
    },
    onSuccess: () => {
      toast.success("Journal entry deleted");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">Journal Entry</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 p-5">
          {/* Header info */}
          <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</div>
              <div className="mt-0.5 font-medium">{fmtDate(entry.entry_date)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Reference</div>
              <div className="mt-0.5 font-medium">{entry.reference || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</div>
              <div className="mt-0.5">
                {entry.status === "posted" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                    Posted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
                    Draft
                  </span>
                )}
              </div>
            </div>
            {entry.description && (
              <div className="col-span-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Description</div>
                <div className="mt-0.5">{entry.description}</div>
              </div>
            )}
          </div>

          {/* Journal lines */}
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-normal">Account</th>
                  <th className="px-4 py-2 text-left font-normal">Description</th>
                  <th className="px-4 py-2 text-right font-normal">Debit</th>
                  <th className="px-4 py-2 text-right font-normal">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(entry.lines || []).map((line: any) => {
                  const account = accountMap[line.account_id];
                  return (
                    <tr key={line.id} className="border-t border-border/50">
                      <td className="px-4 py-2.5 font-medium">
                        {account ? (
                          <span>
                            <span className="font-mono text-[10px] text-muted-foreground">{account.code}</span>
                            <span className="ml-1.5">{account.name}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unknown account</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{line.description || "—"}</td>
                      <td className="px-4 py-2.5 text-right num">
                        {line.debit_amount > 0 ? fmtMoney(line.debit_amount) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right num">
                        {line.credit_amount > 0 ? fmtMoney(line.credit_amount) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border bg-muted/20">
                <tr>
                  <td colSpan={2} className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-muted-foreground">Totals</td>
                  <td className="px-4 py-2 text-right num font-semibold">{fmtMoney(entry.total_debits)}</td>
                  <td className="px-4 py-2 text-right num font-semibold">{fmtMoney(entry.total_credits)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-all"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete entry
            </button>
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-destructive mb-3">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="font-display">Delete journal entry?</h4>
            </div>
            <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-60"
              >
                {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TRIAL BALANCE TAB
// ═══════════════════════════════════════════════════════════════

function TrialBalance() {
  const trialQ = useQuery({
    queryKey: ["trial-balance"],
    queryFn: async () => (await api.get<any>("/accounts/trial-balance")) ?? { rows: [], totals: { total_debits: 0, total_credits: 0 }, balanced: true },
  });

  const [showZeroBalance, setShowZeroBalance] = useState(false);

  const data = trialQ.data;
  const rows = showZeroBalance
    ? [...(data?.rows ?? []), ...(data?.zero_balance_accounts ?? [])]
    : (data?.rows ?? []);

  // Sort rows: group by account type, then by code within each type
  const typeOrder = ["asset", "liability", "equity", "revenue", "expense"];
  const sortedRows = [...rows].sort((a: any, b: any) => {
    const aTypeIdx = typeOrder.indexOf(a.account_type);
    const bTypeIdx = typeOrder.indexOf(b.account_type);
    if (aTypeIdx !== bTypeIdx) return aTypeIdx - bTypeIdx;
    return (a.account_code ?? "").localeCompare(b.account_code ?? "");
  });

  // Group by type
  const groupedRows: Record<string, any[]> = {};
  for (const row of sortedRows) {
    const type = row.account_type || "other";
    if (!groupedRows[type]) groupedRows[type] = [];
    groupedRows[type].push(row);
  }

  const isLoading = trialQ.isLoading;

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <span>Trial Balance</span>
          {data && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                data.balanced
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-400"
              }`}
            >
              {data.balanced ? (
                <><Check className="h-3 w-3" /> Balanced</>
              ) : (
                <><AlertTriangle className="h-3 w-3" /> Out of balance by {fmtMoney(Math.abs(data.totals.total_debits - data.totals.total_credits))}</>
              )}
            </span>
          )}
        </div>
      }
      action={
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          <input
            type="checkbox"
            checked={showZeroBalance}
            onChange={(e) => setShowZeroBalance(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          Show zero-balance accounts
        </label>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Scale className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>No journal entries yet. Post entries to see the trial balance.</p>
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left font-normal">Code</th>
                <th className="px-6 py-3 text-left font-normal">Account</th>
                <th className="px-6 py-3 text-left font-normal">Type</th>
                <th className="px-6 py-3 text-right font-normal">Debit</th>
                <th className="px-6 py-3 text-right font-normal">Credit</th>
              </tr>
            </thead>
            <tbody>
              {typeOrder.map((type) => {
                const typeRows = groupedRows[type];
                if (!typeRows || typeRows.length === 0) return null;
                const typeStyle = TYPE_COLORS[type] || "";
                const typeLabel = ACCOUNT_TYPES.find((t) => t.value === type)?.label || type;

                return (
                  <Fragment key={type}>
                    {/* Type group header */}
                    <tr className="border-b border-border/30 bg-muted/20">
                      <td colSpan={5} className="px-6 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeStyle}`}>
                          {typeLabel}
                        </span>
                      </td>
                    </tr>
                    {/* Type rows */}
                    {typeRows.map((row: any) => (
                      <tr key={row.account_id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-2.5 font-mono text-xs text-muted-foreground">{row.account_code}</td>
                        <td className="px-6 py-2.5 font-medium">{row.account_name}</td>
                        <td className="px-6 py-2.5">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${typeStyle}`}>
                            {type}
                          </span>
                        </td>
                        <td className="px-6 py-2.5 text-right num">
                          {row.debit_balance > 0 ? (
                            <span className="font-medium">{fmtMoney(row.debit_balance)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-6 py-2.5 text-right num">
                          {row.credit_balance > 0 ? (
                            <span className="font-medium">{fmtMoney(row.credit_balance)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            {/* Grand totals */}
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/10">
                <td colSpan={3} className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-widest text-foreground">
                  Grand Total
                </td>
                <td className="px-6 py-3 text-right num font-bold text-foreground">
                  {fmtMoney(data?.totals?.total_debits ?? 0)}
                </td>
                <td className="px-6 py-3 text-right num font-bold text-foreground">
                  {fmtMoney(data?.totals?.total_credits ?? 0)}
                </td>
              </tr>
              {/* Balance indicator */}
              {data && (
                <tr className="border-t border-border bg-muted/5">
                  <td colSpan={5} className="px-6 py-2">
                    <div className={`flex items-center justify-center gap-2 text-xs ${
                      data.balanced ? "text-emerald-600" : "text-rose-600"
                    }`}>
                      {data.balanced ? (
                        <>
                          <Check className="h-4 w-4" />
                          <span className="font-medium">The trial balance is in balance.</span>
                          <span className="text-muted-foreground">
                            Total debits ({fmtMoney(data.totals.total_debits)}) = Total credits ({fmtMoney(data.totals.total_credits)})
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4" />
                          <span className="font-medium">The trial balance is out of balance!</span>
                          <span className="text-muted-foreground">
                            Difference: {fmtMoney(Math.abs(data.totals.total_debits - data.totals.total_credits))}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BALANCE SHEET TAB
// ═══════════════════════════════════════════════════════════════

function BalanceSheetTab() {
  return (
    <div>
      <div className="mb-6">
        <h3 className="font-display text-base font-semibold text-card-foreground">Interactive Balance Sheet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          View auto-computed balances from your transactions alongside manual adjustments. 
          Toggle <strong>Opening Balances</strong> mode to carry forward prior-period closing balances.
        </p>
      </div>
      <BalanceSheetEditor />
    </div>
  );
}

// ── Shared helpers ──

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
