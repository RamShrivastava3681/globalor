import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader, StatusPill, fmtMoney } from "@/components/ledger-ui";
import { SectionCard, TableSkeleton, EmptyState } from "@/components/workbench";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/app/naughty-list")({
  component: NaughtyListPage,
});

function NaughtyListPage() {
  const invQ = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get<any[]>("/invoices")) ?? [] });
  const rows = (invQ.data ?? []).filter((i: any) => i.status === "overdue");
  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title={<span className="inline-flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Naughty List</span>}
        description="Overdue accounts needing collection follow-up."
      />
      <div className="mt-4">
        {invQ.isLoading ? <TableSkeleton rows={6} cols={5} /> : rows.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nothing overdue" hint="All accounts are current." />
        ) : (
          <SectionCard title={`${rows.length} overdue invoices`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {rows.slice(0, 30).map((i: any) => (
                    <tr key={i.id}><td className="px-3 py-2 font-mono text-[13px]">{i.invoice_number}</td><td className="px-3 py-2">{i.party ?? i.debtor_name ?? "—"}</td><td className="px-3 py-2 text-right num">{fmtMoney(Number(i.amount ?? 0))}</td><td className="px-3 py-2"><StatusPill status={i.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
