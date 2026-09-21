import { getItem, putItem, updateItem, scanTable, TABLES } from "../db/client.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { isTerminalStatus, isExceptionStatus, defaultLogisticsSettings } from "../utils/logistics.js";
import { getAdapter } from "./adapters/index.js";
import type { Shipment, ShipmentEvent, LogisticsSettings } from "../types/index.js";

/**
 * Scheduled API polling for shipments whose provider has no webhook.
 * Runs daily (see index.ts) + on demand via POST /api/admin/run-logistics-poll.
 * Also raises: delayed-vs-ETA, stale-tracking, e-way expiry, POD-missing,
 * inbound-overdue alerts. Failure-isolated per shipment — one bad provider
 * response never blocks the rest.
 */
export async function runLogisticsPoll(): Promise<{
  polled: number;
  events: number;
  alerts: number;
}> {
  const shipments = await scanTable<Shipment>(TABLES.SHIPMENTS);
  const settingsByCompany = new Map<string, LogisticsSettings>();
  let polled = 0;
  let events = 0;
  let alerts = 0;

  const settingsFor = async (companyId: string | null): Promise<LogisticsSettings> => {
    const key = companyId ?? "global";
    if (!settingsByCompany.has(key)) {
      const s = companyId
        ? ((await getItem(TABLES.LOGISTICS_SETTINGS, { company_id: companyId })) as unknown as LogisticsSettings | undefined)
        : undefined;
      settingsByCompany.set(key, s ?? (defaultLogisticsSettings(key) as LogisticsSettings));
    }
    return settingsByCompany.get(key)!;
  };

  const raise = async (company_id: string | null, type: any, severity: "info" | "warning" | "critical", message: string) => {
    await createActivityAlert({ company_id, type, severity, message }).catch(() => {});
    alerts++;
  };

  for (const s of shipments) {
    try {
      const settings = await settingsFor(s.company_id);
      const now = Date.now();

      // 1. Poll integrated providers for active shipments with tracking numbers.
      if (!isTerminalStatus(s.status) && s.tracking_number && s.provider_id) {
        const provider = (await getItem(TABLES.LOGISTICS_PROVIDERS, { id: s.provider_id })) as any;
        if (provider?.integration_status === "integrated") {
          const adapter = getAdapter(provider.adapter_key);
          const updates = await adapter.track(s).catch(() => []);
          for (const u of updates) {
            const event: ShipmentEvent = {
              id: generateId(), company_id: s.company_id, shipment_id: s.id,
              status: u.status, carrier_raw_status: u.carrier_raw_status,
              event_at: u.event_at, location: u.location, description: u.description,
              source: "carrier_api", attachment_url: null, created_by: null, created_at: nowISO(),
            };
            await putItem(TABLES.SHIPMENT_EVENTS, event as any);
            await updateItem(TABLES.SHIPMENTS, { id: s.id }, {
              status: u.status, last_event_at: u.event_at, last_event_source: "carrier_api",
              ...(u.status === "delivered" ? { actual_delivery_at: u.event_at } : {}),
              updated_at: nowISO(),
            });
            s.status = u.status;
            events++;
          }
          polled++;
        }
      }

      if (isTerminalStatus(s.status)) continue;

      // 2. Delayed vs ETA (expected delivery + buffer).
      if (s.expected_delivery_date && ["booked", "pickup_scheduled", "picked_up", "in_transit", "at_hub", "out_for_delivery"].includes(s.status)) {
        const eta = new Date(s.expected_delivery_date).getTime() + (settings.delay_buffer_days ?? 2) * 86400000;
        if (eta < now && s.status !== "delayed") {
          await updateItem(TABLES.SHIPMENTS, { id: s.id }, { status: "delayed", updated_at: nowISO() });
          await raise(s.company_id, "shipment_delayed", "warning", `Shipment ${s.shipment_number} delayed versus ETA (${s.expected_delivery_date}).`);
        }
      }

      // 3. Stale tracking (no event beyond threshold while active).
      const lastTs = s.last_event_at ? new Date(s.last_event_at).getTime() : new Date(s.created_at).getTime();
      if (["picked_up", "in_transit", "at_hub", "out_for_delivery"].includes(s.status)) {
        if (now - lastTs > (settings.stale_tracking_hours ?? 48) * 3600000) {
          await raise(s.company_id, "shipment_stale_tracking", "warning", `Shipment ${s.shipment_number} has no carrier update for over ${settings.stale_tracking_hours}h.`);
        }
      }

      // 4. e-Way Bill validity approaching expiry.
      if (s.eway?.eway_validity) {
        const validTill = new Date(s.eway.eway_validity).getTime();
        if (!isNaN(validTill) && validTill - now < (settings.eway_expiry_warn_hours ?? 24) * 3600000 && validTill > now) {
          await raise(s.company_id, "shipment_eway_expiring", "warning", `Shipment ${s.shipment_number}: e-Way Bill ${s.eway.eway_bill_number ?? ""} expires soon.`);
        }
      }

      // 5. POD missing after delivery grace period.
      if (s.status === "delivered" && s.actual_delivery_at) {
        const hasPod = (s.documents ?? []).some((d: any) => d.kind === "pod");
        if (!hasPod && now - new Date(s.actual_delivery_at).getTime() > (settings.pod_grace_hours ?? 24) * 3600000) {
          await raise(s.company_id, "shipment_exception", "warning", `Shipment ${s.shipment_number} delivered but POD is still missing.`);
        }
      }

      // 6. Inbound overdue.
      if (s.shipment_type === "inbound" && s.expected_delivery_date) {
        const due = new Date(s.expected_delivery_date).getTime() + (settings.delay_buffer_days ?? 2) * 86400000;
        if (due < now) {
          await raise(s.company_id, "shipment_delayed", "warning", `Inbound shipment ${s.shipment_number} overdue (expected ${s.expected_delivery_date}).`);
        }
      }

      void isExceptionStatus;
    } catch (err) {
      console.error(`   ⚠️ Logistics poll failed for shipment ${s.shipment_number}:`, err);
    }
  }

  return { polled, events, alerts };
}
