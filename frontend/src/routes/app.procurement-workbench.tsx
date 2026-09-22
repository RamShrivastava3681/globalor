import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ledger-ui";
import { WorkbenchTabs, KpiCard, FilterPills, StatSkeleton, TableSkeleton, SectionCard } from "@/components/workbench";
import type { WorkItem } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import { ShoppingCart, BarChart3, Users, ClipboardList, FileSignature, FileText, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/app/procurement-workbench")({
  component: ProcurementWorkbenchPage,
});

const SuppliersEmbedded = lazy(() => import("@/routes/app.suppliers").then((m) => ({ default: m.SuppliersPage })));
const PurchaseOrdersEmbedded = lazy(() => import("@/routes/app.purchase-orders").then((m) => ({ default: m.PurchaseOrdersPage })));
const ProformasEmbedded = lazy(() => import("@/routes/app.proformas").then((m) => ({ default: () => <m.ProformasPage embedded /> })));
const PurchasesEmbedded = lazy(() => import("@/routes/app.purchases").then((m) => ({ default: () => <m.PurchasesPage embedded /> })));
const GrnEmbedded = lazy(() => import("@/routes/app.goods-receipts").then((m) => ({ default: () => <m.GoodsReceiptsPage embedded /> })));
const ActivityPanel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.GenericActivityPanel })));

const TABS = [
  { id: "workbench", label: "Workbench", icon: BarChart3 },
  { id: "suppliers", label: "Suppliers", icon: Users },
  { id: "orders", label: "Purchase Orders", icon: ClipboardList },
  { id: "proforma", label: "Purchase Proforma", icon: FileSignature },
  { id: "invoices", label: "Purchase Invoices", icon: FileText },
  { id: "grn", label: "GRN", icon: ClipboardList },
  { id: "activity", label: "Activity History", icon: ClipboardList },
];

