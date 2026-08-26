import { createFileRoute, Link } from "@tanstack/react-router";
import { FilterBar } from "@/components/ui/filter-bar";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  Plus, X, Loader2, Trash2, Send, Pencil, Quote as QuoteIcon, Wallet, CheckCircle2, Undo2, BadgeCheck, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/quotations")({
  component: QuotationsPage,
});

type QLine = {
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  updated_unit_price: number | null;
  discount_type: "pct" | "amount" | "none";
  discount_value: number;
  gst_rate: number | null;
  notes?: string | null;
};

type Q = {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_id: string | null;
  prospect_name: string | null;
  customer_name: string | null;
  contact_person: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  salesperson_name: string | null;
  payment_terms: string | null;
  expected_delivery_date: string | null;
  notes: string | null;
  lines: QLine[];
  subtotal: number;
  total_discount: number;
  gst_total: number;
  freight: number | null;
  grand_total: number;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted_to_so";
  approval_status: "none" | "pending_review" | "approved" | "rejected";
  approval_comments: string | null;
  debtor_status: "pending" | "approved" | "rejected";
  debtor_comments: string | null;
  debtor_sent_at: string | null;
  converted_to_so_id: string | null;
  converted_to_so_number: string | null;
  created_at: string;
};

type DebtorOpt = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  registered_address: string | null;
  payment_terms_days: number | null;
};
type ProductOpt = { id: string; name: string; sku: string; unit_of_measure: string; unit_price: number; gst_rate: number | null; status: string };

const LIFE_META: Record<Q["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-warning/40 bg-warning/10 text-warning" },
  sent: { label: "Sent", cls: "border-primary/40 bg-primary/10 text-primary" },
  accepted: { label: "Accepted", cls: "border-success/40 bg-success/10 text-success" },
  rejected: { label: "Rejected", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  expired: { label: "Expired", cls: "border-border bg-muted text-muted-foreground" },
  converted_to_so: { label: "Converted to SO", cls: "border-info/40 bg-info/10 text-info" },
};

