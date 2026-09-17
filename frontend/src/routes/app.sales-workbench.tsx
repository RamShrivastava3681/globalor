import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { WorkbenchTabs, KpiCard, FilterPills, StatSkeleton, TableSkeleton, SectionCard } from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import { ShoppingBag, BarChart3, Users, ClipboardList, FileSignature, FileText, ScrollText, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/app/sales-workbench")({
  component: SalesWorkbenchPage,
});

const CustomersPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.CustomersPanel })));
const SalesOrdersPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.SalesOrdersPanel })));
const ProformaPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DocListPanel })));
const InvoicesPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DocListPanel })));
const CreditNotesPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DocListPanel })));
const ActivityPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.GenericActivityPanel })));

const TABS = [
  { id: "workbench", label: "Workbench", icon: BarChart3 },
  { id: "customers", label: "Customers", icon: Users },
  { id: "orders", label: "Sales Orders", icon: ClipboardList },
  { id: "proforma", label: "Proforma Invoices", icon: FileSignature },
  { id: "invoices", label: "Sales Invoices", icon: FileText },
  { id: "credit", label: "Credit Notes", icon: ScrollText },
  { id: "activity", label: "Activity History", icon: ClipboardList },
];

function SalesWorkbenchPage() {
  const [section, setSection] = useState("workbench");
  const [family, setFamily] = useState<"all" | "orders" | "proforma" | "invoices" | "credit">("all");
  const [query, setQuery] = useState("");

  const soQ = useQuery({ queryKey: ["goods_so"], queryFn: async () => (await api.get<any[]>("/goods-sales-orders")) ?? [] });
  const invQ = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get<any[]>("/invoices")) ?? [] });
  const proQ = useQuery({ queryKey: ["proformas"], queryFn: async () => (await api.get<any[]>("/proformas")) ?? [] });
  const advQ = useQuery({ queryKey: ["advances"], queryFn: async () => (await api.get<any[]>("/advances")) ?? [] });
  const cnQ = useQuery({ queryKey: ["credit-debit-notes"], queryFn: async () => (await api.get<any[]>("/credit-debit-notes")) ?? [] });

  const sos = soQ.data ?? [];
  const invs = invQ.data ?? [];
  const pros = proQ.data ?? [];
  const advs = advQ.data ?? [];
  const cns = (cnQ.data ?? []).filter((n: any) => (n.type ?? "credit") === "credit");
  const loading = soQ.isLoading || invQ.isLoading;

  const awaitingAcceptance = sos.filter((s: any) => s.status === "draft").length;
  const advancesPending = advs.filter((a: any) => ["pending", "unpaid", "partial"].includes(String(a.status ?? "pending"))).length;
  const invoicesApproval = invs.filter((i: any) => ["pending", "submitted", "pending_review"].includes(i.status)).length;
  const readyDispatch = sos.filter((s: any) => s.status === "confirmed").length;

  const items: WorkItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const list: (WorkItem & { fam: string })[] = [
      ...sos.filter((s: any) => ["draft", "confirmed"].includes(s.status)).map((s: any) => ({
        fam: "orders", id: `so-${s.id}`, docNumber: s.so_number, docKind: "Sales order",
        counterparty: s.customer_name ?? "—", value: Number(s.grand_total ?? 0), status: s.status,
        nextStep: s.status === "draft" ? "Send for customer acceptance" : "Confirm advance & dispatch",
        owner: "Sales", dueDate: s.expected_delivery_date ?? s.created_at, overdue: false,
        priority: "normal" as const, actionLabel: "Open", openTo: "/app/sales-orders",
      })),
      ...pros.map((p: any) => ({
        fam: "proforma", id: `pro-${p.id}`, docNumber: p.proforma_number ?? p.id.slice(0, 8), docKind: "Proforma",
        counterparty: p.party ?? p.debtor_name ?? "—", value: Number(p.amount ?? 0), status: p.status ?? "pending",
        nextStep: "Collect advance payment", owner: "Sales", dueDate: p.due_date ?? p.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: "/app/proformas",
      })),
      ...invs.filter((i: any) => i.status !== "paid").map((i: any) => ({
        fam: "invoices", id: `inv-${i.id}`, docNumber: i.invoice_number ?? i.id.slice(0, 8), docKind: "Sales invoice",
        counterparty: i.party ?? i.debtor_name ?? "—", value: Number(i.amount ?? 0), status: i.status,
        nextStep: "Submit for approval", owner: "Sales", dueDate: i.due_date ?? i.created_at,
        overdue: i.status === "overdue", priority: (i.status === "overdue" ? "high" : "normal") as WorkItem["priority"],
        actionLabel: "Open", openTo: "/app/invoices",
      })),
      ...cns.map((n: any) => ({
        fam: "credit", id: `cn-${n.id}`, docNumber: n.note_number ?? n.id.slice(0, 8), docKind: "Credit note",
        counterparty: n.party ?? "—", value: Number(n.amount ?? 0), status: n.status ?? "pending",
        nextStep: "Review credit note", owner: "Sales", dueDate: n.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: "/app/credit-debit-notes",
      })),
    ];
    return list
      .filter((w) => family === "all" || w.fam === family)
      .filter((w) => match([w.docNumber, w.counterparty, w.nextStep, w.status].join(" ")));
  }, [sos, pros, invs, cns, family, query]);

  const focus = useMemo(() => items.slice(0, 5), [items]);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title={<span className="inline-flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-primary" /> Sales Workbench</span>}
        description="Monitor the sales pipeline from acceptance to dispatch."
      />
      <div className="mt-4 space-y-5">
        <div className="overflow-x-auto">
          <WorkbenchTabs tabs={TABS} active={section} onChange={setSection} />
        </div>
        {section === "workbench" && (
          <div className="space-y-5">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Awaiting Customer Acceptance" value={awaitingAcceptance} sub="Draft orders to send" icon={ClipboardList} tone="attention" onClick={() => setFamily("orders")} />
                <KpiCard label="Advance Payments Pending" value={advancesPending} sub="Advances to collect" icon={FileSignature} tone="attention" onClick={() => setFamily("proforma")} />
                <KpiCard label="Invoices Awaiting Approval" value={invoicesApproval} sub="Needs approval" icon={FileText} onClick={() => setFamily("invoices")} />
                <KpiCard label="Ready for Dispatch" value={readyDispatch} sub="Confirmed orders" icon={ShoppingBag} tone="blue" onClick={() => setFamily("orders")} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterPills
                options={[{ id: "all", label: "All" }, { id: "orders", label: "Orders" }, { id: "proforma", label: "Proformas" }, { id: "invoices", label: "Invoices" }, { id: "credit", label: "Credit notes" }]}
                active={family}
                onChange={setFamily}
              />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search document, customer…" aria-label="Search sales work items" className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs" />
            </div>
            <div className="grid gap-6 lg:grid-cols-4">
              <div className="lg:col-span-3">
                {loading ? <TableSkeleton rows={6} cols={7} /> : <WorkItemsTable items={items} title="Sales work items" subtitle="Orders, proformas, invoices and credit notes needing action." />}
              </div>
              <SectionCard title="Needs attention" action={<button onClick={() => setSection("activity")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></button>}>
                {focus.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">All clear</p> : (
                  <ul className="space-y-3">{focus.map((w) => (
                    <li key={w.id} className="text-[13px]"><span className="block truncate font-medium">{w.counterparty}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{w.docNumber}</span></li>))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        )}
        {section === "customers" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><CustomersPanel /></Suspense>}
        {section === "orders" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><SalesOrdersPanel /></Suspense>}
        {section === "proforma" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ProformaPanel title="Proforma invoices" url="/proformas" to="/app/proformas" label="Proformas" numKey="proforma_number" /></Suspense>}
        {section === "invoices" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><InvoicesPanel title="Sales invoices" url="/invoices" to="/app/invoices" label="Invoices" /></Suspense>}
        {section === "credit" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><CreditNotesPanel title="Credit notes" url="/credit-debit-notes" to="/app/credit-debit-notes" label="Notes" numKey="note_number" /></Suspense>}
        {section === "activity" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ActivityPanel items={items} title="Sales activity" /></Suspense>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Sales-rep tools stay in the sidebar (<Link to="/app/crm" className="font-semibold text-primary hover:underline">Leads</Link> · <Link to="/app/naughty-list" className="font-semibold text-primary hover:underline">Naughty List</Link>).</p>
    </div>
  );
}
