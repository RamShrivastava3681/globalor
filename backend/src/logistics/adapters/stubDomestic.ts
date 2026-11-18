import crypto from "crypto";
import type { LogisticsAdapter, TrackingUpdate } from "./types.js";
import type { Shipment, ShipmentStatus } from "../../types/index.js";

// ── V1 integrated domestic provider (scaffold) ──
// Wiring pattern for the first real domestic carrier/aggregator:
// credentials live in env (LOGISTICS_<PROVIDER>_*) and are read ONLY here,
// server-side. Until a real carrier contract exists, this scaffold behaves
// deterministically so the booking → tracking → delivery flow is testable
// end-to-end. Swap the internals for real HTTP calls without touching the
// Logistics module — the adapter interface stays fixed.
//
// Env:
//   LOGISTICS_PROVIDER_KEY   (default "stub-domestic")
//   LOGISTICS_PROVIDER_NAME  (default "Stub Domestic Carrier")
//   LOGISTICS_WEBHOOK_SECRET (shared secret for webhook signature verify)

const PROVIDER_NAME = process.env.LOGISTICS_PROVIDER_NAME || "Stub Domestic Carrier";

function ref(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

const RAW_TO_STANDARD: Array<[RegExp, ShipmentStatus]> = [
  [/pickup|picked/i, "picked_up"],
  [/hub|terminal|arrived/i, "at_hub"],
  [/custom/i, "at_customs"],
  [/out.for.delivery|ofd/i, "out_for_delivery"],
  [/deliver/i, "delivered"],
  [/fail|attempt|refus/i, "delivery_attempt_failed"],
  [/delay/i, "delayed"],
  [/damage/i, "damaged"],
  [/lost/i, "lost"],
  [/cancel/i, "cancelled"],
  [/transit|linehaul|depart/i, "in_transit"],
];

export const stubDomesticAdapter: LogisticsAdapter = {
  key: process.env.LOGISTICS_PROVIDER_KEY || "stub-domestic",
  label: PROVIDER_NAME,

  async serviceability(shipment: Shipment) {
    if (shipment.border === "cross_border") {
      return { serviceable: false, reason: "Domestic-only provider: cross-border not serviceable." };
    }
    if (!shipment.delivery?.postal_code) {
      return { serviceable: false, reason: "Delivery postal code required for serviceability." };
    }
    return { serviceable: true, reason: null };
  },

  async quote(shipment: Shipment) {
    const base = 250 + Math.round(Number(shipment.chargeable_weight || 1) * 18);
    const eta = new Date(Date.now() + 4 * 86400000).toISOString();
    return [
      {
        carrier_name: PROVIDER_NAME,
        mode: shipment.mode,
        service_level: "Standard",
        estimated_pickup_date: new Date(Date.now() + 86400000).toISOString(),
        estimated_delivery_date: eta,
        transit_days: 4,
        freight_charge: base,
        fuel_charges: Math.round(base * 0.12),
        other_charges: 0,
        insurance_charge: shipment.insurance_required ? Math.round(Number(shipment.declared_value || 0) * 0.002) : 0,
        total_cost: 0, // filled below
        tracking_available: true,
        cancellation_terms: "Free cancellation before pickup.",
      },
    ].map((q) => ({
      ...q,
      total_cost: q.freight_charge + q.fuel_charges + q.other_charges + q.insurance_charge,
    }));
  },

  async book(shipment: Shipment) {
    void shipment;
    const now = Date.now();
    return {
      booking_reference: ref("BK"),
      tracking_number: ref("AWB"),
      carrier_name: PROVIDER_NAME,
      service_level: "Standard",
      expected_pickup_date: new Date(now + 86400000).toISOString(),
      expected_delivery_date: new Date(now + 4 * 86400000).toISOString(),
      label_url: null,
    };
  },

  async cancel(_shipment: Shipment) {
    return { ok: true, message: "Booking cancelled with carrier." };
  },

  async track(shipment: Shipment): Promise<TrackingUpdate[]> {
    // Scaffold: no live carrier yet — report "no new updates" so polling is a
    // no-op until a real track() implementation lands.
    void shipment;
    return [];
  },

  verifyWebhook(payload: unknown, signature: string | undefined) {
    const secret = process.env.LOGISTICS_WEBHOOK_SECRET;
    if (!secret) return false;
    if (!signature || typeof payload !== "string") return false;
    try {
      const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  },

  parseWebhook(payload: any) {
    if (!payload || typeof payload.tracking_number !== "string") return null;
    const updates: TrackingUpdate[] = Array.isArray(payload.events)
      ? payload.events.map((e: any) => ({
          status: this.mapStatus(String(e.raw_status ?? "")),
          carrier_raw_status: String(e.raw_status ?? ""),
          event_at: String(e.event_at ?? new Date().toISOString()),
          location: e.location ?? null,
          description: e.description ?? null,
        }))
      : [];
    return { tracking_number: payload.tracking_number, updates };
  },

  mapStatus(raw: string): ShipmentStatus {
    for (const [re, status] of RAW_TO_STANDARD) {
      if (re.test(raw)) return status;
    }
    return "in_transit";
  },
};
