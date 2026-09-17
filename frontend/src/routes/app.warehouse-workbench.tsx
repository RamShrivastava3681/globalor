import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import {
  WorkbenchTabs, KpiCard, FilterPills, StatSkeleton, TableSkeleton, SectionCard, FooterBanner,
} from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import { WarehousePanel } from "@/components/warehouse-panel";
import {
  Warehouse, ClipboardList, PackageCheck, Truck, FileText, BarChart3,
  Boxes, ClipboardCheck, CalendarClock, ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/app/warehouse-workbench")({
  component: WarehouseWorkbenchPage,
});

const ForecastPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.ForecastPanel })));
const GrnPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.GrnPanel })));
const DispatchPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.DispatchPanel })));
const StockAllocationPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.StockAllocationPanel })));
const SamplesPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.SamplesPanel })));
const ActivityPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.WarehouseActivityPanel })));

const TABS = [
  { id: "workbench", label: "Workbench", icon: BarChart3 },
  { id: "warehouse", label: "Warehouse", icon: Warehouse },
  { id: "forecast", label: "Forecast", icon: CalendarClock },
  { id: "grn", label: "GRN", icon: PackageCheck },
  { id: "dispatch", label: "Dispatch", icon: Truck },
  { id: "allocation", label: "Stock Allocation", icon: Boxes },
  { id: "samples", label: "Samples", icon: ClipboardCheck },
  { id: "activity", label: "Activity History", icon: ClipboardList },
];

