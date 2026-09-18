import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ledger-ui";
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Inbox,
  IndianRupee,
  ListTodo,
  Loader2,
  RefreshCw,
  Search,
  Send,
  type LucideIcon,
} from "lucide-react";

export const Route = createFileRoute("/app/tasks")({
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
   DATA — primary contract: GET /workflow-tasks?status=open|done.
   Fallback: derive the same Task shape client-side from the live
   document endpoints so the queue works before the backend lands.
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

async function getList(path: string): Promise<any[]> {
  try {
    const d = await api.get<any>(path);
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") {
      for (const k of [
        "orders",
        "invoices",
        "receipts",
        "dispatches",
        "advances",
        "data",
        "items",
        "rows",
      ]) {
        if (Array.isArray((d as any)[k])) return (d as any)[k];
      }
    }
    return [];
  } catch {
    return [];
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pick = (...vals: unknown[]): string | null => {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  }
  return null;
};

const TERMINAL = new Set([
  "cancelled",
  "paid",
  "delivered",
  "fully_received",
  "fullyreceived",
  "fully_dispatched",
  "fullydispatched",
  "converted_to_po",
  "converted_to_so",
  "converted",
  "expired",
]);
const isTerminal = (s: unknown) => TERMINAL.has(String(s ?? "").toLowerCase());

let synthSeq = 0;
function baseTask(
  doc: any,
  t: Partial<Task> & Pick<Task, "workflow_type" | "required_action">,
): Task | null {
  const status = String(doc.status ?? doc.manual_status ?? doc.lifecycle_status ?? "draft");
  if (
    isTerminal(status) ||
    isTerminal(doc.proforma_status) ||
    String(doc.status ?? "").toLowerCase() === "cancelled"
  ) {
    // Rejected docs stay visible (Rejected filter); everything else terminal drops out.
    if (
      String(doc.doc_status ?? doc.status ?? "").toLowerCase() !== "rejected" &&
      isTerminal(status)
    )
      return null;
  }
  synthSeq += 1;
  const id = String(doc.id ?? doc._id ?? `syn-${synthSeq}`);
  const now = new Date().toISOString();
  return {
    id: `${t.workflow_type}-${id}`,
    workflow_type: t.workflow_type,
    stage: t.stage ?? status,
    doc_type: t.doc_type ?? t.workflow_type,
    doc_id: id,
    doc_number: pick(
      doc.so_number,
      doc.soNumber,
      doc.po_number,
      doc.poNumber,
      doc.invoice_number,
      doc.invoiceNumber,
      doc.proforma_number,
      doc.proformaNumber,
      doc.receipt_number,
      doc.receiptNumber,
      doc.dispatch_number,
      doc.dispatchNumber,
      doc.number,
      doc.name,
    ),
    counterparty: pick(
      doc.customer_name,
      doc.customerName,
      doc.customer?.name,
      doc.supplier_name,
      doc.supplierName,
      doc.vendor?.name,
      doc.party,
      doc.client_name,
    ),
    doc_status: pick(doc.status, doc.manual_status, doc.proforma_status, doc.lifecycle_status),
    owner_role: t.owner_role ?? "operations",
    assigned_user: pick(
      doc.assigned_to,
      doc.assignedTo,
      doc.assigned_user,
      doc.salesperson_email,
      doc.buyer_email,
    ),
    prev_owner: null,
    required_action: t.required_action,
    next_action: t.next_action ?? null,
    priority: t.priority ?? "normal",
    due_date: pick(
      doc.due_date,
      doc.dueDate,
      doc.expected_delivery_date,
      doc.expectedDeliveryDate,
      doc.valid_until,
      doc.validUntil,
    ),
    amount:
      doc.grand_total ??
      doc.grandTotal ??
      doc.amount ??
      doc.total ??
      doc.net_payable ??
      doc.netPayable ??
      null,
    latest_update: pick(doc.latest_update, doc.status_notes, doc.notes, doc.comment, doc.remarks),
    status: "open",
    created_at: pick(doc.created_at, doc.createdAt, doc.issue_date, doc.order_date) ?? now,
    updated_at: pick(doc.updated_at, doc.updatedAt) ?? now,
    completed_at: null,
    overdue: false,
  };
}

/** Build a Task[] from live document endpoints — same shape, mine-first order. */
async function buildSyntheticQueue(meEmail: string, meId: string): Promise<Task[]> {
  const [
    salesOrders,
    purchaseOrders,
    salesInvoices,
    purchaseInvoices,
    proformas,
    grns,
    dispatches,
    advances,
  ] = await Promise.all([
    getList("/goods-sales-orders"),
    getList("/goods-purchase-orders"),
    getList("/invoices"),
    getList("/purchase-invoices"),
    getList("/purchase-orders"),
    getList("/goods-receipts"),
    getList("/goods-dispatches"),
    getList("/advances"),
  ]);

  const out: Task[] = [];
  const push = (t: Task | null) => {
    if (t) out.push(t);
  };

  for (const d of salesOrders) {
    const st = String(d.status ?? d.manual_status ?? "draft").toLowerCase();
    const n = pick(d.so_number, d.soNumber, d.number) ?? "—";
    if (st === "draft") {
      push(
        baseTask(d, {
          workflow_type: "sales_order",
          stage: "confirm",
          doc_type: "sales_order",
          owner_role: "sales",
          required_action: `Confirm sales order ${n}`,
          next_action: "Prepare dispatch",
        }),
      );
    } else {
      push(
        baseTask(d, {
          workflow_type: "sales_order",
          stage: "create_invoice",
          doc_type: "sales_order",
          owner_role: "sales",
          required_action: `Create tax invoice for ${n}`,
          next_action: "Record UTR",
        }),
      );
    }
  }
  for (const d of purchaseOrders) {
    const st = String(d.status ?? d.manual_status ?? "draft").toLowerCase();
    const n = pick(d.po_number, d.poNumber, d.number) ?? "—";
    if (st === "draft") {
      push(
        baseTask(d, {
          workflow_type: "purchase_order",
          stage: "approve",
          doc_type: "purchase_order",
          owner_role: "purchase",
          required_action: `Approve purchase order ${n}`,
          next_action: "Send to supplier",
        }),
      );
    } else if (st === "partially_received" || st === "partiallyreceived") {
      push(
        baseTask(d, {
          workflow_type: "purchase_order",
          stage: "create_grn",
          doc_type: "purchase_order",
          owner_role: "warehouse",
          required_action: `Create GRN for ${n}`,
          next_action: "Record supplier invoice",
        }),
      );
    } else {
      push(
        baseTask(d, {
          workflow_type: "purchase_order",
          stage: "await_goods",
          doc_type: "purchase_order",
          owner_role: "warehouse",
          required_action: `Receive goods for ${n}`,
          next_action: "Create GRN",
        }),
      );
    }
  }
  for (const d of purchaseInvoices) {
    const st = String(d.status ?? "draft").toLowerCase();
    const n = pick(d.invoice_number, d.invoiceNumber, d.number) ?? "—";
    if (st === "draft") {
      push(
        baseTask(d, {
          workflow_type: "purchase_invoice",
          stage: "verify",
          doc_type: "purchase_invoice",
          owner_role: "finance",
          required_action: `Verify purchase invoice ${n}`,
          next_action: "Approve for payment",
        }),
      );
    } else if (st.includes("approve") || st === "verified") {
      push(
        baseTask(d, {
          workflow_type: "purchase_invoice",
          stage: "approve_for_payment",
          doc_type: "purchase_invoice",
          owner_role: "finance",
          required_action: `Approve payment for ${n}`,
          next_action: "Record payment",
          priority: num(d.amount ?? d.net_payable) >= 100000 ? "high" : "normal",
        }),
      );
    } else {
      push(
        baseTask(d, {
          workflow_type: "purchase_invoice",
          stage: "record_payment",
          doc_type: "purchase_invoice",
          owner_role: "treasury",
          required_action: `Record payment for ${n}`,
          next_action: "Close invoice",
        }),
      );
    }
  }
  for (const d of salesInvoices) {
    const st = String(d.status ?? "draft").toLowerCase();
    const n = pick(d.invoice_number, d.invoiceNumber, d.number) ?? "—";
    if (st === "draft") {
      push(
        baseTask(d, {
          workflow_type: "sales_invoice",
          stage: "review",
          doc_type: "sales_invoice",
          owner_role: "finance",
          required_action: `Review sales invoice ${n}`,
          next_action: "Approve invoice",
        }),
      );
    } else if (st === "pending" || st === "issued" || st.includes("pending")) {
      push(
        baseTask(d, {
          workflow_type: "sales_invoice",
          stage: "approve",
          doc_type: "sales_invoice",
          owner_role: "finance",
          required_action: `Approve sales invoice ${n}`,
          next_action: "Record UTR",
        }),
      );
    } else {
      push(
        baseTask(d, {
          workflow_type: "sales_invoice",
          stage: "record_utr",
          doc_type: "sales_invoice",
          owner_role: "treasury",
          required_action: `Record UTR for ${n}`,
          next_action: "Confirm receipt",
          priority: st === "overdue" ? "urgent" : "normal",
          overdue: st === "overdue" ? true : undefined,
        }),
      );
    }
  }
  for (const d of proformas) {
    const side = String(d.side ?? "").toLowerCase();
    const fst = String(d.proforma_status ?? d.proformaStatus ?? "").toLowerCase();
    if (fst !== "" && fst !== "pending_review" && fst !== "approved") continue;
    const n = pick(d.proforma_number, d.proformaNumber, d.po_number, d.poNumber) ?? "—";
    push(
      baseTask(d, {
        workflow_type: "proforma",
        stage: fst === "approved" ? "convert" : "approve",
        doc_type: "proforma",
        owner_role: side === "sales" ? "sales" : "purchase",
        required_action:
          fst === "approved" ? `Convert proforma ${n} to order` : `Approve proforma ${n}`,
        next_action: "Create order",
      }),
    );
  }
  for (const d of grns) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (st !== "draft") continue;
    const n = pick(d.receipt_number, d.receiptNumber, d.grn_number, d.number) ?? "—";
    push(
      baseTask(d, {
        workflow_type: "grn",
        stage: "confirm",
        doc_type: "grn",
        owner_role: "warehouse",
        required_action: `Confirm GRN ${n}`,
        next_action: "Stock in",
      }),
    );
  }
  for (const d of dispatches) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (st !== "draft") continue;
    const n = pick(d.dispatch_number, d.dispatchNumber, d.number) ?? "—";
    push(
      baseTask(d, {
        workflow_type: "dispatch",
        stage: "confirm",
        doc_type: "dispatch",
        owner_role: "warehouse",
        required_action: `Confirm dispatch ${n}`,
        next_action: "Mark delivered",
      }),
    );
  }
  for (const d of advances) {
    const st = String(d.status ?? "pending").toLowerCase();
    if (!st.includes("pending")) continue;
    const n = pick(d.reference, d.advance_number, d.number) ?? "—";
    push(
      baseTask(d, {
        workflow_type: "payment",
        stage: "approve",
        doc_type: "payment",
        owner_role: "treasury",
        required_action: `Approve advance ${n}`,
        next_action: "Release funds",
      }),
    );
  }

  // Backend contract: mine first, then the rest (stable).
  const me = (u: string | null) => !!u && (u.toLowerCase() === meEmail.toLowerCase() || u === meId);
  return [...out].sort((a, b) => Number(me(b.assigned_user)) - Number(me(a.assigned_user)));
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

const fmtINR = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
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
  if (s.includes("record") || s.includes("generate")) return "Record";
  if (s.includes("confirm")) return "Confirm";
  return "Open";
}

