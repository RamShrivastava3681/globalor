import { putItem, TABLES } from "../db/client.js";
import { generateId, nowISO } from "./helpers.js";
import type { Alert, AlertType, AlertSeverity } from "../types/index.js";

/**
 * Create an activity alert and persist it to the database.
 * Alerts are permanent — there is no DELETE endpoint for them.
 */
export async function createActivityAlert(params: {
  client_id?: string | null;
  company_id?: string | null;
  debtor_id?: string | null;
  invoice_id?: string | null;
  type: AlertType;
  severity?: AlertSeverity;
  message: string;
  created_by?: string | null;
}): Promise<void> {
  const alert: Alert = {
    id: generateId(),
    client_id: params.client_id || null,
    company_id: params.company_id || null,
    debtor_id: params.debtor_id || null,
    invoice_id: params.invoice_id || null,
    type: params.type as AlertType,
    severity: (params.severity || "info") as AlertSeverity,
    message: params.message,
    is_read: false,
    created_at: nowISO(),
    created_by: params.created_by || null,
  };
  await putItem(TABLES.ALERTS, alert as any);
}
