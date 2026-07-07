import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney } from "@/components/ledger-ui";
import {
  ArrowRightLeft, Loader2, CheckCircle2, Wallet, AlertTriangle,
  Building2, CalendarDays, DollarSign, CreditCard, SkipForward, History,
  ScrollText, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/bulk-payments")({
  component: BulkPaymentsPage,
});

// ── Types ──

interface DebtorInfo {
  id: string;
  name: string;
  industry?: string | null;
}

interface InvoiceInfo {
  id: string;
  invoice_number: string;
  amount: number;
  amount_received: number | null;
  issue_date: string;
  due_date: string | null;
  status: string;
  debtor?: { name: string } | null;
}

interface CreditNoteInfo {
  id: string;
  note_number: string;
  amount: number;
  date: string;
  status: string;
}

interface PaymentHistoryRecord {
  id: string;
  debtor_id: string;
  debtor_name: string;
  amount: number;
  payment_date: string;
  remaining: number;
  invoices_closed: number;
  credit_note_ids: string[];
  mode: "manual" | "fifo" | "two_pass_fifo";
  created_at: string;
}

interface PaymentResult {
  payment_id: string;
  amount: number;
  remaining: number;
  closed: Array<{ id: string; invoice_number: string; amount: number; late_payment_days: number }>;
  partially_paid: Array<{ id: string; invoice_number: string; amount_paid: number; remaining: number }>;
  skipped: Array<{ id: string; invoice_number: string; reason: string }>;
  settled_credits: string[];
  credit_errors: Array<{ id: string; error: string }>;
}

// ── Helpers ──

function isOverdue(dueDate: string | null, anchorDate: string): boolean {
  if (!dueDate) return false;
  return dueDate < anchorDate;
}

function daysLateCalc(dueDate: string | null, anchorDate: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.round((new Date(anchorDate).getTime() - new Date(dueDate).getTime()) / 86400000));
}

function fmtDateShort(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function outstanding(inv: InvoiceInfo): number {
  return inv.amount_received != null ? Math.max(0, inv.amount - inv.amount_received) : inv.amount;
}

// ── FIFO Preview (strict — no partials) ──
function computeFifoPreview(
  invoices: InvoiceInfo[],
  amount: number,
  isTwoPass: boolean,
  paymentDate: string,
): {
  closed: Array<{ inv: InvoiceInfo; amount: number; lateDays: number; isFuture: boolean }>;
  skipped: InvoiceInfo[];
  remaining: number;
} {
  let remaining = amount;
  const closed: Array<{ inv: InvoiceInfo; amount: number; lateDays: number; isFuture: boolean }> = [];
  const skipped: InvoiceInfo[] = [];

  const sorted = [...invoices].sort((a, b) =>
    (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
  );

  if (isTwoPass) {
    const overdue = sorted.filter((inv) => inv.due_date != null && inv.due_date <= paymentDate);
    const future = sorted.filter((inv) => inv.due_date == null || inv.due_date > paymentDate);

    // Pass 1: overdue
    for (const inv of overdue) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstanding(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate), isFuture: false });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }

    // Pass 2: future — closed_date = due_date, lateDays = 0
    for (const inv of future) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstanding(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: 0, isFuture: true });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }
  } else {
    // Standard FIFO (strict)
    for (const inv of sorted) {
      if (remaining <= 0) { skipped.push(inv); continue; }
      const bal = outstanding(inv);
      if (remaining >= bal) {
        closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate), isFuture: false });
        remaining -= bal;
      } else {
        skipped.push(inv);
      }
    }
  }

  return { closed, skipped, remaining };
}

