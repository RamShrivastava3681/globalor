import { Router, Response } from "express";
import { putItem, getItem, updateItem, scanTable, TABLES } from "../db/client.js";
import {
  requireAuth,
  requireWriteAccess,
  requireRole,
  getCompanyFilter,
  type AuthRequest,
} from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { providerSchema } from "../logistics/validators.js";
import { listAdapters } from "../logistics/adapters/index.js";
import type { LogisticsSettings } from "../types/index.js";
import { defaultLogisticsSettings } from "../utils/logistics.js";

const router = Router();

// Provider / transporter master. Sensitive credentials are NEVER stored here —
// only `adapter_key` + `account_ref` (a pointer to the server-side secret).

router.get("/providers", requireAuth, async (req: AuthRequest, res: Response) => {
  const items = await scanTable(TABLES.LOGISTICS_PROVIDERS, getCompanyFilter(req.user!));
  res.json(items);
});

router.post("/providers", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid provider", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const now = nowISO();
  const provider = {
    id: generateId(),
    company_id: req.user!.company_id,
    provider_name: b.provider_name,
    carrier_name: b.carrier_name ?? null,
    modes: b.modes,
    domestic: b.domestic ?? true,
    cross_border: b.cross_border ?? false,
    service_areas: b.service_areas ?? null,
    integration_status: b.integration_status ?? "manual",
    adapter_key: b.adapter_key ?? "manual",
    account_ref: b.account_ref ?? null,
    billing_terms: b.billing_terms ?? null,
    default_service_level: b.default_service_level ?? null,
    insurance_option: b.insurance_option ?? false,
    support_contact: b.support_contact ?? null,
    escalation_contact: b.escalation_contact ?? null,
    active: b.active ?? true,
    created_at: now,
    updated_at: now,
  };
  await putItem(TABLES.LOGISTICS_PROVIDERS, provider);
  res.status(201).json(provider);
});

router.patch("/providers/:id", requireAuth, requireRole("factor_admin"), async (req: AuthRequest, res: Response) => {
  const existing = await getItem(TABLES.LOGISTICS_PROVIDERS, { id: req.params.id });
  if (!existing) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  const parsed = providerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid provider", details: parsed.error.flatten() });
    return;
  }
  const updated = await updateItem(TABLES.LOGISTICS_PROVIDERS, { id: req.params.id }, {
    ...parsed.data,
    updated_at: nowISO(),
  });
  res.json(updated);
});

// Available adapter keys (for the provider form dropdown)
router.get("/providers/adapters/available", requireAuth, async (_req: AuthRequest, res: Response) => {
  res.json(listAdapters().map((a) => ({ key: a.key, label: a.label })));
});

// ── Per-company logistics settings ──

router.get("/settings/current", requireAuth, async (req: AuthRequest, res: Response) => {
  const cid = req.user!.company_id ?? "global";
  const existing = (await getItem(TABLES.LOGISTICS_SETTINGS, { company_id: cid })) as unknown as LogisticsSettings | undefined;
  res.json(existing ?? defaultLogisticsSettings(cid));
});

router.put("/settings/current", requireAuth, requireWriteAccess("logistics"), async (req: AuthRequest, res: Response) => {
  const cid = req.user!.company_id ?? "global";
  const b = (req.body ?? {}) as Partial<LogisticsSettings>;
  const record: LogisticsSettings = {
    ...(defaultLogisticsSettings(cid) as LogisticsSettings),
    ...(((await getItem(TABLES.LOGISTICS_SETTINGS, { company_id: cid })) as unknown as LogisticsSettings | undefined) ?? {}),
    company_id: cid,
    delay_buffer_days: Number(b.delay_buffer_days ?? 2),
    stale_tracking_hours: Number(b.stale_tracking_hours ?? 48),
    eway_expiry_warn_hours: Number(b.eway_expiry_warn_hours ?? 24),
    default_provider_id: b.default_provider_id ?? null,
    default_mode: b.default_mode ?? "road",
    freight_variance_pct: Number(b.freight_variance_pct ?? 10),
    pod_grace_hours: Number(b.pod_grace_hours ?? 24),
    updated_at: nowISO(),
  };
  await putItem(TABLES.LOGISTICS_SETTINGS, record as any);
  res.json(record);
});

export default router;
