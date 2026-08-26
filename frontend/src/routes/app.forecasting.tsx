import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  TrendingUp, RefreshCw, Download, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, TrendingDown, Activity, CircleDollarSign, Boxes, Package, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/app/forecasting")({
  component: ForecastingPage,
});

type Fv = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  image_url: string | null;
  computed_at: string;
  stock: number | null;
  unit: string | null;
  baseline: number | null;
  trend_direction: "up" | "down" | "stable";
  trend_slope: number | null;
  trend_r2: number | null;
  horizon: Array<{ month: string; forecast: number; low: number; high: number; daily_rate: number; stock_required: number; projected_stock_after: number; suggested_order: number }> | null;
  days_of_cover: number | null;
  estimated_stockout_date: string | null;
  reorder_by_date: string | null;
  next_refill_date: string | null;
  stockout_urgency: "critical" | "warning" | "safe";
  reorder_required: boolean;
  recommended_order_qty: number | null;
  recommended_order_value: number | null;
  momentum: "accelerating" | "stable" | "declining" | "inactive";
  velocity: "fast_mover" | "medium_mover" | "slow_mover" | "dead";
  suggested_price_change_pct: number | null;
  suggested_price_note: string | null;
  floor_price: number | null;
  recent_demand: number | null;
  monthly_demand: Array<{ month: string; actual: number; corrected: number; availability: number }> | null;
  full: Record<string, unknown> | null;
};

const VELOCITY_LABEL: Record<Fv["velocity"], string> = {
  fast_mover: "Fast mover",
  medium_mover: "Medium mover",
  slow_mover: "Slow mover",
  dead: "Dead",
};

function urgencyTone(u: Fv["stockout_urgency"]) {
  return u === "critical" ? "border-destructive/50 text-destructive" : u === "warning" ? "border-warning/50 text-warning" : "border-success/50 text-success";
}

function momentumTone(m: Fv["momentum"]) {
  return m === "accelerating" ? "border-success/50 text-success" : m === "declining" ? "border-destructive/50 text-destructive" : m === "inactive" ? "border-border text-muted-foreground" : "border-primary/40 text-primary";
}

function velocityTone(v: Fv["velocity"]) {
  return v === "fast_mover" ? "border-success/50 text-success" : v === "dead" ? "border-destructive/50 text-destructive" : v === "medium_mover" ? "border-primary/40 text-primary" : "border-warning/50 text-warning";
}

