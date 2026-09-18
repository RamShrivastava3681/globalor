import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { WorkbenchTabs, KpiCard, FilterPills, StatSkeleton, TableSkeleton, SectionCard } from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import { Wallet, BarChart3, Banknote, Send, ClipboardList, FileText, FileSignature, Truck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/app/finance-workbench")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: typeof search?.section === "string" ? (search.section as string) : undefined,
  }),
  component: FinanceWorkbenchPage,
});

const CashCommandPanel = lazy(() => import("@/components/cash-command").then((m) => ({ default: m.CashCommand })));

// Sub-tab pages embedded below via lazy loader — no redirect links.
const QueueEmbedded = lazy(() => import("@/routes/app.queue").then((m) => ({ default: m.QueuePage })));
const BulkPaymentsEmbedded = lazy(() => import("@/routes/app.bulk-payments").then((m) => ({ default: m.BulkPaymentsPage })));
const SalesOrdersEmbedded = lazy(() => import("@/routes/app.sales-orders").then((m) => ({ default: m.SalesOrdersPage })));
const InvoicesEmbedded = lazy(() => import("@/routes/app.invoices").then((m) => ({ default: () => <m.InvoicesPage embedded /> })));
const ProformasEmbedded = lazy(() => import("@/routes/app.proformas").then((m) => ({ default: () => <m.ProformasPage embedded /> })));
const AdvancesEmbedded = lazy(() => import("@/routes/app.advances").then((m) => ({ default: m.AdvancesPage })));
const PurchasesEmbedded = lazy(() => import("@/routes/app.purchases").then((m) => ({ default: () => <m.PurchasesPage embedded /> })));
const DispatchesEmbedded = lazy(() => import("@/routes/app.dispatches").then((m) => ({ default: () => <m.DispatchesPage embedded /> })));
const ActivityPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.GenericActivityPanel })));

const TABS = [
  { id: "workbench", label: "Workbench", icon: BarChart3 },
  { id: "cash", label: "Cash Command", icon: Banknote },
  { id: "treasury", label: "Treasury", icon: Wallet },
  { id: "bulk", label: "Bulk Payments", icon: Send },
  { id: "orders", label: "Sales Orders", icon: ClipboardList },
  { id: "invoices", label: "Sales Invoices", icon: FileText },
  { id: "proforma", label: "Proforma Invoices", icon: FileSignature },
  { id: "advances", label: "Advances", icon: Banknote },
  { id: "pinvoices", label: "Purchase Invoices", icon: FileText },
  { id: "dispatch", label: "Dispatch Orders", icon: Truck },
  { id: "activity", label: "Activity History", icon: ClipboardList },
];

