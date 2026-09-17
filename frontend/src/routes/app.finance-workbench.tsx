import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { WorkbenchTabs, KpiCard, FilterPills, StatSkeleton, TableSkeleton, SectionCard } from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import { Wallet, BarChart3, Banknote, Send, ClipboardList, FileText, FileSignature, Truck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/app/finance-workbench")({
  component: FinanceWorkbenchPage,
});

const DocPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DocListPanel })));
const DispatchOrdersPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DispatchOrdersPanel })));
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
  const [section, setSection] = useState("workbench");
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
        counterparty: i.party ?? i.debtor_name ?? "—", value: Number(i.amount ?? 0), status: i.status,
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
        counterparty: a.party ?? a.debtor_name ?? a.supplier_name ?? "—", value: Number(a.amount ?? 0), status: a.status ?? "pending",
        nextStep: "Release advance", owner: "Treasury", dueDate: a.due_date ?? a.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: "/app/advances",
      })),
    ];
    return list
      .filter((w) => family === "all" || w.fam === family)
      .filter((w) => match([w.docNumber, w.counterparty, w.nextStep, w.status].join(" ")));
  }, [sinvs, pinvs, advs, family, query]);

  const cashPanel = (title: string, rows: any[], to: string) => (
    <SectionCard title={title} subtitle={`${rows.length} open`} action={<a href={to} className="text-xs font-semibold text-primary hover:underline">Open</a>}>
      {rows.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing open</p> : (
        <ul className="divide-y divide-border/60">{rows.slice(0, 8).map((r: any) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
            <span className="min-w-0 truncate font-mono">{r.invoice_number ?? r.advance_number ?? r.id.slice(0, 8)} <span className="text-muted-foreground">· {r.party ?? r.debtor_name ?? r.supplier_name ?? ""}</span></span>
            <span className="num shrink-0">{Number(r.amount ?? 0).toLocaleString()}</span>
          </li>))}
        </ul>
      )}
    </SectionCard>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title={<span className="inline-flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Finance Workbench</span>}
        description="Cash and treasury command — approvals, payments and overdue follow-up."
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
                {loading ? <TableSkeleton rows={6} cols={7} /> : <WorkItemsTable items={items} title="Finance work items" subtitle="Invoices and payments needing treasury action." />}
              </div>
              <SectionCard title="Overdue now" action={<button onClick={() => setSection("activity")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></button>}>
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
          <div className="grid gap-4 lg:grid-cols-2">
            {cashPanel("Advances in flight", advs, "/app/advances")}
            {cashPanel("Overdue invoices", [...sinvs, ...pinvs].filter((i: any) => i.status === "overdue"), "/app/queue")}
          </div>
        )}
        {section === "treasury" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Funding queue" url="/invoices" to="/app/queue" label="Queue" /></Suspense>
        )}
        {section === "bulk" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Bulk payments" url="/invoices" to="/app/bulk-payments" label="Bulk payments" /></Suspense>
        )}
        {section === "orders" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Sales orders" url="/goods-sales-orders" to="/app/sales-orders" label="Orders" numKey="so_number" partyKeys={["customer_name"]} amountKeys={["grand_total"]} /></Suspense>
        )}
        {section === "invoices" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Sales invoices" url="/invoices" to="/app/invoices" label="Invoices" /></Suspense>
        )}
        {section === "proforma" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Proforma invoices" url="/proformas" to="/app/proformas" label="Proformas" numKey="proforma_number" /></Suspense>
        )}
        {section === "advances" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Advances" url="/advances" to="/app/advances" label="Advances" numKey="advance_number" partyKeys={["party", "debtor_name", "supplier_name"]} /></Suspense>
        )}
        {section === "pinvoices" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DocPanel title="Purchase invoices" url="/purchase-invoices" to="/app/purchases" label="Invoices" partyKeys={["party", "supplier_name"]} /></Suspense>
        )}
        {section === "dispatch" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DispatchOrdersPanel /></Suspense>
        )}
        {section === "activity" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ActivityPanel items={items} title="Finance activity" /></Suspense>
        )}
      </div>
    </div>
  );
}
