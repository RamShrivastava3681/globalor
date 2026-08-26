import type { Quotation, QuotationLine } from "../types/index.js";

/** Round money to 2dp (the platform's money rule). */
export function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

/** Effective price = maker's revised price when set, else the original offer. */
export function effectiveUnitPrice(line: Pick<QuotationLine, "unit_price" | "updated_unit_price">): number {
  const p = line.updated_unit_price ?? line.unit_price;
  return Number.isFinite(Number(p)) ? Number(p) : 0;
}

/** Discount (money) applied to one line, per its discount type. */
export function lineDiscount(line: QuotationLine): number {
  const gross = (Number(line.quantity) || 0) * effectiveUnitPrice(line);
  if (line.discount_type === "pct") {
    const pct = Math.min(100, Math.max(0, Number(line.discount_value) || 0));
    return (gross * pct) / 100;
  }
  if (line.discount_type === "amount") {
    const amount = Math.max(0, Number(line.discount_value) || 0);
    return Math.min(amount, gross); // never discount below zero
  }
  return 0;
}

export function computeQuotationTotals(
  lines: QuotationLine[],
  freight: number,
): { subtotal: number; total_discount: number; gst_total: number; grand_total: number } {
  let subtotal = 0;
  let totalDiscount = 0;
  let gstTotal = 0;
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const price = effectiveUnitPrice(l);
    const gross = qty * price;
    const discount = lineDiscount(l);
    const taxable = Math.max(0, gross - discount);
    subtotal += gross;
    totalDiscount += discount;
    gstTotal += (taxable * (Number(l.gst_rate) || 0)) / 100;
  }
  subtotal = roundMoney(subtotal);
  totalDiscount = roundMoney(totalDiscount);
  gstTotal = roundMoney(gstTotal);
  const grandTotal = roundMoney(subtotal - totalDiscount + gstTotal + (Number(freight) || 0));
  return { subtotal, total_discount: totalDiscount, gst_total: gstTotal, grand_total: grandTotal };
}

/**
 * A quotation is expired once its valid-until date has passed while it is still
 * open (draft/sent). Conversion and further sends are blocked when expired.
 */
export function isQuotationExpired(q: Pick<Quotation, "valid_until" | "status">): boolean {
  if (!q.valid_until || (q.status !== "draft" && q.status !== "sent")) return false;
  return new Date(q.valid_until).getTime() < Date.now();
}

/** Effective read-time status — shows `expired` without persisting it. */
export function withExpiry<T extends Quotation>(q: T): T {
  if (isQuotationExpired(q)) return { ...q, status: "expired" as const };
  return q;
}
