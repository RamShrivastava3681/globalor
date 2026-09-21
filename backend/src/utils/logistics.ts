import { putItem, TABLES } from "../db/client.js";
import { generateId, nowISO } from "./helpers.js";
import type { ShipmentStatus } from "../types/index.js";

// ── Standard statuses → colour bucket (must match frontend lib) ──

export type ShipmentColour = "grey" | "blue" | "purple" | "green" | "amber" | "red";

const COLOUR_MAP: Record<ShipmentStatus, ShipmentColour> = {
  draft: "grey",
  quote_requested: "blue",
  quote_received: "blue",
  booked: "blue",
  pickup_scheduled: "blue",
  picked_up: "purple",
  in_transit: "purple",
  at_hub: "purple",
  at_customs: "purple",
  customs_hold: "amber",
  out_for_delivery: "purple",
  delivered: "green",
  delivery_attempt_failed: "amber",
  delayed: "amber",
  damaged: "red",
  lost: "red",
  return_initiated: "red",
  returned: "red",
  cancelled: "red",
};

export function shipmentColour(status: ShipmentStatus): ShipmentColour {
  return COLOUR_MAP[status] ?? "grey";
}

/** Forward-only transition guard: never regress a delivered shipment except via return flow. */
export function isStatusRegression(from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (from === to) return false;
  if (from === "delivered" && to !== "return_initiated") return true;
  if (from === "cancelled" || from === "returned") return true;
  return false;
}

/** Terminal states — polling and booking actions stop here. */
export function isTerminalStatus(status: ShipmentStatus): boolean {
  return status === "delivered" || status === "cancelled" || status === "returned" || status === "lost";
}

/** Exception states surfaced on the Exceptions tab. */
export function isExceptionStatus(status: ShipmentStatus): boolean {
  return (
    status === "delayed" ||
    status === "delivery_attempt_failed" ||
    status === "customs_hold" ||
    status === "damaged" ||
    status === "lost" ||
    status === "return_initiated" ||
    status === "returned" ||
    status === "cancelled"
  );
}

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "draft",
  "quote_requested",
  "quote_received",
  "booked",
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "at_hub",
  "at_customs",
  "customs_hold",
  "out_for_delivery",
  "delivered",
  "delivery_attempt_failed",
  "delayed",
  "damaged",
  "lost",
  "return_initiated",
  "returned",
  "cancelled",
];

export async function writeShipmentAudit(params: {
  company_id: string | null;
  shipment_id: string;
  action: string;
  old_value?: unknown;
  new_value?: unknown;
  actor_id?: string | null;
}): Promise<void> {
  await putItem(TABLES.SHIPMENT_AUDIT, {
    id: generateId(),
    company_id: params.company_id,
    shipment_id: params.shipment_id,
    action: params.action,
    old_value: params.old_value === undefined ? null : JSON.stringify(params.old_value),
    new_value: params.new_value === undefined ? null : JSON.stringify(params.new_value),
    actor_id: params.actor_id ?? null,
    created_at: nowISO(),
  });
}

export function defaultLogisticsSettings(companyId: string) {
  return {
    company_id: companyId,
    delay_buffer_days: 2,
    stale_tracking_hours: 48,
    eway_expiry_warn_hours: 24,
    default_provider_id: null,
    default_mode: "road",
    freight_variance_pct: 10,
    pod_grace_hours: 24,
    updated_at: nowISO(),
  };
}
