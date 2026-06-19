import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { ClipboardCheck, Check, X, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/checker")({
  component: CheckerPage,
});

type Row = {
  kind: "sale" | "purchase" | "proforma";
  id: string;
  invoice_number: string;
  amount: number;
  po_number?: string | null;
  advance: number;
  net: number;
  issue_date: string | null;
  due_date: string | null;
  party: string;
  client?: string;
  client_id?: string | null;
  noa_status?: string;
  noa_comments?: string | null;
  side?: "sales" | "purchase";
  proforma_number?: string | null;
  proforma_review_comments?: string | null;
};

function CheckerPage() {
  const { isAdmin, isChecker, user, canWrite } = useAuth();
  const canReview = canWrite("checker-desk");
  const qc = useQueryClient();
  const [side, setSide] = useState<"all" | "sale" | "purchase" | "proforma">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const salesQ = useQuery({
    queryKey: ["checker-sales"],
    queryFn: async () => {
      const data = await api.get<any[]>("/invoices") ?? [];
      return data.filter((i: any) => i.status === "pending");
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["checker-purchases"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-invoices") ?? [];
      return data.filter((p: any) => p.status === "pending");
    },
  });

  const proformasQ = useQuery({
    queryKey: ["checker-proformas"],
    queryFn: async () => {
      const data = await api.get<any[]>("/purchase-orders") ?? [];
      return data.filter((p: any) => p.proforma_status === "pending_review");
    },
  });

  const reviewSale = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.patch(`/invoices/${id}`, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewPurchase = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "disputed" }) => {
      await api.patch(`/purchase-invoices/${id}`, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewProforma = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.post(`/purchase-orders/${id}/review`, { decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      toast.success("Proforma reviewed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Build PO -> open advance total lookup per side
  const salePos = Array.from(new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)));
  const purPos = Array.from(new Set(((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean)));

  const advLookupQ = useQuery({
    queryKey: ["checker-advances", salePos, purPos],
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

  const advFor = (s: "sales" | "purchase", po?: string | null) => {
    const k = po ? `${s}::${po.trim()}` : "";
    return k ? Number(advMap[k] ?? 0) : 0;
  };

  const rows: Row[] = [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      const adv = advFor("sales", i.po_number);
      const net = Number(i.amount); // amount is already net of advances (backend deducts on create)
      return {
        kind: "sale", id: i.id, invoice_number: i.invoice_number, amount: net + adv, // reconstruct gross
        po_number: i.po_number, advance: adv, net,
        issue_date: i.issue_date, due_date: i.due_date,
        party: i.debtor?.name ?? "—", client: i.client?.company_name || i.client?.contact_name || "—", client_id: i.client_id,
        noa_status: i.noa_status, noa_comments: i.noa_comments,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      const adv = advFor("purchase", p.po_number);
      const net = Number(p.amount); // amount is already net of advances (backend deducts on create)
      return {
        kind: "purchase", id: p.id, invoice_number: p.invoice_number, amount: net + adv, // reconstruct gross
        po_number: p.po_number, advance: adv, net,
        issue_date: p.issue_date, due_date: p.due_date,
        party: p.vendor?.name ?? "—", client: "—", client_id: p.client_id,
      };
    }),
    ...((proformasQ.data ?? []) as Array<Record<string, any>>).map((p): Row => ({
      kind: "proforma" as const,
      id: p.id,
      invoice_number: p.proforma_number ?? p.po_number,
      amount: Number(p.amount),
      po_number: p.po_number,
      advance: 0,
      net: Number(p.amount),
      issue_date: p.proforma_date ?? p.issue_date,
      due_date: null,
      party: p.side === "sales" ? p.debtor?.name ?? "—" : p.vendor?.name ?? "—",
      client: "—",
      side: p.side,
      proforma_number: p.proforma_number,
      proforma_review_comments: p.proforma_review_comments,
    })),
  ].filter((r) => {
    const sideMatch = side === "all" || r.kind === side || (side === "sale" && r.kind === "proforma" && r.side === "sales") || (side === "purchase" && r.kind === "proforma" && r.side === "purchase");
    if (!sideMatch) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return r.invoice_number?.toLowerCase().includes(q) || r.party?.toLowerCase().includes(q) || r.client?.toLowerCase().includes(q) || r.po_number?.toLowerCase().includes(q);
  });

  const pendingSales = (salesQ.data ?? []).length;
  const pendingPurchases = (purchasesQ.data ?? []).length;
  const pendingProformas = (proformasQ.data ?? []).length;

  return (
    <div>
      <PageHeader
        eyebrow="Checker desk"
        title="Maker–checker review"
        description={
          canReview
            ? "Newly submitted invoices wait here for your approval. Approving releases them into the funding queue."
            : "View-only. Only the checker (or admin) can approve invoices into the funding queue."
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Pending sales invoices">
            <div className="num text-3xl text-primary">{pendingSales}</div>
            <div className="mt-1 text-xs text-muted-foreground">Awaiting approval to enter AR queue</div>
          </Card>
          <Card title="Pending purchase invoices">
            <div className="num text-3xl text-warning">{pendingPurchases}</div>
            <div className="mt-1 text-xs text-muted-foreground">Awaiting approval to enter AP queue</div>
          </Card>
          <Card title="Pending proformas">
            <div className="num text-3xl text-primary">{pendingProformas}</div>
            <div className="mt-1 text-xs text-muted-foreground">Proforma advances awaiting review</div>
          </Card>
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
          <input type="text" placeholder="Search by invoice, party, client..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>
        <Card>
          {salesQ.isLoading || purchasesQ.isLoading || proformasQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="mx-auto mb-3 h-8 w-8 opacity-40" />
              Nothing awaiting review.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Party</th>
                    <th className="px-5 py-2 text-right font-normal">Gross</th>
                    <th className="px-5 py-2 text-right font-normal">Advance</th>
                    <th className="px-5 py-2 text-right font-normal">Net</th>
                    <th className="px-5 py-2 text-left font-normal">Issued</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                          r.kind === "sale" ? "bg-primary/15 text-primary" : r.kind === "proforma" ? "bg-purple-500/15 text-purple-500" : "bg-warning/15 text-warning"
                        }`}>{r.kind === "sale" ? "Sale (AR)" : r.kind === "proforma" ? `Proforma (${r.side === "sales" ? "AR" : "AP"})` : "Purchase (AP)"}</span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                      {isAdmin && <td className="px-5 py-3 text-muted-foreground">{r.client ?? "—"}</td>}
                      <td className="px-5 py-3">{r.party}</td>
                      <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}{r.po_number && <div className="text-[10px] font-mono text-muted-foreground">PO {r.po_number}</div>}</td>
                      <td className="px-5 py-3 text-right num text-primary">{r.advance > 0 ? `− ${fmtMoney(r.advance)}` : "—"}</td>
                      <td className={`px-5 py-3 text-right num font-medium ${r.kind === "sale" ? "text-success" : "text-warning"}`}>{fmtMoney(r.net)}<div className="text-[10px] uppercase tracking-widest text-muted-foreground">{(r.kind === "sale" || (r.kind === "proforma" && r.side === "sales")) ? "to receive" : "to transfer"}</div></td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.issue_date)}</td>
                      <td className="px-5 py-3 text-sm">{fmtDate(r.due_date)}</td>
                      <td className="px-5 py-3">
                        {r.kind === "sale" ? (
                          <div>
                            <NoaPill status={r.noa_status ?? "not_sent"} />
                            {r.noa_comments && <div className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground" title={r.noa_comments}>“{r.noa_comments}”</div>}
                          </div>
                        ) : r.kind === "proforma" && r.proforma_review_comments ? (
                          <span className="text-xs text-warning" title={r.proforma_review_comments}>“{r.proforma_review_comments}”</span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {r.kind === "sale" && (r.noa_status === "rejected" || r.noa_status === "not_sent") && (
                          <div className="mb-1 text-[10px] uppercase tracking-widest text-warning">
                            {r.noa_status === "not_sent" ? "NOA not sent" : "NOA rejected"}
                          </div>
                        )}
                        {canReview ? (
                          r.kind === "sale" && r.client_id && r.client_id === user?.id && !isAdmin ? (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground" title="Segregation of duties: you cannot review an invoice you created">
                              <Lock className="h-3 w-3" /> Self-created
                            </span>
                          ) : (
                            <div className="inline-flex gap-1">
                              <button onClick={() => {
                                if (r.kind === "proforma") reviewProforma.mutate({ id: r.id, decision: "approved" });
                                else if (r.kind === "sale") reviewSale.mutate({ id: r.id, decision: "approved" });
                                else reviewPurchase.mutate({ id: r.id, decision: "approved" });
                              }}
                                className="inline-flex items-center gap-1 rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10">
                                <Check className="h-3 w-3" /> Approve
                              </button>
                              <button onClick={() => {
                                if (r.kind === "proforma") reviewProforma.mutate({ id: r.id, decision: "rejected" });
                                else if (r.kind === "sale") reviewSale.mutate({ id: r.id, decision: "rejected" });
                                else reviewPurchase.mutate({ id: r.id, decision: "disputed" });
                              }}
                                className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10">
                                <X className="h-3 w-3" /> {r.kind === "purchase" ? "Dispute" : "Reject"}
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                            <Lock className="h-3 w-3" /> Checker only
                          </span>
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
    </div>
  );
}

function NoaPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}
