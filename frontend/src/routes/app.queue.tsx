import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, useRef, useMemo } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Banknote, CheckCircle2, Lock, ArrowDownToLine, ArrowUpFromLine, ArrowUpDown, ScrollText, Upload, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/queue")({
  component: QueuePage,
});

function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function diffDaysUTC(from?: string | null, to?: string | null): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

type Row = {
  kind: "sale" | "purchase" | "proforma" | "cd_credit" | "cd_debit";
  id: string;
  invoice_number: string;
  amount: number;
  po_number: string | null;
  advance: number;
  balance: number;
  due_date: string | null;
  issue_date: string | null;
  status: string;
  party: string;
  client?: string;
  side?: "sales" | "purchase";
  proforma_number?: string | null;
  currency?: string;
};

function QueuePage() {
  const { isAdmin, isTreasury: isTreasuryRole, canWrite } = useAuth();
  const canAct = canWrite("funding-queue");
  const isTreasury = canAct;
  const qc = useQueryClient();
  const [side, setSide] = useState<"all" | "sale" | "purchase" | "proforma" | "credit_note" | "debit_note">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"issue" | "due">("due");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const salesQ = useQuery({
    queryKey: ["queue-sales"],
    queryFn: async () => {
      const data = await api.get<any[]>("/invoices") ?? [];
      return data.filter((i: any) => ["approved", "funded", "advanced", "overdue"].includes(i.status));
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["queue-purchases"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-invoices") ?? [];
      return data.filter((p: any) => ["approved", "funded", "advanced", "overdue"].includes(p.status));
    },
  });

  const proformasQ = useQuery({
    queryKey: ["queue-proformas"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-orders") ?? [];
      return data.filter((p: any) => p.proforma_status === "approved");
    },
  });

  const creditDebitNotesQ = useQuery({
    queryKey: ["queue-credit-debit-notes"],
    queryFn: async () => {
      const data = await api.get<any[]>("/credit-debit-notes") ?? [];
      return data.filter((n: any) => n.status === "approved");
    },
  });

  // Live advance lookup by PO number
  const salePos = Array.from(new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)));
  const purPos = Array.from(new Set(((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean)));

  const advLookupQ = useQuery({
    queryKey: ["queue-advances", salePos, purPos],
    enabled: salePos.length > 0 || purPos.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {};
      const allAdvances = await api.get<any[]>("/advances") ?? [];

      for (const po of salePos) {
        const orders = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(po)}`);
        const salesOrders = (orders.proformas ?? []).filter((o: any) => o.side === "sales");
        const pfIds = salesOrders.map((o: any) => o.id);
        const advs = allAdvances.filter((a: any) => pfIds.includes(a.purchase_order_id) && a.status !== "refunded");
        map[`sales::${po}`] = advs.reduce((s: number, a: any) => s + Number(a.amount), 0);
      }
      for (const po of purPos) {
        const orders = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(po)}`);
        const purOrders = (orders.proformas ?? []).filter((o: any) => o.side === "purchase");
        const pfIds = purOrders.map((o: any) => o.id);
        const advs = allAdvances.filter((a: any) => pfIds.includes(a.purchase_order_id) && a.status !== "refunded");
        map[`purchase::${po}`] = advs.reduce((s: number, a: any) => s + Number(a.amount), 0);
      }
      return map;
    },
  });
  const advMap = advLookupQ.data ?? {};
  const advFor = (s: "sales" | "purchase", po?: string | null) =>
    po ? Number(advMap[`${s}::${po.trim()}`] ?? 0) : 0;

  const closeSale = useMutation({
    mutationFn: async ({ id, amount_received, receipt_date, amount, due_date }: { id: string; amount_received: number; receipt_date: string; amount: number; due_date: string | null }) => {
      const short_payment = Math.max(0, +(amount - amount_received).toFixed(2));
      const late_days = diffDaysUTC(due_date, receipt_date);
      await api.patch(`/invoices/${id}`, {
        status: "paid",
        paid_date: receipt_date,
        amount_received,
        receipt_date,
        short_payment,
        late_days,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const ld = diffDaysUTC(vars.due_date, vars.receipt_date);
      const sp = Math.max(0, +(vars.amount - vars.amount_received).toFixed(2));
      toast.success(`Invoice closed · ${ld} late day${ld === 1 ? "" : "s"}${sp > 0 ? ` · short ${fmtMoney(sp)}` : ""}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const payPurchase = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const today = new Date().toISOString().slice(0, 10);
      await api.patch(`/purchase-invoices/${id}`, { status: "paid", paid_date: today });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      toast.success("Balance paid");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const settleCreditDebitNote = useMutation({
    mutationFn: async ({ id, noteType }: { id: string; noteType: "credit" | "debit" }) => {
      const targetStatus = noteType === "credit" ? "received" : "paid";
      await api.patch(`/credit-debit-notes/${id}`, { status: targetStatus });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      toast.success("Note settled — linked invoice amount updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [closeFor, setCloseFor] = useState<Row | null>(null);
  const [fundPf, setFundPf] = useState<Row | null>(null);
  const [massCloseOpen, setMassCloseOpen] = useState(false);

  const fundProforma = useMutation({
    mutationFn: async ({ id, amount, reference, advance_date }: { id: string; amount: number; reference: string; advance_date: string }) => {
      await api.post(`/purchase-orders/${id}/fund`, {
        amount,
        reference: reference || null,
        advance_date,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      toast.success("Advance recorded");
      setFundPf(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cdNoteRows: Row[] = ((creditDebitNotesQ.data ?? []) as Array<Record<string, any>>).map((n): Row => ({
    kind: n.type === "credit" ? "cd_credit" : "cd_debit",
    id: n.id,
    invoice_number: n.note_number,
    amount: Number(n.amount),
    po_number: n.linkedInvoice?.invoice_number ? `${n.type === "credit" ? "Credits" : "Debits"} ${n.linkedInvoice.invoice_number}` : null,
    advance: 0,
    balance: Number(n.amount),
    due_date: null,
    issue_date: n.date,
    status: n.status,
    party: n.debtor_supplier_name || "—",
    client: "—",
    side: n.type === "credit" ? "sales" : "purchase",
    proforma_number: n.reason || null,
  }));

  const rows: Row[] = [
    ...cdNoteRows,
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      const amount = Number(i.amount);
      const advance = advFor("sales", i.po_number);
      return {
        kind: "sale", id: i.id, invoice_number: i.invoice_number, amount,
        po_number: i.po_number ?? null, advance,
        balance: Math.max(0, amount - advance),
        due_date: i.due_date, issue_date: i.issue_date,
        status: i.status, party: i.debtor?.name ?? "—", client: i.client?.company_name || i.client?.contact_name || "—",
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      const amount = Number(p.amount);
      const advance = advFor("purchase", p.po_number);
      return {
        kind: "purchase", id: p.id, invoice_number: p.invoice_number, amount,
        po_number: p.po_number ?? null, advance,
        balance: Math.max(0, amount - advance),
        due_date: p.due_date, issue_date: p.issue_date,
        status: p.status, party: p.vendor?.name ?? "—", client: "—",
      };
    }),
    ...((proformasQ.data ?? []) as Array<Record<string, any>>).map((p): Row => ({
      kind: "proforma" as const,
      id: p.id,
      invoice_number: p.proforma_number ?? p.po_number,
      amount: Number(p.amount),
      po_number: p.po_number ?? null,
      advance: 0,
      balance: Number(p.amount),
      due_date: null,
      issue_date: p.proforma_date ?? p.issue_date,
      status: p.proforma_status,
      party: p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—",
      client: "—",
      side: p.side,
      proforma_number: p.proforma_number,
      currency: p.currency,
    })),
  ]
    .filter((r) => {
      if (side === "all") return true;
      if (side === "credit_note") return r.kind === "cd_credit";
      if (side === "debit_note") return r.kind === "cd_debit";
      if (side === "sale") return r.kind === "sale" || (r.kind === "proforma" && r.side === "sales");
      if (side === "purchase") return r.kind === "purchase" || (r.kind === "proforma" && r.side === "purchase");
      if (side === "proforma") return r.kind === "proforma";
      return r.kind === side;
    })
    .filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return r.invoice_number?.toLowerCase().includes(q) || r.party?.toLowerCase().includes(q) || r.client?.toLowerCase().includes(q) || r.po_number?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aVal = sortField === "issue" ? (a.issue_date ?? "9999") : (a.due_date ?? "9999");
      const bVal = sortField === "issue" ? (b.issue_date ?? "9999") : (b.due_date ?? "9999");
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "asc" ? cmp : -cmp;
    });

  const balanceToPay = rows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.balance, 0);
  const balanceToReceive = rows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.balance, 0);
  const advancesAppliedOut = rows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.advance, 0);
  const advancesAppliedIn = rows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.advance, 0);

  return (
    <div>
      <PageHeader
        eyebrow={isTreasury ? "Treasury desk" : isAdmin ? "Operations" : "Approved queue"}
        title="Funding queue"
        description="Approved invoices awaiting settlement."
        actions={
          isTreasury ? (
            <button onClick={() => setMassCloseOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
              <Upload className="h-4 w-4" /> Upload receipts
            </button>
          ) : undefined
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-xs text-muted-foreground">Approved proformas and credit/debit notes appear below. Use the action buttons to record settlement — this will adjust the linked invoice amount.</div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Supplier balance due"><div className="num num-lg text-warning">{fmtMoney(balanceToPay)}</div></Card>
          <Card title="Advances applied (AP)"><div className="num num-lg text-primary">{fmtMoney(advancesAppliedOut)}</div></Card>
          <Card title="Debtor balance expected"><div className="num num-lg text-primary">{fmtMoney(balanceToReceive)}</div></Card>
          <Card title="Advances applied (AR)"><div className="num num-lg text-success">{fmtMoney(advancesAppliedIn)}</div></Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "sale", "purchase", "proforma", "credit_note", "debit_note"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                side === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "sale" ? "Sales (AR)" : s === "purchase" ? "Purchases (AP)" : s === "proforma" ? "Proformas" : s === "credit_note" ? "Credit notes" : "Debit notes"}</button>
          ))}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search queue by invoice, party, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
          <div className="flex gap-1">
            {(["issue", "due"] as const).map((field) => (
              <button
                key={field}
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
                {field === "issue" ? "Issue date" : "Due date"}
                {sortField === field && (
                  <span className="text-[10px]">{sortOrder === "asc" ? "↑" : "↓"}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Card>
          {salesQ.isLoading || purchasesQ.isLoading || proformasQ.isLoading || creditDebitNotesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Banknote className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No approved items in the queue.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Issue</th>
                    <th className="px-5 py-2 text-left font-normal">Party</th>
                    <th className="px-5 py-2 text-right font-normal">Gross</th>
                    <th className="px-5 py-2 text-right font-normal">Advance applied</th>
                    <th className="px-5 py-2 text-right font-normal">Balance</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="sticky right-0 hidden bg-card px-5 py-2 text-right font-normal md:table-cell">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dpd = r.due_date && r.status !== "paid" ? daysBetween(r.due_date) : 0;
                    const lateDays = Math.max(0, dpd);
                    const action = <QueueAction row={r} isTreasury={isTreasury} onCloseSale={setCloseFor} onPayPurchase={() => payPurchase.mutate({ id: r.id })} onFundPf={setFundPf} onSettleCdNote={(id, noteType) => settleCreditDebitNote.mutate({ id, noteType })} />;
                    return (
                      <Fragment key={`${r.kind}-${r.id}`}>
                      <tr className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={r.id}>#{r.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            r.kind === "sale" ? "bg-primary/15 text-primary" : r.kind === "proforma" ? "bg-purple-500/15 text-purple-500" : r.kind === "cd_credit" ? "bg-emerald-500/15 text-emerald-500" : r.kind === "cd_debit" ? "bg-orange-500/15 text-orange-500" : "bg-warning/15 text-warning"
                          }`}>{r.kind === "sale" ? "Sale (AR)" : r.kind === "proforma" ? `Proforma (${r.side === "sales" ? "AR" : "AP"})` : r.kind === "cd_credit" ? "Credit note" : r.kind === "cd_debit" ? "Debit note" : "Purchase (AP)"}</span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">
                          <div>{r.invoice_number}</div>
                          {r.po_number && <div className="text-[10px] text-muted-foreground">PO {r.po_number}</div>}
                        </td>
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{r.client ?? "—"}</td>}
                        <td className="px-5 py-3 text-sm">{fmtDate(r.issue_date)}</td>
                        <td className="px-5 py-3">{r.party}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                        <td className="px-5 py-3 text-right num text-primary">{r.advance > 0 ? `− ${fmtMoney(r.advance)}` : "—"}</td>
                        <td className={`px-5 py-3 text-right num font-medium ${r.kind === "sale" ? "text-success" : "text-warning"}`}>{fmtMoney(r.balance)}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(r.due_date)}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                        <td className="sticky right-0 hidden bg-card px-5 py-3 text-right md:table-cell">{action}</td>
                      </tr>
                      <tr className="border-b border-border/60 md:hidden">
                        <td colSpan={isAdmin ? 13 : 12} className="px-5 pb-4 pt-0 text-left">
                          <div className="flex justify-start">{action}</div>
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {closeFor && (
        <CloseSaleModal
          row={closeFor}
          onClose={() => setCloseFor(null)}
          onSubmit={(vals) => {
            closeSale.mutate(
              { id: closeFor.id, amount: closeFor.balance, due_date: closeFor.due_date, ...vals },
              { onSuccess: () => setCloseFor(null) },
            );
          }}
        />
      )}

      {fundPf && (
        <FundProformaModal
          row={fundPf}
          onClose={() => setFundPf(null)}
          onSubmit={(vals) => {
            fundProforma.mutate(
              { id: fundPf.id, ...vals },
              { onSuccess: () => setFundPf(null) },
            );
          }}
        />
      )}

      {massCloseOpen && (
        <MassCloseModal
          salesData={salesQ.data ?? []}
          onClose={() => setMassCloseOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["queue-sales"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
            qc.invalidateQueries({ queryKey: ["queue-purchases"] });
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            setMassCloseOpen(false);
          }}
        />
      )}
    </div>
  );
}

function QueueAction({ row, isTreasury, onCloseSale, onPayPurchase, onFundPf, onSettleCdNote }: {
  row: Row; isTreasury: boolean; onCloseSale: (row: Row) => void; onPayPurchase: () => void; onFundPf?: (row: Row) => void; onSettleCdNote?: (id: string, noteType: "credit" | "debit") => void;
}) {
  if (!isTreasury) {
    return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"><Lock className="h-3 w-3" /> Treasury only</span>;
  }
  if (row.kind === "proforma") {
    return (
      <button onClick={() => onFundPf?.(row)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10">
        <ArrowDownToLine className="h-3 w-3" /> {row.side === "sales" ? "Mark received" : "Mark paid"}
      </button>
    );
  }
  if (row.kind === "cd_credit") {
    return (
      <button onClick={() => onSettleCdNote?.(row.id, "credit")}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10">
        <ArrowDownToLine className="h-3 w-3" /> Mark received
      </button>
    );
  }
  if (row.kind === "cd_debit") {
    return (
      <button onClick={() => onSettleCdNote?.(row.id, "debit")}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10">
        <ArrowUpFromLine className="h-3 w-3" /> Mark paid
      </button>
    );
  }
  if (row.kind === "sale") {
    return (
      <button onClick={() => onCloseSale(row)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10">
        <ArrowDownToLine className="h-3 w-3" /> Record receipt
      </button>
    );
  }
  if (row.balance <= 0) {
    return (
      <button onClick={onPayPurchase} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10">
        <CheckCircle2 className="h-3 w-3" /> Mark settled
      </button>
    );
  }
  return (
    <button onClick={onPayPurchase} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10">
      <ArrowUpFromLine className="h-3 w-3" /> Pay balance
    </button>
  );
}

function FundProformaModal({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (v: { amount: number; reference: string; advance_date: string }) => void }) {
  const [amt, setAmt] = useState(String(row.amount));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-vault" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-lg">{row.side === "sales" ? "Mark advance received" : "Mark advance paid"} · {row.invoice_number}</h3>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ amount: Number(amt), reference: ref, advance_date: date }); }} className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>PO #</span><span className="font-mono text-foreground">{row.po_number ?? "—"}</span></div>
            <div className="flex justify-between"><span>Party</span><span className="text-foreground">{row.party}</span></div>
            <div className="flex justify-between"><span>Advance amount</span><span className="num text-foreground">{fmtMoney(row.amount)}</span></div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Amount ({row.currency ?? "USD"}) *</span>
            <input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="w-full rounded-md border border-border bg-background p-2" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Date *</span>
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Reference</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Wire ref / transaction id" className="w-full rounded-md border border-border bg-background p-2" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Confirm</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Mass Close Modal ──

