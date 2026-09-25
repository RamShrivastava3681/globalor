import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Check, X, ArrowUpFromLine, ArrowDownToLine, Loader2, Lock } from "lucide-react";

/**
 * Shared approve-or-pay actions. Mount anywhere a doc is viewed
 * (checker drawer, proforma detail, invoice detail, queue row, task drawer)
 * so treasury/checker never hit a dead-end view.
 *
 * - Checker (`checker-desk`): Approve / Reject (proforma, sales, purchase, orders).
 * - Treasury (`funding-queue`): Fund proforma / Record receipt (sales) / Pay balance (purchase).
 * Backend already permits PATCH via requireAnyWriteAccess(invoices, checker-desk, funding-queue).
 */

export type DocKind = "sale" | "purchase" | "proforma" | "po" | "sales_order" | "quotation";

export function DocActions({
  kind,
  doc,
  compact = false,
  onDone,
}: {
  kind: DocKind;
  doc: any;
  compact?: boolean;
  onDone?: () => void;
}) {
  const { canWrite, user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canReview = canWrite("checker-desk");
  const canPay = canWrite("funding-queue");
  const [confirm, setConfirm] = useState<null | "approve" | "reject" | "fund" | "pay">(null);
  const [comment, setComment] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workflow-queue"] });
    qc.invalidateQueries({ queryKey: ["workflow-tasks"] });
    qc.invalidateQueries({ queryKey: ["checker"] });
    qc.invalidateQueries({ queryKey: ["queue"] });
    qc.invalidateQueries({ queryKey: ["proformas"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["purchase"] });
    onDone?.();
  };

  const review = useMutation({
    mutationFn: async ({ decision }: { decision: "approved" | "rejected" | "disputed" }) => {
      if (kind === "proforma") {
        await api.post(`/purchase-orders/${doc.id}/review`, {
          decision: decision === "disputed" ? "rejected" : decision,
          ...(comment.trim() ? { comments: comment.trim() } : {}),
        });
      } else if (kind === "sale") {
        // NOTE: invoice review carries no comment field (matches checker desk) — comment box is hidden for these kinds.
        await api.patch(`/invoices/${doc.id}`, { status: decision });
      } else if (kind === "purchase") {
        await api.patch(`/purchase-invoices/${doc.id}`, { status: decision });
      } else if (kind === "po") {
        await api.post(`/goods-purchase-orders/${doc.id}/${decision === "approved" ? "approve" : "reject"}`, {
          ...(comment.trim() ? { comments: comment.trim() } : {}),
        });
      } else if (kind === "sales_order") {
        await api.post(`/goods-sales-orders/${doc.id}/${decision === "approved" ? "approve" : "reject"}`, {
          ...(comment.trim() ? { comments: comment.trim() } : {}),
        });
      } else if (kind === "quotation") {
        await api.post(`/quotations/${doc.id}/review`, {
          decision: decision === "disputed" ? "rejected" : decision,
          comments: comment.trim() || null,
        });
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === "approved" ? "Approved — released to next queue" : "Decision recorded");
      setConfirm(null);
      setComment("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Review failed"),
  });

  const fund = useMutation({
    mutationFn: async () => {
      await api.post(`/purchase-orders/${doc.id}/fund`, {
        amount: Number(doc.amount),
        reference: comment.trim() || null,
        advance_date: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => {
      toast.success("Advance funded — proforma leaves the queue");
      setConfirm(null);
      setComment("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Fund failed"),
  });

  const pay = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (kind === "sale") {
        await api.patch(`/invoices/${doc.id}`, {
          status: "paid",
          paid_date: today,
          receipt_date: today,
          amount_received: Number(doc.amount),
          ...(comment.trim() ? { paid_note: comment.trim() } : {}),
        });
      } else {
        await api.patch(`/purchase-invoices/${doc.id}`, {
          status: "paid",
          paid_date: today,
          ...(comment.trim() ? { paid_note: comment.trim() } : {}),
        });
      }
    },
    onSuccess: () => {
      toast.success(kind === "sale" ? "Receipt recorded — invoice closed" : "Payment recorded — invoice closed");
      setConfirm(null);
      setComment("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  const status: string = String(doc.status ?? doc.proforma_status ?? doc.approval_status ?? "").toLowerCase();
  const proformaStatus: string = String(doc.proforma_status ?? "").toLowerCase();
  const needsReview =
    status === "submitted" || status === "pending_review" || proformaStatus === "pending_review";
  const needsPay =
    ["approved", "funded", "advanced", "overdue"].includes(status) ||
    proformaStatus === "approved";
  const isSelfCreated =
    !isAdmin && doc.client_id && user?.id && doc.client_id === user.id;

  const btn =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50";

  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "rounded-lg border border-border bg-background/40 p-3"}>
      {!compact && (
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Checker / Treasury actions
        </div>
      )}

      {/* ── Review ── */}
      {needsReview && (
        <>
          {canReview ? (
            isSelfCreated ? (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground" title="Segregation of duties: you cannot review a document you created">
                <Lock className="h-3 w-3" /> Self-created
              </span>
            ) : (
              <>
                <button
                  disabled={review.isPending}
                  onClick={() => {
                    if (confirm === "approve") review.mutate({ decision: "approved" });
                    else setConfirm("approve");
                  }}
                  className={`${btn} border-success/50 text-success hover:bg-success/10`}
                >
                  {review.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {confirm === "approve" ? "Confirm approve" : "Approve"}
                </button>
                <button
                  disabled={review.isPending}
                  onClick={() => {
                    if (confirm === "reject")
                      review.mutate({ decision: kind === "purchase" ? "disputed" : "rejected" });
                    else setConfirm("reject");
                  }}
                  className={`${btn} border-destructive/50 text-destructive hover:bg-destructive/10`}
                >
                  <X className="h-3 w-3" />
                  {confirm === "reject" ? "Confirm reject" : kind === "purchase" ? "Dispute" : "Reject"}
                </button>
              </>
            )
          ) : (
            <button
              onClick={() => navigate({ to: "/app/checker", search: { review: `${checkerKind(kind)}:${doc.id}` } } as never)}
              className={`${btn} border-primary/50 text-primary hover:bg-primary/10`}
              title="Open in checker desk"
            >
              Review in checker →
            </button>
          )}
        </>
      )}

      {/* ── Pay / Fund ── */}
      {needsPay && (
        <>
          {canPay ? (
            kind === "proforma" ? (
              <button
                disabled={fund.isPending}
                onClick={() => {
                  if (confirm === "fund") fund.mutate();
                  else setConfirm("fund");
                }}
                className={`${btn} border-success/50 text-success hover:bg-success/10`}
              >
                {fund.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
                {confirm === "fund" ? "Confirm fund" : doc.side === "sales" ? "Mark received" : "Mark paid"}
              </button>
            ) : kind === "sale" || kind === "purchase" ? (
              <button
                disabled={pay.isPending}
                onClick={() => {
                  if (confirm === "pay") pay.mutate();
                  else setConfirm("pay");
                }}
                className={`${btn} ${kind === "sale" ? "border-success/50 text-success hover:bg-success/10" : "border-warning/50 text-warning hover:bg-warning/10"}`}
              >
                {pay.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : kind === "sale" ? (
                  <ArrowDownToLine className="h-3 w-3" />
                ) : (
                  <ArrowUpFromLine className="h-3 w-3" />
                )}
                {confirm === "pay" ? "Confirm" : kind === "sale" ? "Record receipt" : "Pay balance"}
              </button>
            ) : null
          ) : (
            <button
              onClick={() =>
                navigate({
                  to: "/app/queue",
                  search: { paymentFor: `${docKindForPayment(kind)}:${doc.id}`, fromQueue: "1" },
                } as never)
              }
              className={`${btn} border-primary/50 text-primary hover:bg-primary/10`}
              title="Open in funding queue"
            >
              Pay in queue →
            </button>
          )}
        </>
      )}

      {!needsReview && !needsPay && (
        <span className="text-[11px] text-muted-foreground">
          No pending action — {status || proformaStatus || "closed"}.
        </span>
      )}

      {/* Optional comment / reference input once a confirm step is armed.
          Invoice approve/reject carries no comment field — hide it there. */}
      {confirm && !((kind === "sale" || kind === "purchase") && (confirm === "approve" || confirm === "reject")) && (
        <div className="mt-2 flex w-full items-center gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              confirm === "fund" || confirm === "pay"
                ? "Reference / UTR (optional)"
                : "Review note (optional)"
            }
            className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-xs focus:border-primary focus:outline-none"
          />
          <button
            onClick={() => {
              setConfirm(null);
              setComment("");
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function checkerKind(kind: DocKind): string {
  switch (kind) {
    case "sales_order":
      return "sales_order";
    case "po":
      return "po";
    case "purchase":
      return "purchase";
    case "sale":
      return "sale";
    case "proforma":
      return "proforma";
    case "quotation":
      return "quotation";
    default:
      return "sale";
  }
}

function docKindForPayment(kind: DocKind): string {
  if (kind === "sale") return "sales_invoice";
  if (kind === "purchase") return "purchase_invoice";
  return "proforma";
}