function ForecastingPage() {
  const { canWrite } = useAuth();
  const canRecompute = canWrite("products");
  const qc = useQueryClient();

  const [filter, setFilter] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("days_of_cover");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pageSize = 25;

  const listQ = useQuery({
    queryKey: ["forecast-variables"],
    queryFn: async () => (await api.get<Fv[]>("/forecast-variables")) ?? [],
  });
  const list = listQ.data ?? [];

  const recompute = useMutation({
    mutationFn: async () => {
      await api.post("/forecast-variables/recompute");
    },
    onSuccess: () => {
      toast.success("Forecast recomputed");
      qc.invalidateQueries({ queryKey: ["forecast-variables"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const f of list) if (f.category) s.add(f.category);
    return [...s].sort();
  }, [list]);

  const stats = useMemo(() => {
    const toReorder = list.filter((f) => f.reorder_required);
    return {
      toReorderCount: toReorder.length,
      toReorderQty: toReorder.reduce((s, f) => s + Number(f.recommended_order_qty || 0), 0),
      toReorderValue: toReorder.reduce((s, f) => s + Number(f.recommended_order_value || 0), 0),
      fast: list.filter((f) => f.velocity === "fast_mover").length,
      slow: list.filter((f) => f.velocity === "slow_mover").length,
      dead: list.filter((f) => f.velocity === "dead").length,
      accelerating: list.filter((f) => f.momentum === "accelerating").length,
      declining: list.filter((f) => f.momentum === "declining").length,
      outOfStock: list.filter((f) => Number(f.stock ?? 0) <= 0).length,
      critical: list.filter((f) => f.stockout_urgency === "critical").length,
      total: list.length,
    };
  }, [list]);

  const filtered = useMemo(() => {
    let rows = [...list];
    if (filter === "reorder") rows = rows.filter((f) => f.reorder_required);
    else if (filter === "fast") rows = rows.filter((f) => f.velocity === "fast_mover");
    else if (filter === "medium") rows = rows.filter((f) => f.velocity === "medium_mover");
    else if (filter === "slow") rows = rows.filter((f) => f.velocity === "slow_mover");
    else if (filter === "dead") rows = rows.filter((f) => f.velocity === "dead");
    else if (filter === "accelerating") rows = rows.filter((f) => f.momentum === "accelerating");
    else if (filter === "declining") rows = rows.filter((f) => f.momentum === "declining");
    else if (filter === "out") rows = rows.filter((f) => Number(f.stock ?? 0) <= 0);
    else if (filter === "critical") rows = rows.filter((f) => f.stockout_urgency === "critical");
    if (category !== "all") rows = rows.filter((f) => f.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((f) => f.sku.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
    }
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as any)[sortBy];
      const bv = (b as any)[sortBy];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
    return rows;
  }, [list, filter, category, search, sortBy, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const exportCsv = () => {
    const header = "sku,name,category,stock,unit,days_of_cover,urgency,reorder,recommended_qty,recommended_value,momentum,velocity,recent_demand,baseline,trend,trend_r2,stockout_date,reorder_by,next_refill,suggested_price_change\n";
    const rows = filtered.map((f) =>
      [
        f.sku, `"${f.name.replace(/"/g, '""')}"`, f.category ?? "",
        f.stock ?? "", f.unit ?? "", f.days_of_cover ?? "", f.stockout_urgency,
        f.reorder_required ? "yes" : "no", f.recommended_order_qty ?? "", f.recommended_order_value ?? "",
        f.momentum, f.velocity, f.recent_demand ?? "", f.baseline ?? "", f.trend_direction,
        f.trend_r2 ?? "", f.estimated_stockout_date ?? "", f.reorder_by_date ?? "", f.next_refill_date ?? "",
        f.suggested_price_change_pct ?? "",
      ].join(","),
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "forecast.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filterOptions = [
    { key: "all", label: "All" },
    { key: "reorder", label: "To reorder" },
    { key: "fast", label: "Fast movers" },
    { key: "medium", label: "Medium" },
    { key: "slow", label: "Slow" },
    { key: "dead", label: "Dead" },
    { key: "accelerating", label: "Accelerating" },
    { key: "declining", label: "Declining" },
    { key: "out", label: "Out of stock" },
    { key: "critical", label: "Critical" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Demand planning"
        title="Forecasting"
        description="6-month demand forecasts per SKU — weighted baseline, trend, seasonality, days of cover and reorder recommendations, recomputed automatically after every stock event."
        actions={
          canRecompute ? (
            <div className="flex gap-2">
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Download className="h-4 w-4" /> Export CSV
              </button>
              <button onClick={() => recompute.mutate()} disabled={recompute.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {recompute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Recompute
              </button>
            </div>
          ) : (
            <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        {/* Summary tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Package className="h-4 w-4 text-primary" />} label="SKUs tracked" value={String(stats.total)} />
          <StatTile icon={<AlertTriangle className="h-4 w-4 text-destructive" />} label="To reorder" value={String(stats.toReorderCount)}
            hint={`${fmtMoney(stats.toReorderValue)} at cost`} />
          <StatTile icon={<Activity className="h-4 w-4 text-warning" />} label="Critical stock" value={String(stats.critical)}
            hint={`${stats.outOfStock} out of stock`} />
          <StatTile icon={<TrendingUp className="h-4 w-4 text-success" />} label="Fast / dead" value={`${stats.fast} / ${stats.dead}`}
            hint={`${stats.accelerating} accelerating · ${stats.declining} declining`} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {filterOptions.map((o) => (
            <button key={o.key} onClick={() => { setFilter(o.key); setPage(1); }}
              className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                filter === o.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}>
              {o.label}
            </button>
          ))}
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="ml-1 h-7 rounded-md border border-border bg-background px-2 text-xs">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search SKU or name…"
            className="ml-auto h-7 w-56 rounded-md border border-border bg-background px-2 text-xs placeholder:text-muted-foreground" />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-normal"></th>
                  <th className="px-4 py-3 text-left font-normal">Item</th>
                  <th className="px-4 py-3 text-right font-normal">Stock</th>
                  <th className="px-4 py-3 text-right font-normal">Days cover</th>
                  <th className="px-4 py-3 text-right font-normal">Reorder</th>
                  <th className="px-4 py-3 text-left font-normal">Momentum</th>
                  <th className="px-4 py-3 text-left font-normal">Velocity</th>
                  <th className="px-4 py-3 text-left font-normal">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((f) => {
                  const open = expanded.has(f.id);
                  return (
                    <ForecastRow key={f.id} f={f} open={open} onToggle={() => toggleExpand(f.id)} />
                  );
                })}
                {pageRows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No forecasts yet — {canRecompute ? "hit Recompute" : "ask an operations user to recompute"} to generate snapshots for every product.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length.toLocaleString()} SKUs</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:border-primary">Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:border-primary">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForecastRow({ f, open, onToggle }: { f: Fv; open: boolean; onToggle: () => void }) {
  const months = f.horizon ?? [];
  const chartData = months.map((m) => ({
    name: m.month.slice(5) + "/" + m.month.slice(2, 4),
    forecast: m.forecast,
    low: m.low,
    high: m.high,
  }));
  const monthlyActual = (f.monthly_demand ?? []).map((m) => ({ name: m.month.slice(5), actual: m.actual }));

  return (
    <>
      <tr className={`border-b border-border/60 hover:bg-muted/20 ${f.stockout_urgency === "critical" ? "bg-destructive/[0.04]" : ""}`}>
        <td className="px-4 py-3">
          <button onClick={onToggle} className="rounded-md border border-border p-1 text-muted-foreground hover:border-primary hover:text-primary">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {f.image_url ? (
              <img src={f.image_url} alt="" className="h-8 w-8 rounded-md border border-border object-cover" />
            ) : (
              <div className="grid h-8 w-8 place-items-center rounded-md border border-border bg-muted/40"><Boxes className="h-3.5 w-3.5 text-muted-foreground" /></div>
            )}
            <div>
              <div className="font-medium">{f.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{f.sku}{f.category ? ` · ${f.category}` : ""}</div>
            </div>
          </div>
        </td>
        <td className={`px-4 py-3 text-right num ${Number(f.stock ?? 0) <= 0 ? "text-destructive" : ""}`}>{Number(f.stock ?? 0).toLocaleString()}</td>
        <td className="px-4 py-3 text-right num">{f.days_of_cover != null && f.days_of_cover >= 999 ? "∞" : (f.days_of_cover ?? "—")}</td>
        <td className="px-4 py-3 text-right">
          {f.reorder_required ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-0.5 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" /> {Number(f.recommended_order_qty || 0).toLocaleString()}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] ${momentumTone(f.momentum)}`}>{f.momentum}</span></td>
        <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] ${velocityTone(f.velocity)}`}>{VELOCITY_LABEL[f.velocity]}</span></td>
        <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${urgencyTone(f.stockout_urgency)}`}>{f.stockout_urgency}</span></td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-muted/10">
          <td colSpan={8} className="px-6 py-5">
            <ForecastDetail f={f} chartData={chartData} monthlyActual={monthlyActual} />
          </td>
        </tr>
      )}
    </>
  );
}

function ForecastDetail({ f, chartData, monthlyActual }: { f: Fv; chartData: any[]; monthlyActual: any[] }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 6-month horizon chart */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="uppercase tracking-widest text-muted-foreground">6-month forecast (units)</span>
            <span className="text-[10px] text-muted-foreground">shaded band = 80% prediction interval</span>
          </div>
          {chartData.length === 0 ? (
            <div className="grid h-40 place-items-center text-xs text-muted-foreground">No horizon data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`grad-${f.product_id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                {/* 80% prediction-interval band: low → high as a translucent fill. */}
                <Area type="monotone" dataKey="low" stroke="transparent" fill="var(--color-primary)" fillOpacity={0.08} />
                <Area type="monotone" dataKey="high" stroke="transparent" fill="var(--color-primary)" fillOpacity={0.08} />
                <Area type="monotone" dataKey="forecast" stroke="var(--color-primary)" strokeWidth={2} fill={`url(#grad-${f.product_id})`} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Actual demand history */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Actual demand (12 months, confirmed stock-outs)</div>
          {monthlyActual.length === 0 ? (
            <div className="grid h-40 place-items-center text-xs text-muted-foreground">No demand history</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={monthlyActual}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="actual" stroke="var(--color-muted-foreground)" strokeWidth={2} fill="var(--color-muted-foreground)" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Calculation breakdown */}
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Baseline (12-mo weighted)" value={f.baseline != null ? `${f.baseline} / mo` : "—"} />
        <Mini label="Trend" value={f.trend_direction === "up" ? `▲ up (${f.trend_slope ?? 0}/mo)` : f.trend_direction === "down" ? `▼ down (${f.trend_slope ?? 0}/mo)` : "stable"}
          tone={f.trend_direction === "up" ? "good" : f.trend_direction === "down" ? "bad" : "neutral"} />
        <Mini label="Trend fit (R²)" value={f.trend_r2 != null ? String(f.trend_r2) : "—"} />
        <Mini label="Recent demand (3 mo)" value={f.recent_demand != null ? `${f.recent_demand}` : "—"} />
        <Mini label="Daily demand" value={f.full?.daily_demand != null ? String(f.full.daily_demand) : "—"} />
        <Mini label="Days of cover" value={f.days_of_cover != null && f.days_of_cover >= 999 ? "∞" : String(f.days_of_cover ?? "—")} />
        <Mini label="Est. stockout" value={f.estimated_stockout_date ? fmtDate(f.estimated_stockout_date) : "—"} tone={f.stockout_urgency === "critical" ? "bad" : "neutral"} />
        <Mini label="Reorder by" value={f.reorder_by_date ? fmtDate(f.reorder_by_date) : "—"} />
        <Mini label="Next refill" value={f.next_refill_date ? fmtDate(f.next_refill_date) : "—"} />
        <Mini label="Suggested order" value={f.recommended_order_qty != null ? `${Number(f.recommended_order_qty).toLocaleString()} (${fmtMoney(f.recommended_order_value ?? 0)})` : "—"} />
        <Mini label="Floor price" value={f.floor_price != null ? fmtMoney(f.floor_price) : "—"} />
        <Mini label="Pace factor" value={f.full?.pace_factor != null ? String(f.full.pace_factor) : "—"} />
      </div>

      {/* Horizon table */}
      {chartData.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Month</th>
                <th className="px-3 py-2 text-right font-normal">Forecast</th>
                <th className="px-3 py-2 text-right font-normal">80% low</th>
                <th className="px-3 py-2 text-right font-normal">80% high</th>
                <th className="px-3 py-2 text-right font-normal">Daily rate</th>
                <th className="px-3 py-2 text-right font-normal">Stock required</th>
                <th className="px-3 py-2 text-right font-normal">Proj. stock after</th>
                <th className="px-3 py-2 text-right font-normal">Suggested order</th>
              </tr>
            </thead>
            <tbody>
              {f.horizon!.map((m) => (
                <tr key={m.month} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono text-xs">{m.month}</td>
                  <td className="px-3 py-2 text-right num">{m.forecast}</td>
                  <td className="px-3 py-2 text-right num text-muted-foreground">{m.low}</td>
                  <td className="px-3 py-2 text-right num text-muted-foreground">{m.high}</td>
                  <td className="px-3 py-2 text-right num">{m.daily_rate}</td>
                  <td className="px-3 py-2 text-right num">{m.stock_required}</td>
                  <td className="px-3 py-2 text-right num">{m.projected_stock_after}</td>
                  <td className="px-3 py-2 text-right num">{m.suggested_order > 0 ? m.suggested_order : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pricing recommendation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          <span className="font-medium">Pricing recommendation</span>
          <span className="text-muted-foreground">{f.suggested_price_note ?? "No pricing action suggested"}</span>
        </div>
        {f.suggested_price_change_pct != null && f.suggested_price_change_pct !== 0 && (
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${f.suggested_price_change_pct > 0 ? "border-success/50 text-success" : "border-destructive/50 text-destructive"}`}>
            {f.suggested_price_change_pct > 0 ? "+" : ""}{f.suggested_price_change_pct}%
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">Recommendation only — never auto-applied</span>
      </div>
    </div>
  );
}

function Mini({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-1.5 font-display text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
