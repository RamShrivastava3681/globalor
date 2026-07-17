import { Router, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { scanTable, getItem, putItem, updateItem, TABLES } from "../db/client.js";
import { randomUUID } from "crypto";

const router = Router();

// ── Section enum (maps to balance sheet sections) ──
export const BALANCE_SHEET_SECTIONS = [
  "tangible_asset",
  "cash_bank",
  "accounts_receivable",
  "accounts_payable",
  "customer_advance",
  "rounding",
  "share_capital",
  "retained_earnings",
  "other_current_asset",
  "other_current_liability",
  "other_equity",
] as const;

export type BalanceSheetSection = (typeof BALANCE_SHEET_SECTIONS)[number];

const SECTION_LABELS: Record<BalanceSheetSection, string> = {
  tangible_asset: "Tangible Assets",
  cash_bank: "Cash at bank and in hand",
  accounts_receivable: "Accounts Receivable",
  accounts_payable: "Accounts Payable",
  customer_advance: "Advance received from Customers",
  rounding: "Rounding",
  share_capital: "Share Capital",
  retained_earnings: "Retained Earnings",
  other_current_asset: "Other Current Assets",
  other_current_liability: "Other Current Liabilities",
  other_equity: "Other Equity",
};

export interface BalanceSheetItem {
  id: string;
  section: BalanceSheetSection;
  type: "auto" | "manual";
  description: string;
  amount: number;
  date: string;
  account_id?: string;
  notes?: string;
  is_active: boolean;
  is_opening_balance?: boolean;
  created_at: string;
  updated_at: string;
}

// ── GET /api/balance-sheet-items ──
// List all active manual items, optionally filtered by section
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const allItems = await scanTable<BalanceSheetItem>(TABLES.BALANCE_SHEET_ITEMS);

    const sectionFilter = req.query.section as string | undefined;
    const showInactive = req.query.showInactive === "true";

    const filtered = allItems.filter((item) => {
      if (!showInactive && !item.is_active) return false;
      if (sectionFilter && item.section !== sectionFilter) return false;
      return true;
    });

    // Group by section
    const grouped: Record<string, BalanceSheetItem[]> = {};
    for (const item of filtered) {
      const sec = item.section;
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(item);
    }

    res.json({
      items: filtered.sort(
        (a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)
      ),
      grouped,
    });
  } catch (err) {
    console.error("List balance sheet items error:", err);
    res.status(500).json({ error: "Failed to list balance sheet items" });
  }
});

// ── GET /api/balance-sheet-items/:id ──
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const item = await getItem(TABLES.BALANCE_SHEET_ITEMS, { id: req.params.id });
    if (!item) {
      return res.status(404).json({ error: "Balance sheet item not found" });
    }
    res.json(item);
  } catch (err) {
    console.error("Get balance sheet item error:", err);
    res.status(500).json({ error: "Failed to get balance sheet item" });
  }
});

// ── POST /api/balance-sheet-items ──
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { section, description, amount, date, account_id, notes, is_opening_balance } = req.body;

    // Validation
    if (!section || !BALANCE_SHEET_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `Invalid section. Must be one of: ${BALANCE_SHEET_SECTIONS.join(", ")}` });
    }
    if (!description?.trim()) {
      return res.status(400).json({ error: "Description is required" });
    }
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: "A valid amount is required" });
    }
    if (!date) {
      return res.status(400).json({ error: "Date is required" });
    }

    const now = new Date().toISOString();
    const item: BalanceSheetItem = {
      id: randomUUID(),
      section,
      type: "manual",
      description: description.trim(),
      amount: Number(amount),
      date,
      account_id: account_id || undefined,
      notes: notes?.trim() || undefined,
      is_active: true,
      is_opening_balance: !!is_opening_balance,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.BALANCE_SHEET_ITEMS, item as any);
    res.status(201).json(item);
  } catch (err) {
    console.error("Create balance sheet item error:", err);
    res.status(500).json({ error: "Failed to create balance sheet item" });
  }
});

// ── PATCH /api/balance-sheet-items/:id ──
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.BALANCE_SHEET_ITEMS, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Balance sheet item not found" });
    }

    const { section, description, amount, date, account_id, notes, is_active, is_opening_balance } = req.body;

    const updates: Record<string, unknown> = {};
    if (section !== undefined) {
      if (!BALANCE_SHEET_SECTIONS.includes(section)) {
        return res.status(400).json({ error: "Invalid section" });
      }
      updates.section = section;
    }
    if (description !== undefined) updates.description = description.trim();
    if (amount !== undefined) updates.amount = Number(amount);
    if (date !== undefined) updates.date = date;
    if (account_id !== undefined) updates.account_id = account_id || undefined;
    if (notes !== undefined) updates.notes = notes?.trim() || undefined;
    if (is_active !== undefined) updates.is_active = is_active;
    if (is_opening_balance !== undefined) updates.is_opening_balance = is_opening_balance;
    updates.updated_at = new Date().toISOString();

    const updated = await updateItem(TABLES.BALANCE_SHEET_ITEMS, { id: req.params.id }, updates);
    res.json(updated);
  } catch (err) {
    console.error("Update balance sheet item error:", err);
    res.status(500).json({ error: "Failed to update balance sheet item" });
  }
});

// ── DELETE /api/balance-sheet-items/:id (soft delete) ──
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getItem(TABLES.BALANCE_SHEET_ITEMS, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Balance sheet item not found" });
    }

    await updateItem(TABLES.BALANCE_SHEET_ITEMS, { id: req.params.id }, {
      is_active: false,
      updated_at: new Date().toISOString(),
    });
    res.status(204).send();
  } catch (err) {
    console.error("Delete balance sheet item error:", err);
    res.status(500).json({ error: "Failed to delete balance sheet item" });
  }
});

export default router;
export { SECTION_LABELS, BALANCE_SHEET_SECTIONS as SECTIONS };
