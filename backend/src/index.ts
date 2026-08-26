import express from "express";
import cors from "cors";
import { config } from "./config.js";

import { requireAuth } from "./middleware/auth.js";

// Rate limiters
import { apiLimiter, uploadLimiter, publicLimiter } from "./middleware/rateLimiter.js";

// Admin seed
import { seedAdmin } from "./seed.js";

// DynamoDB table creation
import { createTables } from "./db/schema.js";

// Overdue-reminder daily sweep
import { runOverdueReminderSweep } from "./utils/reminders.js";

// Forecast recompute trigger (fire-and-forget, failure-isolated per SKU)
import { recomputeAll } from "./utils/forecast.js";

// Route imports
import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profiles.js";
import debtorRoutes from "./routes/debtors.js";
import vendorRoutes from "./routes/vendors.js";
import supplierRoutes from "./routes/suppliers.js";
import invoiceRoutes from "./routes/invoices.js";
import purchaseInvoiceRoutes from "./routes/purchaseInvoices.js";
import advanceRoutes from "./routes/advances.js";
import purchaseOrderRoutes from "./routes/purchaseOrders.js";
import alertRoutes from "./routes/alerts.js";
import expenseRoutes from "./routes/expenses.js";
import stockMovementRoutes from "./routes/stockMovements.js";
import inventoryItemRoutes from "./routes/inventoryItems.js";
import adminRoutes from "./routes/admin.js";
import noaRoutes from "./routes/noa.js";
import uploadRoutes from "./routes/upload.js";
import reportRoutes from "./routes/reports.js";
import productRoutes from "./routes/products.js";
import catalogueSettingRoutes from "./routes/catalogueSettings.js";
import goodsPurchaseOrderRoutes from "./routes/goodsPurchaseOrders.js";
import goodsReceiptRoutes from "./routes/goodsReceipts.js";
import goodsSalesOrderRoutes from "./routes/goodsSalesOrders.js";
import goodsDispatchRoutes from "./routes/goodsDispatches.js";
import quotationRoutes from "./routes/quotations.js";
import forecastVariableRoutes from "./routes/forecastVariables.js";
import approvalRoutes from "./routes/approvals.js";

const app = express();

// ── Global middleware ──
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Global rate limiter applied to all routes
app.use(apiLimiter);

// ── Request logging ──
app.use((req, _res, next) => {
  if (config.nodeEnv !== "test") {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// ── Routes ──
// All routes mounted under /api to match frontend API_BASE

// Auth endpoints — the strict limiter is applied per-route inside auth.ts
// (only to /signin and /signup). Authenticated endpoints like /me, /ping and
// /refresh-token fall under the general apiLimiter so the heartbeat never
// exhausts the brute-force budget for everyone on the same IP.
app.use("/api/auth", authRoutes);

// Standard API routes
app.use("/api/profiles", profileRoutes);
app.use("/api/debtors", debtorRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/purchase-invoices", purchaseInvoiceRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/advances", advanceRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/stock-movements", stockMovementRoutes);
app.use("/api/inventory-items", inventoryItemRoutes);
app.use("/api/products", productRoutes);
app.use("/api/catalogue-settings", catalogueSettingRoutes);
app.use("/api/goods-purchase-orders", goodsPurchaseOrderRoutes);
app.use("/api/goods-receipts", goodsReceiptRoutes);
app.use("/api/goods-sales-orders", goodsSalesOrderRoutes);
app.use("/api/goods-dispatches", goodsDispatchRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/forecast-variables", forecastVariableRoutes);
app.use("/api/admin", adminRoutes);

// Public NOA endpoints get a moderate limiter
app.use("/api/noa", publicLimiter, noaRoutes);

// Public quotation-approval endpoints get the same moderate limiter
app.use("/api/approvals", publicLimiter, approvalRoutes);

// Upload endpoints get a upload-specific limiter
app.use("/api/upload", uploadLimiter, uploadRoutes);

// Credit/Debit notes
import creditDebitNoteRoutes from "./routes/creditDebitNotes.js";
app.use("/api/credit-debit-notes", creditDebitNoteRoutes);

// Bulk payments
import bulkPaymentRoutes from "./routes/bulkPayments.js";
app.use("/api/bulk-payments", bulkPaymentRoutes);

// Payments history
import paymentRoutes from "./routes/payments.js";
app.use("/api/payments", paymentRoutes);

// Accounting
import accountRoutes from "./routes/accounts.js";
app.use("/api/accounts", accountRoutes);

import journalEntryRoutes from "./routes/journalEntries.js";
app.use("/api/journal-entries", journalEntryRoutes);

// Reports
app.use("/api/reports", requireAuth, reportRoutes);

// Balance Sheet (separate router for compute-heavy endpoint)
import balanceSheetRoutes from "./routes/balanceSheet.js";
app.use("/api/reports/balance-sheet", balanceSheetRoutes);

// Balance Sheet Items (CRUD for manual entries)
import balanceSheetItemRoutes from "./routes/balanceSheetItems.js";
app.use("/api/balance-sheet-items", requireAuth, balanceSheetItemRoutes);

// Companies (super admin company switcher)
import companyRoutes from "./routes/companies.js";
app.use("/api/companies", companyRoutes);

// ── Health check (no rate limit) ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Overdue-reminder daily sweep ──
// Runs shortly after boot and then every 24h. The sweep itself is idempotent
// per invoice (stamped `last_overdue_reminder_date`), so overlapping runs and
// multiple instances are safe. Errors are isolated and logged, never thrown.
async function dailyOverdueReminderTick() {
  try {
    const { reminded, skipped } = await runOverdueReminderSweep();
    console.log(`   🔔 Overdue-reminder sweep: ${reminded} reminded, ${skipped} skipped`);
  } catch (err) {
    console.error("   ❌ Overdue-reminder sweep failed:", err);
  }
}

// ── Start ──
app.listen(config.port, async () => {
  console.log(`\n🚀 Ledger backend running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);

  // Ensure DynamoDB tables exist
  await createTables();

  // Seed admin user from env vars
  await seedAdmin();

  // Kick the reminder sweep ~60s after boot (gives startup time to settle),
  // then every 24h. Manual trigger: POST /api/admin/run-overdue-reminders.
  setTimeout(dailyOverdueReminderTick, 60_000);
  setInterval(dailyOverdueReminderTick, 24 * 60 * 60 * 1000);

  // Daily "ensure fresh" forecast recompute (in addition to the event triggers).
  const dailyForecastTick = async () => {
    try {
      const { recomputed } = await recomputeAll(null);
      console.log(`   📈 Forecast ensure-fresh: ${recomputed} products recomputed`);
    } catch (err) {
      console.error("   ❌ Forecast ensure-fresh failed:", err);
    }
  };
  setTimeout(dailyForecastTick, 90_000);
  setInterval(dailyForecastTick, 24 * 60 * 60 * 1000);

  console.log(`   API docs: http://localhost:${config.port}/health\n`);
});

export default app;
