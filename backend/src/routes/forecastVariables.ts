import { Router, Response } from "express";
import { scanTable, TABLES } from "../db/client.js";
import { requireAuth, requireWriteAccess, getCompanyFilter, type AuthRequest } from "../middleware/auth.js";
import { recomputeAll } from "../utils/forecast.js";
import { nowISO } from "../utils/helpers.js";
import type { ForecastVariable } from "../types/index.js";

const router = Router();

// ── GET /api/forecast-variables ── (list of snapshots, newest first)
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const snapshots = await scanTable<ForecastVariable>(TABLES.FORECAST_VARIABLES, getCompanyFilter(req.user!));
    const sortBy = (req.query.sortBy as string) || "computed_at";
    const order = (req.query.order as string) === "asc" ? 1 : -1;
    const filtered = snapshots
      .sort((a, b) => {
        const av = (a as any)[sortBy] ?? "";
        const bv = (b as any)[sortBy] ?? "";
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * order;
      });
    res.json(filtered);
  } catch (err) {
    console.error("Get forecast variables error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/forecast-variables/recompute ── (manual "Recompute" button)
router.post("/recompute", requireAuth, requireWriteAccess("products"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await recomputeAll(req.user!.company_id, req.user!.id);
    res.json({ ...result, computed_at: nowISO() });
  } catch (err) {
    console.error("Recompute forecast error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