function WarehouseWorkbenchPage() {
  const [section, setSection] = useState("workbench");
  const [filter, setFilter] = useState<"all" | "grn" | "dispatch">("all");
  const [query, setQuery] = useState("");

  const sosQ = useQuery({ queryKey: ["goods_so"], queryFn: async () => (await api.get<any[]>("/goods-sales-orders")) ?? [] });
  const grnsQ = useQuery({ queryKey: ["goods_grn"], queryFn: async () => (await api.get<any[]>("/goods-receipts")) ?? [] });
  const dspsQ = useQuery({ queryKey: ["goods_dsp"], queryFn: async () => (await api.get<any[]>("/goods-dispatches")) ?? [] });

  const sos = sosQ.data ?? [];
  const grns = grnsQ.data ?? [];
  const dsps = dspsQ.data ?? [];
  const loading = sosQ.isLoading || grnsQ.isLoading || dspsQ.isLoading;

  const soAwaiting = sos.filter((s: any) => ["draft", "confirmed"].includes(s.status)).length;
  const grnPending = grns.filter((g: any) => ["draft", "pending"].includes(g.status)).length;
  const dspActive = dsps.filter((d: any) => !["delivered", "cancelled", "returned"].includes(d.status)).length;

  const items: WorkItem[] = useMemo(() => {
    const grnItems: WorkItem[] = grns
      .filter((g: any) => ["draft", "pending"].includes(g.status))
      .map((g: any) => ({
        id: `grn-${g.id}`, docNumber: g.receipt_number ?? g.id.slice(0, 8), docKind: "Goods receipt",
        counterparty: g.supplier_name ?? "—", value: Number(g.total_value ?? 0),
        status: g.status, nextStep: "Record GRN and confirm receipt", owner: "Warehouse",
        dueDate: g.received_date ?? g.created_at, overdue: false, priority: "normal" as const,
        actionLabel: "Record GRN", openTo: "/app/goods-receipts",
      }));
    const dspItems: WorkItem[] = dsps
      .filter((d: any) => !["delivered", "cancelled", "returned"].includes(d.status))
      .map((d: any) => ({
        id: `dsp-${d.id}`, docNumber: d.dispatch_number ?? d.id.slice(0, 8), docKind: "Dispatch",
        counterparty: d.customer_name ?? d.so_number ?? "—", value: 0,
        status: d.status, nextStep: d.status === "draft" ? "Pick & pack, then dispatch" : "Follow up delivery",
        owner: "Warehouse", dueDate: d.dispatch_date ?? d.created_at, overdue: false,
        priority: "normal" as const, actionLabel: d.status === "draft" ? "Pick & Pack" : "Open",
        openTo: "/app/dispatches",
      }));
    let all = [...grnItems, ...dspItems];
    if (filter === "grn") all = grnItems;
    if (filter === "dispatch") all = dspItems;
    const q = query.trim().toLowerCase();
    if (q) {
      all = all.filter((w) => [w.docNumber, w.counterparty, w.nextStep, w.status].join(" ").toLowerCase().includes(q));
    }
    return all;
  }, [grns, dsps, filter, query]);

  const signOffs = useMemo(
    () => sos.filter((s: any) => ["draft", "confirmed"].includes(s.status)).slice(0, 5),
    [sos],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse"
        title={<span className="inline-flex items-center gap-2"><Warehouse className="h-5 w-5 text-primary" /> Warehouse Control</span>}
        description="Monitor inbound receipts, outbound dispatches, stock levels and forecasts."
      />
      <div className="mt-4 space-y-5">
        <div className="overflow-x-auto">
          <WorkbenchTabs tabs={TABS} active={section} onChange={(id) => { setSection(id); }} />
        </div>

        {section === "workbench" && (
          <div className="space-y-5">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="SOs Awaiting Warehouse" value={soAwaiting} sub="Needs sign-off or hold review" icon={ClipboardList} tone="attention" onClick={() => setSection("warehouse")} />
                <KpiCard label="GRNs Pending" value={grnPending} sub="Awaiting goods receipt" icon={PackageCheck} tone="attention" onClick={() => setFilter("grn")} />
                <KpiCard label="Dispatches In Pipeline" value={dspActive} sub="Picking through in-transit" icon={Truck} tone="blue" onClick={() => setFilter("dispatch")} />
                <KpiCard label="Open Work Items" value={grnPending + dspActive} sub="GRN + dispatch tasks" icon={FileText} onClick={() => setFilter("all")} />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterPills
                options={[{ id: "all", label: "All" }, { id: "grn", label: "GRNs" }, { id: "dispatch", label: "Dispatches" }]}
                active={filter}
                onChange={(id) => setFilter(id)}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search document, customer…"
                aria-label="Search work items"
                className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-4">
              <div className="lg:col-span-3">
                {loading ? <TableSkeleton rows={6} cols={7} /> : (
                  <WorkItemsTable
                    items={items}
                    title="Warehouse work items"
                    subtitle="GRNs and dispatches that need action before the next step."
                    viewAllTo="/app/warehouse-workbench"
                  />
                )}
              </div>
              <SectionCard
                title="Needs warehouse sign-off"
                action={<button onClick={() => setSection("warehouse")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Review <ArrowRight className="h-3 w-3" /></button>}
              >
                {signOffs.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">No pending sign-offs</p>
                ) : (
                  <ul className="space-y-3">
                    {signOffs.map((s: any) => (
                      <li key={s.id} className="text-[13px]">
                        <span className="block truncate font-medium">{s.customer_name ?? "—"}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{s.so_number} · {s.expected_dispatch_date ?? s.order_date ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        )}

        {section === "warehouse" && <WarehousePanel />}

        {section === "forecast" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ForecastPanel /></Suspense>
        )}
        {section === "grn" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><GrnPanel /></Suspense>
        )}
        {section === "dispatch" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><DispatchPanel /></Suspense>
        )}
        {section === "allocation" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><StockAllocationPanel /></Suspense>
        )}
        {section === "samples" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><SamplesPanel /></Suspense>
        )}
        {section === "activity" && (
          <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ActivityPanel items={items} /></Suspense>
        )}
      </div>
      <FooterBanner>
        <span>Warehouse approval sends orders to the Checker · <Link to="/app/dispatches" search={{ so: undefined }} className="font-semibold text-primary hover:underline">open Dispatches</Link> · <Link to="/app/goods-receipts" search={{ po: undefined }} className="font-semibold text-primary hover:underline">open GRNs</Link> · <Link to="/app/inventory" className="font-semibold text-primary hover:underline">full inventory history</Link></span>
      </FooterBanner>
    </div>
  );
}
