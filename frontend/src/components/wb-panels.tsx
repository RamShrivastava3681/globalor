import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { StatusPill, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { SectionCard, TableSkeleton, EmptyState, FooterBanner } from "@/components/workbench";
import { WorkItemsTable } from "@/components/work-items-table";
import type { WorkItem } from "@/components/workbench";
import { Boxes, FileText, PackageCheck, Truck, Users, CalendarClock, FlaskConical } from "lucide-react";

function useQ<T>(key: string[], url: string) {
  return useQuery({ queryKey: key, queryFn: async () => (await api.get<T>(url)) ?? ([] as unknown as T), retry: false });
}

/* ── Warehouse family ── */
export function ForecastPanel() {
  const fvQ = useQ<any[]>("fv" as any, "/forecast-variables");
  const rows = (fvQ.data ?? []) as any[];
  if (fvQ.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Demand forecast" subtitle="Forecast variables and expected demand">
      {rows.length === 0 ? <EmptyState icon={CalendarClock} title="No forecast data" hint="Configure forecast variables to project demand." /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-3 py-2">Variable</th><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Updated</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {rows.slice(0, 15).map((r: any, i: number) => (
                <tr key={r.id ?? i}><td className="px-3 py-2">{r.name ?? r.variable ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.sku ?? r.product_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right num">{r.value ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.updated_at ? fmtDate(r.updated_at) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function GrnPanel() {
  const q = useQ<any[]>(["goods_grn"], "/goods-receipts");
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Goods receipts queue" subtitle={`${rows.length} receipts`}>
      {rows.length === 0 ? <EmptyState icon={PackageCheck} title="No goods receipts" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-3 py-2">Receipt</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {rows.slice(0, 15).map((g: any) => (
                <tr key={g.id}><td className="px-3 py-2 font-mono text-[13px]">{g.receipt_number ?? g.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{g.supplier_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{g.received_date ? fmtDate(g.received_date) : "—"}</td>
                  <td className="px-3 py-2"><StatusPill status={g.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function DispatchPanel() {
  const q = useQ<any[]>(["goods_dsp"], "/goods-dispatches");
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Dispatch notes workspace" subtitle={`${rows.length} dispatches`}>
      {rows.length === 0 ? <EmptyState icon={Truck} title="No dispatch notes" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-3 py-2">Ref</th><th className="px-3 py-2">Order / buyer</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {rows.slice(0, 15).map((d: any) => (
                <tr key={d.id}><td className="px-3 py-2 font-mono text-[13px]">{d.dispatch_number}</td>
                  <td className="px-3 py-2">{d.so_number ?? "—"} · {d.customer_name ?? ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.dispatch_date ? fmtDate(d.dispatch_date) : "—"}</td>
                  <td className="px-3 py-2"><StatusPill status={d.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function StockAllocationPanel() {
  const soQ = useQ<any[]>(["goods_so"], "/goods-sales-orders");
  const stQ = useQ<{ rows: any[] }>(["stock_summary"], "/stock-movements/summary");
  if (soQ.isLoading || stQ.isLoading) return <TableSkeleton rows={6} cols={8} />;
  const stock = new Map<string, number>();
  for (const r of (stQ.data as any)?.rows ?? []) stock.set(r.sku, (stock.get(r.sku) ?? 0) + r.quantity);
  const lines = (soQ.data ?? []).filter((s: any) => ["approved", "confirmed", "partially_dispatched"].includes(s.status)).flatMap((s: any) => (s.lines ?? []).map((l: any) => ({ so: s.so_number, ...l }))).slice(0, 20);
  return (
    <SectionCard title="Allocation board" subtitle="Open order lines vs on-hand stock">
      {lines.length === 0 ? <EmptyState icon={Boxes} title="Nothing to allocate" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-3 py-2">Order</th><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Pending</th><th className="px-3 py-2 text-right">On hand</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {lines.map((l: any, i: number) => {
                const pend = Math.max(0, (l.ordered_qty ?? 0) - (l.dispatched_qty ?? 0));
                const on = stock.get(l.sku) ?? 0;
                return <tr key={i}><td className="px-3 py-2 font-mono text-[12px]">{l.so}</td><td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-right num">{pend}</td>
                  <td className={`px-3 py-2 text-right num ${on < pend ? "font-bold text-destructive" : "text-success"}`}>{on}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function SamplesPanel() {
  return (
    <SectionCard title="Sample queue" subtitle="Samples awaiting dispatch">
      <EmptyState icon={FlaskConical} title="No samples queued" hint="Sample distributions will appear here once recorded." />
      <FooterBanner>Sample queue is UI-only in this release — distributions are recorded as dispatch notes.</FooterBanner>
    </SectionCard>
  );
}

export function WarehouseActivityPanel({ items, onAction }: { items: WorkItem[]; onAction?: (item: WorkItem) => void }) {
  return <WorkItemsTable items={items} title="Warehouse activity" subtitle="Warehouse-filtered queue history." onAction={onAction} />;
}

/* ── Sales family ── */
export function CustomersPanel() {
  const q = useQ<any[]>(["customers"], "/customers");
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Customers" subtitle={`${rows.length} customers`}>
      {rows.length === 0 ? <EmptyState icon={Users} title="No customers" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Terms</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.slice(0, 15).map((c: any) => (
            <tr key={c.id}><td className="px-3 py-2">{c.name}</td><td className="px-3 py-2 text-muted-foreground">{c.contact_name ?? "—"}</td><td className="px-3 py-2 text-muted-foreground">{c.payment_terms_days != null ? `Net ${c.payment_terms_days}` : "—"}</td></tr>))}</tbody>
        </table></div>
      )}
    </SectionCard>
  );
}

export function SalesOrdersPanel() {
  const q = useQ<any[]>(["goods_so"], "/goods-sales-orders");
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Sales orders" subtitle={`${rows.length} orders`}>
      {rows.length === 0 ? <EmptyState icon={FileText} title="No sales orders" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Order</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.slice(0, 15).map((s: any) => (
            <tr key={s.id}><td className="px-3 py-2 font-mono text-[13px]">{s.so_number}</td><td className="px-3 py-2">{s.customer_name ?? "—"}</td><td className="px-3 py-2 text-right num">{fmtMoney(s.grand_total)}</td><td className="px-3 py-2"><StatusPill status={s.status} /></td></tr>))}</tbody>
        </table></div>
      )}
    </SectionCard>
  );
}

export function DocListPanel({ title, url, numKey = "invoice_number", partyKeys = ["party", "customer_name", "customer_name"], amountKeys = ["amount", "grand_total"] }: {
  title: string; url: string; to?: string; label?: string; numKey?: string; partyKeys?: string[]; amountKeys?: string[];
}) {
  const q = useQ<any[]>([url], url);
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  const party = (r: any) => partyKeys.map((k) => r[k]).find((v) => v) ?? "—";
  const amount = (r: any) => Number(amountKeys.map((k) => r[k]).find((v) => v != null) ?? 0);
  return (
    <SectionCard title={title} subtitle={`${rows.length} documents`}>
      {rows.length === 0 ? <EmptyState icon={FileText} title={`No ${title.toLowerCase()}`} /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Document</th><th className="px-3 py-2">Counterparty</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.slice(0, 15).map((r: any) => (
            <tr key={r.id}><td className="px-3 py-2 font-mono text-[13px]">{r[numKey] ?? r.proforma_number ?? r.po_number ?? r.id.slice(0, 8)}</td><td className="px-3 py-2">{party(r)}</td><td className="px-3 py-2 text-right num">{fmtMoney(amount(r))}</td><td className="px-3 py-2"><StatusPill status={r.status} /></td></tr>))}</tbody>
        </table></div>
      )}
    </SectionCard>
  );
}

/* ── Procurement / Finance shared ── */
export function SuppliersPanel() {
  const q = useQ<any[]>(["vendors"], "/vendors");
  const rows = q.data ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Suppliers" subtitle={`${rows.length} suppliers`}>
      {rows.length === 0 ? <EmptyState icon={Users} title="No suppliers" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.slice(0, 15).map((s: any) => (
            <tr key={s.id}><td className="px-3 py-2">{s.name}</td><td className="px-3 py-2 text-muted-foreground">{s.contact_name ?? "—"}</td><td className="px-3 py-2"><StatusPill status={s.status ?? "active"} /></td></tr>))}</tbody>
        </table></div>
      )}
    </SectionCard>
  );
}

export function DispatchOrdersPanel() {
  const q = useQ<any[]>(["goods_dsp"], "/goods-dispatches");
  const rows = (q.data ?? []).filter((d: any) => d.transporter_name || d.tracking_number);
  if (q.isLoading) return <TableSkeleton rows={6} cols={8} />;
  return (
    <SectionCard title="Dispatch orders — Finance handoff" subtitle="Transporter details handed off from Warehouse Awaiting Pickup">
      {rows.length === 0 ? <EmptyState icon={Truck} title="No handoffs yet" hint="Transporter details appear here once Warehouse moves a dispatch to Awaiting Pickup." /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground"><th className="px-3 py-2">Dispatch</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Tracking</th><th className="px-3 py-2">Customer</th></tr></thead>
          <tbody className="divide-y divide-border/60">{rows.slice(0, 15).map((d: any) => (
            <tr key={d.id}><td className="px-3 py-2 font-mono text-[13px]">{d.dispatch_number}</td><td className="px-3 py-2">{d.transporter_name ?? "—"}</td><td className="px-3 py-2 font-mono text-[12px]">{d.tracking_number ?? "—"}</td><td className="px-3 py-2 text-muted-foreground">{d.customer_name ?? "—"}</td></tr>))}</tbody>
        </table></div>
      )}
    </SectionCard>
  );
}

export function GenericActivityPanel({ items, title, onAction }: { items: WorkItem[]; title: string; onAction?: (item: WorkItem) => void }) {
  return <WorkItemsTable items={items} title={title} subtitle="Unified queue filtered to this family." onAction={onAction} />;
}
