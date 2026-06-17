import { Router, Response } from "express";
import { z } from "zod";
import {
  getItem,
  updateItem,
  TABLES,
} from "../db/client.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { nowISO } from "../utils/helpers.js";
import type { Profile } from "../types/index.js";

const router = Router();

// ── GET /api/profiles/me ──
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await getItem(TABLES.PROFILES, { id: req.user!.id }) as Profile | undefined;
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profile);
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /api/profiles/me ──
const updateProfileSchema = z.object({
  company_name: z.string().min(1).optional(),
  contact_name: z.string().nullable().optional(),
});

router.put("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateProfileSchema.parse(req.body);
    const updates: Record<string, unknown> = {
      ...parsed,
      updated_at: nowISO(),
    };

    // Remove undefined values
    Object.keys(updates).forEach((k) => {
      if (updates[k] === undefined) delete updates[k];
    });

    const updated = await updateItem(TABLES.PROFILES, { id: req.user!.id }, updates);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