/** Spec routing table, translated to /app/* routes. */
function resolveTaskRoute(t: Task): { to: string; search: Record<string, string> } {
  const stage = t.stage.toLowerCase();
  const id = t.doc_id;
  if (t.workflow_type === "sales_order" && stage.includes("create_invoice"))
    return { to: "/app/invoices", search: { createFromSo: id } };
  if (t.workflow_type === "sales_order" && stage.includes("create_proforma"))
    return { to: "/app/proformas", search: { createFromSo: id, side: "sales" } };
  if (
    t.workflow_type === "sales_invoice" &&
    (stage.includes("record_utr") || stage.includes("await_payment"))
  )
    return { to: "/app/invoices", search: { utrFor: id } };
  if (
    t.workflow_type === "sales_invoice" &&
    (stage.includes("prepare_dispatch") || stage.includes("confirm_dispatch"))
  )
    return { to: "/app/dispatches", search: { createFromInvoice: id } };
  if (t.workflow_type === "purchase_order" && stage.includes("create_proforma"))
    return { to: "/app/proformas", search: { createFromPo: id } };
  if (t.workflow_type === "purchase_order" && stage.includes("record_supplier_invoice"))
    return { to: "/app/purchases", search: { createFromPo: id } };
  if (
    t.workflow_type === "purchase_order" &&
    (stage.includes("await_goods") || stage.includes("create_grn"))
  )
    return { to: "/app/goods-receipts", search: { createFromPo: id } };
  if (t.workflow_type === "purchase_invoice")
    return { to: "/app/purchases", search: { openInvoice: id } };
  if (t.workflow_type === "proforma") return { to: "/app/proformas", search: {} };
  if (t.workflow_type === "grn") return { to: "/app/goods-receipts", search: {} };
  if (t.workflow_type === "dispatch") return { to: "/app/dispatches", search: {} };
  if (t.workflow_type === "payment") return { to: "/app/queue", search: {} };
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
  const { user } = useAuth();
  const meEmail = user?.email ?? "";
  const meId = user?.id ?? "";
  const today = todayYMD();

  const [filter, setFilter] = useState<FilterKey>("pending");
  const [workflow, setWorkflow] = useState<"all" | WorkflowType>("all");
  const [queue, setQueue] = useState<string>("all");
  const [search, setSearch] = useState("");

  // ── Primary contract (backend pre-sorted) ──
  const openQ = useQuery({
    queryKey: ["workflow-queue", "open"],
    queryFn: () => fetchQueue("open"),
    refetchInterval: 60_000,
    retry: false,
  });
  const doneQ = useQuery({
    queryKey: ["workflow-queue", "done"],
    queryFn: () => fetchQueue("done"),
    enabled: filter === "completed",
    refetchInterval: 60_000,
    retry: false,
  });

  // ── Fallback: derive the queue client-side if the service isn't there yet ──
  const usingFallback = openQ.isError;
  const synthQ = useQuery({
    queryKey: ["workflow-queue", "synthetic", meEmail, meId],
    queryFn: () => buildSyntheticQueue(meEmail, meId),
    enabled: usingFallback,
    refetchInterval: 60_000,
    retry: false,
  });

  const openTasks: Task[] = useMemo(
    () => openQ.data ?? (usingFallback ? (synthQ.data ?? []) : []),

    [openQ.data, usingFallback, synthQ.data],
  );
  const doneTasks: Task[] = useMemo(() => doneQ.data ?? [], [doneQ.data]);
  const isFetching = openQ.isFetching || doneQ.isFetching || synthQ.isFetching;
  const isLoading = openQ.isLoading || (usingFallback && synthQ.isLoading);

  const refresh = () => {
    openQ.refetch();
    if (filter === "completed") doneQ.refetch();
    if (usingFallback) synthQ.refetch();
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

  // ── Visible tasks (order preserved — backend already sorted) ──
  const visible = useMemo(() => {
    const base = filter === "completed" ? doneTasks : openTasks;
    const q = search.trim().toLowerCase();
    return base.filter((t) => {
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
  }, [filter, openTasks, doneTasks, workflow, queue, search, meEmail, meId, today]);

  const openTask = (t: Task) => {
    const r = resolveTaskRoute(t);
    navigate({ to: r.to, search: r.search } as never);
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
        }
      />

      <div className="mt-4 space-y-3">
        {usingFallback && !isLoading && (
          <p className="text-xs text-muted-foreground">
            Live workflow service unavailable — showing a derived queue from open documents.
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
              onChange={(e) => setQueue(e.target.value)}
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
              <TaskCard key={t.id} task={t} today={today} onOpen={() => openTask(t)} />
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

function TaskCard({ task: t, today, onOpen }: { task: Task; today: string; onOpen: () => void }) {
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
                <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
                {fmtINR(amount)}
              </span>
            )}
            <span
              className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
            >
              {fmtDue(t.due_date)}
            </span>
          </div>
          <button
            onClick={onOpen}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            {actionLabel(t.stage)}
          </button>
        </div>
      </div>
    </article>
  );
}
