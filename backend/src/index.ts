import express from "express";
import cors from "cors";
import { config } from "./config.js";

import { requireAuth } from "./middleware/auth.js";

// Rate limiters
import { apiLimiter, authLimiter, uploadLimiter, publicLimiter } from "./middleware/rateLimiter.js";

// Admin seed
import { seedAdmin } from "./seed.js";

// DynamoDB table creation
import { createTables } from "./db/schema.js";

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

// Auth endpoints get a stricter rate limiter
app.use("/api/auth", authLimiter, authRoutes);

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
app.use("/api/admin", adminRoutes);

// Public NOA endpoints get a moderate limiter
app.use("/api/noa", publicLimiter, noaRoutes);

// Upload endpoints get a upload-specific limiter
app.use("/api/upload", uploadLimiter, uploadRoutes);

// Credit/Debit notes
import creditDebitNoteRoutes from "./routes/creditDebitNotes.js";
app.use("/api/credit-debit-notes", creditDebitNoteRoutes);

// Bulk payments
import bulkPaymentRoutes from "./routes/bulkPayments.js";
app.use("/api/bulk-payments", bulkPaymentRoutes);

// Reports
app.use("/api/reports", requireAuth, reportRoutes);

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

// ── Start ──
app.listen(config.port, async () => {
  console.log(`\n🚀 Ledger backend running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);

  // Ensure DynamoDB tables exist
  await createTables();

  // Seed admin user from env vars
  await seedAdmin();

  console.log(`   API docs: http://localhost:${config.port}/health\n`);
});

export default app;
