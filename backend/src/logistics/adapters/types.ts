import type { Shipment, ShipmentMode, ShipmentStatus } from "../../types/index.js";

// ── Provider-neutral logistics integration layer ──
// WhizUnik Logistics Module → Integration Layer → Provider Adapter → Carrier API.
// Adding a provider = adding one adapter file + registering it below. The
// module itself never changes. Credentials are read server-side from env /
// secret store — never from DynamoDB, never returned to the frontend.

export interface QuoteRequest {
  shipment: Shipment;
}

export interface QuoteOption {
  carrier_name: string | null;
  mode: ShipmentMode;
  service_level: string | null;
  estimated_pickup_date: string | null;
  estimated_delivery_date: string | null;
  transit_days: number | null;
  freight_charge: number;
  fuel_charges: number;
  other_charges: number;
  insurance_charge: number;
  total_cost: number;
  tracking_available: boolean;
  cancellation_terms: string | null;
}

export interface BookingResult {
  booking_reference: string;
  tracking_number: string | null;
  carrier_name: string | null;
  service_level: string | null;
  expected_pickup_date: string | null;
  expected_delivery_date: string | null;
  label_url: string | null;
}

export interface TrackingUpdate {
  status: ShipmentStatus;
  carrier_raw_status: string;
  event_at: string;
  location: string | null;
  description: string | null;
}

export interface LogisticsAdapter {
  key: string;
  label: string;
  serviceability(shipment: Shipment): Promise<{ serviceable: boolean; reason: string | null }>;
  quote(shipment: Shipment): Promise<QuoteOption[]>;
  book(shipment: Shipment): Promise<BookingResult>;
  cancel(shipment: Shipment): Promise<{ ok: boolean; message: string | null }>;
  track(shipment: Shipment): Promise<TrackingUpdate[]>;
  verifyWebhook(payload: unknown, signature: string | undefined): boolean;
  parseWebhook(payload: any): { tracking_number: string; updates: TrackingUpdate[] } | null;
  mapStatus(raw: string): ShipmentStatus;
}
