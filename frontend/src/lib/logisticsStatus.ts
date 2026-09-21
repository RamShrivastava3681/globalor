// Shared shipment status → label + colour. Must match backend utils/logistics.ts.
// grey = draft/not booked · blue = booked/pickup scheduled · purple = in transit
// green = delivered · amber = attention · red = exception/cancelled/returned.

export type ShipmentColour = "grey" | "blue" | "purple" | "green" | "amber" | "red";

const LABELS: Record<string, string> = {
  draft: "Draft",
  quote_requested: "Quote requested",
  quote_received: "Quote received",
  booked: "Booked",
  pickup_scheduled: "Pickup scheduled",
  picked_up: "Picked up",
  in_transit: "In transit",
  at_hub: "At hub",
  at_customs: "At customs",
  customs_hold: "Customs hold",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_attempt_failed: "Delivery attempt failed",
  delayed: "Delayed",
  damaged: "Damaged",
  lost: "Lost",
  return_initiated: "Return initiated",
  returned: "Returned",
  cancelled: "Cancelled",
};

const COLOURS: Record<string, ShipmentColour> = {
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

const PILL: Record<ShipmentColour, string> = {
  grey: "border-border bg-muted text-muted-foreground",
  blue: "border-primary/40 bg-primary/10 text-primary",
  purple: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  green: "border-success/40 bg-success/10 text-success",
  amber: "border-warning/40 bg-warning/10 text-warning",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function shipmentLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function shipmentColour(status: string): ShipmentColour {
  return COLOURS[status] ?? "grey";
}

export function shipmentPill(status: string): string {
  return PILL[shipmentColour(status)];
}

export const SHIPMENT_STATUSES = Object.keys(LABELS);

export const EXCEPTION_STATUSES = new Set([
  "delayed",
  "delivery_attempt_failed",
  "customs_hold",
  "damaged",
  "lost",
  "return_initiated",
  "returned",
  "cancelled",
]);
