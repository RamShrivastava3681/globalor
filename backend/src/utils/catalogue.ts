import { scanTable, TABLES } from "../db/client.js";
import type { Product } from "../types/index.js";

/**
 * Generate an `SKU-XXXXXXXX` code (no ambiguous chars: no 0/O, 1/I).
 */
export function generateSku(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `SKU-${s}`;
}

/**
 * True when another product in the same company already uses this SKU.
 * Super admins (no company_id) are checked globally.
 */
export async function skuExists(sku: string, companyId: string | null, excludeId?: string): Promise<boolean> {
  const filter = companyId
    ? {
        filterExpression: "company_id = :cid AND sku = :sku",
        expressionAttributeValues: { ":cid": companyId, ":sku": sku },
      }
    : {
        filterExpression: "sku = :sku",
        expressionAttributeValues: { ":sku": sku },
      };
  const found = await scanTable<Product>(TABLES.PRODUCTS, filter);
  return found.some((p) => p.id !== excludeId);
}
