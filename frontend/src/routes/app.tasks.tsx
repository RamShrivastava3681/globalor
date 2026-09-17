import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader, StatusPill, fmtMoney } from "@/components/ledger-ui";
import { TableSkeleton, EmptyState } from "@/components/workbench";
import { ListTodo } from "lucide-react";

export const Route = createFileRoute("/app/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const invQ = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get<any[]>("/invoices")) ?? [] });
  const pinvQ = useQuery({ queryKey: ["purchase_invoices"], queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [] });
  const loading = invQ.isLoading || pinvQ.isLoading;
  const rows = [
    ...((invQ.data ?? []).filter((i: any) => !["paid", "rejected"].includes(i.status)).map((i: any) => ({ id: `s-${i.id}`, n: i.invoice_number ?? "—", p: i.party ?? i.debtor_name ?? "—", a: Number(i.amount ?? 0), s: i.status, to: "/app/invoices" }))),
    ...((pinvQ.data ?? []).filter((i: any) => !["paid", "rejected"].includes(i.status)).map((i: any) => ({ id: `p-${i.id}`, n: i.invoice_number ?? "—", p: i.party ?? i.supplier_name ?? "—", a: Number(i.amount ?? 0), s: i.status, to: "/app/purchases" }))),
  ].slice(0, 50);

  return (
    <div>
      <PageHeader
        eyebrow="Work"
        title={<span className="inline-flex items-center gap-2"><ListTodo className="h-5 w-5 text-primary" /> My Queue</span>}
        description="Everything assigned to you, across sales, procurement, finance and warehouse."
        actions={<Link to="/app/queue" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-hover">Funding queue</Link>}
      />
      <div className="mt-4">
        {loading ? <TableSkeleton rows={6} cols={5} /> : rows.length === 0 ? (
          <EmptyState icon={ListTodo} title="You're all caught up" hint="No open tasks assigned to you." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Counterparty</th>
                  <th className="px-4 py-2.5 text-right">Value</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Open</th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((r) => (
                    <tr key={r.id}><td className="px-4 py-2.5 font-mono text-[13px]">{r.n}</td>
                      <td className="px-4 py-2.5">{r.p}</td><td className="px-4 py-2.5 text-right num">{fmtMoney(r.a)}</td>
                      <td className="px-4 py-2.5"><StatusPill status={r.s} /></td>
                      <td className="px-4 py-2.5 text-right"><Link to={r.to} className="text-xs font-semibold text-primary hover:underline">Open</Link></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