function ProcurementWorkbenchPage() {
  const [section, setSection] = useState("workbench");
  const [family, setFamily] = useState<"all" | "orders" | "proforma" | "invoices" | "grn">("all");
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("all");

  const poQ = useQuery({ queryKey: ["goods_po"], queryFn: async () => (await api.get<any[]>("/goods-purchase-orders")) ?? [] });
  const pinvQ = useQuery({ queryKey: ["purchase_invoices"], queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [] });
  const grnQ = useQuery({ queryKey: ["goods_grn"], queryFn: async () => (await api.get<any[]>("/goods-receipts")) ?? [] });
  const venQ = useQuery({ queryKey: ["vendors"], queryFn: async () => (await api.get<any[]>("/vendors")) ?? [] });

  const pos = poQ.data ?? [];
  const pinvs = pinvQ.data ?? [];
  const grns = grnQ.data ?? [];
  const vendors = venQ.data ?? [];
  const loading = poQ.isLoading || pinvQ.isLoading;

  const poApproval = pos.filter((p: any) => ["draft", "pending", "sent"].includes(p.status)).length;
  const invPending = pinvs.filter((p: any) => !["paid", "rejected"].includes(p.status)).length;
  const dueWeek = pos.filter((p: any) => {
    if (!p.expected_date) return false;
    const d = (new Date(p.expected_date).getTime() - Date.now()) / 86400000;
    return d >= 0 && d <= 7;
  }).length;
  const grnPending = grns.filter((g: any) => ["draft", "pending"].includes(g.status)).length;

  const items: WorkItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const supOk = (name: string) => supplier === "all" || name === supplier;
    const list: (WorkItem & { fam: string })[] = [
      ...pos.filter((p: any) => !["cancelled"].includes(p.status)).map((p: any) => ({
        fam: "orders", id: `po-${p.id}`, docNumber: p.po_number ?? p.id.slice(0, 8), docKind: "Purchase order",
        counterparty: p.supplier_name ?? "—", value: Number(p.grand_total ?? p.total ?? 0), status: p.status ?? "draft",
        nextStep: p.status === "draft" ? "Send to checker" : p.status === "pending_approval" ? "Awaiting checker approval" : "Receive goods",
        owner: p.status === "pending_approval" ? "Checker" : "Procurement", dueDate: p.expected_date ?? p.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: p.status === "pending_approval" ? "/app/checker" : "/app/purchase-orders",
      })),
      ...pinvs.filter((p: any) => !["paid", "rejected"].includes(p.status)).map((p: any) => ({
        fam: "invoices", id: `pi-${p.id}`, docNumber: p.invoice_number ?? p.id.slice(0, 8), docKind: "Purchase invoice",
        counterparty: p.party ?? p.supplier_name ?? "—", value: Number(p.amount ?? 0), status: p.status ?? "pending",
        nextStep: "Submit for approval", owner: "Procurement", dueDate: p.due_date ?? p.created_at,
        overdue: p.status === "overdue", priority: "normal" as const, actionLabel: "Open", openTo: "/app/purchases",
      })),
      ...grns.filter((g: any) => ["draft", "pending"].includes(g.status)).map((g: any) => ({
        fam: "grn", id: `grn-${g.id}`, docNumber: g.receipt_number ?? g.id.slice(0, 8), docKind: "Goods receipt",
        counterparty: g.supplier_name ?? "—", value: 0, status: g.status,
        nextStep: "Record GRN", owner: "Warehouse", dueDate: g.received_date ?? g.created_at,
        overdue: false, priority: "normal" as const, actionLabel: "Open", openTo: "/app/goods-receipts",
      })),
    ];
    return list
      .filter((w) => family === "all" || w.fam === family)
      .filter((w) => supOk(w.counterparty))
      .filter((w) => match([w.docNumber, w.counterparty, w.nextStep, w.status].join(" ")));
  }, [pos, pinvs, grns, family, query, supplier]);

  // Row actions open the matching sub-tab page below instead of redirecting away.
  const SECTION_BY_ROUTE: Record<string, string> = {
    "/app/purchase-orders": "orders",
    "/app/proformas": "proforma",
    "/app/purchases": "invoices",
    "/app/goods-receipts": "grn",
    "/app/suppliers": "suppliers",
  };
  const openItemBelow = (w: WorkItem) => {
    const s = w.openTo ? SECTION_BY_ROUTE[w.openTo] : undefined;
    if (s) setSection(s);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title={<span className="inline-flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" /> Procurement Workbench</span>}
        description="Track purchase orders, supplier invoices and inbound deliveries."
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
                <KpiCard label="POs Awaiting Approval" value={poApproval} sub="Needs sign-off" icon={ClipboardList} tone="attention" onClick={() => setFamily("orders")} />
                <KpiCard label="Supplier Invoices Pending" value={invPending} sub="Awaiting approval / payment" icon={FileText} onClick={() => setFamily("invoices")} />
                <KpiCard label="Deliveries Due This Week" value={dueWeek} sub="Expected within 7 days" icon={ShoppingCart} tone="blue" onClick={() => setFamily("orders")} />
                <KpiCard label="GRNs Pending" value={grnPending} sub="Awaiting goods receipt" icon={ClipboardList} tone="attention" onClick={() => setFamily("grn")} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <FilterPills
                options={[{ id: "all", label: "All" }, { id: "orders", label: "Orders" }, { id: "proforma", label: "Proformas" }, { id: "invoices", label: "Invoices" }, { id: "grn", label: "GRNs" }]}
                active={family}
                onChange={setFamily}
              />
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Filter by supplier" className="h-8 rounded-md border border-border bg-card px-2 text-xs">
                <option value="all">All suppliers</option>
                {vendors.slice(0, 50).map((v: any) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search document, supplier…" aria-label="Search procurement work items" className="h-8 w-52 rounded-md border border-border bg-card px-2.5 text-xs" />
            </div>
            <div className="grid gap-6 lg:grid-cols-4">
              <div className="lg:col-span-3">
                {loading ? <TableSkeleton rows={6} cols={7} /> : <WorkItemsTable items={items} title="Procurement work items" subtitle="Orders, invoices and receipts needing action." onAction={openItemBelow} partyLabel="Suppliers" />}
              </div>
              <SectionCard title="Needs attention" action={<button onClick={() => setSection("activity")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></button>}>
                {items.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">All clear</p> : (
                  <ul className="space-y-3">{items.slice(0, 5).map((w) => (
                    <li key={w.id} className="text-[13px]"><span className="block truncate font-medium">{w.counterparty}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{w.docNumber}</span></li>))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        )}
        {section === "suppliers" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><SuppliersEmbedded /></Suspense>}
        {section === "orders" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><PurchaseOrdersEmbedded /></Suspense>}
        {section === "proforma" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ProformasEmbedded /></Suspense>}
        {section === "invoices" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><PurchasesEmbedded /></Suspense>}
        {section === "grn" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><GrnEmbedded /></Suspense>}
        {section === "activity" && <Suspense fallback={<TableSkeleton rows={6} cols={8} />}><ActivityPanel items={items} title="Procurement activity" onAction={openItemBelow} /></Suspense>}
      </div>
    </div>
  );
}
