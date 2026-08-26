import { Router, Request, Response } from "express";
import {
  getItem,
  scanTable,
  updateItem,
  TABLES,
} from "../db/client.js";
import { nowISO } from "../utils/helpers.js";
import { effectiveUnitPrice, computeQuotationTotals } from "../utils/quotations.js";
import type { Quotation, Debtor } from "../types/index.js";

const router = Router();

/** Public-safe view of a quotation for the approval page (no internal fields). */
function publicView(q: Quotation, debtor: Debtor | undefined) {
  const lines = q.lines.map((l) => ({
    name: l.name,
    sku: l.sku,
    unit: l.unit,
    quantity: l.quantity,
    unit_price: effectiveUnitPrice(l),
    gst_rate: l.gst_rate,
  }));
  return {
    id: q.id,
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    valid_until: q.valid_until,
    customer_name: q.customer_name ?? q.prospect_name ?? debtor?.name ?? "Customer",
    contact_person: q.contact_person,
    debtor_status: q.debtor_status,
    debtor_comments: q.debtor_comments || "",
    status: q.status,
    lines,
    freight: q.freight ?? 0,
    totals: {
      subtotal: q.subtotal,
      total_discount: q.total_discount,
      gst_total: q.gst_total,
      grand_total: q.grand_total,
    },
  };
}

// ── GET /api/approvals/:token ── (public, no auth required)
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const quotes = await scanTable<Quotation>(TABLES.QUOTATIONS, {
      filterExpression: "debtor_token = :token",
      expressionAttributeValues: { ":token": req.params.token },
    });
    if (quotes.length === 0) {
      res.status(404).json({ error: "Invalid or expired approval link" });
      return;
    }
    const q = quotes[0];
    const debtor = q.customer_id ? await getItem(TABLES.DEBTORS, { id: q.customer_id }) as Debtor | undefined : undefined;
    res.json(publicView(q, debtor));
  } catch (err) {
    console.error("Get approval error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/approvals/:token/respond ── (public, no auth required)
router.post("/:token/respond", async (req: Request, res: Response) => {
  try {
    const { decision, comments } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      res.status(400).json({ error: "Invalid decision" });
      return;
    }

    const quotes = await scanTable<Quotation>(TABLES.QUOTATIONS, {
      filterExpression: "debtor_token = :token",
      expressionAttributeValues: { ":token": req.params.token },
    });
    if (quotes.length === 0) {
      res.status(404).json({ error: "Invalid or expired approval link" });
      return;
    }
    const q = quotes[0];
    if (q.debtor_status === "approved") {
      res.status(400).json({ error: "This quotation was already approved" });
      return;
    }
    if (q.status === "converted_to_so") {
      res.status(400).json({ error: "This quotation has already been converted to a sales order" });
      return;
    }
    if (q.valid_until && new Date(q.valid_until).getTime() < Date.now()) {
      res.status(400).json({ error: "This quotation has expired" });
      return;
    }

    const update: Record<string, unknown> = {
      debtor_status: decision,
      debtor_comments: comments ? String(comments).slice(0, 2000) : null,
      debtor_responded_at: nowISO(),
      updated_at: nowISO(),
    };
    // Debtor acceptance moves the lifecycle to `accepted`.
    if (decision === "approved") update.status = "accepted";

    await updateItem(TABLES.QUOTATIONS, { id: q.id }, update);
    res.json({ success: true, debtor_status: decision });
  } catch (err) {
    console.error("Respond approval error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
