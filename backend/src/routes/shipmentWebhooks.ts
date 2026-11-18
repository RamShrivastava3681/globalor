import { Router, Response } from "express";
import { getItem, updateItem, scanTable, putItem, TABLES } from "../db/client.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { createActivityAlert } from "../utils/alerts.js";
import { writeShipmentAudit, isStatusRegression, isExceptionStatus } from "../utils/logistics.js";
import { getAdapter } from "../logistics/adapters/index.js";
import type { Shipment, ShipmentEvent } from "../types/index.js";

const router = Router();

/**
 * Public carrier webhook endpoint. Each provider adapter verifies the caller
 * (HMAC shared secret) BEFORE any update is accepted. Raw payloads that fail
 * verification are rejected with 401 and nothing is written.
 *
 * POST /api/logistics/webhooks/:adapterKey  (raw body preserved as text)
 */
router.post("/:adapterKey", async (req, res: Response) => {
  const adapter = getAdapter(req.params.adapterKey);
  const signature = (req.headers["x-provider-signature"] as string | undefined)
    ?? (req.headers["x-signature"] as string | undefined);
  const raw = typeof (req as any).rawBody === "string" ? (req as any).rawBody : JSON.stringify(req.body ?? {});

  if (!adapter.verifyWebhook(raw, signature)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  let parsed: { tracking_number: string; updates: Array<{ status: Shipment["status"]; carrier_raw_status: string; event_at: string; location: string | null; description: string | null }> } | null = null;
  try {
    parsed = adapter.parseWebhook(typeof req.body === "object" ? req.body : JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    res.status(400).json({ error: "Unrecognised webhook payload" });
    return;
  }

  const matches = await scanTable<Shipment>(TABLES.SHIPMENTS, {
    filterExpression: "tracking_number = :tn",
    expressionAttributeValues: { ":tn": parsed.tracking_number },
  });
  if (matches.length === 0) {
    res.status(404).json({ error: "No shipment for tracking number" });
    return;
  }

  const applied: Array<{ shipment: string; status: string }> = [];
  for (const shipment of matches) {
    for (const u of parsed.updates) {
      if (isStatusRegression(shipment.status, u.status)) continue;
      const event: ShipmentEvent = {
        id: generateId(),
        company_id: shipment.company_id,
        shipment_id: shipment.id,
        status: u.status,
        carrier_raw_status: u.carrier_raw_status,
        event_at: u.event_at,
        location: u.location,
        description: u.description,
        source: "webhook",
        attachment_url: null,
        created_by: null,
        created_at: nowISO(),
      };
      await putItem(TABLES.SHIPMENT_EVENTS, event as any);
      const patch: Record<string, unknown> = {
        status: u.status,
        last_event_at: u.event_at,
        last_event_source: "webhook",
        updated_at: nowISO(),
      };
      if (u.status === "picked_up" && !shipment.actual_pickup_at) patch.actual_pickup_at = u.event_at;
      if (u.status === "delivered") patch.actual_delivery_at = u.event_at;
      await updateItem(TABLES.SHIPMENTS, { id: shipment.id }, patch);
      shipment.status = u.status;
      applied.push({ shipment: shipment.shipment_number, status: u.status });

      if (u.status === "delivered") {
        await createActivityAlert({ company_id: shipment.company_id, type: "shipment_delivered", severity: "info", message: `Shipment ${shipment.shipment_number} delivered (carrier update). Attach POD; GRN/dispatch confirmation still required.` }).catch(() => {});
      } else if (isExceptionStatus(u.status)) {
        await createActivityAlert({ company_id: shipment.company_id, type: "shipment_exception", severity: "critical", message: `Shipment ${shipment.shipment_number}: ${u.status} (carrier update).` }).catch(() => {});
      }
    }
    await writeShipmentAudit({ company_id: shipment.company_id, shipment_id: shipment.id, action: "webhook_update", new_value: { tracking: parsed.tracking_number, applied: applied.length }, actor_id: null });
  }

  res.json({ ok: true, applied });
});

export default router;