interface ImportRow {
  invoice_number: string;
  date_received: string;
  amount_received: number;
}

function MassCloseModal({ salesData, onClose, onDone }: { salesData: any[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ closed: number; not_found: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Build lookup map from loaded queue data
  const invoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const inv of salesData) {
      map.set(inv.invoice_number, inv);
    }
    return map;
  }, [salesData]);

  // Preview: match rows against the queue data
  const preview = useMemo(() => {
    const matched: Array<{ invoice_number: string; date_received: string; amount_received: number; invoice: any }> = [];
    const unmatched: ImportRow[] = [];
    for (const r of rows) {
      const inv = invoiceMap.get(r.invoice_number);
      if (inv) {
        matched.push({ ...r, invoice: inv });
      } else {
        unmatched.push(r);
      }
    }
    return { matched, unmatched };
  }, [rows, invoiceMap]);

  const totalAmount = useMemo(() => preview.matched.reduce((s, r) => s + r.amount_received, 0), [preview.matched]);

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

        const parsed: ImportRow[] = json.map((row: any, idx: number) => {
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row.invoiceNum ?? row.Invoice ?? row["Invoice#"] ?? "";
          const dateRec = row.date_received ?? row["Date Received"] ?? row.dateReceived ?? row["Receipt Date"] ?? row.receipt_date ?? row.ReceiptDate ?? "";
          const amtRec = Number(row.amount_received ?? row["Amount Received"] ?? row.amountReceived ?? row["Amount"] ?? row.Amount ?? 0);

          let dateStr = String(dateRec);
          if (typeof dateRec === "number" && !isNaN(dateRec)) {
            const d = new Date((dateRec - 25569) * 86400 * 1000);
            dateStr = d.toISOString().slice(0, 10);
          }

          return {
            invoice_number: String(invNum).trim(),
            date_received: dateStr || "",
            amount_received: isNaN(amtRec) ? 0 : amtRec,
          };
        }).filter((r) => r.invoice_number && r.date_received);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: invoice_number, date_received, amount_received");
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

  const batchClose = useMutation({
    mutationFn: async () => {
      return await api.post<{ closed: any[]; not_found: string[]; errors: Array<{ invoice_number: string; error: string }> }>("/invoices/batch-close", {
        items: preview.matched.map((r) => ({
          invoice_number: r.invoice_number,
          date_received: r.date_received,
          amount_received: r.amount_received,
        })),
      });
    },
    onSuccess: (data) => {
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({
        closed: data.closed.length,
        not_found: preview.unmatched.map((r) => r.invoice_number),
        errors: errList,
      });
      setStep("done");
      if (errList.length === 0 && preview.unmatched.length === 0) {
        toast.success(`${data.closed.length} invoices closed successfully`);
      } else {
        toast.success(`${data.closed.length} closed, ${errList.length + preview.unmatched.length} skipped`);
      }
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "upload" ? "Upload receipts" : step === "preview" ? "Preview matched receipts" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "upload" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet (.xlsx, .xls, .xlsb, .xlsm), CSV, TSV, or ODS file with columns:{' '}
              <code className="font-mono text-primary">invoice_number</code>,{' '}
              <code className="font-mono text-primary">date_received</code>,{' '}
              <code className="font-mono text-primary">amount_received</code>.
              Each row will be matched against approved invoices in the queue and closed with the provided receipt date and amount.
            </div>

            <div className="border-t border-border pt-4">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Upload Excel / CSV file *</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                  onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                />
              </label>
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
                Found <strong className="text-success">{preview.matched.length}</strong> matches ·
                <strong className="text-warning">{preview.unmatched.length}</strong> unmatched ·
                Total receipts <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("upload")} className="text-xs text-primary hover:underline">Change file</button>
            </div>

            {preview.unmatched.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <div className="text-xs uppercase tracking-widest text-warning mb-1">Not found in queue ({preview.unmatched.length})</div>
                <div className="flex flex-wrap gap-1">
                  {preview.unmatched.map((r) => (
                    <span key={r.invoice_number} className="inline-flex items-center rounded-md border border-warning/30 px-2 py-0.5 text-[10px] font-mono text-warning">{r.invoice_number}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Party</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-right font-normal">Received</th>
                    <th className="px-5 py-2 text-right font-normal">Short</th>
                    <th className="px-5 py-2 text-left font-normal">Receipt date</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matched.map((r, idx) => {
                    const short = Math.max(0, +(r.invoice.amount - r.amount_received).toFixed(2));
                    return (
                      <tr key={r.invoice_number} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-5 py-3">{r.invoice.debtor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.invoice.amount)}</td>
                        <td className="px-5 py-3 text-right num text-success">{fmtMoney(r.amount_received)}</td>
                        <td className={`px-5 py-3 text-right num ${short > 0 ? "text-destructive" : "text-muted-foreground"}`}>{short > 0 ? fmtMoney(short) : "—"}</td>
                        <td className="px-5 py-3 text-sm font-mono">{r.date_received}</td>
                        <td className="px-5 py-3"><StatusPill status={r.invoice.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button
                disabled={batchClose.isPending || preview.matched.length === 0}
                onClick={() => batchClose.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {batchClose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Close {preview.matched.length} invoice{preview.matched.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.closed}</div>
              <div className="text-xs text-muted-foreground mt-1">Invoices closed successfully</div>
            </div>
            {result.not_found.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="text-xs uppercase tracking-widest text-warning mb-2">Not found ({result.not_found.length})</div>
                <div className="flex flex-wrap gap-1">
                  {result.not_found.map((inv) => (
                    <span key={inv} className="inline-flex items-center rounded-md border border-warning/30 px-2 py-0.5 text-[10px] font-mono text-warning">{inv}</span>
                  ))}
                </div>
              </div>
            )}
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
              <button onClick={onDone} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CloseSaleModal({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (v: { amount_received: number; receipt_date: string }) => void }) {
  const [amt, setAmt] = useState(String(row.balance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const short = Math.max(0, +(row.balance - Number(amt || 0)).toFixed(2));
  const late = diffDaysUTC(row.due_date, date);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-vault" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-lg">Close sales invoice {row.invoice_number}</h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div>Gross: <span className="num text-foreground">{fmtMoney(row.amount)}</span></div>
            {row.advance > 0 && <div>Advance received: <span className="num text-primary">− {fmtMoney(row.advance)}</span></div>}
            <div>Balance expected: <span className="num text-success">{fmtMoney(row.balance)}</span> · Due {fmtDate(row.due_date)}</div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Amount received</span>
            <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="w-full rounded-md border border-border bg-background p-2" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Receipt date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-border bg-background p-2" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Short payment</div>
              <div className={`num text-lg ${short > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(short)}</div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Late days</div>
              <div className={`num text-lg ${late > 0 ? "text-warning" : "text-success"}`}>{late}</div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => onSubmit({ amount_received: Number(amt), receipt_date: date })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Close invoice</button>
        </div>
      </div>
    </div>
  );
}
