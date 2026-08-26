import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import { BadgeCheck, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/approvals/$token")({
  component: ApprovalPage,
});

type ApprovalLine = {
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price: number;
  gst_rate: number | null;
};

type ApprovalView = {
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_name: string;
  contact_person: string | null;
  debtor_status: string;
  debtor_comments: string;
  status: string;
  lines: ApprovalLine[];
  freight: number;
  totals: { subtotal: number; total_discount: number; gst_total: number; grand_total: number };
};

function ApprovalPage() {
  const { token } = useParams({ from: "/approvals/$token" });
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "approved" | "rejected">(null);
  const [comments, setComments] = useState("");

  const q = useQuery({
    queryKey: ["approval", token],
    queryFn: async () => (await api.get<ApprovalView>(`/approvals/${token}`)) ?? null,
  });

  const respond = useMutation({
    mutationFn: async ({ decision, comments }: { decision: string; comments: string | null }) => {
      await api.post(`/approvals/${token}/respond`, { decision, comments });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval", token] });
      toast.success("Response recorded");
      setMode(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  const quote = q.data;
  if (!quote) return <div className="grid min-h-screen place-items-center text-muted-foreground">This approval link is invalid or expired.</div>;

  const decided = quote.debtor_status === "approved" || quote.debtor_status === "rejected";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <BadgeCheck className="h-7 w-7 text-primary" />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Quotation approval</div>
          <h1 className="font-display text-2xl">Review our quotation</h1>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-xl">
        <p className="text-sm text-muted-foreground">
          {quote.customer_name || "Your supplier"} has sent you quotation <strong className="font-mono">{quote.quotation_number}</strong>.
          Please review the offer below and approve or reject it. No login is required.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Quotation #</dt><dd className="font-mono">{quote.quotation_number}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Date</dt><dd>{fmtDate(quote.quotation_date)}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Contact</dt><dd>{quote.contact_person || "—"}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Valid until</dt><dd>{quote.valid_until ? fmtDate(quote.valid_until) : "—"}</dd></div>
        </dl>

        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Item</th>
                <th className="px-3 py-2 text-left font-normal">SKU</th>
                <th className="px-3 py-2 text-right font-normal">Qty</th>
                <th className="px-3 py-2 text-right font-normal">Price</th>
                <th className="px-3 py-2 text-right font-normal">Line total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{l.name}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{l.sku}</td>
                  <td className="px-3 py-2 text-right num">{l.quantity.toLocaleString()} <span className="text-[10px] text-muted-foreground">{l.unit}</span></td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(Number(l.unit_price))}</td>
                  <td className="px-3 py-2 text-right num font-medium">{fmtMoney(Number(l.quantity) * Number(l.unit_price))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border font-medium">
              <tr><td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Subtotal</td><td className="px-3 py-2 text-right num">{fmtMoney(quote.totals.subtotal)}</td></tr>
              {quote.totals.total_discount > 0 && (
                <tr><td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Discount</td><td className="px-3 py-2 text-right num">− {fmtMoney(quote.totals.total_discount)}</td></tr>
              )}
              <tr><td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">GST</td><td className="px-3 py-2 text-right num">{fmtMoney(quote.totals.gst_total)}</td></tr>
              {quote.freight > 0 && (
                <tr><td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Freight</td><td className="px-3 py-2 text-right num">{fmtMoney(quote.freight)}</td></tr>
              )}
              <tr><td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-widest text-foreground">Grand total</td><td className="px-3 py-2 text-right num text-base">{fmtMoney(quote.totals.grand_total)}</td></tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Your response</div>
          <div className="mt-1 text-lg capitalize">{quote.debtor_status.replace("_", " ")}</div>
          {quote.debtor_comments && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your comments</div>
              {quote.debtor_comments}
            </div>
          )}
        </div>

        {!decided && !mode && (
          <div className="mt-6 grid gap-2 md:grid-cols-2">
            <button onClick={() => setMode("approved")} className="inline-flex items-center justify-center gap-2 rounded-md border border-success/50 px-3 py-2 text-sm text-success hover:bg-success/10"><Check className="h-4 w-4" /> Approve quotation</button>
            <button onClick={() => setMode("rejected")} className="inline-flex items-center justify-center gap-2 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"><X className="h-4 w-4" /> Reject quotation</button>
          </div>
        )}

        {!decided && mode && (
          <div className="mt-6 space-y-3">
            {mode === "rejected" && (
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                required
                placeholder="Reason for rejection…"
                className="w-full rounded-md border border-border bg-background p-3 text-sm"
              />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setMode(null); setComments(""); }} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
              <button
                disabled={respond.isPending || (mode === "rejected" && !comments.trim())}
                onClick={() => respond.mutate({ decision: mode, comments: mode === "approved" ? (comments.trim() || null) : comments.trim() })}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {respond.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm {mode === "approved" ? "approval" : "rejection"}
              </button>
            </div>
          </div>
        )}

        {decided && (
          <div className="mt-6 rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Thank you — your response has been recorded.
          </div>
        )}
      </div>
    </div>
  );
}
