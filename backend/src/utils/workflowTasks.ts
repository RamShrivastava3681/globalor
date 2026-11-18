import { putItem, updateItem, scanTable, TABLES } from "../db/client.js";
import { generateId, nowISO } from "./helpers.js";
import { getCompanyFilter } from "../middleware/auth.js";
import type { WorkflowTask, WorkflowTaskType, WorkflowTaskPriority } from "../types/index.js";

/** Company-scoped scan AND-ed with an extra filter (never drops tenancy). */
async function scanTasks(
  companyId: string | null,
  extraFilter: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
): Promise<WorkflowTask[]> {
  const base = getCompanyFilter({ company_id: companyId });
  const filterExpression = [base.filterExpression, `(${extraFilter})`].filter(Boolean).join(" AND ");
  return scanTable<WorkflowTask>(TABLES.WORKFLOW_TASKS, {
    ...(filterExpression ? { filterExpression } : {}),
    expressionAttributeNames: names,
    expressionAttributeValues: { ...(base.expressionAttributeValues ?? {}), ...values },
  });
}

export type TaskSeed = Pick<
  WorkflowTask,
  | "workflow_type"
  | "stage"
  | "doc_type"
  | "doc_number"
  | "counterparty"
  | "doc_status"
  | "owner_role"
  | "required_action"
> & {
  /** Express params may be string|string[] — normalized inside ensureTask. */
  doc_id: string | string[];
} & Partial<
  Pick<
    WorkflowTask,
    | "assigned_user"
    | "next_action"
    | "priority"
    | "due_date"
    | "amount"
    | "latest_update"
    | "linked_docs"
  >
>;

function actorOf(companyId: string | null, clientId: string) {
  return { company_id: companyId, client_id: clientId };
}

/** Express 5 types params as string|string[] — normalize to a single id. */
function normId(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Idempotent task creation: an open task for the same (doc_type, doc_id,
 * stage) is refreshed instead of duplicated. Never throws — queue bookkeeping
 * must never break a document write.
 */
export async function ensureTask(
  companyId: string | null,
  clientId: string,
  seed: TaskSeed,
): Promise<WorkflowTask | null> {
  try {
    const docId = normId(seed.doc_id);
    const existing = await scanTasks(
      companyId,
      "doc_type = :dt AND doc_id = :di AND #stage = :st AND #status = :open",
      { "#stage": "stage", "#status": "status" },
      { ":dt": seed.doc_type, ":di": docId, ":st": seed.stage, ":open": "open" },
    );
    const now = nowISO();
    if (existing.length > 0) {
      const t = existing[0];
      const updated = (await updateItem(
        TABLES.WORKFLOW_TASKS,
        { id: t.id },
        {
          doc_number: seed.doc_number,
          counterparty: seed.counterparty,
          doc_status: seed.doc_status,
          owner_role: seed.owner_role,
          required_action: seed.required_action,
          next_action: seed.next_action ?? null,
          priority: seed.priority ?? t.priority ?? "normal",
          due_date: seed.due_date ?? t.due_date ?? null,
          amount: seed.amount ?? t.amount ?? null,
          latest_update: seed.latest_update ?? t.latest_update ?? null,
          linked_docs: seed.linked_docs ?? t.linked_docs ?? null,
          // The caller asserts this (doc, stage) should be actionable NOW.
          // A stale existence scan can match a task that completeTasksForDoc
          // just closed (DynamoDB reads are eventually consistent) — restoring
          // open state here makes the refresh converge instead of silently
          // swallowing the new stage behind a done task.
          status: "open",
          completed_by: null,
          completed_at: null,
          updated_at: now,
        },
      )) as unknown as WorkflowTask | undefined;
      return updated ?? null;
    }
    const task: WorkflowTask = {
      id: generateId(),
      ...actorOf(companyId, clientId),
      workflow_type: seed.workflow_type,
      stage: seed.stage,
      doc_type: seed.doc_type,
      doc_id: docId,
      doc_number: seed.doc_number ?? null,
      counterparty: seed.counterparty ?? null,
      doc_status: seed.doc_status ?? null,
      owner_role: seed.owner_role,
      assigned_user: seed.assigned_user ?? null,
      prev_owner: null,
      required_action: seed.required_action,
      next_action: seed.next_action ?? null,
      priority: seed.priority ?? "normal",
      due_date: seed.due_date ?? null,
      amount: seed.amount ?? null,
      latest_update: seed.latest_update ?? null,
      linked_docs: seed.linked_docs ?? null,
      status: "open",
      completed_by: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.WORKFLOW_TASKS, task as any);
    return task;
  } catch (err) {
    console.error("   ⚠️ ensureTask failed (non-blocking):", err);
    return null;
  }
}

/** Mark every open task on a document done (optionally only one stage). */
export async function completeTasksForDoc(
  companyId: string | null,
  docType: string,
  docId: string | string[],
  completedBy: string | null,
  stage?: string,
  note?: string,
): Promise<void> {
  try {
    const now = nowISO();
    const open = await scanTasks(
      companyId,
      "doc_type = :dt AND doc_id = :di AND #status = :open",
      { "#status": "status" },
      { ":dt": docType, ":di": normId(docId), ":open": "open" },
    );
    for (const t of open) {
      if (stage && t.stage !== stage) continue;
      await updateItem(TABLES.WORKFLOW_TASKS, { id: t.id }, {
        status: "done",
        completed_by: completedBy,
        completed_at: now,
        latest_update: note ?? t.latest_update ?? null,
        updated_at: now,
      });
    }
  } catch (err) {
    console.error("   ⚠️ completeTasksForDoc failed (non-blocking):", err);
  }
}

/** Cancel every open task on a document (voids, deletes, rejects-out). */
export async function cancelTasksForDoc(
  companyId: string | null,
  docType: string,
  docId: string | string[],
  note?: string,
): Promise<void> {
  try {
    const now = nowISO();
    const open = await scanTasks(
      companyId,
      "doc_type = :dt AND doc_id = :di AND #status = :open",
      { "#status": "status" },
      { ":dt": docType, ":di": normId(docId), ":open": "open" },
    );
    for (const t of open) {
      await updateItem(TABLES.WORKFLOW_TASKS, { id: t.id }, {
        status: "cancelled",
        completed_at: now,
        latest_update: note ?? t.latest_update ?? null,
        updated_at: now,
      });
    }
  } catch (err) {
    console.error("   ⚠️ cancelTasksForDoc failed (non-blocking):", err);
  }
}

const TERMINAL = new Set([
  "cancelled", "paid", "delivered", "fully_received", "fullyreceived",
  "fully_dispatched", "fullydispatched", "converted_to_po", "converted_to_so",
  "converted", "expired",
]);
const isTerminal = (s: unknown) => TERMINAL.has(String(s ?? "").toLowerCase());

function isAdvanceTerms(v: unknown): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "advance" || t === "advance payment" || t === "advance_payment" || t.startsWith("advance");
}

function pickStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  }
  return null;
}

function pickNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type Seed = Omit<TaskSeed, "workflow_type"> & { workflow_type: WorkflowTaskType };

/**
 * Derive the open-task set for every live document — the server-side mirror
 * of the queue rules. Used by POST /workflow-tasks/backfill to rebuild the
 * queue from current documents (one-time migration + repair).
 */
export function deriveOpenTasks(docs: {
  salesOrders: any[];
  purchaseOrders: any[];
  salesInvoices: any[];
  purchaseInvoices: any[];
  proformas: any[];
  grns: any[];
  dispatches: any[];
  advances: any[];
}): Seed[] {
  const out: Seed[] = [];

  for (const d of docs.salesOrders) {
    const st = String(d.status ?? d.manual_status ?? "draft").toLowerCase();
    const n = pickStr(d.so_number, d.soNumber, d.number) ?? "—";
    const party = pickStr(d.customer_name, d.customerName, d.customer?.name);
    const amount = pickNum(d.grand_total, d.grandTotal, d.amount);
    const base = { workflow_type: "sales_order" as const, doc_type: "sales_order", doc_id: String(d.id), doc_number: n, counterparty: party, amount };
    if (st === "draft") {
      out.push({ ...base, stage: "submit", doc_status: st, owner_role: "sales", required_action: `Send sales order ${n} to warehouse`, next_action: "Warehouse approval" });
    } else if (st === "pending_warehouse_approval") {
      out.push({ ...base, stage: "warehouse_approve", doc_status: st, owner_role: "warehouse", required_action: `Approve sales order ${n} (warehouse)`, next_action: "Checker approval" });
    } else if (st === "pending_checker_approval") {
      out.push({ ...base, stage: "checker_approve", doc_status: st, owner_role: "checker", required_action: `Approve sales order ${n} (checker)`, next_action: "Dispatch & invoice" });
    } else if (["approved", "confirmed", "sent", "partially_dispatched", "partiallydispatched"].includes(st)) {
      if (isAdvanceTerms(d.payment_terms)) {
        const hasProforma = docs.proformas.some((p: any) => String(p.linked_po_id ?? p.linkedPoId ?? "") === String(d.id) || String(p.side ?? "").toLowerCase() === "sales" && String(p.po_number ?? "") === String(d.so_number ?? ""));
        if (!hasProforma) {
          out.push({ ...base, stage: "create_proforma", doc_status: st, owner_role: "sales", required_action: `Create proforma for sales order ${n} (advance terms)`, next_action: "Checker approval", linked_docs: [{ type: "sales_order", id: String(d.id), number: n }] });
        } else {
          out.push({ ...base, stage: "create_invoice", doc_status: st, owner_role: "sales", required_action: `Create sales invoice for ${n} (proforma linked)`, next_action: "Record UTR / IRN", linked_docs: [{ type: "sales_order", id: String(d.id), number: n }] });
        }
      } else {
        out.push({ ...base, stage: "dispatch_invoice", doc_status: st, owner_role: "sales", required_action: `Dispatch or invoice ${n}`, next_action: "Create tax invoice", linked_docs: [{ type: "sales_order", id: String(d.id), number: n }] });
      }
    } else if (!isTerminal(st)) {
      out.push({ ...base, stage: "create_invoice", doc_status: st, owner_role: "sales", required_action: `Create tax invoice for ${n}`, next_action: "Record UTR" });
    }
  }

  for (const d of docs.purchaseOrders) {
    const st = String(d.status ?? d.manual_status ?? "draft").toLowerCase();
    const n = pickStr(d.po_number, d.poNumber, d.number) ?? "—";
    const party = pickStr(d.supplier_name, d.supplierName, d.vendor?.name);
    const amount = pickNum(d.grand_total, d.grandTotal, d.amount);
    const base = { workflow_type: "purchase_order" as const, doc_type: "purchase_order", doc_id: String(d.id), doc_number: n, counterparty: party, amount };
    if (st === "draft") {
      out.push({ ...base, stage: "submit", doc_status: st, owner_role: "purchase", required_action: `Send purchase order ${n} to checker`, next_action: "Checker approval" });
    } else if (st === "pending_approval" || st === "pendingapproval") {
      out.push({ ...base, stage: "approve", doc_status: st, owner_role: "checker", required_action: `Approve purchase order ${n} (checker)`, next_action: "Create proforma or invoice" });
    } else if (["sent", "approved", "partially_received", "partiallyreceived"].includes(st)) {
      // Branch on payment terms: Advance → proforma, else invoice. Avoid duplicate proforma task if one already exists.
      const hasProforma = docs.proformas.some((p: any) => String(p.linked_po_id ?? p.linkedPoId ?? p.po_id ?? "") === String(d.id));
      const advance = isAdvanceTerms(d.payment_terms ?? (d as any).paymentTerms);
      if (advance && !hasProforma) {
        out.push({ ...base, stage: "create_proforma", doc_status: st, owner_role: "purchase", required_action: `Create purchase proforma for ${n} (advance terms)`, next_action: "Checker approval", linked_docs: [{ type: "purchase_order", id: String(d.id), number: n }] });
      } else if (advance && hasProforma) {
        out.push({ ...base, stage: "create_invoice", doc_status: st, owner_role: "purchase", required_action: `Create purchase invoice for ${n} (proforma linked)`, next_action: "Verify & pay", linked_docs: [{ type: "purchase_order", id: String(d.id), number: n }] });
      } else {
        out.push({ ...base, stage: "create_invoice", doc_status: st, owner_role: "purchase", required_action: `Create purchase invoice for ${n}`, next_action: "Verify & pay", linked_docs: [{ type: "purchase_order", id: String(d.id), number: n }] });
      }
      // Also surface GRN action when goods are expected
      if (st === "partially_received" || st === "partiallyreceived" || st === "sent") {
        out.push({ ...base, stage: "create_grn", doc_status: st, owner_role: "warehouse", required_action: `Create GRN for ${n}`, next_action: "Confirm receipt" });
      }
    } else if (!isTerminal(st) && st !== "cancelled") {
      out.push({ ...base, stage: "await_goods", doc_status: st, owner_role: "warehouse", required_action: `Receive goods for ${n}`, next_action: "Create GRN" });
    }
  }

  for (const d of docs.purchaseInvoices) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (isTerminal(st)) continue;
    const n = pickStr(d.invoice_number, d.invoiceNumber, d.number) ?? "—";
    const party = pickStr(d.vendor?.name, d.supplier_name);
    const amount = pickNum(d.amount, d.net_payable);
    const base = { workflow_type: "purchase_invoice" as const, doc_type: "purchase_invoice", doc_id: String(d.id), doc_number: n, counterparty: party, amount };
    if (st === "draft") {
      out.push({ ...base, stage: "verify", doc_status: st, owner_role: "finance", required_action: `Verify purchase invoice ${n}`, next_action: "Approve for payment" });
    } else if (st.includes("approve") || st === "verified") {
      out.push({ ...base, stage: "approve_for_payment", doc_status: st, owner_role: "finance", required_action: `Approve payment for ${n}`, next_action: "Record payment", priority: (amount ?? 0) >= 100000 ? "high" as WorkflowTaskPriority : "normal" });
    } else {
      out.push({ ...base, stage: "record_payment", doc_status: st, owner_role: "treasury", required_action: `Record payment for ${n}`, next_action: "Close invoice" });
    }
  }

  for (const d of docs.salesInvoices) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (isTerminal(st)) continue;
    const n = pickStr(d.invoice_number, d.invoiceNumber, d.number) ?? "—";
    const party = pickStr(d.customer?.name, d.customer_name);
    const amount = pickNum(d.amount);
    const base = { workflow_type: "sales_invoice" as const, doc_type: "sales_invoice", doc_id: String(d.id), doc_number: n, counterparty: party, amount };
    if (st === "draft") {
      out.push({ ...base, stage: "review", doc_status: st, owner_role: "finance", required_action: `Review sales invoice ${n}`, next_action: "Approve invoice" });
    } else if (st === "pending" || st === "issued" || st.includes("pending")) {
      out.push({ ...base, stage: "approve", doc_status: st, owner_role: "finance", required_action: `Approve sales invoice ${n}`, next_action: "Record UTR" });
    } else {
      out.push({ ...base, stage: "record_utr", doc_status: st, owner_role: "treasury", required_action: `Record UTR for ${n}`, next_action: "Confirm receipt", priority: st === "overdue" ? "urgent" as WorkflowTaskPriority : "normal", due_date: d.due_date ?? null });
    }
  }

  for (const d of docs.proformas) {
    const fst = String(d.proforma_status ?? d.proformaStatus ?? "").toLowerCase();
    if (fst !== "" && fst !== "pending_review" && fst !== "approved") continue;
    const side = String(d.side ?? "").toLowerCase();
    const n = pickStr(d.proforma_number, d.proformaNumber, d.po_number, d.poNumber) ?? "—";
    const party = pickStr(side === "sales" ? d.customer?.name : d.vendor?.name, side === "sales" ? d.customer_name : d.vendor_name);
    out.push({
      workflow_type: "proforma", doc_type: "proforma", doc_id: String(d.id), doc_number: n,
      counterparty: party, doc_status: fst || String(d.status ?? ""),
      amount: pickNum(d.amount), owner_role: side === "sales" ? "sales" : "purchase",
      stage: fst === "approved" ? "convert" : "approve",
      required_action: fst === "approved" ? `Convert proforma ${n} to order` : `Approve proforma ${n}`,
      next_action: "Create order",
    });
  }

  for (const d of docs.grns) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (st !== "draft") continue;
    const n = pickStr(d.receipt_number, d.receiptNumber, d.grn_number, d.number) ?? "—";
    out.push({
      workflow_type: "grn", doc_type: "grn", doc_id: String(d.id), doc_number: n,
      counterparty: pickStr(d.supplier_name), doc_status: st, amount: null,
      owner_role: "warehouse", stage: "confirm",
      required_action: `Confirm GRN ${n}`, next_action: "Stock in",
    });
  }

  for (const d of docs.dispatches) {
    const st = String(d.status ?? "draft").toLowerCase();
    if (st !== "draft") continue;
    const n = pickStr(d.dispatch_number, d.dispatchNumber, d.number) ?? "—";
    out.push({
      workflow_type: "dispatch", doc_type: "dispatch", doc_id: String(d.id), doc_number: n,
      counterparty: pickStr(d.customer_name), doc_status: st, amount: null,
      owner_role: "warehouse", stage: "confirm",
      required_action: `Confirm dispatch ${n}`, next_action: "Mark delivered",
    });
  }

  for (const d of docs.advances) {
    const st = String(d.status ?? "pending").toLowerCase();
    if (!st.includes("pending")) continue;
    const n = pickStr(d.reference, d.advance_number, d.number) ?? "—";
    out.push({
      workflow_type: "payment", doc_type: "payment", doc_id: String(d.id), doc_number: n,
      counterparty: null, doc_status: st, amount: pickNum(d.amount),
      owner_role: "treasury", stage: "approve",
      required_action: `Approve advance ${n}`, next_action: "Release funds",
    });
  }

  return out;
}
