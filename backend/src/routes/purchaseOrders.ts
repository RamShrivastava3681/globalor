import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  updateItemConditional,
  deleteItem,
  scanTable,
  queryByIndex,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, requireAnyWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { generateId, generateDocNumber, nowISO } from "../utils/helpers.js";
import { computeOrderTotals } from "../utils/goodsOrders.js";
import { computeSalesTotals } from "../utils/goodsSales.js";
import { createActivityAlert } from "../utils/alerts.js";
import type { PurchaseOrder, POStatus, ProformaStatus, AdvanceSide, Debtor, Vendor, Profile, DocMeta, GoodsPurchaseOrder, GoodsPurchaseOrderLine, GoodsSalesOrder, GoodsSalesOrderLine } from "../types/index.js";

const router = Router();

// ── GET /api/purchase-orders (proformas) ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await scanTable<PurchaseOrder>(TABLES.PURCHASE_ORDERS, getCompanyFilter(req.user!));

    // Preload lookup maps to avoid N+1 GetItem calls
    const allDebtors = await scanTable<Debtor>(TABLES.DEBTORS, getCompanyFilter(req.user!));
    const allVendors = await scanTable<Vendor>(TABLES.VENDORS, getCompanyFilter(req.user!));
    const allProfiles = await scanTable<Profile>(TABLES.PROFILES, getCompanyFilter(req.user!));
    const debtorMap = new Map(allDebtors.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    const enriched = orders
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map((po) => ({
        ...po,
        debtor: po.debtor_id ? debtorMap.get(po.debtor_id) : undefined,
        vendor: po.vendor_id ? vendorMap.get(po.vendor_id) : undefined,
        client: po.client_id ? profileMap.get(po.client_id) : undefined,
      }));

    res.json(enriched);
  } catch (err) {
    console.error("Get purchase orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/purchase-orders/by-po/:poNumber ──
router.get("/by-po/:poNumber", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const side = req.query.side as string | undefined;
    // Use GSI for efficient lookup by po_number
    const orders = await queryByIndex<PurchaseOrder>(TABLES.PURCHASE_ORDERS, "po_number-index", "po_number = :pn", { ":pn": req.params.poNumber });

    const filtered = side ? orders.filter((o) => o.side === side) : orders;

    // Get advances for these POs
    const pfIds = filtered.map((o) => o.id);
    let advances: any[] = [];
    if (pfIds.length > 0) {
      for (const pfId of pfIds) {
        const advs = await scanTable<any>(TABLES.ADVANCES, {
          filterExpression: "purchase_order_id = :poid",
          expressionAttributeValues: { ":poid": pfId },
        });
        advances.push(...advs);
      }
    }

    res.json({ proformas: filtered, advances });
  } catch (err) {
    console.error("Get PO by number error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders ──
const createSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  po_number: z.string().min(1).max(80),
  proforma_number: z.string().min(1).max(80).optional(),
  proforma_date: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().optional().default("USD"),
  notes: z.string().nullable().optional(),
  has_contractual_due_date: z.boolean().optional().default(false),
  documents: z.array(z.any()).optional().default([]),
});

router.post("/", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.parse(req.body);
    const id = generateId();
    const now = nowISO();
    const proformaDate = parsed.proforma_date || now.slice(0, 10);

    const po: PurchaseOrder = {
      id,
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      side: parsed.side as AdvanceSide,
      debtor_id: parsed.debtor_id || null,
      vendor_id: parsed.vendor_id || null,
      po_number: parsed.po_number,
      proforma_number: parsed.proforma_number || null,
      proforma_date: proformaDate,
      amount: parsed.amount,
      currency: parsed.currency,
      issue_date: proformaDate,
      expected_date: null,
      status: "proforma",
      proforma_status: "pending_review",
      proforma_review_comments: null,
      proforma_reviewed_at: null,
      proforma_reviewed_by: null,
      proforma_funded_amount: null,
      proforma_funded_at: null,
      proforma_funded_by: null,
      proforma_funding_reference: null,
      converted_to: null,
      converted_document_number: null,
      converted_at: null,
      notes: parsed.notes || null,
      documents: parsed.documents as DocMeta[],
      has_contractual_due_date: parsed.has_contractual_due_date || false,
      created_at: now,
      updated_at: now,
    };

    await putItem(TABLES.PURCHASE_ORDERS, po as any);
    res.status(201).json(po);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/purchase-orders/:id ──
router.patch("/:id", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = { ...req.body, updated_at: nowISO() };
    delete updates.id;
    delete updates.created_at;

    const updated = await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, updates);
    if (!updated) { res.status(404).json({ error: "Purchase order not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Update purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/purchase-orders/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.PURCHASE_ORDERS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/batch ── (mass import from Excel)
const batchProformaSchema = z.object({
  side: z.enum(["sales", "purchase"]),
  debtor_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  items: z.array(z.object({
    proforma_number: z.string().min(1).max(80),
    proforma_date: z.string().min(1),
    po_number: z.string().min(1).max(80),
    amount: z.number().positive(),
  })).min(1),
});

router.post("/batch", requireAuth, requireWriteAccess("purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchProformaSchema.parse(req.body);
    const now = nowISO();
    const created: PurchaseOrder[] = [];
    const errors: Array<{ proforma_number: string; error: string }> = [];

    const ordersToCreate: PurchaseOrder[] = [];
    for (const item of parsed.items) {
      try {
        const id = generateId();
        const proformaDate = item.proforma_date || now.slice(0, 10);

        const po: PurchaseOrder = {
          id,
          client_id: req.user!.id,
          company_id: req.user!.company_id,
          side: parsed.side as AdvanceSide,
          debtor_id: parsed.side === "sales" ? parsed.debtor_id || null : null,
          vendor_id: parsed.side === "purchase" ? parsed.vendor_id || null : null,
          po_number: item.po_number,
          proforma_number: item.proforma_number,
          proforma_date: proformaDate,
          amount: item.amount,
          currency: "USD",
          issue_date: proformaDate,
          expected_date: null,
          status: "proforma",
          proforma_status: "pending_review",
          proforma_review_comments: null,
          proforma_reviewed_at: null,
          proforma_reviewed_by: null,
          proforma_funded_amount: null,
          proforma_funded_at: null,
          proforma_funded_by: null,
        proforma_funding_reference: null,
        converted_to: null,
        converted_document_number: null,
        converted_at: null,
        notes: null,
          documents: [],
          has_contractual_due_date: false,
          created_at: now,
          updated_at: now,
        };

        ordersToCreate.push(po);
      } catch (err) {
        errors.push({ proforma_number: item.proforma_number, error: "Invalid proforma data" });
        console.error(`Batch build error for ${item.proforma_number}:`, err);
      }
    }

    // Write all proformas in batches of 25
    if (ordersToCreate.length > 0) {
      const dbItems = ordersToCreate.map((po) => po as unknown as Record<string, unknown>);
      try {
        await batchPutItems(TABLES.PURCHASE_ORDERS, dbItems);
        created.push(...ordersToCreate);
      } catch (err) {
        console.error("Batch write failed, falling back to individual writes:", err);
        for (const po of ordersToCreate) {
          try {
            await putItem(TABLES.PURCHASE_ORDERS, po as any);
            created.push(po);
          } catch (innerErr) {
            errors.push({ proforma_number: po.proforma_number || "", error: "Failed to create" });
            console.error(`Batch fallback error for ${po.proforma_number}:`, innerErr);
          }
        }
      }
    }

    res.status(201).json({ created: created.length, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create proformas error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/review ──
router.post("/:id/review", requireAuth, requireAnyWriteAccess("purchase-orders", "checker-desk"), async (req: AuthRequest, res: Response) => {
  try {
    const { decision, comments } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      res.status(400).json({ error: "Decision must be 'approved' or 'rejected'" });
      return;
    }

    const updated = await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, {
      proforma_status: decision,
      proforma_reviewed_by: req.user!.id,
      proforma_reviewed_at: nowISO(),
      proforma_review_comments: comments || null,
      updated_at: nowISO(),
    });

    res.json(updated);
  } catch (err) {
    console.error("Review purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/fund ──
router.post("/:id/fund", requireAuth, requireAnyWriteAccess("purchase-orders", "funding-queue"), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reference, advance_date } = req.body;
    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be > 0" });
      return;
    }

    const po = await getItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }) as PurchaseOrder | undefined;
    if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

    // Update PO
    await updateItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }, {
      proforma_status: "funded",
      proforma_funded_by: req.user!.id,
      proforma_funded_at: nowISO(),
      proforma_funded_amount: Number(amount),
      proforma_funding_reference: reference || null,
      updated_at: nowISO(),
    });

    // Create advance record
    const advanceId = generateId();
    const advance = {
      id: advanceId,
      client_id: po.client_id,
      company_id: po.company_id,
      side: po.side,
      purchase_order_id: po.id,
      amount: Number(amount),
      advance_date: advance_date || new Date().toISOString().slice(0, 10),
      reference: reference || po.proforma_number || po.po_number,
      status: "open",
      created_at: nowISO(),
      updated_at: nowISO(),
      invoice_id: null,
      purchase_invoice_id: null,
      notes: null,
    };
    await putItem(TABLES.ADVANCES, advance as any);

    res.json({ success: true, advance });
  } catch (err) {
    console.error("Fund purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/convert-to-po ── (purchase proforma → goods PO)
// Wires the proforma both ways: an approved purchase-side proforma becomes a
// draft goods PO carrying the proforma amount as a single line, linked back to
// its source. The PO is a draft — lines are editable before approval.
router.post("/:id/convert-to-po", requireAuth, requireAnyWriteAccess("purchase-orders", "goods-purchase-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const proforma = await getItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }) as PurchaseOrder | undefined;
    if (!proforma) { res.status(404).json({ error: "Proforma not found" }); return; }
    if (req.user!.company_id && proforma.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Proforma not found" });
      return;
    }
    if (proforma.side !== "purchase") {
      res.status(400).json({ error: "Only purchase-side proformas convert to a purchase order" });
      return;
    }
    if (proforma.proforma_status !== "approved") {
      res.status(400).json({ error: `Convert requires an approved proforma (current: ${proforma.proforma_status})` });
      return;
    }
    if (proforma.converted_to) {
      res.status(400).json({ error: `This proforma was already converted to ${proforma.converted_to.toUpperCase()} ${proforma.converted_document_number ?? ""}` });
      return;
    }

    const now = nowISO();
    const ref = proforma.proforma_number || proforma.po_number;
    const line: GoodsPurchaseOrderLine = {
      product_id: null,
      sku: `PF-${proforma.proforma_number || proforma.po_number}`,
      name: `Proforma ${ref}`,
      unit: "unit",
      ordered_qty: 1,
      unit_price: Math.round(Number(proforma.amount) * 100) / 100,
      gst_rate: null,
      received_qty: 0,
      line_total: Math.round(Number(proforma.amount) * 100) / 100,
    };
    const totals = computeOrderTotals([line], 0);
    const supplierName = proforma.vendor_id
      ? (await getItem(TABLES.VENDORS, { id: proforma.vendor_id }) as Vendor | undefined)?.name ?? null
      : null;

    const id = generateId();
    const po: GoodsPurchaseOrder = {
      id,
      client_id: proforma.client_id,
      company_id: proforma.company_id,
      po_number: generateDocNumber("PO"),
      po_date: now.slice(0, 10),
      supplier_id: proforma.vendor_id ?? null,
      supplier_name: supplierName,
      warehouse: null,
      expected_delivery_date: proforma.expected_date || null,
      payment_terms: null,
      buyer_name: null,
      notes: `Converted from proforma ${ref}`,
      freight: null,
      lines: [line],
      subtotal: totals.subtotal,
      gst_total: totals.gst_total,
      grand_total: totals.grand_total,
      manual_status: "draft",
      status: "draft",
      documents: proforma.documents ?? [],
      linked_proforma_id: proforma.id,
      linked_proforma_number: ref,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.GOODS_PURCHASE_ORDERS, po as any);

    // One-time conversion stamp — a proforma converts exactly once. The stamp
    // is conditional (`converted_to` must not exist yet): a concurrent convert
    // that loses the race deletes its just-created PO and reports 409, so no
    // duplicate documents can ever be produced.
    const stamped = await updateItemConditional(
      TABLES.PURCHASE_ORDERS,
      { id: proforma.id },
      {
        converted_to: "po",
        converted_document_number: po.po_number,
        converted_at: now,
        updated_at: now,
      },
      "attribute_not_exists(converted_to)",
    );
    if (!stamped) {
      await deleteItem(TABLES.GOODS_PURCHASE_ORDERS, { id });
      res.status(409).json({ error: "This proforma was already converted to another purchase order" });
      return;
    }

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      type: "purchase_order_created",
      severity: "info",
      message: `Purchase order ${po.po_number} created from proforma ${ref}`,
      created_by: req.user!.id,
    });

    res.status(201).json(po);
  } catch (err) {
    console.error("Convert proforma to PO error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/purchase-orders/:id/convert-to-so ── (sales proforma → goods SO)
// The sales-side mirror: an approved sales proforma becomes a draft goods SO
// with the proforma amount as a single line, linked to its source.
router.post("/:id/convert-to-so", requireAuth, requireAnyWriteAccess("purchase-orders", "goods-sales-orders"), async (req: AuthRequest, res: Response) => {
  try {
    const proforma = await getItem(TABLES.PURCHASE_ORDERS, { id: req.params.id }) as PurchaseOrder | undefined;
    if (!proforma) { res.status(404).json({ error: "Proforma not found" }); return; }
    if (req.user!.company_id && proforma.company_id !== req.user!.company_id) {
      res.status(404).json({ error: "Proforma not found" });
      return;
    }
    if (proforma.side !== "sales") {
      res.status(400).json({ error: "Only sales-side proformas convert to a sales order" });
      return;
    }
    if (proforma.proforma_status !== "approved") {
      res.status(400).json({ error: `Convert requires an approved proforma (current: ${proforma.proforma_status})` });
      return;
    }
    if (proforma.converted_to) {
      res.status(400).json({ error: `This proforma was already converted to ${proforma.converted_to.toUpperCase()} ${proforma.converted_document_number ?? ""}` });
      return;
    }

    const now = nowISO();
    const ref = proforma.proforma_number || proforma.po_number;
    const line: GoodsSalesOrderLine = {
      product_id: null,
      sku: `PF-${proforma.proforma_number || proforma.po_number}`,
      name: `Proforma ${ref}`,
      unit: "unit",
      ordered_qty: 1,
      unit_price: Math.round(Number(proforma.amount) * 100) / 100,
      discount_pct: 0,
      gst_rate: null,
      dispatched_qty: 0,
      line_total: Math.round(Number(proforma.amount) * 100) / 100,
    };
    const totals = computeSalesTotals([line], 0);
    const debtor = proforma.debtor_id
      ? await getItem(TABLES.DEBTORS, { id: proforma.debtor_id }) as Debtor | undefined
      : undefined;

    const id = generateId();
    const so: GoodsSalesOrder = {
      id,
      client_id: proforma.client_id,
      company_id: proforma.company_id,
      so_number: generateDocNumber("SO"),
      order_date: now.slice(0, 10),
      customer_id: proforma.debtor_id ?? null,
      customer_name: debtor?.name ?? null,
      contact_person: debtor?.contact_name ?? null,
      billing_address: debtor?.registered_address ?? null,
      delivery_address: null,
      salesperson_name: null,
      linked_quotation_id: null,
      linked_quotation_number: null,
      payment_terms: debtor?.payment_terms_days ? `Net ${debtor.payment_terms_days}` : null,
      expected_dispatch_date: null,
      expected_delivery_date: null,
      notes: `Converted from proforma ${ref}`,
      lines: [line],
      subtotal: totals.subtotal,
      total_discount: totals.total_discount,
      gst_total: totals.gst_total,
      freight: null,
      grand_total: totals.grand_total,
      manual_status: "draft",
      status: "draft",
      documents: proforma.documents ?? [],
      linked_proforma_id: proforma.id,
      linked_proforma_number: ref,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };
    await putItem(TABLES.GOODS_SALES_ORDERS, so as any);

    // One-time conversion stamp — a proforma converts exactly once. The stamp
    // is conditional (`converted_to` must not exist yet): a concurrent convert
    // that loses the race deletes its just-created SO and reports 409.
    const stamped = await updateItemConditional(
      TABLES.PURCHASE_ORDERS,
      { id: proforma.id },
      {
        converted_to: "so",
        converted_document_number: so.so_number,
        converted_at: now,
        updated_at: now,
      },
      "attribute_not_exists(converted_to)",
    );
    if (!stamped) {
      await deleteItem(TABLES.GOODS_SALES_ORDERS, { id });
      res.status(409).json({ error: "This proforma was already converted to another sales order" });
      return;
    }

    createActivityAlert({
      client_id: req.user!.id,
      company_id: req.user!.company_id,
      debtor_id: proforma.debtor_id ?? undefined,
      type: "sales_order_created",
      severity: "info",
      message: `Sales order ${so.so_number} created from proforma ${ref}`,
      created_by: req.user!.id,
    });

    res.status(201).json(so);
  } catch (err) {
    console.error("Convert proforma to SO error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
