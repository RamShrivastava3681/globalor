import { Router, Response } from "express";
import {
  putItem,
  getItem,
  updateItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import {
  requireAuth,
  requireWriteAccess,
  getCompanyFilter,
  type AuthRequest,
} from "../middleware/auth.js";
import { generateId, generateDocNumber, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import {
  writeShipmentAudit,
  isStatusRegression,
  isTerminalStatus,
  isExceptionStatus,
  defaultLogisticsSettings,
} from "../utils/logistics.js";
import { getAdapter } from "../logistics/adapters/index.js";
import {
  createShipmentSchema,
  manualBookingSchema,
  manualQuoteSchema,
  manualEventSchema,
} from "../logistics/validators.js";
import type {
  Shipment,
  ShipmentEvent,
  ShipmentQuote,
  ShipmentStatus,
  GoodsPurchaseOrder,
  GoodsDispatch,
  Invoice,
  PurchaseInvoice,
  LogisticsSettings,
  AppRole,
} from "../types/index.js";

const router = Router();

// ── Helpers ──

function elevated(roles: AppRole[]): boolean {
  return roles.includes("factor_admin") || roles.includes("checker");
}

function emptyParty(name = "") {
  return {
    name, contact_person: null, mobile: null, email: null, address: null,
    city: null, state: null, country: null, postal_code: null, tax_id: null,
  };
}

/** Server-side pre-fill from the linked PO / invoice / dispatch. Best-effort. */
async function buildPrefill(linkedDocType: string, linkedDocId: string): Promise<{
  prefill: Partial<Shipment>;
  linkedDocNo: string | null;
  error?: string;
}> {
  if (linkedDocType === "goods_purchase_order") {
    const po = (await getItem(TABLES.GOODS_PURCHASE_ORDERS, { id: linkedDocId })) as unknown as GoodsPurchaseOrder | undefined;
    if (!po) return { prefill: {}, linkedDocNo: null, error: "Linked purchase order not found." };
    if (po.manual_status !== "approved" && po.manual_status !== "sent" && po.status !== "approved" && po.status !== "sent" && po.status !== "partially_received") {
      return { prefill: {}, linkedDocNo: po.po_number, error: "Purchase order must be approved before creating an inbound shipment." };
    }
    const desc = (po.lines ?? []).map((l) => `${l.name} × ${l.ordered_qty}`).join("; ").slice(0, 1000) || null;
    return {
      linkedDocNo: po.po_number,
      prefill: {
        shipment_type: "inbound",
        pickup: { ...emptyParty(po.supplier_name ?? ""), city: null, state: null, country: null },
        delivery: { ...emptyParty(po.warehouse ?? ""), city: null, state: null, country: null },
        requested_delivery_date: po.expected_delivery_date,
        goods_description: desc,
        declared_value: Number(po.grand_total) || 0,
        estimated_freight: Number(po.freight) || 0,
        goods_dispatch_id: null,
      },
    };
  }
  if (linkedDocType === "goods_dispatch") {
    const dsp = (await getItem(TABLES.GOODS_DISPATCHES, { id: linkedDocId })) as unknown as GoodsDispatch | undefined;
    if (!dsp) return { prefill: {}, linkedDocNo: null, error: "Linked dispatch order not found." };
    if (dsp.status === "draft" || dsp.status === "cancelled") {
      return { prefill: {}, linkedDocNo: dsp.dispatch_number, error: "Dispatch must be confirmed before creating an outbound shipment." };
    }
    const desc = (dsp.lines ?? []).map((l) => `${l.name} × ${l.dispatched_qty}`).join("; ").slice(0, 1000) || null;
    const value = (dsp.lines ?? []).reduce((s, l) => s + Number(l.line_value || 0), 0);
    return {
      linkedDocNo: dsp.dispatch_number,
      prefill: {
        shipment_type: "outbound",
        pickup: { ...emptyParty(dsp.warehouse ?? "") },
        delivery: { ...emptyParty(dsp.customer_name ?? ""), contact_person: dsp.contact_person, address: dsp.delivery_address },
        requested_delivery_date: dsp.delivery_date,
        goods_description: desc,
        declared_value: Math.round(value * 100) / 100,
        goods_dispatch_id: dsp.id,
        eway: {
          eway_bill_number: null, eway_bill_date: null, eway_validity: null,
          transporter_id: null, vehicle_number: null,
          lr_number: null, delivery_challan_number: dsp.delivery_challan_number ?? null,
        },
      },
    };
  }
  if (linkedDocType === "sales_invoice") {
    const inv = (await getItem(TABLES.INVOICES, { id: linkedDocId })) as unknown as Invoice | undefined;
    if (!inv) return { prefill: {}, linkedDocNo: null, error: "Linked sales invoice not found." };
    if (inv.status === "draft" || inv.status === "rejected") {
      return { prefill: {}, linkedDocNo: inv.invoice_number, error: "Sales invoice must be confirmed before creating an outbound shipment." };
    }
    const desc = (inv.lines ?? []).map((l) => `${l.name} × ${l.quantity}`).join("; ").slice(0, 1000) || null;
    const invAny = inv as unknown as Record<string, any>;
    return {
      linkedDocNo: inv.invoice_number,
      prefill: {
        shipment_type: "outbound",
        delivery: {
          ...emptyParty(invAny.customer_name ?? ""),
          contact_person: inv.customer_contact ?? null,
          address: inv.delivery_address ?? inv.billing_address ?? null,
        },
        goods_description: desc,
        declared_value: Number(inv.grand_total ?? inv.amount) || 0,
        estimated_freight: Number(inv.freight) || 0,
      },
    };
  }
  if (linkedDocType === "purchase_invoice") {
    const pi = (await getItem(TABLES.PURCHASE_INVOICES, { id: linkedDocId })) as unknown as PurchaseInvoice | undefined;
    if (!pi) return { prefill: {}, linkedDocNo: null, error: "Linked purchase invoice not found." };
    const desc = (pi.lines ?? []).map((l) => `${l.name} × ${l.invoice_qty}`).join("; ").slice(0, 1000) || null;
    return {
      linkedDocNo: pi.invoice_number,
      prefill: { shipment_type: "inbound", goods_description: desc, declared_value: Number(pi.amount) || 0 },
    };
  }
  return { prefill: { shipment_type: "outbound" }, linkedDocNo: null };
}

async function getSettings(companyId: string | null): Promise<LogisticsSettings | null> {
  if (!companyId) return null;
  return ((await getItem(TABLES.LOGISTICS_SETTINGS, { company_id: companyId })) as unknown as LogisticsSettings | undefined) ?? null;
}

async function appendEvent(params: {
  company_id: string | null;
  shipment: Shipment;
  status: ShipmentStatus;
  carrier_raw_status?: string | null;
  location?: string | null;
  description?: string | null;
  source: ShipmentEvent["source"];
  actor_id?: string | null;
}): Promise<ShipmentEvent> {
  const { company_id, shipment, status } = params;
  const event: ShipmentEvent = {
    id: generateId(),
    company_id,
    shipment_id: shipment.id,
    status,
    carrier_raw_status: params.carrier_raw_status ?? null,
    event_at: nowISO(),
    location: params.location ?? null,
    description: params.description ?? null,
    source: params.source,
    attachment_url: null,
    created_by: params.actor_id ?? null,
    created_at: nowISO(),
  };
  await putItem(TABLES.SHIPMENT_EVENTS, event as any);
  const updates: Record<string, unknown> = {
    status,
    last_event_at: event.event_at,
    last_event_source: params.source,
    updated_at: nowISO(),
    updated_by: params.actor_id ?? shipment.updated_by,
  };
  if (status === "picked_up" && !shipment.actual_pickup_at) updates.actual_pickup_at = event.event_at;
  if (status === "delivered") updates.actual_delivery_at = event.event_at;
  await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, updates);
  return event;
}

async function loadShipment(req: AuthRequest, id: string | string[]): Promise<Shipment | null> {
  const sid = Array.isArray(id) ? id[0] : id;
  const item = (await getItem(TABLES.SHIPMENTS, { id: sid })) as unknown as Shipment | undefined;
  if (!item) return null;
  // Company scoping (factor_admin / super-admin see all)
  const cid = req.user!.company_id;
  if (cid && !req.user!.roles.includes("factor_admin") && item.company_id && item.company_id !== cid) return null;
  return item;
}

// ── Dashboard summary (must be registered before /:id) ──

router.get("/dashboard/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const filter = getCompanyFilter(req.user!);
  const shipments = await scanTable<Shipment>(TABLES.SHIPMENTS, filter);
  const settings = await getSettings(req.user!.company_id);
  const bufferDays = settings?.delay_buffer_days ?? 2;
  const now = Date.now();

  const buckets: Record<string, number> = {
    awaiting_booking: 0, booked_not_picked: 0, in_transit: 0, delayed: 0,
    delivered: 0, exceptions: 0, returns: 0, inbound_overdue: 0, customs_pending: 0,
  };
  const freightByProvider: Record<string, number> = {};
  const freightByMode: Record<string, number> = {};
  let etaBreaches = 0;
  let quoteVarianceTotal = 0;

  for (const s of shipments) {
    if (s.status === "draft" || s.status === "quote_requested" || s.status === "quote_received") buckets.awaiting_booking++;
    if (s.status === "booked" || s.status === "pickup_scheduled") buckets.booked_not_picked++;
    if (["picked_up", "in_transit", "at_hub", "out_for_delivery"].includes(s.status)) buckets.in_transit++;
    if (s.status === "delayed") buckets.delayed++;
    if (s.status === "delivered") buckets.delivered++;
    if (isExceptionStatus(s.status)) buckets.exceptions++;
    if (s.status === "return_initiated" || s.status === "returned") buckets.returns++;
    if (s.status === "at_customs" || s.status === "customs_hold") buckets.customs_pending++;
    if (s.shipment_type === "inbound" && !isTerminalStatus(s.status) && s.expected_delivery_date) {
      if (new Date(s.expected_delivery_date).getTime() + bufferDays * 86400000 < now) buckets.inbound_overdue++;
    }
    const cost = Number(s.final_freight || s.total_freight || s.booked_freight || 0);
    if (cost > 0) {
      freightByProvider[s.provider_name || s.carrier_name || "Unassigned"] =
        (freightByProvider[s.provider_name || s.carrier_name || "Unassigned"] || 0) + cost;
      freightByMode[s.mode] = (freightByMode[s.mode] || 0) + cost;
    }
    if (s.status === "delivered" && s.expected_delivery_date && s.actual_delivery_at) {
      if (new Date(s.actual_delivery_at).getTime() > new Date(s.expected_delivery_date).getTime()) etaBreaches++;
    }
    if (Number(s.final_freight) > 0 && Number(s.quoted_freight) > 0) {
      quoteVarianceTotal += Number(s.final_freight) - Number(s.quoted_freight);
    }
  }

  res.json({
    counts: buckets,
    freight_by_provider: freightByProvider,
    freight_by_mode: freightByMode,
    eta_breaches: etaBreaches,
    quote_variance_total: Math.round(quoteVarianceTotal * 100) / 100,
    total: shipments.length,
  });
});

