import { Router, Response } from "express";
import { z } from "zod";
import { scanTable, updateItem, TABLES } from "../db/client.js";
import { requireAuth, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { nowISO } from "../utils/helpers.js";
import { ensureTask, deriveOpenTasks } from "../utils/workflowTasks.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { WorkflowTask } from "../types/index.js";

const router = Router();

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function mineFirst(tasks: WorkflowTask[], email: string, id: string, today: string): WorkflowTask[] {
  const me = (u: string | null) => !!u && (u.toLowerCase() === email.toLowerCase() || u === id);
  // SLA: overdue open tasks outrank everything except personal assignment.
  const isOd = (t: WorkflowTask) => !!t.due_date && t.due_date.slice(0, 10) < today;
  return [...tasks].sort((a, b) => {
    const mine = Number(me(b.assigned_user)) - Number(me(a.assigned_user));
    if (mine !== 0) return mine;
    const od = Number(isOd(b)) - Number(isOd(a));
    if (od !== 0) return od;
    const pri = (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) - (PRIORITY_RANK[b.priority ?? "normal"] ?? 2);
    if (pri !== 0) return pri;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}

// ── GET /api/workflow-tasks?status=open|done ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status === "done" ? "done" : "open";
    const base = getCompanyFilter(req.user!);
    const filterExpression = [base.filterExpression, "(#status = :st)"].filter(Boolean).join(" AND ");
    const tasks = await scanTable<WorkflowTask>(TABLES.WORKFLOW_TASKS, {
      ...(filterExpression ? { filterExpression } : {}),
      expressionAttributeNames: { "#status": "status" },
      expressionAttributeValues: { ...(base.expressionAttributeValues ?? {}), ":st": status },
    });
    res.json(mineFirst(tasks, req.user!.email, req.user!.id, new Date().toISOString().slice(0, 10)));
  } catch (err) {
    console.error("Get workflow tasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/workflow-tasks ── (idempotent ensure)
const seedSchema = z.object({
  workflow_type: z.enum(["sales_order", "purchase_order", "purchase_invoice", "sales_invoice", "proforma", "payment", "grn", "dispatch"]),
  stage: z.string().min(1).max(80),
  doc_type: z.string().min(1).max(80),
  doc_id: z.string().min(1).max(200),
  doc_number: z.string().max(120).nullable().optional(),
  counterparty: z.string().max(240).nullable().optional(),
  doc_status: z.string().max(80).nullable().optional(),
  owner_role: z.string().min(1).max(80),
  assigned_user: z.string().max(320).nullable().optional(),
  required_action: z.string().min(1).max(500),
  next_action: z.string().max(500).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  due_date: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  latest_update: z.string().max(2000).nullable().optional(),
});

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = seedSchema.parse(req.body);
    const task = await ensureTask(req.user!.company_id, req.user!.id, {
      ...parsed,
      doc_number: parsed.doc_number ?? null,
      counterparty: parsed.counterparty ?? null,
      doc_status: parsed.doc_status ?? null,
    });
    if (!task) {
      res.status(500).json({ error: "Could not create task" });
      return;
    }
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create workflow task error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/workflow-tasks/:id ── (assign / reprioritize / complete / cancel)
const patchSchema = z.object({
  assigned_user: z.string().max(320).nullable().optional(),
  owner_role: z.string().max(80).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  latest_update: z.string().max(2000).nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
  linked_docs: z.array(z.object({ type: z.string(), id: z.string(), number: z.string() })).nullable().optional(),
}).strict();

router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = patchSchema.parse(req.body);
    const now = nowISO();
    const updates: Record<string, unknown> = { ...parsed, updated_at: now };
    if (parsed.status === "done") {
      updates.completed_by = req.user!.id;
      updates.completed_at = now;
    }
    if (parsed.status === "open") {
      updates.completed_by = null;
      updates.completed_at = null;
    }
    const updated = await updateItem(TABLES.WORKFLOW_TASKS, { id: req.params.id }, updates);
    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update workflow task error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/workflow-tasks/backfill ──
// Rebuilds the open queue from live documents (one-time migration + repair).
// Existing open tasks are refreshed in place; nothing is duplicated.
router.post("/backfill", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.company_id;
    const filter = getCompanyFilter(req.user!);
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
      scanTable<any>(TABLES.GOODS_SALES_ORDERS, filter),
      scanTable<any>(TABLES.GOODS_PURCHASE_ORDERS, filter),
      scanTable<any>(TABLES.INVOICES, filter),
      scanTable<any>(TABLES.PURCHASE_INVOICES, filter),
      scanTable<any>(TABLES.PURCHASE_ORDERS, filter),
      scanTable<any>(TABLES.GOODS_RECEIPTS, filter),
      scanTable<any>(TABLES.GOODS_DISPATCHES, filter),
      scanTable<any>(TABLES.ADVANCES, filter),
    ]);
    const seeds = deriveOpenTasks({
      salesOrders, purchaseOrders, salesInvoices, purchaseInvoices,
      proformas, grns, dispatches, advances,
    });
    let created = 0;
    for (const seed of seeds) {
      const t = await ensureTask(companyId, req.user!.id, seed);
      if (t) created += 1;
    }
    res.json({ ensured: created, derived: seeds.length });
  } catch (err) {
    console.error("Backfill workflow tasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/workflow-tasks/sweep ──
// SLA escalation: overdue open tasks are bumped to urgent with a dated note
// and raise one activity alert per task per day. Idempotent — safe to call on
// every queue visit (the frontend does it once per session).
router.post("/sweep", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tag = `ESCALATED ${today}:`;
    const base = getCompanyFilter(req.user!);
    const filterExpression = [base.filterExpression, "(#status = :open)"].filter(Boolean).join(" AND ");
    const open = await scanTable<WorkflowTask>(TABLES.WORKFLOW_TASKS, {
      ...(filterExpression ? { filterExpression } : {}),
      expressionAttributeNames: { "#status": "status" },
      expressionAttributeValues: { ...(base.expressionAttributeValues ?? {}), ":open": "open" },
    });
    const now = nowISO();
    let escalated = 0;
    for (const t of open) {
      if (!t.due_date || t.due_date.slice(0, 10) >= today) continue;
      if (t.priority === "urgent" && (t.latest_update ?? "").includes(tag)) continue; // already escalated today
      await updateItem(TABLES.WORKFLOW_TASKS, { id: t.id }, {
        priority: "urgent",
        latest_update: `${tag} overdue since ${t.due_date.slice(0, 10)} — auto-escalated`,
        updated_at: now,
      });
      escalated += 1;
      createActivityAlert({
        client_id: t.client_id,
        company_id: t.company_id,
        type: "overdue",
        severity: (t.amount ?? 0) >= 50000 ? "critical" : "warning",
        message: `Overdue queue task: ${t.required_action} (due ${t.due_date.slice(0, 10)})`,
        created_by: req.user!.id,
      });
    }
    res.json({ checked: open.length, escalated });
  } catch (err) {
    console.error("Sweep workflow tasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
