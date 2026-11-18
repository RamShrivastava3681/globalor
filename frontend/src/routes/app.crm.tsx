import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { SectionCard, TableSkeleton, EmptyState } from "@/components/workbench";
import { Users } from "lucide-react";

export const Route = createFileRoute("/app/crm")({
  component: CrmPage,
});

function CrmPage() {
  const q = useQuery({ queryKey: ["customers"], queryFn: async () => (await api.get<any[]>("/customers")) ?? [] });
  const rows = q.data ?? [];
  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title={<span className="inline-flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Leads</span>}
        description="Prospects and customer pipeline."
        actions={<Link to="/app/sales-workbench" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-hover">Sales Workbench</Link>}
      />
      <div className="mt-4">
        {q.isLoading ? <TableSkeleton rows={6} cols={4} /> : rows.length === 0 ? (
          <EmptyState icon={Users} title="No leads yet" hint="Add customers to start the pipeline." />
        ) : (
          <SectionCard title={`${rows.length} leads & customers`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Name</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Terms</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {rows.slice(0, 30).map((c: any) => (
                    <tr key={c.id}><td className="px-3 py-2 font-medium">{c.name}</td><td className="px-3 py-2 text-muted-foreground">{c.contact_name ?? "—"}</td><td className="px-3 py-2 text-muted-foreground">{c.payment_terms_days != null ? `Net ${c.payment_terms_days}` : "—"}</td></tr>
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