// ── Manual Preview (process in due_date order, allow partials) ──
function computeManualPreview(
  invoices: InvoiceInfo[],
  selectedIds: Set<string>,
  amount: number,
  paymentDate: string,
): {
  closed: Array<{ inv: InvoiceInfo; amount: number; lateDays: number }>;
  partiallyPaid: Array<{ inv: InvoiceInfo; amountPaid: number; remainingBalance: number }>;
  untouched: InvoiceInfo[];
  remaining: number;
} {
  const sorted = [...invoices]
    .filter((inv) => selectedIds.has(inv.id))
    .sort((a, b) =>
      (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
    );

  let remaining = amount;
  const closed: Array<{ inv: InvoiceInfo; amount: number; lateDays: number }> = [];
  const partiallyPaid: Array<{ inv: InvoiceInfo; amountPaid: number; remainingBalance: number }> = [];

  for (const inv of sorted) {
    if (remaining <= 0) break;
    const bal = outstanding(inv);

    if (remaining >= bal) {
      closed.push({ inv, amount: bal, lateDays: daysLateCalc(inv.due_date, paymentDate) });
      remaining -= bal;
    } else {
      partiallyPaid.push({ inv, amountPaid: remaining, remainingBalance: bal - remaining });
      remaining = 0;
    }
  }

  const untouched = invoices.filter((inv) => !selectedIds.has(inv.id));

  return { closed, partiallyPaid, untouched, remaining };
}

// ── Page Component ──

function BulkPaymentsPage() {
  const { isAdmin, isTreasury, canWrite } = useAuth();
  const canEdit = isAdmin || isTreasury || canWrite("funding-queue");
  const qc = useQueryClient();

  // ── Core state ──
  const [selectedDebtorId, setSelectedDebtorId] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inputAmount, setInputAmount] = useState("");
  const [useBalance, setUseBalance] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [mode, setMode] = useState<"fifo" | "two_pass_fifo" | "manual">("fifo");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [debtorSearch, setDebtorSearch] = useState("");
  const [historyFilterDebtorId, setHistoryFilterDebtorId] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Payment history (lazy-loaded when card is opened) ──
  const historyQ = useQuery({
    queryKey: ["bulk-payment-history", historyFilterDebtorId],
    enabled: historyOpen,
    queryFn: async (): Promise<{ payments: PaymentHistoryRecord[]; totals: { total_payments: number; total_amount: number; total_remaining: number } }> => {
      const params = historyFilterDebtorId ? `?debtor_id=${historyFilterDebtorId}` : "";
      return (await api.get<any>(`/bulk-payments/history${params}`)) ?? { payments: [], totals: { total_payments: 0, total_amount: 0, total_remaining: 0 } };
    },
  });

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<DebtorInfo[]>("/debtors")) ?? [],
  });

  // ── Fetch previous remaining balance ──
  const balanceQ = useQuery({
    queryKey: ["bulk-payment-balance", selectedDebtorId],
    enabled: !!selectedDebtorId && useBalance,
    queryFn: async (): Promise<number> => {
      const res = await api.get<{ total_remaining: number }>(`/bulk-payments/balance/${selectedDebtorId}`);
      return res?.total_remaining ?? 0;
    },
  });
  const previousRemaining = balanceQ.data ?? 0;

  // ── Fetch invoices ──
  const invoicesQ = useQuery({
    queryKey: ["bulk-payment-invoices", selectedDebtorId],
    enabled: !!selectedDebtorId,
    queryFn: async (): Promise<InvoiceInfo[]> => {
      const all = await api.get<any[]>("/invoices") ?? [];
      return all
        .filter((i: any) => i.debtor_id === selectedDebtorId && i.status !== "paid" && i.status !== "rejected")
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          amount: Number(i.amount),
          amount_received: i.amount_received != null ? Number(i.amount_received) : null,
          issue_date: i.issue_date,
          due_date: i.due_date,
          status: i.status,
          debtor: i.debtor ? { name: i.debtor.name } : null,
        }));
    },
  });

  const openInvoices = invoicesQ.data ?? [];

  // ── Fetch credit notes ──
  const creditNotesQ = useQuery({
    queryKey: ["bulk-payment-credits", selectedDebtorId, debtorsQ.data],
    enabled: !!selectedDebtorId,
    queryFn: async (): Promise<{ total: number; notes: CreditNoteInfo[] }> => {
      const debtor = (debtorsQ.data ?? []).find((d) => d.id === selectedDebtorId);
      if (!debtor) return { total: 0, notes: [] };
      const allNotes = await api.get<any[]>("/credit-debit-notes") ?? [];
      const matching = allNotes
        .filter((n: any) =>
          n.type === "credit"
          && n.status === "approved"
          && n.debtor_supplier_name?.toLowerCase() === debtor.name.toLowerCase()
        )
        .map((n: any) => ({ id: n.id, note_number: n.note_number, amount: Number(n.amount), date: n.date, status: n.status }));
      return { total: matching.reduce((s: number, n: CreditNoteInfo) => s + n.amount, 0), notes: matching };
    },
  });

  const unappliedCredit = creditNotesQ.data?.total ?? 0;
  const creditNotes = creditNotesQ.data?.notes ?? [];

  // ── Derived calculations ──
  const numericAmount = Number(inputAmount) || 0;
  const balanceBoost = useBalance ? previousRemaining : 0;
  const creditBoost = applyCredit ? unappliedCredit : 0;
  const availableAmount = numericAmount + balanceBoost + creditBoost;

  // FIFO / Two-Pass FIFO preview
  const fifoPreview = useMemo(() => {
    if (mode === "manual" || availableAmount <= 0 || openInvoices.length === 0) return null;
    return computeFifoPreview(openInvoices, availableAmount, mode === "two_pass_fifo", paymentDate);
  }, [mode, availableAmount, openInvoices, paymentDate]);

  // Manual preview
  const manualPreview = useMemo(() => {
    if (mode !== "manual" || availableAmount <= 0 || selectedInvoiceIds.size === 0) return null;
    return computeManualPreview(openInvoices, selectedInvoiceIds, availableAmount, paymentDate);
  }, [mode, availableAmount, selectedInvoiceIds, openInvoices, paymentDate]);

  const selectedDebtor = (debtorsQ.data ?? []).find((d) => d.id === selectedDebtorId);

  // ── Handlers ──
  const handleDebtorChange = (id: string) => {
    setSelectedDebtorId(id);
    setSelectedInvoiceIds(new Set());
    setInputAmount("");
    setUseBalance(false);
    setApplyCredit(false);
    setResult(null);
  };

  const handleDateChange = (date: string) => {
    setPaymentDate(date);
    setSelectedInvoiceIds(new Set());
    setResult(null);
  };

  const toggleInvoice = (id: string) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Submit ──
  const submitPayment = useCallback(async () => {
    if (!selectedDebtorId || availableAmount <= 0) return;
    if (mode === "manual" && selectedInvoiceIds.size === 0) return;

    setSubmitting(true);
    setResult(null);

    try {
      const creditNoteIds = applyCredit ? creditNotes.map((n) => n.id) : [];

      const res = await api.post<PaymentResult>("/bulk-payments/process", {
        debtor_id: selectedDebtorId,
        payment_date: paymentDate,
        amount: numericAmount,
        use_balance: useBalance,
        mode,
        selected_invoice_ids: mode === "manual" ? [...selectedInvoiceIds] : [],
        settle_credit_note_ids: creditNoteIds,
      });

      setResult(res);

      if (res.closed.length > 0) {
        toast.success(`${res.closed.length} invoice${res.closed.length !== 1 ? "s" : ""} closed`);
      }
      if (res.partially_paid.length > 0) {
        toast.info(`${res.partially_paid.length} invoice${res.partially_paid.length !== 1 ? "s" : ""} partially paid`);
      }
      if (res.remaining > 0) {
        toast.info(`Remaining balance: ${fmtMoney(res.remaining)} — saved for future use`);
      }

      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-invoices"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-credits"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-history"] });
      qc.invalidateQueries({ queryKey: ["bulk-payment-balance"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }, [selectedDebtorId, availableAmount, numericAmount, mode, selectedInvoiceIds, applyCredit, creditNotes, paymentDate, useBalance, qc]);

  // ── Validation ──
  const canSubmit = !!selectedDebtorId
    && availableAmount > 0
    && (mode !== "manual" || selectedInvoiceIds.size > 0)
    && !submitting;

  // ── Filtered debtor list ──
  const filteredDebtors = useMemo(() => {
    const q = debtorSearch.toLowerCase().trim();
    if (!q) return debtorsQ.data ?? [];
    return (debtorsQ.data ?? []).filter(
      (d) => d.name.toLowerCase().includes(q) || d.industry?.toLowerCase().includes(q)
    );
  }, [debtorSearch, debtorsQ.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Treasury"
        title="Bulk payments"
        description="Process customer payments with optional FIFO auto-allocation (strict, no partials), Two-Pass FIFO (future invoice pre-closing), or manual selection with partial payment support."
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* ── Step 1: Customer Selection ── */}
        <Card title="1. Select customer" className={!selectedDebtorId ? "ring-1 ring-primary/30" : ""}>
          <div className="space-y-4">
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search customer..."
                value={debtorSearch}
                onChange={(e) => setDebtorSearch(e.target.value)}
                onFocus={() => setDebtorSearch("")}
                className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              />
              {debtorSearch && filteredDebtors.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                  {filteredDebtors.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { handleDebtorChange(d.id); setDebtorSearch(""); }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 ${
                        d.id === selectedDebtorId ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{d.name}</div>
                        {d.industry && <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{d.industry}</div>}
                      </div>
                      {d.id === selectedDebtorId && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
              {debtorSearch && filteredDebtors.length === 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground shadow-xl">
                  No customers match your search.
                </div>
              )}
            </div>

            {selectedDebtor && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-medium">{selectedDebtor.name}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {openInvoices.length} open invoice{openInvoices.length !== 1 ? "s" : ""}
                  {" · "}
                  {unappliedCredit > 0 ? `${fmtMoney(unappliedCredit)} in unapplied credit` : "No unapplied credit"}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ── Step 2: Payment Details ── */}
        {selectedDebtorId && (
          <Card title="2. Payment details">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" /> Payment amount
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?"
                    placeholder="0.00" value={inputAmount}
                    onChange={(e) => { setInputAmount(e.target.value); setResult(null); }}
                    className="h-11 w-full rounded-lg border border-border bg-background pl-8 pr-4 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" /> Payment date
                </label>
                <input
                  type="date" value={paymentDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" /> Available amount
                </label>
                <div className={`flex h-11 items-center rounded-lg border px-4 text-lg font-semibold font-mono transition-colors ${
                  availableAmount > 0
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-border bg-background/40 text-muted-foreground"
                }`}>
                  {fmtMoney(availableAmount)}
                </div>
              </div>

              <div className="flex flex-col justify-end">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Remaining after
                </label>
                <div className={`flex h-11 items-center rounded-lg border px-4 text-lg font-semibold font-mono transition-colors ${
                  result && result.remaining > 0
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
                    : "border-border bg-background/40 text-muted-foreground"
                }`}>
                  {result && result.remaining > 0 ? fmtMoney(result.remaining) : "—"}
                </div>
              </div>
            </div>

            {/* Balance & Credit */}

            {/* Previous remaining balance section */}
            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                  <History className="h-4 w-4" />
                  Previous unapplied balance
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-muted-foreground">{useBalance ? "Included" : "Use"}</span>
                  <input
                    type="checkbox" checked={useBalance}
                    onChange={(e) => { setUseBalance(e.target.checked); setResult(null); }}
                    className="h-5 w-5 rounded border-border accent-amber-500"
                  />
                </label>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {balanceQ.isLoading
                  ? "Checking previous balances…"
                  : previousRemaining > 0
                    ? `${fmtMoney(previousRemaining)} available from previous payments`
                    : "No unapplied balance from previous payments"}
              </p>
            </div>

            {/* Credit notes section */}
            {creditNotes.length > 0 && (
              <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    <CreditCard className="h-4 w-4" />
                    Unapplied past credit
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-muted-foreground">{applyCredit ? "Applied" : "Apply"}</span>
                    <input
                      type="checkbox" checked={applyCredit}
                      onChange={(e) => { setApplyCredit(e.target.checked); setResult(null); }}
                      className="h-5 w-5 rounded border-border accent-emerald-500"
                    />
                  </label>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {creditNotes.length} approved credit note{creditNotes.length !== 1 ? "s" : ""} totaling {fmtMoney(unappliedCredit)}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* ── Step 3: Mode Selection ── */}
        {selectedDebtorId && openInvoices.length > 0 && (
          <Card title="3. Payment mode">
            <div className="mb-4 flex flex-wrap gap-2">
              {([
                { key: "fifo" as const, label: "FIFO (strict)", desc: "No partials — skip if funds insufficient" },
                { key: "two_pass_fifo" as const, label: "Two-Pass FIFO", desc: "Overdue first, then future (pre-close)" },
                { key: "manual" as const, label: "Manual", desc: "Pick invoices, partials allowed" },
              ]).map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setMode(m.key); setSelectedInvoiceIds(new Set()); setResult(null); }}
                  className={`rounded-lg border px-4 py-2 text-left text-xs transition-all ${
                    mode === m.key
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                  }`}
                >
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="mt-0.5 opacity-70">{m.desc}</div>
                </button>
              ))}
            </div>

            {/* Mode-specific previews */}
            {mode !== "manual" && fifoPreview && (
              <div className="mb-4 space-y-2">
                <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">{fifoPreview.closed.length}</span> invoice{fifoPreview.closed.length !== 1 ? "s" : ""} will be closed{" "}
                  for <span className="font-semibold text-primary">{fmtMoney(fifoPreview.closed.reduce((s, c) => s + c.amount, 0))}</span>
                  {fifoPreview.skipped.length > 0 && (
                    <span className="ml-1">
                      · <span className="font-semibold text-warning">{fifoPreview.skipped.length}</span> skipped (insufficient funds)
                    </span>
                  )}
                  {fifoPreview.remaining > 0 && (
                    <span className="ml-1">
                      · Remaining: <span className="font-semibold text-warning">{fmtMoney(fifoPreview.remaining)}</span>
                    </span>
                  )}
                </div>
                {mode === "two_pass_fifo" && fifoPreview.closed.filter((c) => c.isFuture).length > 0 && (
                  <div className="rounded-md border border-purple-500/20 bg-purple-500/5 px-4 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-purple-500">{fifoPreview.closed.filter((c) => c.isFuture).length}</span> future invoice{fifoPreview.closed.filter((c) => c.isFuture).length !== 1 ? "s" : ""}{" "}
                    will be pre-closed with <span className="font-semibold text-purple-500">late_payment_days = 0</span> (closed_date = due_date)
                  </div>
                )}
              </div>
            )}

            {mode === "manual" && manualPreview && (
              <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{manualPreview.closed.length}</span> will close{" "}
                · <span className="font-semibold text-warning">{manualPreview.partiallyPaid.length}</span> partially paid
                · Remaining: <span className="font-semibold">{fmtMoney(manualPreview.remaining)}</span>
              </div>
            )}
          </Card>
        )}

        {/* ── Invoice Table ── */}
        {selectedDebtorId && openInvoices.length > 0 && (
          <Card title="Invoices">
            {invoicesQ.isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading invoices…
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      {mode === "manual" && <th className="px-4 py-2 text-left font-normal w-10"></th>}
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-left font-normal">Issue</th>
                      <th className="px-4 py-2 text-left font-normal">Due</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-right font-normal">Outstanding</th>
                      <th className="px-4 py-2 text-center font-normal">Age</th>
                      <th className="px-4 py-2 text-center font-normal">Status</th>
                      <th className="px-4 py-2 text-center font-normal">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((inv) => {
                      const overdue = isOverdue(inv.due_date, paymentDate);
                      const late = daysLateCalc(inv.due_date, paymentDate);
                      const isSelected = selectedInvoiceIds.has(inv.id);
                      const bal = outstanding(inv);

                      // Determine what happens to this invoice
                      let resultLabel = "";
                      let resultCls = "";

                      if (mode !== "manual" && fifoPreview) {
                        const isClosed = fifoPreview.closed.find((c) => c.inv.id === inv.id);
                        const isSkipped = fifoPreview.skipped.find((s) => s.id === inv.id);
                        if (isClosed) {
                          resultLabel = isClosed.isFuture ? "Pre-close" : fmtMoney(isClosed.amount);
                          resultCls = isClosed.isFuture ? "text-purple-500 bg-purple-500/15" : "text-success bg-success/15";
                        } else if (isSkipped) {
                          resultLabel = "Skip";
                          resultCls = "text-muted-foreground bg-muted/30";
                        }
                      }

                      if (mode === "manual" && manualPreview) {
                        const isClosed = manualPreview.closed.find((c) => c.inv.id === inv.id);
                        const isPartial = manualPreview.partiallyPaid.find((p) => p.inv.id === inv.id);
                        if (isClosed) {
                          resultLabel = fmtMoney(isClosed.amount);
                          resultCls = "text-success bg-success/15";
                        } else if (isPartial) {
                          resultLabel = `Partial ${fmtMoney(isPartial.amountPaid)}`;
                          resultCls = "text-warning bg-warning/15";
                        }
                      }

                      const isFutureInvoice = mode !== "manual" && inv.due_date != null && inv.due_date > paymentDate;

                      return (
                        <tr
                          key={inv.id}
                          className={`border-b border-border/60 transition-colors ${
                            resultLabel && resultCls.includes("success")
                              ? "bg-success/5 hover:bg-success/10"
                              : resultLabel && resultCls.includes("warning")
                              ? "bg-warning/5 hover:bg-warning/10"
                              : resultLabel === "Skip"
                              ? "opacity-50"
                              : overdue
                              ? "bg-destructive/5 hover:bg-destructive/10"
                              : isFutureInvoice
                              ? "bg-purple-500/5 hover:bg-purple-500/10"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          {mode === "manual" && (
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={isSelected} onChange={() => toggleInvoice(inv.id)}
                                className="h-4 w-4 rounded border-border accent-primary" />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs font-medium">{inv.invoice_number}</div>
                            {isFutureInvoice && <div className="text-[9px] text-purple-500 uppercase tracking-wider">Future</div>}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDateShort(inv.issue_date)}</td>
                          <td className={`px-4 py-3 text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {fmtDateShort(inv.due_date)}
                            {overdue && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(inv.amount)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-medium">{fmtMoney(bal)}</td>
                          <td className="px-4 py-3 text-center text-xs">
                            {late > 0 ? (
                              <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                                {late}d overdue
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                              inv.status === "overdue" ? "bg-destructive/15 text-destructive"
                              : inv.status === "approved" ? "bg-primary/15 text-primary"
                              : inv.status === "advanced" || inv.status === "funded" ? "bg-warning/15 text-warning"
                              : "bg-muted text-muted-foreground"
                            }`}>{inv.status}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {resultLabel ? (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${resultCls}`}>
                                {resultLabel.includes("Partial") || resultLabel === "Skip" ? (
                                  <SkipForward className="h-3 w-3" />
                                ) : resultLabel.includes("Pre-close") ? (
                                  <CalendarDays className="h-3 w-3" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3" />
                                )}
                                {resultLabel}
                              </span>
                            ) : mode === "manual" && isSelected ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">Awaiting</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
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
        )}

        {/* ── Submit Button ── */}
        {selectedDebtorId && openInvoices.length > 0 && (
          <div className="sticky bottom-6 z-10">
            <Card className="border-primary/20 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5 text-sm">
                  {mode !== "manual" && fifoPreview && fifoPreview.closed.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Closing</span>
                      <span className="font-semibold">{fifoPreview.closed.length}</span>
                      <span className="text-muted-foreground">for</span>
                      <span className="font-semibold text-primary">{fmtMoney(fifoPreview.closed.reduce((s, c) => s + c.amount, 0))}</span>
                      {fifoPreview.remaining > 0 && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">Remaining</span>
                          <span className="font-semibold text-warning">{fmtMoney(fifoPreview.remaining)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {mode === "manual" && (
                    <>
                      {selectedInvoiceIds.size === 0 && (
                        <div className="text-xs text-warning">Select at least one invoice to pay.</div>
                      )}
                      {manualPreview && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Closing</span>
                          <span className="font-semibold">{manualPreview.closed.length}</span>
                          {manualPreview.partiallyPaid.length > 0 && (
                            <>
                              <span className="text-muted-foreground">· Partial</span>
                              <span className="font-semibold text-warning">{manualPreview.partiallyPaid.length}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">· Remaining</span>
                          <span className="font-semibold text-success">{fmtMoney(manualPreview.remaining)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {!inputAmount && (
                    <div className="text-xs text-muted-foreground">Enter a payment amount to calculate allocations.</div>
                  )}
                </div>

                <button
                  disabled={!canSubmit}
                  onClick={submitPayment}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                  ) : (
                    <><ArrowRightLeft className="h-4 w-4" /> Process payment</>
                  )}
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* ── No invoices ── */}
        {selectedDebtorId && !invoicesQ.isLoading && openInvoices.length === 0 && (
          <Card>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="mb-3 h-10 w-10 text-success/60" />
              <h3 className="text-lg font-medium">All caught up</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedDebtor?.name ?? "This customer"} has no open invoices.
              </p>
            </div>
          </Card>
        )}

        {/* ── Empty state ── */}
        {!selectedDebtorId && (
          <Card>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowRightLeft className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <h3 className="text-lg font-medium">Select a customer to begin</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Choose a customer above, enter the payment amount, optionally apply past balance or credit,
                then choose FIFO (strict), Two-Pass FIFO (future pre-closing), or manual selection.
              </p>
            </div>
          </Card>
        )}

        {/* ── Results ── */}
        {result && (
          <Card title="Payment result">
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
                  <div className="text-2xl font-display text-success">{result.closed.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Closed</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.partially_paid.length > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.partially_paid.length > 0 ? "text-warning" : "text-muted-foreground"}`}>
                    {result.partially_paid.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Partially paid</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.remaining > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.remaining > 0 ? "text-amber-500" : "text-muted-foreground"}`}>
                    {fmtMoney(result.remaining)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Remaining balance</div>
                </div>
                <div className={`rounded-lg border p-4 text-center ${
                  result.skipped.length > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-background/40"
                }`}>
                  <div className={`text-2xl font-display ${result.skipped.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {result.skipped.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Skipped</div>
                </div>
              </div>

              {result.closed.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-success">Closed invoices:</p>
                  <div className="space-y-1">
                    {result.closed.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-mono">{c.invoice_number}</span>
                        <span>{fmtMoney(c.amount)} · {c.late_payment_days > 0 ? `${c.late_payment_days}d late` : "On time"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.partially_paid.length > 0 && (
                <div className="rounded-md border border-warning/20 bg-warning/5 p-3">
                  <p className="mb-2 text-xs font-medium text-warning">Partially paid:</p>
                  <div className="space-y-1">
                    {result.partially_paid.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-mono">{p.invoice_number}</span>
                        <span>Paid {fmtMoney(p.amount_paid)} · Remaining {fmtMoney(p.remaining)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => {
                  setResult(null);
                  setInputAmount("");
                  setSelectedInvoiceIds(new Set());
                  setApplyCredit(false);
                }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  New payment
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Payment History ── */}
        <Card
          title={
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-muted-foreground" />
                <span>Payment history</span>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          }
        >
          {historyOpen && (
            <div className="space-y-4">
              {/* Filter by customer */}
              <div className="flex items-center gap-3">
                <select
                  value={historyFilterDebtorId}
                  onChange={(e) => setHistoryFilterDebtorId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="">All customers</option>
                  {(debtorsQ.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <div className="text-xs text-muted-foreground">
                  {historyQ.data?.totals.total_payments ?? 0} payment{(historyQ.data?.totals.total_payments ?? 0) !== 1 ? "s" : ""}
                  {historyQ.data && historyQ.data.totals.total_remaining > 0 && (
                    <> · <span className="text-amber-500 font-medium">{fmtMoney(historyQ.data.totals.total_remaining)}</span> total carried forward</>
                  )}
                </div>
              </div>

              {historyQ.isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading history…
                </div>
              ) : (historyQ.data?.payments ?? []).length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No payment records yet.
                </div>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-5 py-2 text-left font-normal">Date</th>
                        <th className="px-5 py-2 text-left font-normal">Customer</th>
                        <th className="px-5 py-2 text-right font-normal">Amount</th>
                        <th className="px-5 py-2 text-right font-normal">Remaining</th>
                        <th className="px-5 py-2 text-center font-normal">Mode</th>
                        <th className="px-5 py-2 text-right font-normal">Closed</th>
                        <th className="px-5 py-2 text-right font-normal">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(historyQ.data?.payments ?? []).map((p) => (
                        <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-5 py-3 text-xs">{fmtDateShort(p.payment_date)}</td>
                          <td className="px-5 py-3">
                            <div className="text-xs font-medium">{p.debtor_name}</div>
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs">{fmtMoney(p.amount)}</td>
                          <td className={`px-5 py-3 text-right font-mono text-xs ${p.remaining > 0 ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
                            {p.remaining > 0 ? fmtMoney(p.remaining) : "—"}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                              p.mode === "manual" ? "bg-primary/15 text-primary"
                              : p.mode === "two_pass_fifo" ? "bg-purple-500/15 text-purple-500"
                              : "bg-warning/15 text-warning"
                            }`}>
                              {p.mode === "two_pass_fifo" ? "2-pass" : p.mode}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{p.invoices_closed}</td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{p.credit_note_ids.length || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {!historyOpen && (
            <div className="text-xs text-muted-foreground">
              {historyQ.data
                ? `${historyQ.data.totals.total_payments} records · ${fmtMoney(historyQ.data.totals.total_amount)} processed · ${historyQ.data.totals.total_remaining > 0 ? `${fmtMoney(historyQ.data.totals.total_remaining)} carried forward` : "No outstanding balances"}`
                : "Click to load payment history"}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
