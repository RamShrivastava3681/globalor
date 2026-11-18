import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Package, FileText, Paperclip, X } from "lucide-react";
import { DocActions, type DocKind } from "@/components/workflow/doc-actions";

function taskToDocKind(task: any): DocKind | null {
  const wt = String(task.workflow_type ?? "");
  const dt = String(task.doc_type ?? "");
  if (wt === "proforma" || dt === "proforma") return "proforma";
  if (wt === "sales_invoice" || dt === "sales_invoice") return "sale";
  if (wt === "purchase_invoice" || dt === "purchase_invoice") return "purchase";
  if (wt === "sales_order" || dt === "sales_order") return "sales_order";
  if (wt === "purchase_order" || dt === "purchase_order") return "po";
  return null;
}

type Task = any;

const docFetchers: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/goods-purchase-orders/${id}`,
  sales_order: (id) => `/goods-sales-orders/${id}`,
  proforma: (id) => `/purchase-orders/${id}`,
  purchase_invoice: (id) => `/purchase-invoices/${id}`,
  sales_invoice: (id) => `/invoices/${id}`,
  grn: (id) => `/goods-receipts/${id}`,
  dispatch: (id) => `/goods-dispatches/${id}`,
  payment: (id) => `/advances/${id}`,
};

export function TaskDetailDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const docType = task.doc_type;
  const docId = task.doc_id;
  const fetcher = docFetchers[docType];
  const docQ = useQuery({
    queryKey: ["task-doc", docType, docId],
    queryFn: async () => fetcher ? (await api.get<any>(fetcher(docId))) : null,
    enabled: !!fetcher && !!docId,
  });
  const doc: any = docQ.data;
  const lines: any[] = doc?.lines ?? doc?.items ?? [];
  const attachments: any[] = doc?.documents ?? doc?.attachments ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-primary">{task.workflow_type} · {task.stage}</div>
            <h3 className="font-mono text-sm font-semibold text-foreground">{task.doc_number ?? task.doc_id}</h3>
            <div className="text-xs text-muted-foreground">{task.counterparty ?? ""} · {task.required_action}</div>
          </div>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <Info label="Owner role" value={task.owner_role} />
            <Info label="Status" value={task.doc_status ?? task.status} />
            <Info label="Amount" value={task.amount != null ? fmtMoney(task.amount) : "—"} />
            <Info label="Due" value={task.due_date ? fmtDate(task.due_date) : "—"} />
            <Info label="Next" value={task.next_action ?? "—"} />
            <Info label="Priority" value={task.priority} />
          </div>
          {task.latest_update && <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs">{task.latest_update}</p>}
          {(() => {
            const kind = taskToDocKind(task);
            if (!kind || !doc) return null;
            return <DocActions kind={kind} doc={doc} onDone={onClose} />;
          })()}
          {task.linked_docs?.length > 0 && (
            <div className="text-xs"><span className="font-semibold">Linked:</span> {task.linked_docs.map((d: any) => `${d.type} ${d.number}`).join(" · ")}</div>
          )}
          {docQ.isLoading ? <div className="text-sm text-muted-foreground">Loading document…</div> : (
            <>
              {lines.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                    <tbody className="divide-y divide-border/60">
                      {lines.slice(0, 20).map((l: any, i: number) => (
                        <tr key={i}><td className="px-3 py-1.5">{l.name ?? l.item_name ?? "—"}</td><td className="px-3 py-1.5 font-mono text-[11px]">{l.sku ?? "—"}</td><td className="px-3 py-1.5 text-right">{l.ordered_qty ?? l.quantity ?? l.qty ?? "—"}</td><td className="px-3 py-1.5 text-right">{l.unit_price != null ? fmtMoney(l.unit_price) : "—"}</td><td className="px-3 py-1.5 text-right">{l.line_total != null ? fmtMoney(l.line_total) : "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Paperclip className="h-3.5 w-3.5" /> Attachments ({attachments.length})</div>
                {attachments.length === 0 ? <div className="text-xs text-muted-foreground">No attachments yet. Upload proof (UTR/IRN/e-invoice) in the action modal.</div> : (
                  <div className="space-y-1">
                    {attachments.map((a: any, i: number) => (
                      <a key={i} href={a.path ?? a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline"><FileText className="h-3 w-3" />{a.name ?? a.path ?? `Attachment ${i+1}`}{a.size ? ` · ${(a.size/1024).toFixed(1)} KB` : ""}</a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>; }
