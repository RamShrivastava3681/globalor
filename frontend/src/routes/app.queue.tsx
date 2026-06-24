import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Banknote, CheckCircle2, Lock, ArrowDownToLine, ArrowUpFromLine, ArrowUpDown } from "lucide-react";
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
  kind: "sale" | "purchase" | "proforma";
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
  const [side, setSide] = useState<"all" | "sale" | "purchase" | "proforma">("all");
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

  const [closeFor, setCloseFor] = useState<Row | null>(null);
  const [fundPf, setFundPf] = useState<Row | null>(null);

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

  const rows: Row[] = [
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
    .filter((r) => side === "all" || r.kind === side || (side === "sale" && r.kind === "proforma" && r.side === "sales") || (side === "purchase" && r.kind === "proforma" && r.side === "purchase"))
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
      />

      <div className="space-y-6 p-6 md:p-10">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-xs text-muted-foreground">Approved proformas appear below. Use <span className="text-success">Fund advance</span> to record the payment/receipt.</div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Supplier balance due"><div className="num num-lg text-warning">{fmtMoney(balanceToPay)}</div></Card>
          <Card title="Advances applied (AP)"><div className="num num-lg text-primary">{fmtMoney(advancesAppliedOut)}</div></Card>
          <Card title="Debtor balance expected"><div className="num num-lg text-primary">{fmtMoney(balanceToReceive)}</div></Card>
          <Card title="Advances applied (AR)"><div className="num num-lg text-success">{fmtMoney(advancesAppliedIn)}</div></Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "sale", "purchase", "proforma"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                side === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "sale" ? "Sales (AR)" : s === "purchase" ? "Purchases (AP)" : "Proformas"}</button>
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
          {salesQ.isLoading || purchasesQ.isLoading || proformasQ.isLoading ? (
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
                    const action = <QueueAction row={r} isTreasury={isTreasury} onCloseSale={setCloseFor} onPayPurchase={() => payPurchase.mutate({ id: r.id })} onFundPf={setFundPf} />;
                    return (
                      <Fragment key={`${r.kind}-${r.id}`}>
                      <tr className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            r.kind === "sale" ? "bg-primary/15 text-primary" : r.kind === "proforma" ? "bg-purple-500/15 text-purple-500" : "bg-warning/15 text-warning"
                          }`}>{r.kind === "sale" ? "Sale (AR)" : r.kind === "proforma" ? `Proforma (${r.side === "sales" ? "AR" : "AP"})` : "Purchase (AP)"}</span>
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
                        <td colSpan={isAdmin ? 12 : 11} className="px-5 pb-4 pt-0 text-left">
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
    </div>
  );
}

function QueueAction({ row, isTreasury, onCloseSale, onPayPurchase, onFundPf }: {
  row: Row; isTreasury: boolean; onCloseSale: (row: Row) => void; onPayPurchase: () => void; onFundPf?: (row: Row) => void;
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
