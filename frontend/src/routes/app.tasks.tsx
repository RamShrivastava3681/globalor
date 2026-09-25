import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Inbox,
  DollarSign,
  ListTodo,
  Loader2,
  RefreshCw,
  Search,
  Send,
  type LucideIcon,
} from "lucide-react";

export const Route = createFileRoute("/app/tasks")({
  validateSearch: (search: Record<string, unknown>): { queue?: string | undefined } => ({
    queue: (search.queue as string) || undefined,
  }),
  component: WorkflowQueuePage,
});

/* ═══════════════════════════════════════════════════════════════
   TYPES — mirrors the workflow-task contract (backend pre-sorted:
   assigned to me first, then department/role queue, then rest)
   ═══════════════════════════════════════════════════════════════ */

type WorkflowType =
  | "sales_order"
  | "purchase_order"
  | "purchase_invoice"
  | "sales_invoice"
  | "proforma"
  | "payment"
  | "grn"
  | "dispatch";

type Priority = "low" | "normal" | "high" | "urgent";

type Task = {
  id: string;
  workflow_type: WorkflowType;
  stage: string;
  doc_type: string;
  doc_id: string;
  doc_number: string | null;
  counterparty: string | null;
  doc_status: string | null;
  owner_role: string;
  assigned_user: string | null;
  prev_owner: string | null;
  required_action: string;
  next_action: string | null;
  priority: Priority;
  due_date: string | null;
  amount: number | null;
  latest_update: string | null;
  status: "open" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  overdue?: boolean;
  linked_docs?: Array<{ type: string; id: string; number: string }>;
};

type FilterKey = "mine" | "pending" | "today" | "overdue" | "rejected" | "completed";

/* ═══════════════════════════════════════════════════════════════
   DATA — contract: GET /workflow-tasks?status=open|done (backend
   pre-sorted: assigned to me first, then department/role queue).
   ═══════════════════════════════════════════════════════════════ */

async function fetchQueue(status: "open" | "done"): Promise<Task[]> {
  const data = await api.get<any>(`/workflow-tasks?status=${status}`);
  if (Array.isArray(data)) return data as Task[];
  if (data && typeof data === "object") {
    for (const k of ["tasks", "data", "items", "rows"]) {
      if (Array.isArray((data as any)[k])) return (data as any)[k] as Task[];
    }
  }
  return [];
}


/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ymdOf = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "");

const isMine = (t: Task, email: string, id: string) =>
  !!t.assigned_user &&
  (t.assigned_user.toLowerCase() === email.toLowerCase() || t.assigned_user === id);
const isOverdueTask = (t: Task, today: string) =>
  t.overdue === true || (!!t.due_date && ymdOf(t.due_date) < today);
const isDueTodayTask = (t: Task, today: string) => ymdOf(t.due_date) === today;
const isRejectedTask = (t: Task) =>
  String(t.doc_status ?? "").toLowerCase() === "rejected" ||
  String(t.latest_update ?? "")
    .toLowerCase()
    .includes("reject");

