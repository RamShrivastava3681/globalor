import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type {
  CashAccount,
  ExpectedInflow,
  ExpectedOutflow,
  MarketplaceSettlement,
  RecurringExpense,
  PurchaseCommitment,
  TreasurySettings,
} from "../types/index.js";

const router = Router();
const write = requireWriteAccess("cash");
const money = z.number().min(0, "Amount must be >= 0");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

async function list<T>(table: string, req: AuthRequest, res: Response, sort?: (a: T, b: T) => number) {
  try {
    const rows = await scanTable<T>(table, getCompanyFilter(req.user!));
    res.json(sort ? [...rows].sort(sort) : rows);
  } catch (err) {
    console.error(`Get ${table} error:`, err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function baseFields(req: AuthRequest) {
  return {
    id: generateId(),
    client_id: req.user!.id,
    company_id: req.user!.company_id,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

async function remove(table: string, req: AuthRequest, res: Response) {
  try {
    await deleteItem(table, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error(`Delete ${table} error:`, err);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function patch(table: string, req: AuthRequest, res: Response) {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;
    delete updates.client_id;
    delete updates.company_id;
    const updated = await updateItem(table, { id: req.params.id }, updates);
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error(`Update ${table} error:`, err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Cash accounts ──
router.get("/accounts", requireAuth, (req: AuthRequest, res: Response) =>
  list<CashAccount>(TABLES.CASH_ACCOUNTS, req, res, (a, b) => a.name.localeCompare(b.name)),
);

const accountSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["BANK", "CASH", "MARKETPLACE", "FIXED_DEPOSIT"]),
  current_balance: money,
  restricted_balance: money.optional().default(0),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});

router.post("/accounts", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = accountSchema.parse(req.body);
    const row: CashAccount = {
      ...baseFields(req),
      name: p.name,
      type: p.type,
      current_balance: p.current_balance,
      restricted_balance: p.restricted_balance ?? 0,
      status: p.status ?? "active",
    };
    await putItem(TABLES.CASH_ACCOUNTS, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create cash account error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/accounts/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.CASH_ACCOUNTS, req, res),
);
router.delete("/accounts/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.CASH_ACCOUNTS, req, res),
);

// ── Expected inflows ──
router.get("/inflows", requireAuth, (req: AuthRequest, res: Response) =>
  list<ExpectedInflow>(TABLES.EXPECTED_INFLOWS, req, res, (a, b) =>
    (a.expected_date || "").localeCompare(b.expected_date || ""),
  ),
);

const inflowSchema = z.object({
  type: z.string().min(1).max(120).optional().default("OTHER"),
  amount: money,
  expected_date: ymd,
  status: z.enum(["EXPECTED", "OVERDUE", "RECEIVED", "CANCELLED"]).optional().default("EXPECTED"),
  source: z.enum(["manual", "invoice", "settlement"]).optional().default("manual"),
  source_id: z.string().nullable().optional(),
  customer_name: z.string().max(200).nullable().optional(),
});

router.post("/inflows", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = inflowSchema.parse(req.body);
    const row: ExpectedInflow = {
      ...baseFields(req),
      type: p.type ?? "OTHER",
      amount: p.amount,
      expected_date: p.expected_date,
      status: p.status ?? "EXPECTED",
      source: p.source ?? "manual",
      source_id: p.source_id || null,
      customer_name: p.customer_name || null,
    };
    await putItem(TABLES.EXPECTED_INFLOWS, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create inflow error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/inflows/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.EXPECTED_INFLOWS, req, res),
);
router.delete("/inflows/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.EXPECTED_INFLOWS, req, res),
);

// ── Expected outflows ──
router.get("/outflows", requireAuth, (req: AuthRequest, res: Response) =>
  list<ExpectedOutflow>(TABLES.EXPECTED_OUTFLOWS, req, res, (a, b) =>
    (a.expected_date || "").localeCompare(b.expected_date || ""),
  ),
);

const outflowSchema = z.object({
  type: z.enum(["SUPPLIER_PAYMENT", "OPERATIONAL", "OTHER"]).optional().default("OTHER"),
  amount: money,
  expected_date: ymd,
  status: z.enum(["EXPECTED", "OVERDUE", "PAID", "CANCELLED"]).optional().default("EXPECTED"),
  supplier_name: z.string().max(200).nullable().optional(),
});

router.post("/outflows", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = outflowSchema.parse(req.body);
    const row: ExpectedOutflow = {
      ...baseFields(req),
      type: p.type ?? "OTHER",
      amount: p.amount,
      expected_date: p.expected_date,
      status: p.status ?? "EXPECTED",
      supplier_name: p.supplier_name || null,
    };
    await putItem(TABLES.EXPECTED_OUTFLOWS, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create outflow error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/outflows/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.EXPECTED_OUTFLOWS, req, res),
);
router.delete("/outflows/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.EXPECTED_OUTFLOWS, req, res),
);

// ── Marketplace settlements ──
router.get("/settlements", requireAuth, (req: AuthRequest, res: Response) =>
  list<MarketplaceSettlement>(TABLES.MARKETPLACE_SETTLEMENTS, req, res, (a, b) =>
    (a.expected_date || "").localeCompare(b.expected_date || ""),
  ),
);

const settlementSchema = z.object({
  marketplace_name: z.string().min(1).max(120),
  net_expected: money,
  expected_date: ymd,
  actual_date: ymd.nullable().optional(),
  status: z.enum(["EXPECTED", "DELAYED", "RECEIVED", "DISPUTED"]).optional().default("EXPECTED"),
});

router.post("/settlements", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = settlementSchema.parse(req.body);
    const row: MarketplaceSettlement = {
      ...baseFields(req),
      marketplace_name: p.marketplace_name,
      net_expected: p.net_expected,
      expected_date: p.expected_date,
      actual_date: p.actual_date || null,
      status: p.status ?? "EXPECTED",
    };
    await putItem(TABLES.MARKETPLACE_SETTLEMENTS, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create settlement error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settlements/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.MARKETPLACE_SETTLEMENTS, req, res),
);
router.delete("/settlements/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.MARKETPLACE_SETTLEMENTS, req, res),
);

// ── Recurring expenses ──
router.get("/recurring", requireAuth, (req: AuthRequest, res: Response) =>
  list<RecurringExpense>(TABLES.RECURRING_EXPENSES, req, res, (a, b) =>
    a.category.localeCompare(b.category),
  ),
);

const recurringSchema = z.object({
  category: z.string().min(1).max(120),
  amount: money,
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]),
  payment_day: z.number().int().min(1).max(31),
  status: z.enum(["active", "paused"]).optional().default("active"),
});

router.post("/recurring", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = recurringSchema.parse(req.body);
    const row: RecurringExpense = {
      ...baseFields(req),
      category: p.category,
      amount: p.amount,
      frequency: p.frequency,
      payment_day: p.payment_day,
      status: p.status ?? "active",
    };
    await putItem(TABLES.RECURRING_EXPENSES, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create recurring error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/recurring/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.RECURRING_EXPENSES, req, res),
);
router.delete("/recurring/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.RECURRING_EXPENSES, req, res),
);

// ── Purchase commitments (manual planning inputs; goods POs stay read-only) ──
router.get("/commitments", requireAuth, (req: AuthRequest, res: Response) =>
  list<PurchaseCommitment>(TABLES.PURCHASE_COMMITMENTS, req, res, (a, b) =>
    (a.expected_payment_date || "").localeCompare(b.expected_payment_date || ""),
  ),
);

const commitmentSchema = z.object({
  supplier_name: z.string().min(1).max(200),
  expected_payment_amount: money,
  expected_payment_date: ymd,
  status: z.enum(["PENDING", "APPROVED", "CANCELLED"]).optional().default("PENDING"),
  linked_po: z.string().max(120).nullable().optional(),
});

router.post("/commitments", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const p = commitmentSchema.parse(req.body);
    const row: PurchaseCommitment = {
      ...baseFields(req),
      supplier_name: p.supplier_name,
      expected_payment_amount: p.expected_payment_amount,
      expected_payment_date: p.expected_payment_date,
      status: p.status ?? "PENDING",
      linked_po: p.linked_po || null,
    };
    await putItem(TABLES.PURCHASE_COMMITMENTS, row as any);
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create commitment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/commitments/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  patch(TABLES.PURCHASE_COMMITMENTS, req, res),
);
router.delete("/commitments/:id", requireAuth, write, (req: AuthRequest, res: Response) =>
  remove(TABLES.PURCHASE_COMMITMENTS, req, res),
);

// ── Treasury settings (one row per company) ──
function settingsId(companyId: string | null): string {
  return companyId ? `treasury:${companyId}` : "treasury:global";
}

router.get("/settings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = settingsId(req.user!.company_id);
    const s = (await getItem(TABLES.TREASURY_SETTINGS, { id })) as TreasurySettings | undefined;
    res.json(
      s ?? { id, company_id: req.user!.company_id, minimum_buffer: 0, created_at: null, updated_at: null },
    );
  } catch (err) {
    console.error("Get treasury settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings", requireAuth, write, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = z.object({ minimum_buffer: money }).parse(req.body);
    const id = settingsId(req.user!.company_id);
    const now = nowISO();
    const existing = (await getItem(TABLES.TREASURY_SETTINGS, { id })) as TreasurySettings | undefined;
    const row: TreasurySettings = {
      id,
      company_id: req.user!.company_id,
      minimum_buffer: parsed.minimum_buffer,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await putItem(TABLES.TREASURY_SETTINGS, row as any);
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update treasury settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
