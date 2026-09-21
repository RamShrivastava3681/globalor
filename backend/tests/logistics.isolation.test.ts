/**
 * Logistics module regression tests.
 *
 * Run with: npm test  (backend)  →  tsx --test tests/*.test.ts
 *
 * Three groups:
 *  1. Pure-function rules — status transitions, exception/terminal sets,
 *     colour map integrity, default settings.
 *  2. Zod validators — shipment create, manual booking/quote/event, provider.
 *  3. Stock-isolation guard — the hard rule from the build plan: the logistics
 *     module (shipments routes, webhooks, polling, adapters, providers, seed)
 *     must NEVER write to stock or finance tables. Inbound stock credits only
 *     on GRN confirm; outbound debits only on Dispatch confirm; booking freight
 *     moves no stock. Reads/links of PO / dispatch / invoice docs are allowed
 *     (prefill + freight-invoice validation), writes are not. Source files are
 *     scanned so a future edit that introduces a stock write fails immediately.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isStatusRegression,
  isTerminalStatus,
  isExceptionStatus,
  shipmentColour,
  SHIPMENT_STATUSES,
  defaultLogisticsSettings,
} from "../src/utils/logistics.js";
import {
  createShipmentSchema,
  manualBookingSchema,
  manualQuoteSchema,
  manualEventSchema,
  providerSchema,
} from "../src/logistics/validators.js";

const here = dirname(fileURLToPath(import.meta.url));

// ── 1. Status rules ──────────────────────────────────────────────────────────

describe("shipment status rules", () => {
  it("delivered never regresses except via return flow", () => {
    assert.equal(isStatusRegression("delivered", "in_transit"), true);
    assert.equal(isStatusRegression("delivered", "booked"), true);
    assert.equal(isStatusRegression("delivered", "return_initiated"), false);
    assert.equal(isStatusRegression("delivered", "delivered"), false);
  });

  it("cancelled and returned are frozen", () => {
    assert.equal(isStatusRegression("cancelled", "booked"), true);
    assert.equal(isStatusRegression("cancelled", "return_initiated"), true);
    assert.equal(isStatusRegression("returned", "delivered"), true);
    assert.equal(isStatusRegression("cancelled", "cancelled"), false);
  });

  it("forward transitions are allowed", () => {
    assert.equal(isStatusRegression("booked", "picked_up"), false);
    assert.equal(isStatusRegression("in_transit", "at_hub"), false);
    assert.equal(isStatusRegression("in_transit", "delayed"), false);
    assert.equal(isStatusRegression("quote_received", "booked"), false);
  });

  it("terminal statuses stop polling and booking", () => {
    for (const s of ["delivered", "cancelled", "returned", "lost"] as const) {
      assert.equal(isTerminalStatus(s), true, `${s} should be terminal`);
    }
    for (const s of ["draft", "booked", "in_transit", "delayed", "customs_hold"] as const) {
      assert.equal(isTerminalStatus(s), false, `${s} should not be terminal`);
    }
  });

  it("exception statuses are the red/amber set surfaced on the Exceptions tab", () => {
    for (const s of [
      "delayed", "delivery_attempt_failed", "customs_hold",
      "damaged", "lost", "return_initiated", "returned", "cancelled",
    ] as const) {
      assert.equal(isExceptionStatus(s), true, `${s} should be an exception`);
    }
    assert.equal(isExceptionStatus("in_transit"), false);
    assert.equal(isExceptionStatus("delivered"), false);
  });

  it("colour buckets match the shared map", () => {
    assert.equal(shipmentColour("draft"), "grey");
    assert.equal(shipmentColour("booked"), "blue");
    assert.equal(shipmentColour("in_transit"), "purple");
    assert.equal(shipmentColour("delivered"), "green");
    assert.equal(shipmentColour("delayed"), "amber");
    assert.equal(shipmentColour("lost"), "red");
  });

  it("every status has a colour and the list is complete", () => {
    assert.equal(SHIPMENT_STATUSES.length, 19);
    for (const s of SHIPMENT_STATUSES) assert.ok(shipmentColour(s));
  });

  it("default settings carry the alert thresholds", () => {
    const s = defaultLogisticsSettings("c1") as any;
    assert.equal(s.company_id, "c1");
    assert.equal(s.delay_buffer_days, 2);
    assert.equal(s.stale_tracking_hours, 48);
    assert.equal(s.freight_variance_pct, 10);
    assert.equal(s.pod_grace_hours, 24);
  });
});

// ── 2. Validators ────────────────────────────────────────────────────────────

describe("logistics validators", () => {
  it("accepts a minimal manual shipment create", () => {
    const r = createShipmentSchema.safeParse({
      shipment_type: "outbound",
      pickup: { name: "Warehouse A" },
      delivery: { name: "Customer B" },
    });
    assert.equal(r.success, true);
  });

  it("rejects an unknown shipment type", () => {
    const r = createShipmentSchema.safeParse({ shipment_type: "sideways" });
    assert.equal(r.success, false);
  });

  it("rejects a booking without carrier or tracking number", () => {
    const r = manualBookingSchema.safeParse({ booked_freight: 100 });
    assert.equal(r.success, false);
    const r2 = manualBookingSchema.safeParse({ carrier_name: "BlueDart", tracking_number: "", booked_freight: 100 });
    assert.equal(r2.success, false);
  });

  it("rejects negative freight on booking", () => {
    const r = manualBookingSchema.safeParse({ carrier_name: "BlueDart", tracking_number: "AWB1", booked_freight: -5 });
    assert.equal(r.success, false);
  });

  it("accepts a manual booking with charges", () => {
    const r = manualBookingSchema.safeParse({
      carrier_name: "BlueDart", tracking_number: "AWB123", booked_freight: 500,
      fuel_surcharge: 20, other_charges: 10,
    });
    assert.equal(r.success, true);
  });

  it("rejects an unknown event status", () => {
    const r = manualEventSchema.safeParse({ status: "teleported" });
    assert.equal(r.success, false);
  });

  it("requires provider name and non-negative freight on a manual quote", () => {
    assert.equal(manualQuoteSchema.safeParse({ provider_name: "X", freight_charge: 0 }).success, true);
    assert.equal(manualQuoteSchema.safeParse({ provider_name: "X", freight_charge: -1 }).success, false);
    assert.equal(manualQuoteSchema.safeParse({ freight_charge: 10 }).success, false);
  });

  it("provider master requires name and at least one mode", () => {
    assert.equal(providerSchema.safeParse({ provider_name: "P", modes: ["road"] }).success, true);
    assert.equal(providerSchema.safeParse({ provider_name: "P", modes: [] }).success, false);
    assert.equal(providerSchema.safeParse({ modes: ["road"] }).success, false);
  });
});

// ── 3. Stock-isolation guard ─────────────────────────────────────────────────

describe("stock isolation (hard rule: freight booking never moves stock)", () => {
  /** Tables the logistics module must never WRITE to. Reads/links are fine. */
  const GUARDED_TABLES = [
    "STOCK_MOVEMENTS",
    "GOODS_RECEIPTS",
    "GOODS_DISPATCHES",
    "PURCHASE_INVOICES",
  ] as const;

  const WRITE_FNS = ["putItem", "updateItem", "deleteItem", "putItemConditional", "updateItemConditional", "batchWrite"] as const;

  // Only the logistics module + its seed. Other route files legitimately write
  // these tables (GRN credits stock, dispatch debits stock, PI flows).
  const LOGISTICS_FILES = [
    "../src/routes/shipments.ts",
    "../src/routes/shipmentWebhooks.ts",
    "../src/routes/logisticsProviders.ts",
    "../src/logistics/polling.ts",
    "../src/logistics/validators.ts",
    "../src/logistics/adapters/index.ts",
    "../src/logistics/adapters/manual.ts",
    "../src/logistics/adapters/stubDomestic.ts",
    "../src/logistics/adapters/types.ts",
    "../src/seed.ts",
  ];

  const writeTargets = (src: string): string[] => {
    const targets: string[] = [];
    for (const fn of WRITE_FNS) {
      const re = new RegExp(`\\b${fn}\\(\\s*TABLES\\.([A-Z_]+)`, "g");
      for (const m of src.matchAll(re)) targets.push(m[1]);
    }
    return targets;
  };

  it("logistics module never writes to stock or finance tables", () => {
    const offenders: string[] = [];
    for (const rel of LOGISTICS_FILES) {
      const src = readFileSync(join(here, rel), "utf8");
      for (const t of writeTargets(src)) {
        if ((GUARDED_TABLES as readonly string[]).includes(t)) offenders.push(`${rel} → writes TABLES.${t}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Logistics module must not touch stock/finance tables (writes happen only via GRN/dispatch confirm):\n${offenders.join("\n")}`,
    );
  });

  it("shipments.ts writes target shipment-owned tables only", () => {
    const src = readFileSync(join(here, "../src/routes/shipments.ts"), "utf8");
    const allowed = new Set(["SHIPMENTS", "SHIPMENT_EVENTS", "SHIPMENT_QUOTES", "SHIPMENT_AUDIT"]);
    const targets = writeTargets(src);
    assert.ok(targets.length > 0, "expected write calls in shipments.ts");
    for (const t of targets) assert.ok(allowed.has(t), `unexpected write target: TABLES.${t}`);
  });

  it("poller writes target shipment-owned tables only", () => {
    const src = readFileSync(join(here, "../src/logistics/polling.ts"), "utf8");
    const allowed = new Set(["SHIPMENTS", "SHIPMENT_EVENTS"]);
    for (const t of writeTargets(src)) assert.ok(allowed.has(t), `unexpected write target: TABLES.${t}`);
  });

  it("provider/settings routes write their own tables only", () => {
    const src = readFileSync(join(here, "../src/routes/logisticsProviders.ts"), "utf8");
    const allowed = new Set(["LOGISTICS_PROVIDERS", "LOGISTICS_SETTINGS"]);
    const targets = writeTargets(src);
    assert.ok(targets.length > 0, "expected write calls in logisticsProviders.ts");
    for (const t of targets) assert.ok(allowed.has(t), `unexpected write target: TABLES.${t}`);
  });
});
