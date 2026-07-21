import { Router } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { scanTable, TABLES } from "../db/client.js";
import type { Company } from "../types/index.js";

const router = Router();

/**
 * GET /api/companies
 *
 * Returns all companies. Super admin only.
 * Used by the frontend company switcher dropdown.
 */
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    // Only super admins can list all companies
    // `originalCompanyId` is null when an override is active for a super admin
    const isSuperAdmin = !req.user!.company_id || req.user!.originalCompanyId === null;
    if (!isSuperAdmin) {
      res.status(403).json({ error: "Only super admins can list all companies" });
      return;
    }

    const companies = await scanTable<Company>(TABLES.COMPANIES);

    res.json(
      companies.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        created_at: c.created_at,
      })),
    );
  } catch (err) {
    console.error("Error listing companies:", err);
    res.status(500).json({ error: "Failed to list companies" });
  }
});

export default router;
