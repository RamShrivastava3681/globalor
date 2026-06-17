import { Router, Request, Response } from "express";
import {
  getItem,
  scanTable,
  updateItem,
  TABLES,
} from "../db/client.js";
import { nowISO } from "../utils/helpers.js";
import type { Invoice, NoaInvoiceResult, Debtor, Profile } from "../types/index.js";

const router = Router();

// ── GET /api/noa/:token ── (public, no auth required)
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const invoices = await scanTable<Invoice>(TABLES.INVOICES, {
      filterExpression: "noa_token = :token",
      expressionAttributeValues: { ":token": req.params.token },
    });

    if (invoices.length === 0) {
      res.status(404).json({ error: "Invalid or expired NOA link" });
      return;
    }

    const inv = invoices[0];
    const debtor = await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined;
    const client = await getItem(TABLES.PROFILES, { id: inv.client_id }) as Profile | undefined;

    const advanceAmount = (inv.amount * inv.advance_rate) / 100;

    const result: NoaInvoiceResult = {
      id: inv.id,
      invoice_number: inv.invoice_number,
      amount: inv.amount,
      advance_rate: inv.advance_rate,
      advance_amount: advanceAmount,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      noa_status: inv.noa_status,
      noa_comments: inv.noa_comments || "",
      client_company: client?.contact_name || client?.company_name || "Unknown",
      debtor_name: debtor?.name || "Unknown",
      debtor_contact_name: debtor?.contact_name || "",
      debtor_contact_email: debtor?.contact_email || "",
    };

    res.json(result);
  } catch (err) {
    console.error("Get NOA error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/noa/:token/respond ── (public, no auth required)
router.post("/:token/respond", async (req: Request, res: Response) => {
  try {
    const { decision, comments } = req.body;

    if (!["accepted", "rejected", "commented"].includes(decision)) {
      res.status(400).json({ error: "Invalid decision" });
      return;
    }

    const invoices = await scanTable<Invoice>(TABLES.INVOICES, {
      filterExpression: "noa_token = :token",
      expressionAttributeValues: { ":token": req.params.token },
    });

    if (invoices.length === 0) {
      res.status(404).json({ error: "Invalid or expired NOA link" });
      return;
    }

    const inv = invoices[0];
    const update: Record<string, unknown> = {
      noa_status: decision,
      noa_responded_at: nowISO(),
      updated_at: nowISO(),
    };
    if (comments) update.noa_comments = comments;

    await updateItem(TABLES.INVOICES, { id: inv.id }, update);
    res.json({ success: true, noa_status: decision });
  } catch (err) {
    console.error("Respond NOA error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
