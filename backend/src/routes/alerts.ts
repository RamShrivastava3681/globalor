import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  getItem,
  updateItem,
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { Alert, AlertSeverity, AlertType } from "../types/index.js";

const router = Router();

// ── GET /api/alerts ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const alerts = await scanTable<Alert>(TABLES.ALERTS);

    // Enrich alerts with creator names from profiles
    const userIds = [...new Set(alerts.map((a) => a.created_by).filter(Boolean))] as string[];
    const profiles = await Promise.all(
      userIds.map(async (uid) => {
        const profile = await getItem(TABLES.PROFILES, { id: uid }) as { id: string; email: string | null; company_name: string; contact_name: string | null } | undefined;
        return profile ? { id: profile.id, name: profile.contact_name || profile.email || profile.company_name } : null;
      }),
    );
    const profileMap = new Map(profiles.filter(Boolean).map((p) => [p!.id, p!.name]));

    const enriched = alerts.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).map((a) => ({
      ...a,
      created_by_name: a.created_by ? profileMap.get(a.created_by) || null : null,
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Get alerts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/alerts ──
const createAlertSchema = z.object({
  client_id: z.string().nullable().optional(),
  debtor_id: z.string().nullable().optional(),
  invoice_id: z.string().nullable().optional(),
  type: z.enum(["overdue", "large_invoice", "payment_received"]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().min(1),
});

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createAlertSchema.parse(req.body);
    const alert: Alert = {
      id: generateId(),
      client_id: parsed.client_id || null,
      debtor_id: parsed.debtor_id || null,
      invoice_id: parsed.invoice_id || null,
      type: parsed.type as AlertType,
      severity: parsed.severity as AlertSeverity,
      message: parsed.message,
      is_read: false,
      created_at: nowISO(),
      created_by: req.user?.id || null,
    };
    await putItem(TABLES.ALERTS, alert as any);
    res.status(201).json(alert);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Create alert error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/alerts/:id/read ──
router.patch("/:id/read", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const updated = await updateItem(TABLES.ALERTS, { id: req.params.id }, { is_read: true });
    if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("Mark alert read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
