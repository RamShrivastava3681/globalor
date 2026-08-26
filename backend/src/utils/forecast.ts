import { TABLES, scanTable, putItem, getItem } from "../db/client.js";
import { getCompanyFilter } from "../middleware/auth.js";
import { nowISO } from "./helpers.js";
import type {
  StockMovement, Product, ForecastVariable, ForecastMonth,
  ForecastTrend, ForecastMomentum, ForecastVelocity, StockoutUrgency,
} from "../types/index.js";

// ── Small stats helpers ──

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function safeNum(v: number | null | undefined): number {
  return Number.isFinite(v) ? Number(v) : 0;
}

/** YYYY-MM for a date string (ISO or YYYY-MM-DD). */
function monthKey(dateStr: string): string {
  return (dateStr || "").slice(0, 7);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Ordinary least squares on (x=0..n-1, y). Returns slope, intercept, r². */
function ols(y: number[]): { slope: number; intercept: number; r2: number } {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };
  const xs = y.map((_, i) => i);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (y[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy ** 2) / (sxx * syy);
  return { slope, intercept, r2 };
}

// ── The engine ──

export interface ForecastInputs {
  product: Product;
  /** Confirmed stock-out movements for this product (any window). */
  outMovements: StockMovement[];
  /** Live confirmed stock on hand. */
  stock: number;
  categoryAvgs: Map<string, number>;
  minMargin: number;
}

/** Compute the full forecast for one product. Pure — no IO. */
export function computeForecastForProduct(inputs: ForecastInputs): ForecastVariable {
  const { product, outMovements, stock, categoryAvgs, minMargin } = inputs;
  const now = nowISO();
  const today = now.slice(0, 10);
  const currentYm = monthKey(today);

  // 1. Bucket confirmed outbound movements by calendar month (12 trailing months, current included).
  const startYm = addMonths(currentYm, -11);
  const monthly = new Map<string, number>();
  for (const m of outMovements) {
    const ym = monthKey(m.movement_date || m.created_at || "");
    if (ym < startYm || ym > currentYm) continue;
    monthly.set(ym, (monthly.get(ym) ?? 0) + Number(m.quantity || 0));
  }

  const months: string[] = [];
  for (let i = 0; i < 12; i++) months.push(addMonths(startYm, i));
  const actualByMonth = months.map((ym) => ({ month: ym, actual: monthly.get(ym) ?? 0 }));

  // 2. Availability correction: when a month had stockouts, scale demand up
  //    (corrected = actual / max(availabilityRate, 0.7), capped at actual × 1.4).
  //    True per-month stockout data isn't tracked, so we use a deterministic
  //    proxy: months with above-average demand were the likely stockout months,
  //    so their availability is lower (more correction). Quiet months are
  //    untouched (availability = 1).
  const avgActual = actualByMonth.reduce((s, r) => s + r.actual, 0) / Math.max(1, actualByMonth.length);
  const correctedMonths = actualByMonth.map((r) => {
    const availabilityRate = avgActual > 0 ? clamp(avgActual / r.actual, 0.7, 1) : 1;
    const corrected = availabilityRate < 1 ? r.actual / availabilityRate : r.actual;
    return {
      ...r,
      corrected: Math.min(r.actual * 1.4, Math.round(corrected * 100) / 100),
      availability: Math.round(availabilityRate * 100) / 100,
    };
  });

  // 3. Weighted baseline: newest 3 months ×3, middle 3 ×2, oldest 6 ×1.
  let weighted = 0;
  let weightSum = 0;
  correctedMonths.forEach((r, idx) => {
    const w = idx >= 9 ? 3 : idx >= 6 ? 2 : 1;
    weighted += r.corrected * w;
    weightSum += w;
  });
  const baseline = weightSum > 0 ? weighted / weightSum : 0;

  // 4. Trend: OLS slope on the corrected series.
  const trend = ols(correctedMonths.map((r) => r.corrected));
  const avgDemand = Math.max(1, ...correctedMonths.map((r) => r.corrected));
  const trendPct = avgDemand > 0 ? trend.slope / avgDemand : 0; // per month, relative
  const trendDirection: ForecastTrend =
    trendPct > 0.03 ? "up" : trendPct < -0.03 ? "down" : "stable";

  // 5. Seasonality: raw per-CALENDAR-MONTH factor, clamped 0.5–2.0. Keyed by
  //    "MM" so future horizon months resolve against the same calendar month.
  const overallAvg = correctedMonths.reduce((s, r) => s + r.corrected, 0) / Math.max(1, correctedMonths.length);
  const monthFactors = new Map<string, number>();
  for (let cal = 1; cal <= 12; cal++) {
    const group = correctedMonths.filter((r) => Number(r.month.slice(5, 7)) === cal);
    const avg = group.length ? group.reduce((s, r) => s + r.corrected, 0) / group.length : 0;
    const factor = overallAvg > 0 && avg > 0 ? clamp(avg / overallAvg, 0.5, 2.0) : 1;
    monthFactors.set(String(cal).padStart(2, "0"), factor);
  }

  // 6. Forecast horizon: 6 months of baseline × trend × seasonality, clamped
  //    0.7–1.5×, with 80% prediction intervals.
  const horizon: ForecastMonth[] = [];
  let projectedStock = stock;
  let runningOrder = 0;
  for (let i = 1; i <= 6; i++) {
    const ym = addMonths(currentYm, i);
    // Growth base clamped positive so a steep decline can't zigzag the horizon.
    const growth = Math.pow(Math.max(0.05, 1 + trendPct), i);
    const seasonal = monthFactors.get(ym.slice(5, 7)) ?? 1;
    const raw = baseline * Math.max(0.5, growth) * seasonal;
    const forecast = Math.max(0, raw); // clamped vs baseline 0.7–1.5×
    const clamped = clamp(forecast, baseline * 0.7, Math.max(baseline * 1.5, 1));
    const sigma = Math.max(0.2 * clamped, 1);
    const low = Math.max(0, clamped - 1.28 * sigma);
    const high = clamped + 1.28 * sigma;
    const dailyRate = clamped / daysInMonth(ym);
    const stockRequired = clamped;
    const suggestedOrder = Math.max(0, Math.ceil((stockRequired - projectedStock) / (product.order_multiple || 1)) * (product.order_multiple || 1));
    projectedStock = Math.max(0, projectedStock + runningOrder - clamped);
    runningOrder = suggestedOrder;
    horizon.push({
      month: ym,
      forecast: Math.round(clamped * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      daily_rate: Math.round(dailyRate * 100) / 100,
      stock_required: Math.round(stockRequired * 100) / 100,
      projected_stock_after: Math.round(projectedStock * 100) / 100,
      suggested_order: Math.round(suggestedOrder * 100) / 100,
    });
  }

  // 7. Live pace adjustment (display-only): how the current partial month is
  //    tracking vs its forecast. expectedToDate = baseline × daysElapsed/days;
  //    ratio = actual/expected; factor = clamp(1 + 0.3×(ratio−1), 0.80, 1.20).
  //    Disabled before day 7 of the month or when expected is 0.
  const todayDate = new Date(today);
  const daysElapsed = todayDate.getDate();
  const currentMonthActual = actualByMonth.find((r) => r.month === currentYm)?.actual ?? 0;
  const expectedToDate = (baseline / daysInMonth(currentYm)) * daysElapsed;
  const paceRatio = daysElapsed >= 7 && expectedToDate > 0 ? currentMonthActual / expectedToDate : 1;
  const paceFactor = clamp(1 + 0.3 * (paceRatio - 1), 0.8, 1.2);

  // 8. Days of cover: stock ÷ (last-3-months demand / their calendar days).
  const last3 = correctedMonths.slice(-3);
  const last3Days = last3.reduce((s, r) => s + daysInMonth(r.month), 0);
  const recentDemand = last3.reduce((s, r) => s + r.actual, 0);
  const dailyDemand = last3Days > 0 ? recentDemand / last3Days : 0;
  const daysOfCover = dailyDemand > 0 ? stock / dailyDemand : stock > 0 ? 999 : 0;

  // 9. Reorder recommendation.
  const leadTime = Math.max(0, product.lead_time_days ?? 0);
  const safetyDays = Math.max(0, product.safety_stock_days ?? 0);
  const requiredStock = dailyDemand * (leadTime + safetyDays);
  const recommended = Math.max(0, requiredStock - stock);
  const minOrderQty = product.minimum_order_quantity ?? 0;
  const orderMultiple = Math.max(1, product.order_multiple ?? 1);
  const raised = Math.max(recommended, minOrderQty);
  const recommendedOrder = Math.ceil(raised / orderMultiple) * orderMultiple;

  // 10. Timeline.
  const estimatedStockoutDate = dailyDemand > 0 && stock > 0
    ? new Date(new Date(today).getTime() + daysOfCover * 86400000).toISOString().slice(0, 10)
    : stock <= 0 ? today : null;
  const reorderByDate = estimatedStockoutDate && leadTime > 0
    ? new Date(new Date(estimatedStockoutDate).getTime() - leadTime * 86400000).toISOString().slice(0, 10)
    : estimatedStockoutDate;
  const nextRefillDate = new Date(new Date(today).getTime() + leadTime * 86400000).toISOString().slice(0, 10);
  const stockoutUrgency: StockoutUrgency =
    stock <= 0 ? "critical" : daysOfCover <= leadTime ? "critical" : daysOfCover <= leadTime * 2 + 7 ? "warning" : "safe";

  // 11. Momentum: recent 3-mo avg vs 120%/60% of overall avg.
  const recent3Avg = correctedMonths.slice(-3).reduce((s, r) => s + r.corrected, 0) / 3;
  const overall = correctedMonths.reduce((s, r) => s + r.corrected, 0) / Math.max(1, correctedMonths.length);
  const momentum: ForecastMomentum =
    overall === 0 && recent3Avg === 0 ? "inactive"
      : recent3Avg >= 1.2 * overall ? "accelerating"
      : recent3Avg <= 0.6 * overall ? "declining"
      : "stable";

  // 12. Velocity: category-relative. No sales in 3 months → dead; top 20% → fast; next 30% → medium; rest → slow.
  let velocity: ForecastVelocity = "slow_mover";
  if (recentDemand === 0) {
    velocity = "dead";
  } else {
    const catAvg = product.category ? (categoryAvgs.get(product.category) ?? 0) : 0;
    if (catAvg > 0) {
      const ratio = recent3Avg / catAvg;
      velocity = ratio >= 1.2 ? "fast_mover" : ratio >= 0.8 ? "medium_mover" : "slow_mover";
    } else {
      velocity = recent3Avg > 0 ? "medium_mover" : "slow_mover";
    }
  }

  // 13. Pricing strategy (recommendation only, never auto-applied).
  const margin = product.minimum_gross_margin_percentage ?? minMargin;
  const floorPrice = product.unit_cost > 0 && margin > 0 && margin < 1
    ? product.unit_cost / (1 - margin)
    : product.unit_cost;
  let suggestedPriceChangePct: number | null = null;
  let suggestedPriceNote = "";
  const highStock = stock > recommendedOrder * 2;
  const lowStock = daysOfCover < leadTime;
  if (velocity === "dead" && highStock) {
    suggestedPriceChangePct = -25;
    suggestedPriceNote = "Dead + high stock → clearance: suggest −25% to move inventory";
  } else if (velocity === "fast_mover" && momentum === "accelerating" && lowStock) {
    suggestedPriceChangePct = 5;
    suggestedPriceNote = "Fast + accelerating + low stock → protect margin: suggest +5%";
  } else if (velocity === "slow_mover" && momentum === "declining" && highStock) {
    suggestedPriceChangePct = -10;
    suggestedPriceNote = "Slow + declining + high stock → suggest −10% to stimulate demand";
  } else if (velocity === "fast_mover" && momentum === "stable") {
    suggestedPriceChangePct = 0;
    suggestedPriceNote = "Healthy velocity — hold price";
  } else {
    suggestedPriceNote = "No pricing action suggested";
  }

  const categoryRank = product.category ? (categoryAvgs.get(product.category) ?? 0) : 0;
  const catRankCls = categoryRank > 0 && recent3Avg > 0 ? recent3Avg / categoryRank : 0;

  const sku = product.sku;
  return {
    id: `fc_${product.id}`,
    client_id: product.client_id,
    company_id: product.company_id,
    product_id: product.id,
    sku,
    name: product.name,
    category: product.category ?? null,
    image_url: product.image_url ?? null,
    computed_at: now,
    stock: Number.isFinite(stock) ? stock : null,
    unit: product.unit_of_measure ?? "unit",
    baseline: Number.isFinite(baseline) ? Math.round(baseline * 100) / 100 : null,
    trend_direction: trendDirection,
    trend_slope: Number.isFinite(trend.slope) ? Math.round(trend.slope * 100) / 100 : null,
    trend_r2: Number.isFinite(trend.r2) ? Math.round(trend.r2 * 100) / 100 : null,
    horizon,
    days_of_cover: Number.isFinite(daysOfCover) ? Math.round(daysOfCover * 10) / 10 : null,
    estimated_stockout_date: estimatedStockoutDate,
    reorder_by_date: reorderByDate,
    next_refill_date: nextRefillDate,
    stockout_urgency: stockoutUrgency,
    reorder_required: recommendedOrder > 0,
    recommended_order_qty: Number.isFinite(recommendedOrder) ? recommendedOrder : null,
    recommended_order_value: Number.isFinite(recommendedOrder * product.unit_cost) ? Math.round(recommendedOrder * product.unit_cost * 100) / 100 : null,
    momentum,
    velocity,
    suggested_price_change_pct: suggestedPriceChangePct,
    suggested_price_note: suggestedPriceNote,
    floor_price: Number.isFinite(floorPrice) ? Math.round(floorPrice * 100) / 100 : null,
    recent_demand: Math.round(recentDemand * 100) / 100,
    monthly_demand: correctedMonths,
    full: {
      pace_factor: paceFactor,
      category_rank_ratio: Math.round(catRankCls * 100) / 100,
      lead_time_days: leadTime,
      safety_stock_days: safetyDays,
      required_stock: Math.round(requiredStock * 100) / 100,
      daily_demand: Math.round(dailyDemand * 100) / 100,
      unit_cost: product.unit_cost,
      unit_price: product.unit_price,
      reorder_level: product.reorder_level,
      max_stock: product.max_stock,
    },
    updated_at: now,
  };
}

// ── Batch recompute ──

/**
 * Recompute every active product and persist a ForecastVariable snapshot each.
 * Failure-isolated per product: one quiet SKU can't crash the batch.
 */
export async function recomputeAll(companyId: string | null, clientId?: string): Promise<{ recomputed: number; failed: number }> {
  const filter = getCompanyFilter({ company_id: companyId });
  const [products, movements, settings] = await Promise.all([
    scanTable<Product>(TABLES.PRODUCTS, filter),
    scanTable<StockMovement>(TABLES.STOCK_MOVEMENTS, filter),
    getItem(TABLES.CATALOGUE_SETTINGS, { id: companyId ? `catalogue:${companyId}` : "catalogue:global" }).catch(() => undefined) as Promise<any>,
  ]);

  const minMargin = Number(settings?.default_minimum_margin ?? 0.4) || 0.4;

  // Live stock per product from confirmed movements.
  const liveStock = new Map<string, number>();
  for (const m of movements) {
    if ((m.status ?? "confirmed") !== "confirmed" || !m.product_id) continue;
    const sign = m.direction === "in" ? 1 : -1;
    liveStock.set(m.product_id, (liveStock.get(m.product_id) ?? 0) + sign * Number(m.quantity || 0));
  }

  // Outbound movements per product (the demand signal).
  // Demand = confirmed out movements that represent goods leaving to a
  // customer (reason `dispatch` / legacy `sale`). Everything else is excluded:
  // reversal movements created by a cancelled GRN are direction "out" with
  // reason "goods_receipt" (a real GRN credit is direction "in") and manual
  // reasons (damage, samples, supplier return, adjustments) are leakage or
  // corrections — counting any of them would inflate the forecast.
  const DEMAND_REASONS = new Set(["dispatch", "sale"]);
  const outByProduct = new Map<string, StockMovement[]>();
  for (const m of movements) {
    if (m.direction !== "out" || (m.status ?? "confirmed") !== "confirmed" || !m.product_id) continue;
    // Legacy rows may lack `reason` — infer `sale` from an invoice link (mirrors
    // normalizeMovement) so pre-reason movements still count as demand.
    const reason = m.reason ?? (m.invoice_id ? "sale" : "");
    if (!DEMAND_REASONS.has(reason)) continue;
    const arr = outByProduct.get(m.product_id) ?? [];
    arr.push(m);
    outByProduct.set(m.product_id, arr);
  }

  // Category average demand (for velocity).
  const catTotals = new Map<string, { sum: number; count: number }>();
  for (const p of products) {
    const demand = outByProduct.get(p.id)?.reduce((s, m) => s + Number(m.quantity || 0), 0) ?? 0;
    if (!p.category) continue;
    const cur = catTotals.get(p.category) ?? { sum: 0, count: 0 };
    cur.sum += demand;
    cur.count += 1;
    catTotals.set(p.category, cur);
  }
  const categoryAvgs = new Map<string, number>();
  for (const [cat, { sum, count }] of catTotals) {
    categoryAvgs.set(cat, count > 0 ? sum / count : 0);
  }

  let recomputed = 0;
  let failed = 0;
  const active = products.filter((p) => p.status !== "inactive");
  for (const product of active) {
    try {
      const forecast = computeForecastForProduct({
        product,
        outMovements: outByProduct.get(product.id) ?? [],
        stock: liveStock.get(product.id) ?? 0,
        categoryAvgs,
        minMargin,
      });
      // Snapshot keeps the PRODUCT's client_id — never the operator who
      // happened to trigger the recompute (admin-triggered runs must not
      // misattribute ownership).
      if (clientId && !product.client_id) forecast.client_id = clientId;
      await putItem(TABLES.FORECAST_VARIABLES, forecast as any);
      recomputed += 1;
    } catch (err) {
      console.error(`   ⚠️ Forecast failed for ${product.sku ?? product.id}:`, err);
      failed += 1;
    }
  }
  return { recomputed, failed };
}

/**
 * Fire-and-forget recompute for a single company (guide invariant 11: triggered
 * asynchronously after every stock-affecting event, failure-isolated per SKU).
 * Callers never await — the forecast is eventually consistent.
 */
export function triggerForecastRecompute(companyId: string | null, clientId?: string): void {
  recomputeAll(companyId, clientId)
    .then(({ recomputed, failed }) => {
      if (failed > 0) console.warn(`   ⚠️ Forecast: ${recomputed} ok, ${failed} failed`);
    })
    .catch((err) => console.error("   ⚠️ Forecast recompute failed:", err));
}
