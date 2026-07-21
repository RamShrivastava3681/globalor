import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { TABLES, putItem, getItem, scanTable, updateItem, deleteItem } from "../db/client.js";

const VALID_SUB_TYPES = [
  "fixed_asset",
  "bank", "cash", "petty_cash",
  "current_asset",
  "current_liability",
  "share_capital",
  "retained_earnings",
  "other",
] as const;

const router = Router();

// All routes require auth
router.use(requireAuth);

// ── GET / — List all accounts ──
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await scanTable(TABLES.CHART_OF_ACCOUNTS, getCompanyFilter(req.user!));
    accounts.sort((a: any, b: any) => (a.code ?? "").localeCompare(b.code ?? ""));
    res.json(accounts);
  } catch (err) {
    console.error("Error listing accounts:", err);
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

// ── GET /:id — Get single account ──
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const account = await getItem(TABLES.CHART_OF_ACCOUNTS, { id: req.params.id });
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }
    res.json(account);
  } catch (err) {
    console.error("Error getting account:", err);
    res.status(500).json({ error: "Failed to get account" });
  }
});

// ── POST / — Create account ──
router.post("/", async (req: Request, res: Response) => {
  try {
    const { code, name, type, description, sub_type } = req.body;

    if (!code || !name || !type) {
      return res.status(400).json({ error: "code, name, and type are required" });
    }

    const validTypes = ["asset", "liability", "equity", "revenue", "expense"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    }

    if (sub_type !== undefined && sub_type !== null && sub_type !== "" && !VALID_SUB_TYPES.includes(sub_type as any)) {
      return res.status(400).json({ error: `sub_type must be one of: ${VALID_SUB_TYPES.join(", ")}` });
    }

    // Check for duplicate code
    const existing = await scanTable(TABLES.CHART_OF_ACCOUNTS, {
      filterExpression: "#code = :code",
      expressionAttributeNames: { "#code": "code" },
      expressionAttributeValues: { ":code": code },
    });
    if (existing.length > 0) {
      return res.status(409).json({ error: `Account with code '${code}' already exists` });
    }

    const now = new Date().toISOString();
    const account = {
      id: randomUUID(),
      code,
      name,
      type,
      sub_type: sub_type || "",
      description: description || "",
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.CHART_OF_ACCOUNTS, account);
    res.status(201).json(account);
  } catch (err) {
    console.error("Error creating account:", err);
    res.status(500).json({ error: "Failed to create account" });
  }
});

// ── PATCH /:id — Update account ──
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await getItem(TABLES.CHART_OF_ACCOUNTS, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { code, name, type, description, sub_type, is_active } = req.body;
    const updates: Record<string, unknown> = {};

    if (code !== undefined) updates.code = code;
    if (name !== undefined) updates.name = name;
    if (type !== undefined) {
      const validTypes = ["asset", "liability", "equity", "revenue", "expense"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
      }
      updates.type = type;
    }
    if (sub_type !== undefined) {
      if (sub_type !== null && sub_type !== "" && !VALID_SUB_TYPES.includes(sub_type as any)) {
        return res.status(400).json({ error: `sub_type must be one of: ${VALID_SUB_TYPES.join(", ")}` });
      }
      updates.sub_type = sub_type;
    }
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;

    updates.updated_at = new Date().toISOString();

    const updated = await updateItem(TABLES.CHART_OF_ACCOUNTS, { id: req.params.id }, updates);
    res.json(updated);
  } catch (err) {
    console.error("Error updating account:", err);
    res.status(500).json({ error: "Failed to update account" });
  }
});

// ── GET /trial-balance — Compute trial balance from journal entries ──
router.get("/trial-balance", async (req: AuthRequest, res: Response) => {
  try {
    // Fetch all accounts and journal entries in parallel
    const [accounts, entries] = await Promise.all([
      scanTable(TABLES.CHART_OF_ACCOUNTS, getCompanyFilter(req.user!)),
      scanTable(TABLES.JOURNAL_ENTRIES, getCompanyFilter(req.user!)),
    ]);

    // Build a map of account_id -> { debit_total, credit_total }
    const balanceMap: Record<string, { debit_total: number; credit_total: number }> = {};

    for (const entry of entries as any[]) {
      const lines = entry.lines || [];
      for (const line of lines) {
        const accId = line.account_id;
        if (!accId) continue;
        if (!balanceMap[accId]) {
          balanceMap[accId] = { debit_total: 0, credit_total: 0 };
        }
        balanceMap[accId].debit_total += Number(line.debit_amount) || 0;
        balanceMap[accId].credit_total += Number(line.credit_amount) || 0;
      }
    }

    // Build trial balance rows for each account
    const trialBalance = (accounts as any[]).map((account) => {
      const balances = balanceMap[account.id] || { debit_total: 0, credit_total: 0 };
      const netBalance = balances.debit_total - balances.credit_total;

      // Standard trial balance: if the account has a net debit balance, show it in the debit column;
      // if it has a net credit balance, show it in the credit column
      const debit_balance = netBalance > 0 ? netBalance : 0;
      const credit_balance = netBalance < 0 ? Math.abs(netBalance) : 0;

      return {
        account_id: account.id,
        account_code: account.code,
        account_name: account.name,
        account_type: account.type,
        debit_balance,
        credit_balance,
        net_balance: netBalance,
      };
    });

    // Filter to only accounts with activity
    const activeRows = trialBalance.filter((r) => r.debit_balance > 0 || r.credit_balance > 0);

    // Sort by account code
    activeRows.sort((a, b) => (a.account_code ?? "").localeCompare(b.account_code ?? ""));

    // Compute totals
    const totalDebits = activeRows.reduce((s, r) => s + r.debit_balance, 0);
    const totalCredits = activeRows.reduce((s, r) => s + r.credit_balance, 0);

    // Also include accounts with zero balances if they exist
    const zeroBalanceRows = trialBalance
      .filter((r) => r.debit_balance === 0 && r.credit_balance === 0)
      .sort((a, b) => (a.account_code ?? "").localeCompare(b.account_code ?? ""));

    res.json({
      rows: activeRows,
      zero_balance_accounts: zeroBalanceRows,
      totals: {
        total_debits: totalDebits,
        total_credits: totalCredits,
      },
      balanced: Math.abs(totalDebits - totalCredits) < 0.001,
    });
  } catch (err) {
    console.error("Error computing trial balance:", err);
    res.status(500).json({ error: "Failed to compute trial balance" });
  }
});

// ── DELETE /:id — Delete account ──
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await getItem(TABLES.CHART_OF_ACCOUNTS, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    await deleteItem(TABLES.CHART_OF_ACCOUNTS, { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting account:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export default router;