const fmtUSD = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDue(iso?: string | null): string {
  if (!iso) return "No due date";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "No due date";
  return `Due ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "<1d";
  const d = Math.floor(ms / 86400000);
  return d <= 0 ? "<1d" : `${d}d`;
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  sales_order: "Sales Order",
  purchase_order: "Purchase Order",
  purchase_invoice: "Purchase Invoice",
  sales_invoice: "Sales Invoice",
  proforma: "Proforma",
  payment: "Payment",
  grn: "GRN",
  dispatch: "Dispatch",
};

const PRIORITY_CLS: Record<Priority, string> = {
  urgent: "border-destructive/30 bg-destructive/10 text-destructive",
  high: "border-warning/30 bg-warning/10 text-warning",
  normal: "border-border bg-muted/60 text-muted-foreground",
  low: "border-border bg-muted/60 text-muted-foreground",
};

function actionLabel(stage: string): string {
  const s = stage.toLowerCase();
  if (s.includes("approve") || s.includes("review") || s.includes("checker")) return "Approve";
  if (s.includes("dispatch_invoice") || s.includes("create_invoice") || s.includes("record_supplier_invoice")) return "Make invoice";
  if (s.includes("create_proforma")) return "Make proforma";
  if (s.includes("record") || s.includes("generate")) return "Record";
  if (s.includes("confirm")) return "Confirm";
  return "Open";
}

/** Secondary "Make invoice" hop for order tasks whose primary action is receiving/proforma.
 *  Purchase orders → purchases invoice panel (PO preselected, supplier+amount locked).
 *  Sales orders at dispatch/invoice stage → sales invoice modal (SO preselected, customer+lines locked).
 *  If the order carries advance payment terms the caller should route to Make proforma first
 *  (see resolveTaskRoute create_proforma branches); this hop is the direct-invoice path. */
function makeInvoiceRoute(t: Task): { to: string; search: Record<string, string> } | null {
  const stage = t.stage.toLowerCase();
  if (
    t.workflow_type === "purchase_order" &&
    (t.stage === "await_goods" || t.stage === "create_grn" || t.stage === "record_supplier_invoice" || stage.includes("record_supplier_invoice") || stage.includes("await_goods") || stage.includes("create_grn"))
  ) {
    // The purchases page opens its invoice panel with this PO preselected.
    return { to: "/app/purchases", search: { createFromPo: t.doc_id, fromQueue: "1" } };
  }
  if (
    t.workflow_type === "sales_order" &&
    (stage.includes("dispatch_invoice") || stage.includes("create_invoice") || stage.includes("await_dispatch") || stage.includes("ready_to_invoice"))
  ) {
    // The invoices page opens its from-SO modal with this SO preselected.
    return { to: "/app/invoices", search: { createFromSo: t.doc_id, fromQueue: "1" } };
  }
  return null;
}

/** Queue workflow → checker drawer kind (checker-owned tasks deep-open in the checker). */
const CHECKER_KIND: Record<WorkflowType, string> = {
  sales_order: "sales_order",
  purchase_order: "po",
  purchase_invoice: "purchase",
  sales_invoice: "sale",
  proforma: "proforma",
  payment: "",
  grn: "",
  dispatch: "",
};

/** Spec routing table, translated to /app/* routes. */
function resolveTaskRoute(t: Task): { to: string; search: Record<string, string> } {
  const stage = t.stage.toLowerCase();
  const id = t.doc_id;
  // Checker-owned stages open that exact document in the checker desk.
  const ck = CHECKER_KIND[t.workflow_type];
  if (ck && t.owner_role === "checker") {
    return { to: "/app/checker", search: { review: `${ck}:${id}` } };
  }
  // Treasury-owned payment stages open the funding-queue payment modal directly.
  // Treasury-only roles are blocked from /app/invoices and /app/purchases by the
  // role wall, so routing them there would bounce and drop the deep-link.
  // (Non-payment stages fall through to the document pages for ops/admin users.)
  const isPayStage =
    stage.includes("record_utr") ||
    stage.includes("await_payment") ||
    stage.includes("record_payment") ||
    stage.includes("settle") ||
    stage.includes("pay");
  if (t.owner_role === "treasury" && isPayStage && (t.workflow_type === "sales_invoice" || t.workflow_type === "purchase_invoice")) {
    return { to: "/app/queue", search: { paymentFor: `${t.workflow_type}:${id}`, fromQueue: "1" } };
  }
  if (t.workflow_type === "sales_order") {
    if (stage.includes("submit") || stage.includes("warehouse") || stage.includes("checker"))
      return { to: "/app/sales-orders", search: {} };
    if (stage.includes("create_proforma"))
      // Advance payment terms: the next hop is the proforma (funding) track.
      return { to: "/app/proformas", search: { createFromSo: id, side: "sales", fromQueue: "1" } };
    if (stage.includes("dispatch_invoice") || stage.includes("create_invoice"))
      return { to: "/app/invoices", search: { createFromSo: id, fromQueue: "1" } };
  }
  if (
    t.workflow_type === "sales_invoice" &&
    (stage.includes("record_utr") || stage.includes("await_payment"))
  )
    return { to: "/app/invoices", search: { utrFor: id, fromQueue: "1" } };
  if (
    t.workflow_type === "sales_invoice" &&
    (stage.includes("prepare_dispatch") || stage.includes("confirm_dispatch"))
  )
    return { to: "/app/dispatches", search: { createFromInvoice: id, fromQueue: "1" } };
  if (t.workflow_type === "purchase_order" && stage.includes("create_proforma"))
    return { to: "/app/proformas", search: { createFromPo: id, fromQueue: "1" } };
  if (t.workflow_type === "purchase_order" && stage.includes("record_supplier_invoice"))
    // Invoice panel on the purchases page, PO link preselected.
    return { to: "/app/purchases", search: { createFromPo: id, fromQueue: "1" } };
  if (
    t.workflow_type === "purchase_order" &&
    (stage.includes("await_goods") || stage.includes("create_grn"))
  )
    return { to: "/app/goods-receipts", search: { createFromPo: id, fromQueue: "1" } };
  if (t.workflow_type === "purchase_invoice")
    return { to: "/app/purchases", search: { openInvoice: id, fromQueue: "1" } };
  // Proforma tasks deep-open the exact proforma detail (approve/fund actions live there).
  if (t.workflow_type === "proforma") return { to: "/app/proformas", search: { view: id, fromQueue: "1" } };
  // GRN / dispatch pages have no ?view= detail modal — land on the list (confirm actions live there).
  if (t.workflow_type === "grn") return { to: "/app/goods-receipts", search: {} };
  if (t.workflow_type === "dispatch") return { to: "/app/dispatches", search: {} };
  // Payment tasks deep-open the funding queue payment modal for that invoice.
  if (t.workflow_type === "payment") return { to: "/app/queue", search: { paymentFor: `${t.doc_type}:${id}`, fromQueue: "1" } };
  return { to: "/app/dashboard", search: {} };
}

/* ═══════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════ */

const FILTERS: Array<{ key: FilterKey; label: string; icon: LucideIcon }> = [
  { key: "mine", label: "Assigned to me", icon: Inbox },
  { key: "pending", label: "Pending", icon: ListTodo },
  { key: "today", label: "Due today", icon: Clock },
  { key: "overdue", label: "Overdue", icon: AlertTriangle },
  { key: "rejected", label: "Rejected", icon: Send },
  { key: "completed", label: "Completed", icon: CheckCheck },
];

const WORKFLOW_OPTIONS: Array<{ value: "all" | WorkflowType; label: string }> = [
  { value: "all", label: "All workflows" },
  { value: "sales_order", label: "Sales Order" },
  { value: "purchase_order", label: "Purchase Order" },
  { value: "purchase_invoice", label: "Purchase Invoice" },
  { value: "sales_invoice", label: "Sales Invoice" },
  { value: "proforma", label: "Proforma" },
  { value: "payment", label: "Payment" },
  { value: "grn", label: "GRN" },
  { value: "dispatch", label: "Dispatch" },
];

export function WorkflowQueuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const meEmail = user?.email ?? "";
  const meId = user?.id ?? "";
  const today = todayYMD();
  const routeQueue = (Route.useSearch() as { queue?: string })?.queue;

  const [filter, setFilter] = useState<FilterKey>("pending");
  const [workflow, setWorkflow] = useState<"all" | WorkflowType>("all");
  const [queue, setQueue] = useState<string>(routeQueue ?? "all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"smart" | "newest" | "due">("smart");

  // ── Primary contract (backend pre-sorted) ──
  const openQ = useQuery({
    queryKey: ["workflow-queue", "open"],
    queryFn: () => fetchQueue("open"),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: false,
  });
  const doneQ = useQuery({
    queryKey: ["workflow-queue", "done"],
    queryFn: () => fetchQueue("done"),
    enabled: filter === "completed",
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: false,
  });

  const queueError = openQ.isError;

  const openTasks: Task[] = useMemo(() => openQ.data ?? [], [openQ.data]);
  const doneTasks: Task[] = useMemo(() => doneQ.data ?? [], [doneQ.data]);
  const isFetching = openQ.isFetching || doneQ.isFetching;
  const isLoading = openQ.isLoading;

  const refresh = () => {
    openQ.refetch();
    if (filter === "completed") doneQ.refetch();
  };

  // SLA sweep: once per session, escalate overdue tasks (idempotent server-side).
  useEffect(() => {
    try {
      if (sessionStorage.getItem("wf-sweep-done")) return;
      sessionStorage.setItem("wf-sweep-done", "1");
    } catch {
      // storage unavailable — still run once per mount
    }
    api.post("/workflow-tasks/sweep").catch(() => {}).then(() => {
      qc.invalidateQueries({ queryKey: ["workflow-queue"] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRebuild = roles.includes("factor_admin") || roles.includes("checker") || roles.includes("treasury") || roles.includes("operations");
  const rebuildQueue = async () => {
    if (!window.confirm("Rebuild My Queue from current documents? Existing open tasks are refreshed in place — nothing is duplicated.")) return;
    try {
      const res = await api.post<{ ensured: number; derived: number }>("/workflow-tasks/backfill");
      toast.success(`Queue rebuilt — ${res?.ensured ?? 0} open tasks`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rebuild failed");
    }
  };

  // ── Live counts ──
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      mine: 0,
      pending: openTasks.length,
      today: 0,
      overdue: 0,
      rejected: 0,
      completed: doneTasks.length,
    };
    for (const t of openTasks) {
      if (isMine(t, meEmail, meId)) c.mine += 1;
      if (isDueTodayTask(t, today)) c.today += 1;
      if (isOverdueTask(t, today)) c.overdue += 1;
      if (isRejectedTask(t)) c.rejected += 1;
    }
    return c;
  }, [openTasks, doneTasks.length, meEmail, meId, today]);

  // ── Dynamic department queues ──
  const queues = useMemo(() => {
    const set = new Set<string>();
    for (const t of openTasks) if (t.owner_role) set.add(t.owner_role);
    return [...set].sort();
  }, [openTasks]);

  // ── Role-aware default queue: land checkers/treasury/ops on their own
  // non-empty queue on first load; never overrides an explicit selection or ?queue= deep-link.
  const queueTouchedRef = useRef(!!routeQueue && routeQueue !== "all");
  useEffect(() => {
    if (routeQueue && routeQueue !== "all" && queue === "all") setQueue(routeQueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeQueue]);
  const setQueuePersist = (v: string) => {
    queueTouchedRef.current = true;
    setQueue(v);
    navigate({ to: "/app/tasks", search: v === "all" ? {} : { queue: v }, replace: true } as never);
  };
  useEffect(() => {
    if (queueTouchedRef.current || queue !== "all" || roles.length === 0 || openTasks.length === 0) return;
    const counts = new Map<string, number>();
    for (const t of openTasks) counts.set(t.owner_role, (counts.get(t.owner_role) ?? 0) + 1);
    const candidates: string[] = [];
    if (roles.includes("checker")) candidates.push("checker");
    if (roles.includes("treasury")) candidates.push("treasury");
    if (roles.includes("operations")) candidates.push("operations");
    const best = candidates.find((q) => (counts.get(q) ?? 0) > 0);
    if (best) setQueue(best);
  }, [roles, openTasks, queue]);

  const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  // ── Visible tasks (filtered, then sorted by the selected sort mode) ──
  const visible = useMemo(() => {
    const base = filter === "completed" ? doneTasks : openTasks;
    const q = search.trim().toLowerCase();
    const rows = base.filter((t) => {
      if (filter === "mine" && !isMine(t, meEmail, meId)) return false;
      if (filter === "today" && !isDueTodayTask(t, today)) return false;
      if (filter === "overdue" && !isOverdueTask(t, today)) return false;
      if (filter === "rejected" && !isRejectedTask(t)) return false;
      if (workflow !== "all" && t.workflow_type !== workflow) return false;
      if (queue !== "all" && t.owner_role !== queue) return false;
      if (q) {
        const hay =
          `${t.doc_number ?? ""} ${t.counterparty ?? ""} ${t.required_action} ${t.latest_update ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Smart: overdue first, then due-today, then priority, then value.
    // Newest / due-date sorts preserve the previous manual orderings.
    if (sortMode === "newest") {
      return [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    }
    if (sortMode === "due") {
      return [...rows].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    }
    return [...rows].sort((a, b) => {
      const rank = (t: Task) => (isOverdueTask(t, today) ? 0 : isDueTodayTask(t, today) ? 1 : 2);
      const ao = rank(a);
      const bo = rank(b);
      if (ao !== bo) return ao - bo;
      const ap = PRIORITY_RANK[a.priority ?? "normal"] ?? 2;
      const bp = PRIORITY_RANK[b.priority ?? "normal"] ?? 2;
      if (ap !== bp) return ap - bp;
      return (Number(b.amount ?? 0) || 0) - (Number(a.amount ?? 0) || 0);
    });
  }, [filter, openTasks, doneTasks, workflow, queue, search, meEmail, meId, today, sortMode]);

  const openTask = (t: Task) => {
    const r = resolveTaskRoute(t);
    navigate({ to: r.to, search: r.search } as never);
  };

  const makeInvoice = (t: Task) => {
    const r = makeInvoiceRoute(t);
    if (r) navigate({ to: r.to, search: r.search } as never);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Workflows"
        title={
          <span className="inline-flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" /> Workflow Queue
          </span>
        }
        description="Every pending task across Sales, Purchase, Finance, Treasury, Warehouse and Dispatch — your tasks first."
        actions={
          <div className="flex items-center gap-2">
            {canRebuild && (
              <button
                onClick={rebuildQueue}
                title="Regenerate open tasks from current documents (idempotent)"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Rebuild queue
              </button>
            )}
            <button
              onClick={refresh}
              disabled={isFetching}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          </div>
        }
      />

      <div className="mt-4 space-y-3">
        {queueError && !isLoading && (
          <p className="text-xs text-destructive">
            Queue service unavailable — press Refresh to retry{canRebuild ? ", or Rebuild queue to regenerate tasks" : ""}.
          </p>
        )}

        {/* ── Filter bar ── */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              const active = filter === f.key;
              const showCount = f.key !== "completed" || doneQ.data !== undefined;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                  {showCount && (
                    <span
                      className={`rounded-full px-1.5 font-mono text-[11px] font-semibold ${
                        active ? "bg-primary/15" : "bg-muted"
                      }`}
                    >
                      {counts[f.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value as "all" | WorkflowType)}
              aria-label="Filter by workflow"
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              {WORKFLOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={queue}
              onChange={(e) => setQueuePersist(e.target.value)}
              aria-label="Filter by queue"
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All queues</option>
              {queues.map((q) => (
                <option key={q} value={q}>
                  {cap(q)} queue
                </option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "smart" | "newest" | "due")}
              aria-label="Sort tasks"
              title="Smart sorts overdue first, then due-today, priority and value"
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="smart">Smart sort</option>
              <option value="newest">Newest first</option>
              <option value="due">Due date</option>
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doc no., customer, action…"
                className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 sm:w-56"
              />
            </div>
          </div>
        </div>

        {/* ── States ── */}
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading queue…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <CheckCheck className="h-6 w-6 text-success" />
            </span>
            <h3 className="mt-2 font-display text-base font-semibold text-foreground">
              Nothing here
            </h3>
            <p className="text-sm text-muted-foreground">
              No tasks match this filter — the queue is clear.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visible.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                today={today}
                onOpen={() => openTask(t)}
                makeInvoice={makeInvoiceRoute(t) ? () => makeInvoice(t) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TASK ROW CARD
   ═══════════════════════════════════════════════════════════════ */

function TaskCard({ task: t, today, onOpen, makeInvoice }: { task: Task; today: string; onOpen: () => void; makeInvoice?: () => void }) {
  const overdue = isOverdueTask(t, today) && t.status === "open";
  const dueToday = isDueTodayTask(t, today) && !overdue && t.status === "open";
  const completed = t.status === "done";
  const age = ageLabel(t.created_at);
  const amount = Number(t.amount ?? 0);

  return (
    <article
      className={`rounded-xl border bg-card p-4 transition-colors ${
        overdue ? "border-destructive/50" : "border-border hover:border-primary/40 hover:shadow-sm"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${PRIORITY_CLS[t.priority ?? "normal"]}`}
            >
              {t.priority}
            </span>
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {WORKFLOW_LABELS[t.workflow_type] ?? t.workflow_type}
            </span>
            {t.doc_number && (
              <span className="font-mono text-xs font-bold text-foreground">{t.doc_number}</span>
            )}
            {overdue && (
              <span className="inline-flex items-center rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
                Overdue
              </span>
            )}
            {!overdue && dueToday && (
              <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warning">
                Due today
              </span>
            )}
            {completed && (
              <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-success">
                Completed
              </span>
            )}
          </div>

          <h3 className="mt-1.5 text-sm font-semibold text-foreground">{t.required_action}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t.counterparty ?? "—"} · {cap(t.owner_role)} queue
            {t.next_action ? ` → next: ${t.next_action}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.latest_update ? (
              <>
                <em>Latest: {t.latest_update}</em>
                <span className="mx-1.5">•</span>
              </>
            ) : null}
            <span>
              {age} in {t.required_action}
            </span>
          </p>
        </div>

        {/* Right */}
        <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-1.5 sm:text-right">
          <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
            {amount > 0 && (
              <span className="inline-flex items-center gap-1 font-mono text-sm font-bold text-foreground">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                {fmtUSD(amount)}
              </span>
            )}
            <span
              className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
            >
              {fmtDue(t.due_date)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {makeInvoice && (
              <button
                onClick={makeInvoice}
                title="Create the invoice for this order with values prefilled"
                className="inline-flex h-8 items-center rounded-lg border border-primary/40 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                Make invoice
              </button>
            )}
            <button
              onClick={onOpen}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              {actionLabel(t.stage)}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
