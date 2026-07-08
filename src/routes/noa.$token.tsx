import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import { ShieldCheck, Check, X, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/noa/$token")({
  component: NoaPage,
});

type NoaInvoice = {
  id: string;
  invoice_number: string;
  amount: number;
  advance_rate: number;
  advance_amount: number;
  issue_date: string;
  due_date: string;
  noa_status: string;
  noa_comments: string;
  client_company: string;
  debtor_name: string;
  debtor_contact_name: string;
  debtor_contact_email: string;
};

function NoaPage() {
  const { token } = useParams({ from: "/noa/$token" });
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "accept" | "reject" | "comment">(null);
  const [comments, setComments] = useState("");

  const noaQ = useQuery({
    queryKey: ["noa", token],
    queryFn: async () => {
      const data = await api.get<NoaInvoice>(`/noa/${token}`);
      return data ?? null;
    },
  });

  const respond = useMutation({
    mutationFn: async ({ decision, comments }: { decision: string; comments: string | null }) => {
      await api.post(`/noa/${token}/respond`, { decision, comments });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["noa", token] });
      toast.success("Response recorded");
      setMode(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (noaQ.isLoading) return <div className="grid min-h-screen place-items-center text-[#64748B]">Loading…</div>;
  const inv = noaQ.data;
  if (!inv) return <div className="grid min-h-screen place-items-center text-[#64748B]">This Notice of Assignment link is invalid or expired.</div>;

  const decided = ["accepted", "rejected", "commented"].includes(inv.noa_status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-[#00B8FF]" />
        <div>
          <div className="text-xs uppercase tracking-widest text-[#64748B]">Notice of Assignment</div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">Invoice verification</h1>
        </div>
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <p className="text-sm text-[#64748B]">
          {inv.client_company || "Your supplier"} has assigned the following invoice to a factoring facility.
          Please digitally verify the invoice details and confirm that payment, when due, will be remitted to the assignee.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Debtor</dt><dd className="text-[#0F172A]">{inv.debtor_name}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Contact</dt><dd className="text-[#0F172A]">{inv.debtor_contact_name || "—"}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Invoice #</dt><dd className="font-mono text-[#0F172A]">{inv.invoice_number}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Amount</dt><dd className="num text-[#0F172A] font-medium">{fmtMoney(Number(inv.amount))}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Advance rate</dt><dd className="text-[#0F172A]">{inv.advance_rate}%</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#00B8FF] font-medium">Advance amount</dt><dd className="num text-[#00B8FF] font-medium">{fmtMoney(Number(inv.advance_amount))}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Issue date</dt><dd className="text-[#0F172A]">{fmtDate(inv.issue_date)}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Due date</dt><dd className="text-[#0F172A]">{fmtDate(inv.due_date)}</dd></div>
        </dl>

        <div className="mt-6 border-t border-[#E2E8F0] pt-6">
          <div className="text-xs uppercase tracking-widest text-[#64748B] font-medium">Current status</div>
          <div className="mt-1 text-lg capitalize text-[#0F172A]">{inv.noa_status.replace("_", " ")}</div>
          {inv.noa_comments && (
            <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-sm text-[#475569]">
              <div className="text-[10px] uppercase tracking-widest text-[#64748B] font-medium">Comments</div>
              {inv.noa_comments}
            </div>
          )}
        </div>

        {!decided && !mode && (
          <div className="mt-6 grid gap-2 md:grid-cols-3">
            <button onClick={() => setMode("accept")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#16A34A]/50 px-3 py-2.5 text-sm font-medium text-[#16A34A] hover:bg-[#F0FDF4] transition-colors"><Check className="h-4 w-4" /> Accept</button>
            <button onClick={() => setMode("reject")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#DC2626]/50 px-3 py-2.5 text-sm font-medium text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"><X className="h-4 w-4" /> Reject</button>
            <button onClick={() => setMode("comment")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"><MessageSquare className="h-4 w-4" /> Reply with comments</button>
          </div>
        )}

        {!decided && mode && (
          <div className="mt-6 space-y-3">
            {(mode === "reject" || mode === "comment") && (
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                required
                placeholder={mode === "reject" ? "Reason for rejection…" : "Your comments…"}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white p-3 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#00B8FF] focus:outline-none focus:ring-1 focus:ring-[#00B8FF]/20"
              />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setMode(null); setComments(""); }} className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#64748B] hover:bg-[#F8FAFC] transition-colors">Cancel</button>
              <button
                disabled={respond.isPending || ((mode === "reject" || mode === "comment") && !comments.trim())}
                onClick={() => respond.mutate({
                  decision: mode === "accept" ? "accepted" : mode === "reject" ? "rejected" : "commented",
                  comments: mode === "accept" ? null : comments.trim(),
                })}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#00B8FF] to-[#0099D9] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:shadow-md disabled:opacity-60 transition-all"
              >
                {respond.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm {mode === "accept" ? "acceptance" : mode === "reject" ? "rejection" : "comments"}
              </button>
            </div>
          </div>
        )}

        {decided && (
          <div className="mt-6 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm text-[#64748B]">
            Thank you — your response has been recorded and shared with the factor.
          </div>
        )}
      </div>
    </div>
  );
}
