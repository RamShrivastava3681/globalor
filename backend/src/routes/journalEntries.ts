import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { TABLES, putItem, getItem, scanTable, updateItem, deleteItem } from "../db/client.js";

const router = Router();

// All routes require auth
router.use(requireAuth);

// ── GET / — List all journal entries ──
router.get("/", async (_req: Request, res: Response) => {
  try {
    const entries = await scanTable(TABLES.JOURNAL_ENTRIES);
    // Sort by entry date descending, then created at descending
    entries.sort((a: any, b: any) => {
      const dateCmp = (b.entry_date ?? "").localeCompare(a.entry_date ?? "");
      if (dateCmp !== 0) return dateCmp;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
    res.json(entries);
  } catch (err) {
    console.error("Error listing journal entries:", err);
    res.status(500).json({ error: "Failed to list journal entries" });
  }
});

// ── GET /:id — Get single journal entry ──
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const entry = await getItem(TABLES.JOURNAL_ENTRIES, { id: req.params.id });
    if (!entry) {
      return res.status(404).json({ error: "Journal entry not found" });
    }
    res.json(entry);
  } catch (err) {
    console.error("Error getting journal entry:", err);
    res.status(500).json({ error: "Failed to get journal entry" });
  }
});

// ── POST / — Create journal entry ──
router.post("/", async (req: Request, res: Response) => {
  try {
    const { entry_date, reference, description, lines } = req.body;

    if (!entry_date) {
      return res.status(400).json({ error: "entry_date is required" });
    }

    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ error: "At least two journal lines are required" });
    }

    // Validate lines
    for (const line of lines) {
      if (!line.account_id) {
        return res.status(400).json({ error: "Each line must have an account_id" });
      }
      const debit = Number(line.debit_amount) || 0;
      const credit = Number(line.credit_amount) || 0;
      if (debit <= 0 && credit <= 0) {
        return res.status(400).json({ error: "Each line must have either a debit or credit amount" });
      }
      if (debit > 0 && credit > 0) {
        return res.status(400).json({ error: "A line cannot have both debit and credit amounts" });
      }
    }

    // Verify debits = credits
    const totalDebits = lines.reduce((s: number, l: any) => s + (Number(l.debit_amount) || 0), 0);
    const totalCredits = lines.reduce((s: number, l: any) => s + (Number(l.credit_amount) || 0), 0);

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      return res.status(400).json({
        error: `Total debits (${totalDebits.toFixed(2)}) must equal total credits (${totalCredits.toFixed(2)})`,
      });
    }

    const now = new Date().toISOString();
    const enhancedLines = lines.map((line: any) => ({
      id: randomUUID(),
      account_id: line.account_id,
      description: line.description || "",
      debit_amount: Number(line.debit_amount) || 0,
      credit_amount: Number(line.credit_amount) || 0,
    }));

    const entry = {
      id: randomUUID(),
      entry_date,
      reference: reference || "",
      description: description || "",
      lines: enhancedLines,
      total_debits: totalDebits,
      total_credits: totalCredits,
      status: "posted",
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.JOURNAL_ENTRIES, entry);
    res.status(201).json(entry);
  } catch (err) {
    console.error("Error creating journal entry:", err);
    res.status(500).json({ error: "Failed to create journal entry" });
  }
});

// ── PATCH /:id — Update journal entry ──
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await getItem(TABLES.JOURNAL_ENTRIES, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Journal entry not found" });
    }

    const { entry_date, reference, description, lines } = req.body;
    const updates: Record<string, unknown> = {};

    if (entry_date !== undefined) updates.entry_date = entry_date;
    if (reference !== undefined) updates.reference = reference;
    if (description !== undefined) updates.description = description;

    if (lines !== undefined) {
      if (!Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ error: "At least two journal lines are required" });
      }

      for (const line of lines) {
        if (!line.account_id) {
          return res.status(400).json({ error: "Each line must have an account_id" });
        }
        const debit = Number(line.debit_amount) || 0;
        const credit = Number(line.credit_amount) || 0;
        if (debit <= 0 && credit <= 0) {
          return res.status(400).json({ error: "Each line must have a debit or credit amount" });
        }
        if (debit > 0 && credit > 0) {
          return res.status(400).json({ error: "A line cannot have both debit and credit amounts" });
        }
      }

      const enhancedLines = lines.map((line: any) => ({
        id: line.id || randomUUID(),
        account_id: line.account_id,
        description: line.description || "",
        debit_amount: Number(line.debit_amount) || 0,
        credit_amount: Number(line.credit_amount) || 0,
      }));

      const totalDebits = lines.reduce((s: number, l: any) => s + (Number(l.debit_amount) || 0), 0);
      const totalCredits = lines.reduce((s: number, l: any) => s + (Number(l.credit_amount) || 0), 0);

      if (Math.abs(totalDebits - totalCredits) > 0.001) {
        return res.status(400).json({
          error: `Total debits (${totalDebits.toFixed(2)}) must equal total credits (${totalCredits.toFixed(2)})`,
        });
      }

      updates.lines = enhancedLines;
      updates.total_debits = totalDebits;
      updates.total_credits = totalCredits;
    }

    updates.updated_at = new Date().toISOString();

    const updated = await updateItem(TABLES.JOURNAL_ENTRIES, { id: req.params.id }, updates);
    res.json(updated);
  } catch (err) {
    console.error("Error updating journal entry:", err);
    res.status(500).json({ error: "Failed to update journal entry" });
  }
});

// ── DELETE /:id — Delete journal entry ──
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const existing = await getItem(TABLES.JOURNAL_ENTRIES, { id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Journal entry not found" });
    }

    await deleteItem(TABLES.JOURNAL_ENTRIES, { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting journal entry:", err);
    res.status(500).json({ error: "Failed to delete journal entry" });
  }
});

export default router;
