import { Router, Response } from "express";
import {
  scanTable,
  TABLES,
} from "../db/client.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import type { Invoice, PurchaseInvoice, Customer, Vendor } from "../types/index.js";

const router = Router();

// ── GET /api/payments/history ──
// Returns a unified feed of payment events across both sales and purchase invoices.
// Optionally filtered by party_type: "customer" | "supplier" | "all" (default "all")
router.get("/history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const partyType = (req.query.party_type as string) || "all";

    // Preload all customers and vendors for enrichment
    const [allCustomers, allVendors] = await Promise.all([
      scanTable<Customer>(TABLES.CUSTOMERS),
      scanTable<Vendor>(TABLES.VENDORS),
    ]);
    const customerMap = new Map(allCustomers.map((d) => [d.id, d]));
    const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

    // Fetch paid invoices
    const allInvoices = await scanTable<Invoice>(TABLES.INVOICES);
    const allPurchaseInvoices = await scanTable<PurchaseInvoice>(TABLES.PURCHASE_INVOICES);

    // Build unified payment events
    type PaymentEvent = {
      id: string;
      type: "customer_payment" | "supplier_payment";
      party_id: string;
      party_name: string;
      invoice_number: string;
      amount: number;
      amount_received: number | null;
      paid_date: string | null;
      paid_note: string | null;
      late_days: number | null;
      short_payment: number | null;
      status: string;
      payment_type: string | null;
    };

    const events: PaymentEvent[] = [];

    // Sales invoices (customer → money in)
    for (const inv of allInvoices) {
      if (inv.status === "paid" && inv.paid_date) {
        const customer = inv.customer_id ? customerMap.get(inv.customer_id) : undefined;
        events.push({
          id: inv.id,
          type: "customer_payment",
          party_id: inv.customer_id,
          party_name: customer?.name ?? "Unknown customer",
          invoice_number: inv.invoice_number,
          amount: inv.amount,
          amount_received: inv.amount_received ?? null,
          paid_date: inv.paid_date,
          paid_note: inv.paid_note ?? null,
          late_days: inv.late_days ?? null,
          short_payment: inv.short_payment ?? null,
          status: inv.status,
          payment_type: inv.payment_type ?? null,
        });
      }
    }

    // Purchase invoices (supplier → money out)
    for (const pi of allPurchaseInvoices) {
      if (pi.status === "paid" && pi.paid_date) {
        const vendor = pi.vendor_id ? vendorMap.get(pi.vendor_id) : undefined;
        events.push({
          id: pi.id,
          type: "supplier_payment",
          party_id: pi.vendor_id,
          party_name: vendor?.name ?? "Unknown supplier",
          invoice_number: pi.invoice_number,
          amount: pi.amount,
          amount_received: null,
          paid_date: pi.paid_date,
          paid_note: pi.paid_note ?? null,
          late_days: null,
          short_payment: null,
          status: pi.status,
          payment_type: "supplier_pay",
        });
      }
    }

    // Filter by party type
    const filtered = partyType === "customer"
      ? events.filter((e) => e.type === "customer_payment")
      : partyType === "supplier"
      ? events.filter((e) => e.type === "supplier_payment")
      : events;

    // Sort by paid_date descending (most recent first)
    filtered.sort((a, b) => (b.paid_date ?? "").localeCompare(a.paid_date ?? ""));

    // Calculate totals
    const totalCustomerPayments = filtered
      .filter((e) => e.type === "customer_payment")
      .reduce((s, e) => s + (e.amount_received ?? e.amount), 0);
    const totalSupplierPayments = filtered
      .filter((e) => e.type === "supplier_payment")
      .reduce((s, e) => s + e.amount, 0);

    res.json({
      payments: filtered,
      totals: {
        total_events: filtered.length,
        total_customer_payments: totalCustomerPayments,
        total_supplier_payments: totalSupplierPayments,
      },
    });
  } catch (err) {
    console.error("Get payment history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