// ── Prefill preview ──

router.get("/prefill", requireAuth, async (req: AuthRequest, res: Response) => {
  const { linked_doc_type, linked_doc_id } = req.query as Record<string, string>;
  if (!linked_doc_type || !linked_doc_id) {
    res.status(400).json({ error: "linked_doc_type and linked_doc_id are required" });
    return;
  }
  const { prefill, linkedDocNo, error } = await buildPrefill(linked_doc_type, String(linked_doc_id));
  if (error) {
    res.status(422).json({ error, linked_doc_no: linkedDocNo });
    return;
  }
  res.json({ prefill, linked_doc_no: linkedDocNo });
});

// ── List ──

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const filter = getCompanyFilter(req.user!);
  const all = await scanTable<Shipment>(TABLES.SHIPMENTS, filter);
  const q = req.query as Record<string, string>;
  const out = all.filter((s) => {
    if (q.type && s.shipment_type !== q.type) return false;
    if (q.status && s.status !== q.status) return false;
    if (q.provider && (s.provider_name ?? "") !== q.provider && (s.carrier_name ?? "") !== q.provider) return false;
    if (q.border && s.border !== q.border) return false;
    if (q.search) {
      const needle = q.search.toLowerCase();
      const hay = `${s.shipment_number} ${s.tracking_number ?? ""} ${s.booking_reference ?? ""} ${s.linked_doc_no ?? ""} ${s.pickup?.name ?? ""} ${s.delivery?.name ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (q.exceptions === "1" && !isExceptionStatus(s.status)) return false;
    return true;
  });
  out.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  res.json(out);
});

// ── Create (draft; pre-fills from linked doc; never touches stock) ──

router.post("/", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const parsed = createShipmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shipment data", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  let prefill: Partial<Shipment> = {};
  let linkedDocNo: string | null = null;
  if (b.linked_doc_type && b.linked_doc_type !== "manual" && b.linked_doc_id) {
    const r = await buildPrefill(b.linked_doc_type, b.linked_doc_id);
    if (r.error) {
      res.status(422).json({ error: r.error });
      return;
    }
    prefill = r.prefill;
    linkedDocNo = r.linkedDocNo;
  }

  const now = nowISO();
  const pickup = { ...emptyParty(""), ...(prefill.pickup ?? {}), ...(b.pickup ?? {}) };
  const delivery = { ...emptyParty(""), ...(prefill.delivery ?? {}), ...(b.delivery ?? {}) };
  if (!pickup.name || !delivery.name) {
    res.status(400).json({ error: "Pickup party name and consignee name are required." });
    return;
  }
  const chargeable = Math.max(Number(b.actual_weight ?? 0), Number(b.volumetric_weight ?? 0));

  const shipment: Shipment = {
    id: generateId(),
    company_id: req.user!.company_id,
    shipment_number: generateDocNumber("SHP"),
    shipment_type: b.shipment_type ?? prefill.shipment_type ?? "outbound",
    linked_doc_type: (b.linked_doc_type as Shipment["linked_doc_type"]) ?? "manual",
    linked_doc_id: b.linked_doc_id ?? null,
    linked_doc_no: linkedDocNo,
    priority: b.priority ?? "normal",
    owner_id: b.owner_id ?? req.user!.id,
    business_unit: b.business_unit ?? null,
    sales_channel: b.sales_channel ?? null,
    status: "draft",
    pickup: pickup as Shipment["pickup"],
    pickup_window: b.pickup_window ?? null,
    delivery: delivery as Shipment["delivery"],
    requested_delivery_date: b.requested_delivery_date ?? prefill.requested_delivery_date ?? null,
    mode: b.mode ?? "road",
    service_type: b.service_type ?? "standard",
    border: b.border ?? "domestic",
    package_count: b.package_count ?? 0,
    actual_weight: b.actual_weight ?? 0,
    volumetric_weight: b.volumetric_weight ?? 0,
    chargeable_weight: chargeable,
    length_cm: b.length_cm ?? null,
    width_cm: b.width_cm ?? null,
    height_cm: b.height_cm ?? null,
    package_unit: b.package_unit ?? null,
    package_unit_count: b.package_unit_count ?? 0,
    declared_value: b.declared_value ?? prefill.declared_value ?? 0,
    currency: b.currency ?? "INR",
    goods_description: b.goods_description ?? prefill.goods_description ?? null,
    hs_code: b.hs_code ?? null,
    dangerous_goods: b.dangerous_goods ?? false,
    insurance_required: b.insurance_required ?? false,
    handling_notes: b.handling_notes ?? null,
    freight_payment: b.freight_payment ?? "prepaid",
    estimated_freight: b.estimated_freight ?? prefill.estimated_freight ?? 0,
    quoted_freight: 0,
    booked_freight: 0,
    final_freight: 0,
    fuel_surcharge: 0,
    insurance_charge: 0,
    other_charges: 0,
    total_freight: b.estimated_freight ?? prefill.estimated_freight ?? 0,
    cost_centre: b.cost_centre ?? null,
    freight_invoice_id: null,
    freight_payment_status: null,
    provider_id: null,
    provider_name: null,
    carrier_name: null,
    service_level: null,
    tracking_number: null,
    container_number: null,
    vehicle_number: null,
    driver_name: null,
    driver_mobile: null,
    transporter_id: null,
    booking_reference: null,
    expected_pickup_date: null,
    expected_delivery_date: null,
    actual_pickup_at: null,
    actual_delivery_at: null,
    eway: {
      eway_bill_number: null, eway_bill_date: null, eway_validity: null,
      transporter_id: null, vehicle_number: null, lr_number: null,
      delivery_challan_number: null, ...(prefill.eway ?? {}), ...(b.eway ?? {}),
    },
    cross_border: {
      exporter_of_record: null, importer_of_record: null, iec_number: null,
      origin_country: null, destination_country: null, incoterms: null,
      port_of_loading: null, port_of_discharge: null, final_destination: null,
      commercial_invoice_number: null, packing_list_number: null,
      shipping_bill_number: null, bill_of_entry_number: null, bl_awb_number: null,
      certificate_of_origin: false, customs_broker: null, customs_status: null,
      duty_tax_amount: 0, seal_number: null, ...(b.cross_border ?? {}),
    },
    documents: [],
    goods_receipt_id: null,
    goods_dispatch_id: prefill.goods_dispatch_id ?? null,
    last_event_at: null,
    last_event_source: null,
    booking_failure: null,
    created_by: req.user!.id,
    created_at: now,
    updated_by: req.user!.id,
    updated_at: now,
  };

  await putItem(TABLES.SHIPMENTS, shipment as any);
  await writeShipmentAudit({
    company_id: shipment.company_id, shipment_id: shipment.id,
    action: "created", new_value: { shipment_number: shipment.shipment_number, linked_doc_no: linkedDocNo },
    actor_id: req.user!.id,
  });
  await appendEvent({
    company_id: shipment.company_id, shipment, status: "draft",
    description: "Shipment request created.", source: "manual", actor_id: req.user!.id,
  });
  await createActivityAlert({
    company_id: shipment.company_id, type: "shipment_created", severity: "info",
    message: `Shipment ${shipment.shipment_number} created${linkedDocNo ? ` for ${linkedDocNo}` : ""} — awaiting booking.`,
    created_by: req.user!.id,
  }).catch(() => {});
  res.status(201).json(shipment);
});

// ── Detail (shipment + quotes + events + audit) ──

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const [events, quotes, audit] = await Promise.all([
    scanTable<ShipmentEvent>(TABLES.SHIPMENT_EVENTS, {
      filterExpression: "shipment_id = :sid",
      expressionAttributeValues: { ":sid": shipment.id },
    }),
    scanTable<ShipmentQuote>(TABLES.SHIPMENT_QUOTES, {
      filterExpression: "shipment_id = :sid",
      expressionAttributeValues: { ":sid": shipment.id },
    }),
    scanTable(TABLES.SHIPMENT_AUDIT, {
      filterExpression: "shipment_id = :sid",
      expressionAttributeValues: { ":sid": shipment.id },
    }),
  ]);
  events.sort((a, b) => (a.event_at > b.event_at ? 1 : -1));
  audit.sort((a: any, b: any) => (a.created_at > b.created_at ? 1 : -1));
  res.json({ shipment, events, quotes, audit });
});

// ── Patch (header/cargo/compliance edits; freight fields need elevated role) ──

const FREIGHT_FIELDS = new Set([
  "quoted_freight", "booked_freight", "final_freight", "fuel_surcharge",
  "insurance_charge", "other_charges", "total_freight",
]);

router.patch("/:id", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (isTerminalStatus(shipment.status)) {
    res.status(422).json({ error: `Shipment is ${shipment.status} and can no longer be edited.` });
    return;
  }
  const updates = (req.body ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(updates)) {
    if (FREIGHT_FIELDS.has(k) && !elevated(req.user!.roles)) {
      res.status(403).json({ error: "Only a logistics manager or admin can change freight charges." });
      return;
    }
  }
  const allowed = new Set([
    "priority", "owner_id", "business_unit", "sales_channel", "pickup", "pickup_window",
    "delivery", "requested_delivery_date", "mode", "service_type", "package_count",
    "actual_weight", "volumetric_weight", "length_cm", "width_cm", "height_cm",
    "package_unit", "package_unit_count", "declared_value", "currency",
    "goods_description", "hs_code", "dangerous_goods", "insurance_required",
    "handling_notes", "freight_payment", "estimated_freight", "cost_centre",
    "eway", "cross_border", "vehicle_number", "driver_name", "driver_mobile",
    "transporter_id", "expected_pickup_date", "expected_delivery_date",
    "goods_receipt_id", ...FREIGHT_FIELDS,
  ]);
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.has(k)) safe[k] = v;
  }
  if (Object.keys(safe).length === 0) {
    res.status(400).json({ error: "No editable fields supplied." });
    return;
  }
  if (safe.actual_weight !== undefined || safe.volumetric_weight !== undefined) {
    const aw = Number(safe.actual_weight ?? shipment.actual_weight);
    const vw = Number(safe.volumetric_weight ?? shipment.volumetric_weight);
    safe.chargeable_weight = Math.max(aw, vw);
  }
  safe.updated_at = nowISO();
  safe.updated_by = req.user!.id;
  const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, safe)) as unknown as Shipment;
  await writeShipmentAudit({
    company_id: shipment.company_id, shipment_id: shipment.id, action: "edited",
    old_value: shipment, new_value: safe, actor_id: req.user!.id,
  });

  // Freight-variance alert (final vs quoted beyond configured threshold)
  if (safe.final_freight !== undefined) {
    const settings = await getSettings(shipment.company_id);
    const pct = settings?.freight_variance_pct ?? 10;
    const quoted = Number(updated.quoted_freight) || 0;
    const final = Number(updated.final_freight) || 0;
    if (quoted > 0 && final > quoted * (1 + pct / 100)) {
      await createActivityAlert({
        company_id: shipment.company_id, type: "shipment_freight_variance", severity: "warning",
        message: `Shipment ${shipment.shipment_number}: final freight ${final} exceeds quote ${quoted} by > ${pct}%.`,
        created_by: req.user!.id,
      }).catch(() => {});
    }
  }
  res.json(updated);
});

// ── Quotes ──

router.post("/:id/quotes/request", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const { provider_id } = (req.body ?? {}) as { provider_id?: string };
  const providers = await scanTable<any>(TABLES.LOGISTICS_PROVIDERS, getCompanyFilter(req.user!));
  const targets = (provider_id ? providers.filter((p) => p.id === provider_id) : providers.filter((p) => p.active && p.integration_status === "integrated"));
  if (targets.length === 0) {
    res.status(422).json({ error: "No active integrated provider. Enter a manual quote instead." });
    return;
  }
  const created: ShipmentQuote[] = [];
  const failures: Array<{ provider: string; error: string }> = [];
  for (const p of targets) {
    try {
      const adapter = getAdapter(p.adapter_key);
      const options = await adapter.quote(shipment);
      for (const o of options) {
        const quote: ShipmentQuote = {
          id: generateId(),
          company_id: shipment.company_id,
          shipment_id: shipment.id,
          provider_id: p.id,
          provider_name: p.provider_name,
          carrier_name: o.carrier_name,
          mode: o.mode,
          service_level: o.service_level,
          estimated_pickup_date: o.estimated_pickup_date,
          estimated_delivery_date: o.estimated_delivery_date,
          transit_days: o.transit_days,
          freight_charge: o.freight_charge,
          fuel_charges: o.fuel_charges,
          other_charges: o.other_charges,
          insurance_charge: o.insurance_charge,
          total_cost: o.total_cost,
          tracking_available: o.tracking_available,
          cancellation_terms: o.cancellation_terms,
          is_selected: false,
          expires_at: null,
          created_by: req.user!.id,
          created_at: nowISO(),
        };
        await putItem(TABLES.SHIPMENT_QUOTES, quote as any);
        created.push(quote);
      }
    } catch (err: any) {
      failures.push({ provider: p.provider_name, error: err?.message ?? "Quote failed" });
    }
  }
  if (created.length > 0 && shipment.status === "draft") {
    await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, { status: "quote_received", quoted_freight: created[0].total_cost, updated_at: nowISO(), updated_by: req.user!.id });
    await appendEvent({ company_id: shipment.company_id, shipment: { ...shipment, status: "quote_received" }, status: "quote_received", description: `${created.length} quote option(s) received.`, source: "carrier_api", actor_id: req.user!.id });
  } else if (created.length > 0) {
    await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, { status: "quote_received", updated_at: nowISO(), updated_by: req.user!.id });
  }
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "quotes_requested", new_value: { created: created.length, failures }, actor_id: req.user!.id });
  res.status(201).json({ quotes: created, failures });
});

router.post("/:id/quotes", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const parsed = manualQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid quote", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const total = b.freight_charge + (b.fuel_charges ?? 0) + (b.other_charges ?? 0) + (b.insurance_charge ?? 0);
  const quote: ShipmentQuote = {
    id: generateId(),
    company_id: shipment.company_id,
    shipment_id: shipment.id,
    provider_id: b.provider_id ?? null,
    provider_name: b.provider_name,
    carrier_name: b.carrier_name ?? null,
    mode: b.mode ?? shipment.mode,
    service_level: b.service_level ?? null,
    estimated_pickup_date: b.estimated_pickup_date ?? null,
    estimated_delivery_date: b.estimated_delivery_date ?? null,
    transit_days: b.transit_days ?? null,
    freight_charge: b.freight_charge,
    fuel_charges: b.fuel_charges ?? 0,
    other_charges: b.other_charges ?? 0,
    insurance_charge: b.insurance_charge ?? 0,
    total_cost: total,
    tracking_available: b.tracking_available ?? true,
    cancellation_terms: b.cancellation_terms ?? null,
    is_selected: false,
    expires_at: null,
    created_by: req.user!.id,
    created_at: nowISO(),
  };
  await putItem(TABLES.SHIPMENT_QUOTES, quote as any);
  await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
    status: shipment.status === "draft" ? "quote_received" : shipment.status,
    quoted_freight: total, updated_at: nowISO(), updated_by: req.user!.id,
  });
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "manual_quote_added", new_value: quote, actor_id: req.user!.id });
  res.status(201).json(quote);
});

router.post("/:id/quotes/:quoteId/select", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const quote = (await getItem(TABLES.SHIPMENT_QUOTES, { id: req.params.quoteId })) as unknown as ShipmentQuote | undefined;
  if (!quote || quote.shipment_id !== shipment.id) {
    res.status(404).json({ error: "Quote not found for this shipment" });
    return;
  }
  const existing = await scanTable<ShipmentQuote>(TABLES.SHIPMENT_QUOTES, {
    filterExpression: "shipment_id = :sid",
    expressionAttributeValues: { ":sid": shipment.id },
  });
  for (const q of existing) {
    if (q.is_selected) await updateItem(TABLES.SHIPMENT_QUOTES, { id: q.id }, { is_selected: false });
  }
  await updateItem(TABLES.SHIPMENT_QUOTES, { id: quote.id }, { is_selected: true });
  await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, { quoted_freight: quote.total_cost, updated_at: nowISO(), updated_by: req.user!.id });
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "quote_selected", new_value: { quote_id: quote.id, total: quote.total_cost }, actor_id: req.user!.id });
  res.json({ ok: true, quoted_freight: quote.total_cost });
});

// ── Booking ──

router.post("/:id/book/manual", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (isTerminalStatus(shipment.status)) {
    res.status(422).json({ error: `Shipment is ${shipment.status} and cannot be booked.` });
    return;
  }
  const parsed = manualBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid booking", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const total = b.booked_freight + (b.fuel_surcharge ?? 0) + (b.insurance_charge ?? 0) + (b.other_charges ?? 0);
  const providerName = b.provider_id
    ? (((await getItem(TABLES.LOGISTICS_PROVIDERS, { id: b.provider_id })) as any)?.provider_name as string | undefined) ?? null
    : null;
  const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
    status: "booked",
    provider_id: b.provider_id ?? shipment.provider_id,
    provider_name: providerName ?? shipment.provider_name,
    carrier_name: b.carrier_name,
    service_level: b.service_level ?? shipment.service_level,
    tracking_number: b.tracking_number,
    booked_freight: b.booked_freight,
    fuel_surcharge: b.fuel_surcharge ?? 0,
    insurance_charge: b.insurance_charge ?? 0,
    other_charges: b.other_charges ?? 0,
    total_freight: total,
    vehicle_number: b.vehicle_number ?? null,
    driver_name: b.driver_name ?? null,
    driver_mobile: b.driver_mobile ?? null,
    transporter_id: b.transporter_id ?? null,
    expected_pickup_date: b.expected_pickup_date ?? null,
    expected_delivery_date: b.expected_delivery_date ?? null,
    booking_failure: null,
    updated_at: nowISO(),
    updated_by: req.user!.id,
  })) as unknown as Shipment;
  await appendEvent({
    company_id: shipment.company_id, shipment: updated, status: "booked",
    description: `Manual booking with ${b.carrier_name}. Tracking ${b.tracking_number}.`, source: "manual", actor_id: req.user!.id,
  });
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "booking_confirmed", new_value: { mode: "manual", carrier: b.carrier_name, tracking: b.tracking_number, total }, actor_id: req.user!.id });
  await createActivityAlert({ company_id: shipment.company_id, type: "shipment_booked", severity: "info", message: `Shipment ${shipment.shipment_number} booked with ${b.carrier_name} (${b.tracking_number}).`, created_by: req.user!.id }).catch(() => {});
  res.json(updated);
});

router.post("/:id/book/integrated", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (isTerminalStatus(shipment.status)) {
    res.status(422).json({ error: `Shipment is ${shipment.status} and cannot be booked.` });
    return;
  }
  const { provider_id } = (req.body ?? {}) as { provider_id?: string };
  const provider = provider_id ? ((await getItem(TABLES.LOGISTICS_PROVIDERS, { id: provider_id })) as any) : null;
  if (!provider || provider.integration_status !== "integrated") {
    res.status(422).json({ error: "An active integrated provider is required for integrated booking." });
    return;
  }
  const adapter = getAdapter(provider.adapter_key);
  try {
    const svc = await adapter.serviceability(shipment);
    if (!svc.serviceable) {
      await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, { booking_failure: svc.reason, updated_at: nowISO(), updated_by: req.user!.id });
      res.status(422).json({ error: svc.reason ?? "Route not serviceable." });
      return;
    }
    const result = await adapter.book(shipment);
    const total = Number(shipment.quoted_freight) || Number(shipment.estimated_freight) || 0;
    const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
      status: "booked",
      provider_id: provider.id,
      provider_name: provider.provider_name,
      carrier_name: result.carrier_name ?? provider.carrier_name ?? provider.provider_name,
      service_level: result.service_level,
      tracking_number: result.tracking_number,
      booking_reference: result.booking_reference,
      expected_pickup_date: result.expected_pickup_date,
      expected_delivery_date: result.expected_delivery_date,
      booked_freight: total,
      total_freight: total,
      booking_failure: null,
      updated_at: nowISO(),
      updated_by: req.user!.id,
    })) as unknown as Shipment;
    await appendEvent({
      company_id: shipment.company_id, shipment: updated, status: "booked",
      description: `Booked via ${provider.provider_name}. Ref ${result.booking_reference}.`, source: "carrier_api", actor_id: req.user!.id,
    });
    await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "booking_confirmed", new_value: { mode: "integrated", provider: provider.provider_name, ref: result.booking_reference }, actor_id: req.user!.id });
    await createActivityAlert({ company_id: shipment.company_id, type: "shipment_booked", severity: "info", message: `Shipment ${shipment.shipment_number} booked via ${provider.provider_name} (${result.tracking_number ?? result.booking_reference}).`, created_by: req.user!.id }).catch(() => {});
    res.json(updated);
  } catch (err: any) {
    // Provider failure must not lose the shipment request — record and allow retry/manual.
    await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, { booking_failure: err?.message ?? "Booking failed", updated_at: nowISO(), updated_by: req.user!.id });
    await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "booking_failed", new_value: { error: err?.message }, actor_id: req.user!.id });
    res.status(502).json({ error: "Provider booking failed — shipment retained for retry or manual booking.", detail: err?.message });
  }
});

// ── Tracking events (manual update; carrier updates arrive via webhook/polling) ──

router.post("/:id/events", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const parsed = manualEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  if (isStatusRegression(shipment.status, b.status)) {
    res.status(422).json({ error: `Cannot move shipment from ${shipment.status} to ${b.status}.` });
    return;
  }
  const event = await appendEvent({
    company_id: shipment.company_id,
    shipment: { ...shipment, actual_pickup_at: shipment.actual_pickup_at },
    status: b.status,
    carrier_raw_status: b.carrier_raw_status ?? b.status,
    location: b.location ?? null,
    description: b.description ?? null,
    source: "manual",
    actor_id: req.user!.id,
  });
  // Patch event_at when explicitly supplied
  if (b.event_at) await updateItem(TABLES.SHIPMENT_EVENTS, { id: event.id }, { event_at: b.event_at });
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "manual_status_change", old_value: shipment.status, new_value: b.status, actor_id: req.user!.id });

  if (b.status === "delivered") {
    await createActivityAlert({ company_id: shipment.company_id, type: "shipment_delivered", severity: "info", message: `Shipment ${shipment.shipment_number} marked delivered by carrier. Attach POD; GRN/dispatch confirmation still required for stock.`, created_by: req.user!.id }).catch(() => {});
  } else if (isExceptionStatus(b.status)) {
    await createActivityAlert({ company_id: shipment.company_id, type: "shipment_exception", severity: "critical", message: `Shipment ${shipment.shipment_number}: ${b.status}${b.location ? ` at ${b.location}` : ""}.`, created_by: req.user!.id }).catch(() => {});
  }
  const refreshed = (await getItem(TABLES.SHIPMENTS, { id: shipment.id })) as unknown as Shipment;
  res.status(201).json({ event, shipment: refreshed });
});

// ── Cancel (elevated role only) ──

router.post("/:id/cancel", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  if (!elevated(req.user!.roles)) {
    res.status(403).json({ error: "Only a logistics manager or admin can cancel a booked shipment." });
    return;
  }
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (shipment.status === "delivered" || shipment.status === "cancelled") {
    res.status(422).json({ error: `Shipment is ${shipment.status} and cannot be cancelled.` });
    return;
  }
  const { reason } = (req.body ?? {}) as { reason?: string };
  const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
    status: "cancelled", updated_at: nowISO(), updated_by: req.user!.id,
  })) as unknown as Shipment;
  await appendEvent({ company_id: shipment.company_id, shipment: updated, status: "cancelled", description: reason ?? "Booking cancelled.", source: "manual", actor_id: req.user!.id });
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "cancelled", old_value: shipment.status, new_value: "cancelled", actor_id: req.user!.id });
  await createActivityAlert({ company_id: shipment.company_id, type: "shipment_cancelled", severity: "warning", message: `Shipment ${shipment.shipment_number} cancelled.${reason ? ` ${reason}` : ""}`, created_by: req.user!.id }).catch(() => {});
  res.json(updated);
});

// ── Documents (metadata only; bytes go through /api/upload) ──

router.post("/:id/documents", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const { path, name, type, size, kind } = (req.body ?? {}) as Record<string, any>;
  if (!path || !name) {
    res.status(400).json({ error: "Document path and name are required." });
    return;
  }
  const doc = {
    path, name, type: type ?? "application/octet-stream", size: Number(size) || 0,
    kind: ["pod", "label", "invoice", "certificate", "other"].includes(kind) ? kind : "other",
    uploaded_at: nowISO(), uploaded_by: req.user!.id,
  };
  const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
    documents: [...(shipment.documents ?? []), doc],
    updated_at: nowISO(), updated_by: req.user!.id,
  })) as unknown as Shipment;
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "document_uploaded", new_value: doc, actor_id: req.user!.id });
  res.status(201).json(updated);
});

// ── Link freight purchase invoice (operational linkage; creates NO payable) ──

router.post("/:id/freight-invoice", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const shipment = await loadShipment(req, req.params.id);
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  const { freight_invoice_id, final_freight } = (req.body ?? {}) as { freight_invoice_id?: string; final_freight?: number };
  if (!freight_invoice_id) {
    res.status(400).json({ error: "freight_invoice_id is required." });
    return;
  }
  const pi = await getItem(TABLES.PURCHASE_INVOICES, { id: freight_invoice_id });
  if (!pi) {
    res.status(404).json({ error: "Freight purchase invoice not found." });
    return;
  }
  const final = Number(final_freight) || Number((pi as any).amount) || 0;
  const updated = (await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, {
    freight_invoice_id, final_freight: final, total_freight: final,
    updated_at: nowISO(), updated_by: req.user!.id,
  })) as unknown as Shipment;
  await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "freight_invoice_linked", new_value: { freight_invoice_id, final }, actor_id: req.user!.id });
  const settings = await getSettings(shipment.company_id);
  const pct = settings?.freight_variance_pct ?? 10;
  const quoted = Number(updated.quoted_freight) || 0;
  if (quoted > 0 && final > quoted * (1 + pct / 100)) {
    await createActivityAlert({ company_id: shipment.company_id, type: "shipment_freight_variance", severity: "warning", message: `Shipment ${shipment.shipment_number}: billed freight ${final} exceeds quote ${quoted} by > ${pct}%.`, created_by: req.user!.id }).catch(() => {});
  }
  res.json(updated);
});

export async function getDefaultSettings(companyId: string): Promise<LogisticsSettings> {
  const existing = companyId ? await getSettings(companyId) : null;
  return existing ?? (defaultLogisticsSettings(companyId) as LogisticsSettings);
}

export default router;
