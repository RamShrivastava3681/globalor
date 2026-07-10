import { Router, Response } from "express";
import { z } from "zod";
import {
  putItem,
  deleteItem,
  scanTable,
  batchPutItems,
  TABLES,
} from "../db/client.js";
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { generateId, nowISO } from "../utils/helpers.js";
import type { InventoryItem } from "../types/index.js";

const router = Router();

// ── GET /api/inventory-items ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const items = await scanTable<InventoryItem>(TABLES.INVENTORY_ITEMS);
    // Filter to current user's items
    const userItems = items
      .filter((i) => i.client_id === req.user!.id)
      .sort((a, b) => a.item.localeCompare(b.item));
    res.json(userItems);
  } catch (err) {
    console.error("Get inventory items error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/inventory-items/batch ──
const batchCreateSchema = z.object({
  items: z.array(z.object({
    item: z.string().min(1, "Item name is required"),
    description: z.string().optional().nullable().default(""),
    closing_quantity: z.number().min(0, "Closing quantity must be >= 0"),
    price_sale: z.number().min(0, "Price sale must be >= 0"),
    unit_cost: z.number().min(0, "Unit cost must be >= 0"),
  })).min(1, "At least one item is required"),
});

router.post("/batch", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = batchCreateSchema.parse(req.body);
    const now = nowISO();
    const clientId = req.user!.id;

    const newItems: InventoryItem[] = parsed.items.map((item) => {
      const extendedPrice = item.closing_quantity * item.price_sale;
      const extendedCost = item.closing_quantity * item.unit_cost;
      return {
        id: generateId(),
        client_id: clientId,
        item: item.item.trim(),
        description: item.description?.trim() || null,
        closing_quantity: item.closing_quantity,
        price_sale: item.price_sale,
        extended_price: extendedPrice,
        unit_cost: item.unit_cost,
        extended_cost: extendedCost,
        created_at: now,
        updated_at: now,
      };
    });

    await batchPutItems(TABLES.INVENTORY_ITEMS, newItems as any);

    res.status(201).json({ created: newItems.length, items: newItems });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error("Batch create inventory items error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/inventory-items/:id ──
router.delete("/:id", requireAuth, requireWriteAccess("stock-movements"), async (req: AuthRequest, res: Response) => {
  try {
    await deleteItem(TABLES.INVENTORY_ITEMS, { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete inventory item error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