const APPROVAL_META: Record<Q["approval_status"], { label: string; cls: string }> = {
  none: { label: "No price review", cls: "border-border text-muted-foreground" },
  pending_review: { label: "Prices pending review", cls: "border-warning/40 bg-warning/10 text-warning" },
  approved: { label: "Prices approved", cls: "border-success/40 bg-success/10 text-success" },
  rejected: { label: "Prices rejected", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

const DEBTOR_META: Record<Q["debtor_status"], { label: string; cls: string }> = {
  pending: { label: "Debtor: not asked", cls: "border-border text-muted-foreground" },
  approved: { label: "Debtor approved", cls: "border-success/40 bg-success/10 text-success" },
  rejected: { label: "Debtor rejected", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60", "Advance", "COD", "LC"];
const GST_OPTIONS = ["0", "5", "12", "18", "28"];

function QuotationsPage() {
  const { user, isAdmin, canWrite } = useAuth();
  const canEdit = canWrite("quotations");
  const isApprover = isAdmin;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Q | null>(null);
  const [detail, setDetail] = useState<Q | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | Q["status"]>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const quotesQ = useQuery({
    queryKey: ["quotations"],
    queryFn: async () => (await api.get<Q[]>("/quotations")) ?? [],
  });

  const quotes = quotesQ.data ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotes
      .filter((qt) => {
        if (statusFilter !== "all" && qt.status !== statusFilter) return false;
        if (!q) return true;
        return (
          qt.quotation_number.toLowerCase().includes(q) ||
          (qt.customer_name ?? "").toLowerCase().includes(q) ||
          (qt.prospect_name ?? "").toLowerCase().includes(q) ||
          qt.lines.some((l) => l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const aVal = sortField === "date" ? (a.quotation_date ?? a.created_at ?? "") : String(a.grand_total);
        const bVal = sortField === "date" ? (b.quotation_date ?? b.created_at ?? "") : String(b.grand_total);
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === "asc" ? cmp : -cmp;
      });
  }, [quotes, statusFilter, searchQuery, sortField, sortOrder]);

  const stats = useMemo(() => ({
    total: quotes.length,
    open: quotes.filter((q) => q.status === "draft" || q.status === "sent").length,
    pendingReview: quotes.filter((q) => q.approval_status === "pending_review").length,
    converted: quotes.filter((q) => q.status === "converted_to_so").length,
  }), [quotes]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["quotations"] });

  const send = useMutation({
    mutationFn: async (id: string) => { await api.post(`/quotations/${id}/send`); },
    onSuccess: () => { invalidate(); toast.success("Quotation marked sent — customer notified"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const submit = useMutation({
    mutationFn: async (id: string) => { await api.post(`/quotations/${id}/submit`); },
    onSuccess: () => { invalidate(); toast.success("Prices submitted for checker review"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const review = useMutation({
    mutationFn: async ({ id, decision, comments }: { id: string; decision: "approved" | "rejected"; comments?: string }) => {
      await api.post(`/quotations/${id}/review`, { decision, comments: comments || null });
    },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["checker-quotations"] }); toast.success("Price review recorded"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const sendToDebtor = useMutation({
    mutationFn: async (id: string) => { await api.post(`/quotations/${id}/send-to-debtor`); },
    onSuccess: () => { invalidate(); toast.success("Secure approval link emailed to the debtor"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const convert = useMutation({
    mutationFn: async (id: string) => { await api.post(`/quotations/${id}/convert`); },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["goods_so"] });
      toast.success("Converted to a sales order — no stock impact");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/quotations/${id}`); },
    onSuccess: () => { invalidate(); toast.success("Draft removed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Quotations"
        description="An offer that never touches inventory or accounting. Send it, get the pricing checker-approved, optionally get the debtor's secure approval, then convert to a sales order."
        actions={
          canEdit ? (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New quotation
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Read-only</span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<QuoteIcon className="h-4 w-4 text-primary" />} label="Total quotations" value={String(stats.total)} />
          <StatTile icon={<Send className="h-4 w-4 text-warning" />} label="Open (draft/sent)" value={String(stats.open)} />
          <StatTile icon={<BadgeCheck className="h-4 w-4 text-info" />} label="Prices pending review" value={String(stats.pendingReview)} hint={stats.pendingReview > 0 ? "Awaiting the checker" : "None pending"} />
          <StatTile icon={<CheckCircle2 className="h-4 w-4 text-success" />} label="Converted to SO" value={String(stats.converted)} />
        </div>

        <FilterBar
          searchPlaceholder="Search by quotation number, customer, item…"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          statusOptions={[
            { label: "All statuses", value: "all" },
            { label: "Draft", value: "draft" },
            { label: "Sent", value: "sent" },
            { label: "Accepted", value: "accepted" },
            { label: "Expired", value: "expired" },
            { label: "Converted to SO", value: "converted_to_so" },
          ]}
          statusValue={statusFilter}
          onStatusChange={(v) => setStatusFilter(v as typeof statusFilter)}
          sortOptions={[
            { field: "date", label: "Date" },
            { field: "amount", label: "Amount" },
          ]}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={(f) => setSortField(f as typeof sortField)}
          onSortOrderChange={(o) => setSortOrder(o)}
        />

        <Card title="Quotations">
          {quotesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {quotes.length === 0 ? "No quotations yet. Create one to make an offer to a customer." : "No quotations match your filters."}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Quotation</th>
                    <th className="px-5 py-2 text-left font-normal">Customer</th>
                    <th className="px-5 py-2 text-right font-normal">Total</th>
                    <th className="px-5 py-2 text-left font-normal">Lifecycle</th>
                    <th className="px-5 py-2 text-left font-normal">Price review</th>
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-right font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((qt) => (
                    <tr key={qt.id} className={`border-b border-border/60 hover:bg-muted/30 ${qt.status === "expired" || qt.status === "rejected" ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3">
                        <button onClick={() => setDetail(qt)} className="font-mono text-xs text-primary hover:underline">{qt.quotation_number}</button>
                        <div className="text-[10px] text-muted-foreground">{fmtDate(qt.quotation_date)}{qt.valid_until ? ` · valid to ${fmtDate(qt.valid_until)}` : ""}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{qt.customer_name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{qt.contact_person ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 text-right num font-medium">{fmtMoney(qt.grand_total)}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${LIFE_META[qt.status].cls}`}>{LIFE_META[qt.status].label}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${APPROVAL_META[qt.approval_status].cls}`}>{APPROVAL_META[qt.approval_status].label}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${DEBTOR_META[qt.debtor_status].cls}`}>{DEBTOR_META[qt.debtor_status].label}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && qt.status === "draft" && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setEditing(qt)} title="Edit"
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => send.mutate(qt.id)} disabled={send.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
                              <Send className="h-3 w-3" /> Send
                            </button>
                            {qt.approval_status !== "approved" && qt.approval_status !== "pending_review" && (
                              <button onClick={() => submit.mutate(qt.id)} disabled={submit.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                                <BadgeCheck className="h-3 w-3" /> Submit prices
                              </button>
                            )}
                            <button onClick={() => { if (window.confirm(`Delete draft ${qt.quotation_number}?`)) remove.mutate(qt.id); }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        {qt.status === "sent" && canEdit && (
                          <div className="flex items-center justify-end gap-1.5">
                            {qt.approval_status !== "approved" && qt.approval_status !== "pending_review" && (
                              <button onClick={() => submit.mutate(qt.id)} disabled={submit.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                                <BadgeCheck className="h-3 w-3" /> Submit prices
                              </button>
                            )}
                            {qt.debtor_status !== "approved" && (
                              <button onClick={() => sendToDebtor.mutate(qt.id)} disabled={sendToDebtor.isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10">
                                <Undo2 className="h-3 w-3" /> Send to debtor
                              </button>
                            )}
                          </div>
                        )}
                        {(qt.status === "sent" || qt.status === "accepted") && qt.approval_status === "approved" && canEdit && (
                          <button onClick={() => { if (window.confirm(`Convert ${qt.quotation_number} to a sales order?`)) convert.mutate(qt.id); }} disabled={convert.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                            <ArrowRight className="h-3 w-3" /> Convert to SO
                          </button>
                        )}
                        {qt.status === "converted_to_so" && (
                          <Link to="/app/sales-orders" className="inline-flex items-center gap-1 rounded-md border border-info/40 px-2 py-1 text-[11px] text-info hover:bg-info/10">
                            <QuoteIcon className="h-3 w-3" /> {qt.converted_to_so_number}
                          </Link>
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

      {open && <QuotationModal onClose={() => setOpen(false)} />}
      {editing && <QuotationModal quote={editing} onClose={() => setEditing(null)} />}
      {detail && (
        <QuotationDetail
          q={detail}
          onClose={() => setDetail(null)}
          isApprover={isApprover}
          onReview={(decision, comments) => review.mutate({ id: detail.id, decision, comments })}
          reviewPending={review.isPending}
        />
      )}
    </div>
  );
}

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-2 font-display text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Pill({ meta }: { meta: { label: string; cls: string } }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.cls}`}>{meta.label}</span>;
}

// ── Detail modal ──

function QuotationDetail({ q, onClose, isApprover, onReview, reviewPending }: {
  q: Q; onClose: () => void; isApprover: boolean;
  onReview: (decision: "approved" | "rejected", comments?: string) => void; reviewPending: boolean;
}) {
  const [mode, setMode] = useState<null | "approved" | "rejected">(null);
  const [comments, setComments] = useState("");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <span className="font-mono text-primary">{q.quotation_number}</span>
            <span className="ml-2 align-middle"><Pill meta={LIFE_META[q.status]} /></span>
            <span className="ml-1 align-middle"><Pill meta={APPROVAL_META[q.approval_status]} /></span>
            <span className="ml-1 align-middle"><Pill meta={DEBTOR_META[q.debtor_status]} /></span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <Detail label="Customer">{q.customer_name ?? "—"}</Detail>
            <Detail label="Contact">{q.contact_person ?? "—"}</Detail>
            <Detail label="Salesperson">{q.salesperson_name ?? "—"}</Detail>
            <Detail label="Quotation date">{fmtDate(q.quotation_date)}</Detail>
            <Detail label="Valid until">{q.valid_until ? fmtDate(q.valid_until) : "—"}</Detail>
            <Detail label="Payment terms">{q.payment_terms ?? "—"}</Detail>
            <Detail label="Billing">{q.billing_address ?? "—"}</Detail>
            <Detail label="Delivery">{q.delivery_address ?? "—"}</Detail>
            <Detail label="Expected delivery">{q.expected_delivery_date ? fmtDate(q.expected_delivery_date) : "—"}</Detail>
          </div>
          {q.notes && <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{q.notes}</p>}
          {q.converted_to_so_number && (
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
              Converted to <Link to="/app/sales-orders" className="font-mono underline">{q.converted_to_so_number}</Link> — no stock impact; only a confirmed dispatch debits inventory.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Item</th>
                  <th className="px-3 py-2 text-left font-normal">SKU</th>
                  <th className="px-3 py-2 text-right font-normal">Qty</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-right font-normal">Disc</th>
                  <th className="px-3 py-2 text-right font-normal">GST</th>
                  <th className="px-3 py-2 text-right font-normal">Line total</th>
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l, i) => {
                  const eff = l.updated_unit_price ?? l.unit_price;
                  const gross = l.quantity * eff;
                  const discount = l.discount_type === "pct" ? gross * l.discount_value / 100 : l.discount_type === "amount" ? Math.min(l.discount_value, gross) : 0;
                  const lineTotal = gross - discount;
                  return (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{l.sku}</td>
                      <td className="px-3 py-2 text-right num">{l.quantity.toLocaleString()} <span className="text-[10px] text-muted-foreground">{l.unit}</span></td>
                      <td className="px-3 py-2 text-right num">
                        {eff.toLocaleString()}
                        {l.updated_unit_price != null && <div className="text-[9px] text-info line-through">{l.unit_price.toLocaleString()}</div>}
                      </td>
                      <td className="px-3 py-2 text-right num">
                        {l.discount_type === "none" ? "—" : l.discount_type === "pct" ? `${l.discount_value}%` : fmtMoney(l.discount_value)}
                      </td>
                      <td className="px-3 py-2 text-right num">{l.gst_rate != null ? `${l.gst_rate}%` : "—"}</td>
                      <td className="px-3 py-2 text-right num font-medium">{fmtMoney(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Subtotal</td><td className="px-3 py-2 text-right num">{fmtMoney(q.subtotal)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Discount</td><td className="px-3 py-2 text-right num">− {fmtMoney(q.total_discount)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">GST</td><td className="px-3 py-2 text-right num">{fmtMoney(q.gst_total)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Freight</td><td className="px-3 py-2 text-right num">{fmtMoney(q.freight ?? 0)}</td></tr>
                <tr><td colSpan={6} className="px-3 py-2 text-xs uppercase tracking-widest text-foreground">Grand total</td><td className="px-3 py-2 text-right num text-base">{fmtMoney(q.grand_total)}</td></tr>
              </tfoot>
            </table>
          </div>

          {(q.approval_comments || q.debtor_comments) && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {q.approval_comments && <p><span className="text-[10px] uppercase tracking-widest text-muted-foreground">Checker comments: </span>{q.approval_comments}</p>}
              {q.debtor_comments && <p><span className="text-[10px] uppercase tracking-widest text-muted-foreground">Debtor comments: </span>{q.debtor_comments}</p>}
            </div>
          )}

          {isApprover && q.approval_status === "pending_review" && !mode && (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3">
              <div className="text-xs uppercase tracking-widest text-info">Checker review — revised prices</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Approve to unlock conversion to a sales order, or reject with comments to reopen the lines.</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setMode("approved")} className="inline-flex items-center gap-1 rounded-md border border-success/40 px-3 py-1.5 text-xs text-success hover:bg-success/10">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve pricing
                </button>
                <button onClick={() => setMode("rejected")} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  <X className="h-3.5 w-3.5" /> Reject with comments
                </button>
              </div>
            </div>
          )}
          {isApprover && q.approval_status === "pending_review" && mode && (
            <div className="space-y-3 rounded-lg border border-info/30 bg-info/5 p-3">
              {mode === "rejected" && (
                <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Reason for rejection — the maker will revise the lines…"
                  className="w-full rounded-md border border-border bg-background p-3 text-sm" />
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setMode(null); setComments(""); }} className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                <button
                  disabled={reviewPending || (mode === "rejected" && !comments.trim())}
                  onClick={() => onReview(mode, comments.trim() || undefined)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
                  {reviewPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm {mode}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className="mt-0.5 font-medium">{children}</div></div>;
}

// ── Create / edit modal ──

type LineForm = {
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  unit_price: string;
  revised: string;
  discount_type: "pct" | "amount" | "none";
  discount_value: string;
  gst_rate: string;
};

function QuotationModal({ quote, onClose }: { quote?: Q; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!quote;
  const [form, setForm] = useState({
    customer_id: quote?.customer_id ?? "",
    prospect_name: quote?.prospect_name ?? "",
    contact_person: quote?.contact_person ?? "",
    billing_address: quote?.billing_address ?? "",
    delivery_address: quote?.delivery_address ?? "",
    salesperson_name: quote?.salesperson_name ?? "",
    payment_terms: quote?.payment_terms ?? "Net 30",
    valid_until: quote?.valid_until ?? "",
    expected_delivery_date: quote?.expected_delivery_date ?? "",
    freight: quote?.freight != null ? String(quote.freight) : "",
    notes: quote?.notes ?? "",
  });
  const [lines, setLines] = useState<LineForm[]>(
    quote
      ? quote.lines.map((l) => ({
          product_id: l.product_id ?? "",
          name: l.name,
          sku: l.sku,
          unit: l.unit,
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          revised: l.updated_unit_price != null ? String(l.updated_unit_price) : "",
          discount_type: l.discount_type,
          discount_value: String(l.discount_value),
          gst_rate: String(l.gst_rate ?? 0),
        }))
      : [{ product_id: "", name: "", sku: "", unit: "piece", quantity: "", unit_price: "", revised: "", discount_type: "none", discount_value: "", gst_rate: "0" }],
  );

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<ProductOpt[]>("/products")) ?? [],
  });
  const debtorsQ = useQuery({
    queryKey: ["debtor-options"],
    queryFn: async () => (await api.get<DebtorOpt[]>("/debtors")) ?? [],
  });

  const activeProducts = (productsQ.data ?? []).filter((p) => p.status === "active");
  const debtors = debtorsQ.data ?? [];

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = activeProducts.find((x) => x.id === productId);
    if (!p) {
      setLine(i, { product_id: "", name: "", sku: "", unit: "piece", unit_price: "" });
      return;
    }
    setLine(i, {
      product_id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit_of_measure,
      gst_rate: String(p.gst_rate ?? 0),
      unit_price: p.unit_price > 0 ? String(p.unit_price) : "",
    });
  };

  const pickCustomer = (id: string) => {
    const d = debtors.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      customer_id: id,
      prospect_name: "",
      contact_person: d?.contact_name ?? "",
      billing_address: d?.registered_address ?? "",
      delivery_address: d?.registered_address ?? "",
      payment_terms: d?.payment_terms_days ? `Net ${d.payment_terms_days}` : f.payment_terms,
    }));
  };

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, gst = 0;
    for (const l of lines) {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unit_price) || 0;
      const eff = l.revised.trim() !== "" ? Number(l.revised) : price;
      const gross = qty * eff;
      const disc = l.discount_type === "pct" ? gross * (Number(l.discount_value) || 0) / 100
        : l.discount_type === "amount" ? Math.min(Number(l.discount_value) || 0, gross) : 0;
      subtotal += gross;
      discount += disc;
      gst += (gross - disc) * (Number(l.gst_rate) || 0) / 100;
    }
    const freight = Number(form.freight) || 0;
    return { subtotal, discount, gst, freight, grand: subtotal - discount + gst + freight };
  }, [lines, form.freight]);

  const hasRevised = useMemo(() => lines.some((l) => l.revised.trim() !== ""), [lines]);

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one line");
      for (const l of lines) {
        if (!l.name.trim()) throw new Error("Every line needs a product or item name");
        if (!l.quantity || Number(l.quantity) <= 0) throw new Error("Quantity must be > 0 on every line");
        if (Number(l.unit_price) < 0) throw new Error("Unit price must be >= 0");
      }
      const payload = {
        customer_id: form.customer_id || null,
        prospect_name: form.prospect_name || null,
        contact_person: form.contact_person || null,
        billing_address: form.billing_address || null,
        delivery_address: form.delivery_address || null,
        salesperson_name: form.salesperson_name || null,
        payment_terms: form.payment_terms || null,
        valid_until: form.valid_until || null,
        expected_delivery_date: form.expected_delivery_date || null,
        freight: form.freight.trim() === "" ? null : Number(form.freight),
        notes: form.notes || null,
        lines: lines.map((l) => ({
          product_id: l.product_id || null,
          name: l.name.trim(),
          sku: l.sku.trim() || null,
          unit: l.unit.trim() || "unit",
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
          updated_unit_price: l.revised.trim() === "" ? null : Number(l.revised),
          discount_type: l.discount_type,
          discount_value: Number(l.discount_value) || 0,
          gst_rate: Number(l.gst_rate),
        })),
      };
      if (editing) await api.patch(`/quotations/${quote!.id}`, payload);
      else await api.post("/quotations", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success(editing ? "Quotation updated" : "Quotation created");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? `Edit ${quote!.quotation_number}` : "New quotation"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          <Section title="Customer & offer">
            <div className="grid gap-3 md:grid-cols-3">
              <L label="Customer (debtor)" full>
                <select className="inp" value={form.customer_id} onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">— free-text prospect —</option>
                  {debtors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </L>
              {!form.customer_id && (
                <L label="Prospect name"><input className="inp" value={form.prospect_name} onChange={(e) => setForm({ ...form, prospect_name: e.target.value })} /></L>
              )}
              <L label="Contact person"><input className="inp" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></L>
              <L label="Valid until"><input type="date" className="inp" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></L>
              <L label="Payment terms">
                <select className="inp" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
                  {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </L>
              <L label="Salesperson"><input className="inp" value={form.salesperson_name} onChange={(e) => setForm({ ...form, salesperson_name: e.target.value })} /></L>
              <L label="Expected delivery"><input type="date" className="inp" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} /></L>
              <L label="Freight"><input type="text" inputMode="decimal" className="inp num" value={form.freight} onChange={(e) => setForm({ ...form, freight: e.target.value })} /></L>
              <L label="Billing address" full><input className="inp" value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></L>
              <L label="Delivery address" full><input className="inp" value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} /></L>
            </div>
          </Section>

          <Section title="Lines — snapshot from the catalogue">
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <select className="inp" value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">Pick product…</option>
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <input className="inp" placeholder="Item name (free text)" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Price" title="Original offered price" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Revise" title="Revised price — requires checker approval" value={l.revised} onChange={(e) => setLine(i, { revised: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <select className="inp" value={l.discount_type} onChange={(e) => setLine(i, { discount_type: e.target.value as LineForm["discount_type"] })}>
                      <option value="none">No disc</option>
                      <option value="pct">% disc</option>
                      <option value="amount">$ disc</option>
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <input className="inp num" placeholder="Disc" value={l.discount_value} onChange={(e) => setLine(i, { discount_value: e.target.value })} />
                  </div>
                  <div className="flex items-center justify-end sm:col-span-1">
                    <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="text-[9px] text-muted-foreground sm:col-span-11">
                    {l.product_id ? `${l.sku} · ${l.unit} · offered ${fmtMoney(Number(l.unit_price) || 0)}` : "Free-text line — pick a product to auto-fill the selling price"}
                    {l.revised.trim() !== "" && <span className="text-info"> · revised {fmtMoney(Number(l.revised))} (needs checker approval)</span>}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLines((ls) => [...ls, { product_id: "", name: "", sku: "", unit: "piece", quantity: "", unit_price: "", revised: "", discount_type: "none", discount_value: "", gst_rate: "0" }])}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/5">
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </Section>

          {hasRevised && (
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-info">
              Revised prices will require checker approval before this quotation can be converted to a sales order.
            </p>
          )}

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              Gross <span className="num">{fmtMoney(totals.subtotal)}</span> · Discount <span className="num">− {fmtMoney(totals.discount)}</span> · GST <span className="num">{fmtMoney(totals.gst)}</span> · Freight <span className="num">{fmtMoney(totals.freight)}</span>
            </div>
            <div className="font-display text-lg">{fmtMoney(totals.grand)}</div>
          </div>
          <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> A quotation is an offer — it never touches inventory or accounting. Only a confirmed dispatch debits stock.
          </p>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              {editing ? "Save changes" : "Create quotation"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-2 text-xs uppercase tracking-widest text-primary">{title}</div>{children}</div>;
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "md:col-span-3" : ""}`}><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}
