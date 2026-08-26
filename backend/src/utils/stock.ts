import type { StockMovement, MovementStatus, MovementReason, Product } from "../types/index.js";
import { generateDocNumber } from "./helpers.js";

/**
 * Human labels for every movement reason (manual + system + legacy).
 */
export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  stock_adjustment: "Stock adjustment",
  damage: "Damage",
  samples: "Samples / internal use",
  customer_return: "Customer return",
  supplier_return: "Supplier return",
  goods_receipt: "Goods receipt",
  dispatch: "Dispatch",
  sale: "Sales invoice",
  purchase: "Purchase invoice",
};

/** Generate a `MOV-XXXXXXXX` movement number. */
export function generateMovementNumber(): string {
  return generateDocNumber("MOV");
}

/**
 * Normalize a movement for read paths so legacy rows (created before the
 * lifecycle existed) behave like confirmed, system-generated entries:
 *  - missing `status` ⇒ `confirmed` (legacy rows were already credited)
 *  - missing `is_system` ⇒ true when linked to an invoice / source document
 *  - missing `movement_number` ⇒ derived from the id
 *  - missing `reason` ⇒ inferred from the legacy invoice link
 */
export function normalizeMovement<T extends StockMovement>(m: T): T & {
  status: MovementStatus;
  is_system: boolean;
  movement_number: string;
  reason: MovementReason | null;
  product_id: string | null;
  warehouse: string | null;
} {
  const isSystem =
    m.is_system ??
    !!(m.invoice_id || m.purchase_invoice_id || m.goods_receipt_id || m.goods_dispatch_id || m.linked_document_type);
  const reason =
    m.reason ??
    (m.invoice_id ? "sale" : m.purchase_invoice_id ? "purchase" : null);

  return {
    ...m,
    status: m.status ?? "confirmed",
    is_system: isSystem,
    movement_number: m.movement_number ?? `MOV-${m.id.slice(-8).toUpperCase()}`,
    reason,
    product_id: m.product_id ?? null,
    warehouse: m.warehouse ?? null,
  };
}

export interface LiveStockRow {
  key: string;
  product_id: string | null;
  sku: string;
  item: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  inventory_value: number;
  reorder_level: number | null;
  image_url: string | null;
}

export interface LiveStockResult {
  rows: LiveStockRow[];
  totals: { skus: number; units: number; value: number; low_stock: number };
}

/**
 * THE core invariant: `liveStock = Σ confirmed(in) − Σ confirmed(out)`.
 * Draft and cancelled movements never count. Values are derived at read
 * time — no stored stock number can drift.
 *
 * Rows are grouped by (product, sku, unit). A product-linked movement
 * snapshots name/sku/unit from the catalogue; legacy rows use their own
 * item_name/sku/unit. The valuation unit cost is the most recent confirmed
 * unit cost seen for that group.
 */
export function computeLiveStock(
  movements: StockMovement[],
  products: Product[],
): LiveStockResult {
  const productMap = new Map(products.map((p) => [p.id, p]));

  const groups = new Map<
    string,
    {
      key: string;
      product_id: string | null;
      sku: string;
      item: string;
      unit: string;
      quantity: number;
      lastCost: number | null;
      reorder_level: number | null;
      image_url: string | null;
    }
  >();

  for (const raw of movements) {
    const m = normalizeMovement(raw);
    if (m.status !== "confirmed") continue;

    const product = m.product_id ? productMap.get(m.product_id) : undefined;
    const sku = product?.sku ?? m.sku ?? (m.item_name || "Unknown");
    const unit = product?.unit_of_measure ?? m.unit ?? "unit";
    const key = `${m.product_id ?? ""}|${sku}|${unit}`;

    let cur = groups.get(key);
    if (!cur) {
      cur = {
        key,
        product_id: m.product_id ?? null,
        sku,
        item: product?.name ?? m.item_name ?? sku,
        unit,
        quantity: 0,
        lastCost: null,
        reorder_level: product?.reorder_level ?? null,
        image_url: product?.image_url ?? null,
      };
      groups.set(key, cur);
    }

    cur.quantity += m.direction === "in" ? Number(m.quantity) : -Number(m.quantity);
    const cost = Number(m.unit_cost);
    if (m.unit_cost != null && Number.isFinite(cost)) cur.lastCost = cost;
  }

  const rows: LiveStockRow[] = [...groups.values()]
    .map((g) => {
      const unitCost = g.lastCost ?? 0;
      const inventoryValue = Math.round(g.quantity * unitCost * 100) / 100;
      return {
        key: g.key,
        product_id: g.product_id,
        sku: g.sku,
        item: g.item,
        unit: g.unit,
        quantity: Math.round(g.quantity * 1000) / 1000,
        unit_cost: unitCost,
        inventory_value: inventoryValue,
        reorder_level: g.reorder_level,
        image_url: g.image_url,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const totals = {
    skus: rows.length,
    units: Math.round(rows.reduce((s, r) => s + r.quantity, 0) * 1000) / 1000,
    value: Math.round(rows.reduce((s, r) => s + r.inventory_value, 0) * 100) / 100,
    low_stock: rows.filter((r) => r.reorder_level != null && r.quantity < r.reorder_level).length,
  };

  return { rows, totals };
}
