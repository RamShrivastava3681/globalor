import { Router, Response } from "express";
import { z } from "zod";
import { putItem, getItem, TABLES } from "../db/client.js";
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { nowISO } from "../utils/helpers.js";
import type { CatalogueSettings } from "../types/index.js";

const router = Router();

/**
 * One settings row per company, keyed deterministically so GET can find it
 * without a scan. Super admins (no company_id) get a global row.
 */
function settingsId(companyId: string | null): string {
  return companyId ? `catalogue:${companyId}` : "catalogue:global";
}

const DEFAULT_MARGIN = 0.4; // 40% — matches the pre-existing hardcoded floor

// ── GET /api/catalogue-settings ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = settingsId(req.user!.company_id);
    const settings = await getItem(TABLES.CATALOGUE_SETTINGS, { id }) as CatalogueSettings | undefined;
    res.json(
      settings ?? {
        id,
        company_id: req.user!.company_id,
        default_minimum_margin: DEFAULT_MARGIN,
        created_at: null,
        updated_at: null,
      },
    );
  } catch (err) {
    console.error("Get catalogue settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /api/catalogue-settings ──
const updateSettingsSchema = z.object({
  default_minimum_margin: z
    .number()
    .min(0.01, "Default margin must be between 1% and 99%")
    .max(0.99, "Default margin must be between 1% and 99%"),
});

router.put("/", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSettingsSchema.parse(req.body);
    const id = settingsId(req.user!.company_id);
    const now = nowISO();

    const existing = await getItem(TABLES.CATALOGUE_SETTINGS, { id }) as CatalogueSettings | undefined;
    const settings: CatalogueSettings = {
      id,
      company_id: req.user!.company_id,
      default_minimum_margin: parsed.default_minimum_margin,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    await putItem(TABLES.CATALOGUE_SETTINGS, settings as any);
    res.json(settings);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update catalogue settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
