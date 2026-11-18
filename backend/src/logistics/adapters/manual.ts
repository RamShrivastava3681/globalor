import type { LogisticsAdapter } from "./types.js";
import type { Shipment } from "../../types/index.js";

// Manual transporter booking — works for any local transporter with no API.
// All values are entered by the user; the adapter only validates serviceability.

export const manualAdapter: LogisticsAdapter = {
  key: "manual",
  label: "Manual transporter",

  async serviceability(_shipment: Shipment) {
    return { serviceable: true, reason: null };
  },

  async quote(_shipment: Shipment) {
    return [];
  },

  async book(_shipment: Shipment) {
    throw new Error("Manual bookings are recorded directly with carrier, cost and tracking number.");
  },

  async cancel(_shipment: Shipment) {
    return { ok: true, message: "Manual booking — cancel directly with the transporter." };
  },

  async track(_shipment: Shipment) {
    return [];
  },

  verifyWebhook(_payload: unknown, _signature: string | undefined) {
    return false;
  },

  parseWebhook(_payload: any) {
    return null;
  },

  mapStatus(raw: string) {
    void raw;
    return "in_transit";
  },
};
