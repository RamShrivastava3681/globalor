import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/ledger-ui";
import { SectionCard } from "@/components/workbench";
import { Users, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/app/my-reports")({
  component: MyReportsPage,
});

const LINKS = [
  { tab: "portfolio", label: "Portfolio", hint: "Exposure and limits" },
  { tab: "aging", label: "Aging", hint: "Overdue buckets" },
  { tab: "profit-loss", label: "Profit & Loss", hint: "Income vs expense" },
];

function MyReportsPage() {
  return (
    <div>
      <PageHeader eyebrow="Reports" title={<span className="inline-flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> My Reports</span>} description="Saved views for reporting managers." />
      <SectionCard title="Saved reports" className="mt-4">
        <ul className="divide-y divide-border/60">
          {LINKS.map((l) => (
            <li key={l.label} className="flex items-center justify-between gap-2 py-2.5">
              <span><span className="block text-sm font-semibold">{l.label}</span><span className="block text-xs text-muted-foreground">{l.hint}</span></span>
              <Link to="/app/reports/$tab" params={{ tab: l.tab }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent">Open <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
