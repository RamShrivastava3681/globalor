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
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { CreditDebitNote, Invoice, PurchaseInvoice, Vendor } from "../types/index.js";

const router = Router();

// ── Resolve a supplier name to a vendor, auto-creating the vendor if needed ──
async function resolveSupplierId(
  supplierName: string,
  existingVendors: Vendor[],
  req: AuthRequest,
  now: string,
): Promise<{ supplier_id: string; created: boolean; vendor: Vendor }> {
  const key = supplierName.toLowerCase().trim();
  const existing = existingVendors.find((v) => v.name.toLowerCase().trim() === key);
  if (existing) return { supplier_id: existing.id, created: false, vendor: existing };

  const vendorId = generateId();
  const vendor: Vendor = {
    id: vendorId,
    client_id: req.user!.id,
    company_id: req.user!.company_id,
    name: supplierName.trim(),
    address_line: null,
    city: null,
    country: null,
    postal_code: null,
    phone: null,
    website: null,
    contact_name: null,
    contact_email: null,
    contact_designation: null,
    contact_phone: null,
    industry: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
  await putItem(TABLES.VENDORS, vendor as any);

  createActivityAlert({
    client_id: req.user!.id,
    company_id: req.user!.company_id,
    type: "vendor_created",
    severity: "info",
    message: `Supplier "${supplierName.trim()}" auto-created during credit/debit note import`,
    created_by: req.user!.id,
  });

  return { supplier_id: vendorId, created: true, vendor };
}

// ── Apply a credit/debit note to its linked invoice ──
// Credit notes reduce the invoice amount; debit notes increase it (credit
// clamped at 0). Called at creation (notes take effect immediately — the
// checker/treasury workflow is bypassed) and by the PATCH settlement path for
// legacy notes.
interface NoteForInvoice {
  id: string;
  type: "credit" | "debit";
  note_number: string;
  amount: number;
  client_id: string;
  company_id: string | null;
  linked_invoice_id: string | null;
  linked_invoice_type: "sales" | "purchase" | null;
}

async function applyNoteToLinkedInvoice(
  note: NoteForInvoice,
  actorId: string,
  verb: "settled" | "applied",
): Promise<void> {
  if (!note.linked_invoice_id || !note.linked_invoice_type) return;
  const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
  const inv = await getItem(table, { id: note.linked_invoice_id }) as (Invoice | PurchaseInvoice) | undefined;
  if (!inv) return;

  const currentAmount = Number(inv.amount);
  const noteAmount = Number(note.amount);
  const newAmount = note.type === "credit"
    ? Math.max(0, currentAmount - noteAmount)
    : currentAmount + noteAmount;

  await updateItem(table, { id: note.linked_invoice_id }, {
    amount: newAmount,
    updated_at: nowISO(),
  } as any);

  createActivityAlert({
    client_id: inv.client_id || note.client_id,
    company_id: inv.company_id || note.company_id,
    type: "payment_received",
    severity: "info",
    message: `${note.type === "credit" ? "Credit" : "Debit"} note ${note.note_number} ${verb} — invoice amount ${note.type === "credit" ? "reduced" : "increased"} from $${currentAmount.toLocaleString()} to $${newAmount.toLocaleString()}`,
    created_by: actorId,
  });
}

// ── GET /api/credit-debit-notes ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const notes = await scanTable<CreditDebitNote>(TABLES.CREDIT_DEBIT_NOTES, getCompanyFilter(req.user!));

    // Preload lookup maps to avoid N+1 GetItem calls
    const allInvoices = await scanTable<any>(TABLES.INVOICES, getCompanyFilter(req.user!));
    const allPurchaseInvoices = await scanTable<any>(TABLES.PURCHASE_INVOICES, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const invoiceMap = new Map(allInvoices.map((i) => [i.id, i]));
    const piMap = new Map(allPurchaseInvoices.map((p) => [p.id, p]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

    const enriched = notes
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map((note) => {
        let linkedInvoice: { invoice_number: string; amount: number; status: string } | null = null;
        if (note.linked_invoice_id) {
          const map = note.linked_invoice_type === "sales" ? invoiceMap : piMap;
          const inv = map.get(note.linked_invoice_id);
          if (inv) {
            linkedInvoice = {
              invoice_number: inv.invoice_number,
              amount: inv.amount,
              status: inv.status,
            };
          }
        }
        const vendor = note.supplier_id ? vendorMap.get(note.supplier_id) : undefined;
        return { ...note, linkedInvoice, supplier: vendor ? { id: vendor.id, name: vendor.name } : null };
      });

    res.json(enriched);
  } catch (err) {
    console.error("Get credit/debit notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/credit-debit-notes ──
const createSchema = z.object({
  type: z.enum(["credit", "debit"]),
  note_number: z.string().min(1).max(80),
  date: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
  amount: z.number(),
  debtor_supplier_name: z.string().max(200).nullable().optional(),
  supplier_name: z.string().max(200).nullable().optional(),
  linked_invoice_id: z.string().nullable().optional(),
  linked_invoice_type: z.enum(["sales", "purchase"]).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

router.post("/", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();

    // Validate linked invoice exists if provided
    if (parsed.linked_invoice_id) {
      const table = parsed.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
      const inv = await getItem(table, { id: parsed.linked_invoice_id });
      if (!inv) {
        res.status(400).json({ error: "Linked invoice not found" });
        return;
      }
    }

    // Resolve supplier name to a vendor (auto-creating it if needed)
    let supplier_id: string | null = null;
    if (parsed.supplier_name && parsed.supplier_name.trim()) {
      const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
      const resolved = await resolveSupplierId(parsed.supplier_name.trim(), allVendors, req, now);
      supplier_id = resolved.supplier_id;
    }

    // Notes take effect immediately — the checker approval and funding-queue
    // settlement steps are bypassed. Credit notes land as "received", debit
    // notes as "paid", and the linked invoice amount is adjusted right away.
    const terminalStatus: "received" | "paid" = parsed.type === "credit" ? "received" : "paid";
    const note: CreditDebitNote = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: parsed.type,
      note_number: parsed.note_number,
      date: parsed.date || new Date().toISOString().slice(0, 10),
      amount: parsed.amount,
      debtor_supplier_name: parsed.debtor_supplier_name || null,
      supplier_id,
      linked_invoice_id: parsed.linked_invoice_id || null,
      linked_invoice_type: parsed.linked_invoice_type || null,
      reason: parsed.reason || null,
      status: terminalStatus,
      reviewed_at: null,
      reviewed_by: null,
      settled_at: now,
      settled_by: req.user!.id,
      settled_at_creation: true,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.CREDIT_DEBIT_NOTES, note as any);
    try {
      await applyNoteToLinkedInvoice(note, req.user!.id, "applied");
    } catch (err) {
      // Never leave a settled note whose linked invoice was not adjusted — that
      // would silently overstate cost in the reports. Remove the note and fail.
      await deleteItem(TABLES.CREDIT_DEBIT_NOTES, { id: note.id }).catch(() => {});
      throw err;
    }

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "invoice_created",
      severity: "info",
      message: `${parsed.type === "credit" ? "Credit" : "Debit"} note ${parsed.note_number} created for $${parsed.amount.toLocaleString()} — applied immediately${parsed.linked_invoice_id ? ", linked invoice adjusted" : ""}`,
      created_by: req.user!.id,
    });

    res.status(201).json(note);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/credit-debit-notes/:id ──
router.patch("/:id", requireAuth, requireAnyWriteAccess("invoices", "checker-desk", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }) as CreditDebitNote | undefined;
    if (!note) {
      res.status(404).json({ error: "Credit/debit note not found" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: nowISO() };

    // ── Checker approval / rejection ──
    if (req.body.status === "approved" || req.body.status === "rejected") {
      if (note.status !== "pending") {
        res.status(400).json({ error: `Note is already ${note.status}, cannot change to ${req.body.status}` });
        return;
      }
      updates.status = req.body.status;
      updates.reviewed_at = nowISO();
      updates.reviewed_by = req.user!.id;
    }

    // ── Funding queue settlement (mark received for credit, mark paid for debit) ──
    if (req.body.status === "received" || req.body.status === "paid") {
      if (note.status !== "approved") {
        res.status(400).json({ error: `Note must be approved first, current status: ${note.status}` });
        return;
      }
      
      // For credit notes, only "received" is valid; for debit notes, only "paid" is valid
      if (note.type === "credit" && req.body.status !== "received") {
        res.status(400).json({ error: "Credit notes must be marked as received" });
        return;
      }
      if (note.type === "debit" && req.body.status !== "paid") {
        res.status(400).json({ error: "Debit notes must be marked as paid" });
        return;
      }

      updates.status = req.body.status;
      updates.settled_at = nowISO();
      updates.settled_by = req.user!.id;

      // ── Update linked invoice amount ──
      await applyNoteToLinkedInvoice(note, req.user!.id, "settled");
    }

    // Apply updates (allow partial updates from req.body)
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== "id" && key !== "created_at" && key !== "type") {
        if (key === "status") continue; // Already handled above
        updates[key] = value;
      }
    }

    const updated = await updateItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Credit/debit note not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/credit-debit-notes/batch ──
const batchCreateSchema = z.object({
  type: z.enum(["credit", "debit"]),
  notes: z.array(z.object({
    note_number: z.string().min(1).max(80),
    date: z.string().optional(),
    amount: z.number(),
    debtor_supplier_name: z.string().max(200).nullable().optional(),
    supplier_name: z.string().max(200).nullable().optional(),
    linked_invoice_number: z.string().max(80).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  })).min(1).max(500),
});

router.post("/batch", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCreateSchema.parse(req.body);
    const { type, notes } = parsed;
    const now = nowISO();
    const errors: Array<{ row: number; error: string }> = [];
    const created: string[] = [];

    // Pre-fetch all invoices, purchase invoices, and vendors for lookups
    const companyFilter = getCompanyFilter(req.user!);
    const [allInvoices, allPurchaseInvoices, allVendors] = await Promise.all([
      scanTable<{ id: string; invoice_number: string }>(TABLES.INVOICES, companyFilter),
      scanTable<{ id: string; invoice_number: string; vendor_id: string | null }>(TABLES.PURCHASE_INVOICES, companyFilter),
      scanTable<Vendor>(TABLES.VENDORS, companyFilter),
    ]);
    const invoiceByNumber = new Map<string, { id: string; type: "sales" }>();
    const purchaseByNumber = new Map<string, { id: string; type: "purchase"; vendor_id: string | null }>();
    for (const inv of allInvoices) invoiceByNumber.set(inv.invoice_number, { id: inv.id, type: "sales" });
    for (const inv of allPurchaseInvoices) purchaseByNumber.set(inv.invoice_number, { id: inv.id, type: "purchase", vendor_id: inv.vendor_id ?? null });

    // Track suppliers resolved during this import (auto-created vendors are added
    // to the list so duplicate supplier names in one file reuse the same vendor)
    const vendorsList = [...allVendors];
    const suppliersMatched: Array<{ supplier_name: string; supplier_id: string }> = [];
    const suppliersCreated: Array<{ supplier_name: string; supplier_id: string }> = [];

    for (let i = 0; i < notes.length; i++) {
      const row = notes[i];
      const rowNum = i + 1;

      try {
        let linked_invoice_id: string | null = null;
        let linked_invoice_type: "sales" | "purchase" | null = null;
        let supplier_id: string | null = null;

        // Resolve supplier_name → vendor (match existing or auto-create)
        let supplierName = "";
        if (row.supplier_name && row.supplier_name.trim()) {
          supplierName = row.supplier_name.trim();
          const resolved = await resolveSupplierId(supplierName, vendorsList, req, now);
          supplier_id = resolved.supplier_id;
          if (!vendorsList.some((v) => v.id === supplier_id)) {
            vendorsList.push(resolved.vendor);
          }
          if (resolved.created) {
            suppliersCreated.push({ supplier_name: supplierName, supplier_id });
          } else {
            suppliersMatched.push({ supplier_name: supplierName, supplier_id });
          }
        }

        if (row.linked_invoice_number) {
          const salesMatch = invoiceByNumber.get(row.linked_invoice_number);
          const purchaseMatch = purchaseByNumber.get(row.linked_invoice_number);
          if (supplier_id) {
            // Strict supplier linking: a note tied to a supplier may only link to a
            // purchase invoice belonging to that supplier — never a mismatched invoice
            if (purchaseMatch && purchaseMatch.vendor_id === supplier_id) {
              linked_invoice_id = purchaseMatch.id;
              linked_invoice_type = "purchase";
            } else {
              errors.push({ row: rowNum, error: `Invoice "${row.linked_invoice_number}" not found for supplier "${supplierName}"` });
              continue;
            }
          } else if (salesMatch) {
            linked_invoice_id = salesMatch.id;
            linked_invoice_type = "sales";
          } else if (purchaseMatch) {
            linked_invoice_id = purchaseMatch.id;
            linked_invoice_type = "purchase";
          } else {
            errors.push({ row: rowNum, error: `Invoice "${row.linked_invoice_number}" not found` });
            continue;
          }
        }

        const id = generateId();
        // Same immediate-settlement behavior as single create: no checker or
        // funding-queue step, linked invoice adjusted right away.
        const terminalStatus: "received" | "paid" = type === "credit" ? "received" : "paid";
        const note = {
          id,
          client_id: req.user!.id,
          company_id: req.user!.company_id,
          type,
          note_number: row.note_number,
          date: row.date || new Date().toISOString().slice(0, 10),
          amount: row.amount,
          debtor_supplier_name: row.debtor_supplier_name || null,
          supplier_id,
          linked_invoice_id,
          linked_invoice_type,
          reason: row.reason || null,
          status: terminalStatus,
          reviewed_at: null,
          reviewed_by: null,
          settled_at: now,
          settled_by: req.user!.id,
          settled_at_creation: true,
          created_at: now,
          updated_at: now,
        };

        await putItem(TABLES.CREDIT_DEBIT_NOTES, note as any);
        try {
          await applyNoteToLinkedInvoice(note, req.user!.id, "applied");
        } catch (err) {
          // Same rollback as single create: don't keep a settled note whose
          // linked invoice was not adjusted.
          await deleteItem(TABLES.CREDIT_DEBIT_NOTES, { id: note.id }).catch(() => {});
          throw err;
        }
        created.push(note.note_number);
      } catch (err) {
        errors.push({ row: rowNum, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    res.status(201).json({
      created: created.length,
      errors,
      suppliers_matched: suppliersMatched,
      suppliers_created: suppliersCreated,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create credit/debit notes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/credit-debit-notes/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("invoices"), async (req: AuthRequest, res: Response) => {
  try {
    const note = await getItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id }) as CreditDebitNote | undefined;
    if (!note) {
      res.status(404).json({ error: "Credit/debit note not found" });
      return;
    }
    if (note.status !== "pending" && note.settled_at_creation !== true) {
      res.status(400).json({ error: "Cannot delete a note that was settled through review" });
      return;
    }

    // Notes auto-settled at creation already adjusted their linked invoice —
    // reverse that adjustment so deleting the note keeps the books consistent.
    if (note.status !== "pending" && note.linked_invoice_id && note.linked_invoice_type) {
      const table = note.linked_invoice_type === "sales" ? TABLES.INVOICES : TABLES.PURCHASE_INVOICES;
      const inv = await getItem(table, { id: note.linked_invoice_id }) as (Invoice | PurchaseInvoice) | undefined;
      if (inv) {
        const noteAmount = Number(note.amount);
        // Credit note reduced the invoice at creation → add it back.
        // Debit note increased it → subtract it back.
        // Note: when a credit note originally exceeded the invoice, creation
        // clamped the invoice to 0, so this reversal restores the note amount
        // rather than the original invoice value — same clamp semantics used
        // by the settlement path.
        const newAmount = note.type === "credit"
          ? Number(inv.amount) + noteAmount
          : Math.max(0, Number(inv.amount) - noteAmount);
        await updateItem(table, { id: note.linked_invoice_id }, { amount: newAmount, updated_at: nowISO() } as any);
        createActivityAlert({
          client_id: inv.client_id || note.client_id,
          company_id: inv.company_id || note.company_id,
          type: "payment_received",
          severity: "info",
          message: `${note.type === "credit" ? "Credit" : "Debit"} note ${note.note_number} deleted — invoice amount ${note.type === "credit" ? "restored" : "reduced"} from $${Number(inv.amount).toLocaleString()} to $${newAmount.toLocaleString()}`,
          created_by: req.user!.id,
        });
      }
    }

    await deleteItem(TABLES.CREDIT_DEBIT_NOTES, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete credit/debit note error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