function FinanceWorkbenchPage() {
  const navigate = useNavigate();
  const { section: sectionParam } = Route.useSearch();
  const [section, setSection] = useState(sectionParam ?? "workbench");
  useEffect(() => {
    if (sectionParam) setSection(sectionParam);
  }, [sectionParam]);
  const changeSection = (s: string) => {
    setSection(s);
    navigate({ to: "/app/finance-workbench", search: { section: s }, replace: true });
  };
  // Row actions open the matching sub-tab page below instead of redirecting away.
  const SECTION_BY_ROUTE: Record<string, string> = {
    "/app/queue": "treasury",
    "/app/bulk-payments": "bulk",
    "/app/sales-orders": "orders",
    "/app/invoices": "invoices",
    "/app/proformas": "proforma",
    "/app/advances": "advances",
    "/app/purchases": "pinvoices",
    "/app/dispatches": "dispatch",
  };
  const openItemBelow = (w: WorkItem) => {
    const s = w.openTo ? SECTION_BY_ROUTE[w.openTo] : undefined;
    if (s) changeSection(s);
  };
  const [family, setFamily] = useState<"all" | "sales" | "purchase" | "payments">("all");
  const [query, setQuery] = useState("");

  const sinvQ = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get<any[]>("/invoices")) ?? [] });
  const pinvQ = useQuery({ queryKey: ["purchase_invoices"], queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [] });
  const advQ = useQuery({ queryKey: ["advances"], queryFn: async () => (await api.get<any[]>("/advances")) ?? [] });

  const sinvs = sinvQ.data ?? [];
  const pinvs = pinvQ.data ?? [];
  const advs = advQ.data ?? [];
  const loading = sinvQ.isLoading || pinvQ.isLoading;

  const salesApproval = sinvs.filter((i: any) => ["pending", "submitted", "pending_review"].includes(i.status)).length;
  const purchasePending = pinvs.filter((i: any) => !["paid", "rejected"].includes(i.status)).length;
  const openPayments = advs.filter((a: any) => !["paid", "settled", "closed"].includes(String(a.status ?? ""))).length;
  const overdue = [...sinvs, ...pinvs].filter((i: any) => i.status === "overdue").length;

  const items: WorkItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const list: (WorkItem & { fam: string })[] = [
      ...sinvs.filter((i: any) => !["paid", "rejected"].includes(i.status)).map((i: any) => ({
        fam: "sales", id: `si-${i.id}`, docNumber: i.invoice_number ?? i.id.slice(0, 8), docKind: "Sales invoice",
        counterparty: i.party ?? i.customer_name ?? "—", value: Number(i.amount ?? 0), status: i.status,
        nextStep: "Approve and fund", owner: "Treasury", dueDate: i.due_date ?? i.created_at,
        overdue: i.status === "overdue", priority: (i.status === "overdue" ? "high" : "normal") as WorkItem["priority"],
        actionLabel: "Open", openTo: "/app/invoices",
      })),
      ...pinvs.filter((i: any) => !["paid", "rejected"].includes(i.status)).map((i: any) => ({
        fam: "purchase", id: `pi-${i.id}`, docNumber: i.invoice_number ?? i.id.slice(0, 8), docKind: "Purchase invoice",
        counterparty: i.party ?? i.supplier_name ?? "—", value: Number(i.amount ?? 0), status: i.status,
        nextStep: "Approve supplier payment", owner: "Treasury", dueDate: i.due_date ?? i.created_at,
        overdue: i.status === "overdue", priority: (i.status === "overdue" ? "high" : "normal") as WorkItem["priority"],
        actionLabel: "Open", openTo: "/app/purchases",
      })),
      ...advs.filter((a: any) => !["paid", "settled", "closed"].includes(String(a.status ?? ""))).map((a: any) => ({
        fam: "payments", id: `ad-${a.id}`, docNumber: a.advance_number ?? a.id.slice(0, 8), docKind: "Advance",
        counterparty: a.party ?? a.customer_name ?? a.supplier_name ?? "—", value: Number(a.amount ?? 0), status: a.status ?? "pending",
        nextStep: "Release advance", owner: "Treasury", dueDate: a.due_date ?? a.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: "/app/advances",
      })),
    ];
    return list
      .filter((w) => family === "all" || w.fam === family)
      .filter((w) => match([w.docNumber, w.counterparty, w.nextStep, w.status].join(" ")));
  }, [sinvs, pinvs, advs, family, query]);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title={<span className="inline-flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Finance Workbench</span>}
        description="Cash and treasury command — approvals, payments and overdue follow-up."
      />
      <div className="mt-4 space-y-5">
        <div className="overflow-x-auto">
          <WorkbenchTabs tabs={TABS} active={section} onChange={changeSection} />
        </div>
        {section === "workbench" && (
          <div className="space-y-5">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Sales Invoices Awaiting Approval" value={salesApproval} sub="Needs treasury sign-off" icon={FileText} tone="attention" onClick={() => setFamily("sales")} />
                <KpiCard label="Purchase Invoices Pending" value={purchasePending} sub="Awaiting approval / payment" icon={FileText} onClick={() => setFamily("purchase")} />
                <KpiCard label="Open Payments" value={openPayments} sub="Advances in flight" icon={Banknote} tone="blue" onClick={() => setFamily("payments")} />
                <KpiCard label="Overdue Invoices" value={overdue} sub="Needs follow-up" icon={Wallet} tone="attention" onClick={() => setFamily("all")} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterPills
                options={[{ id: "all", label: "All" }, { id: "sales", label: "Sales" }, { id: "purchase", label: "Purchase" }, { id: "payments", label: "Payments" }]}
                active={family}
                onChange={setFamily}
              />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search document, customer…" aria-label="Search finance work items" className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs" />
            </div>
            <div className="grid gap-6 lg:grid-cols-4">
              <div className="lg:col-span-3">
                {loading ? <TableSkeleton rows={6} cols={7} /> : <WorkItemsTable items={items} title="Finance work items" subtitle="Invoices and payments needing treasury action." onAction={openItemBelow} />}
              </div>
              <SectionCard title="Overdue now" action={<button onClick={() => changeSection("activity")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></button>}>
                {overdue === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing overdue</p> : (
                  <ul className="space-y-3">{items.filter((w) => w.overdue).slice(0, 5).map((w) => (
                    <li key={w.id} className="text-[13px]"><span className="block truncate font-medium">{w.counterparty}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{w.docNumber}</span></li>))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        )}
        {section === "cash" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}>
            <CashCommandPanel />
          </Suspense>
        )}
        {section === "treasury" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><QueueEmbedded /></Suspense>
        )}
        {section === "bulk" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><BulkPaymentsEmbedded /></Suspense>
        )}
        {section === "orders" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><SalesOrdersEmbedded /></Suspense>
        )}
        {section === "invoices" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><InvoicesEmbedded /></Suspense>
        )}
        {section === "proforma" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ProformasEmbedded /></Suspense>
        )}
        {section === "advances" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><AdvancesEmbedded /></Suspense>
        )}
        {section === "pinvoices" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><PurchasesEmbedded /></Suspense>
        )}
        {section === "dispatch" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DispatchesEmbedded /></Suspense>
        )}
        {section === "activity" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ActivityPanel items={items} title="Finance activity" onAction={openItemBelow} /></Suspense>
        )}
      </div>
    </div>
  );
}
