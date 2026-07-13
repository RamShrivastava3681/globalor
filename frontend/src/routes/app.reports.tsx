import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { FileText, FileSpreadsheet, Loader2, Filter, Columns, CalendarDays, X, Building2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// ── Types ──

type ReportTab = "portfolio" | "proformas" | "sales-invoices" | "purchase-invoices" | "aging" | "debtors" | "suppliers" | "advances" | "expenses" | "profit-loss" | "inventory-tracking";

const TABS: { id: ReportTab; label: string }[] = [
  { id: "portfolio", label: "Portfolio Summary" },
  { id: "profit-loss", label: "Profit & Loss" },
  { id: "proformas", label: "Proforma invoices" },
  { id: "sales-invoices", label: "Sales invoices" },
  { id: "purchase-invoices", label: "Purchase invoices" },
  { id: "aging", label: "Aging report" },
  { id: "debtors", label: "Debtors" },
  { id: "suppliers", label: "Suppliers" },
  { id: "advances", label: "Advances" },
  { id: "expenses", label: "Expenses" },
  { id: "inventory-tracking", label: "Inventory tracking" },
];

// ── Status filter options ──
const STATUS_FILTERS: Record<ReportTab, string[]> = {
  "portfolio": ["all"],
  "profit-loss": ["all"],
  "proformas": ["all", "open", "closed", "proforma", "invoiced", "cancelled"],
  "sales-invoices": ["all", "open", "closed"],
  "purchase-invoices": ["all", "open", "closed"],
  "aging": ["all", "overdue", "pending"],
  "debtors": ["all"],
  "suppliers": ["all"],
  "advances": ["all", "open", "applied", "refunded"],
  "expenses": ["all"],
  "inventory-tracking": ["all"],
};

// ── Tab-specific open/closed statuses ──
function getOpenStatuses(tab: ReportTab): string[] {
  if (tab === "profit-loss" || tab === "portfolio" || tab === "inventory-tracking") return [];
  if (tab === "sales-invoices" || tab === "purchase-invoices") return ["pending", "approved", "advanced", "overdue", "disputed"];
  return ["pending", "approved", "advanced", "overdue", "funded", "proforma"];
}

function getClosedStatuses(tab: ReportTab): string[] {
  if (tab === "profit-loss" || tab === "portfolio" || tab === "inventory-tracking") return [];
  if (tab === "sales-invoices" || tab === "purchase-invoices") return ["funded", "paid"];
  return ["paid", "rejected", "cancelled", "disputed"];
}

// ── Column definitions for each report ──

function getColumns(tab: ReportTab): { key: string; label: string; render: (row: any) => string }[] {
  const common = [
    { key: "id", label: "ID", render: (r: any) => r.id?.slice(0, 8) ?? "" },
  ];

  switch (tab) {
    case "portfolio":
      return [
        { key: "review_period", label: "Review Period", render: (r: any) => r.review_period ?? "" },
        { key: "total_buyers", label: "Total Buyers", render: (r: any) => (r.total_buyers ?? 0).toLocaleString() },
        { key: "total_invoices", label: "Total Invoices", render: (r: any) => (r.total_invoices ?? 0).toLocaleString() },
        { key: "total_invoice_value", label: "Total Invoice Value (USD)", render: (r: any) => fmtMoney(r.total_invoice_value ?? 0) },
        { key: "total_collections", label: "Total Collections Received (USD)", render: (r: any) => fmtMoney(r.total_collections ?? 0) },
        { key: "total_outstanding", label: "Total Outstanding (USD)", render: (r: any) => fmtMoney(r.total_outstanding ?? 0) },
        { key: "closed_invoices", label: "Closed Invoices", render: (r: any) => (r.closed_invoices ?? 0).toLocaleString() },
        { key: "open_invoices", label: "Open Invoices", render: (r: any) => (r.open_invoices ?? 0).toLocaleString() },
        { key: "avg_payment_days", label: "Average Payment Days", render: (r: any) => r.avg_payment_days != null ? `${r.avg_payment_days}d` : "—" },
        { key: "median_payment_days", label: "Median Payment Days", render: (r: any) => r.median_payment_days != null ? `${r.median_payment_days}d` : "—" },
      ];
    case "sales-invoices":
      return [
        ...common,
        { key: "invoice_number", label: "Invoice #", render: (r: any) => r.invoice_number ?? "" },
        { key: "debtor_name", label: "Debtor", render: (r: any) => r.debtor?.name ?? "" },
        { key: "client_name", label: "Client", render: (r: any) => r.client?.company_name ?? "" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "outstanding_amount", label: "Outstanding", render: (r: any) => r.outstanding != null ? fmtMoney(r.outstanding) : "—" },
        { key: "advance_rate", label: "Advance Rate", render: (r: any) => `${r.advance_rate ?? 0}%` },
        { key: "fee_rate", label: "Fee Rate", render: (r: any) => `${r.fee_rate ?? 0}%` },
        { key: "issue_date", label: "Issue Date", render: (r: any) => fmtDate(r.issue_date) },
        { key: "due_date", label: "ERP Due Date", render: (r: any) => fmtDate(r.due_date) },
        { key: "contractual_terms", label: "Contractual Payment Terms", render: (r: any) => r.has_contractual_due_date ? "Yes" : "N/A" },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
        { key: "paid_date", label: "Paid Date", render: (r: any) => fmtDate(r.paid_date) },
        { key: "amount_received", label: "Amount Received", render: (r: any) => r.amount_received ? fmtMoney(r.amount_received) : "—" },
        { key: "short_payment", label: "Short Payment", render: (r: any) => r.short_payment ? fmtMoney(r.short_payment) : "—" },
        { key: "late_days", label: "Late Days", render: (r: any) => r.late_days?.toString() ?? "—" },
        { key: "pay_days", label: "Pay Days", render: (r: any) => (r.status === "paid" && r.issue_date && r.paid_date) ? `${daysBetween(r.issue_date, r.paid_date)}d` : "—" },
        { key: "noa_status", label: "NOA Status", render: (r: any) => r.noa_status ?? "" },
        { key: "payment_type", label: "Payment Type", render: (r: any) => {
            const closed = r.status === "paid" || r.status === "funded";
            if (!closed) return "—";
            const pt = r.payment_type ?? "manual_pay";
            return pt === "mass_upload" ? "Mass Upload" : pt === "bulk_pay" ? "Bulk Pay" : pt === "treasury_pay" ? "Treasury Pay" : "Manual Pay";
          } },
        { key: "po_number", label: "PO Number", render: (r: any) => r.po_number ?? "—" },
        { key: "payment_terms_days", label: "Terms (Days)", render: (r: any) => r.payment_terms_days?.toString() ?? "—" },
        { key: "bl_date", label: "BL Date", render: (r: any) => fmtDate(r.bl_date) },
        { key: "due_date_source", label: "Due Date Source", render: (r: any) => r.due_date_source ?? "" },
        { key: "advance_received_date", label: "Advance Received", render: (r: any) => fmtDate(r.advance_received_date) },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "purchase-invoices":
      return [
        ...common,
        { key: "invoice_number", label: "Invoice #", render: (r: any) => r.invoice_number ?? "" },
        { key: "vendor_name", label: "Vendor", render: (r: any) => r.vendor?.name ?? "" },
        { key: "client_name", label: "Client", render: (r: any) => r.client?.company_name ?? "" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "issue_date", label: "Issue Date", render: (r: any) => fmtDate(r.issue_date) },
        { key: "due_date", label: "ERP Due Date", render: (r: any) => fmtDate(r.due_date) },
        { key: "contractual_terms", label: "Contractual Payment Terms", render: (r: any) => r.has_contractual_due_date ? "Yes" : "N/A" },
        { key: "paid_date", label: "Paid Date", render: (r: any) => fmtDate(r.paid_date) },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
        { key: "po_number", label: "PO Number", render: (r: any) => r.po_number ?? "—" },
        { key: "payment_terms_days", label: "Terms (Days)", render: (r: any) => r.payment_terms_days?.toString() ?? "—" },
        { key: "bl_date", label: "BL Date", render: (r: any) => fmtDate(r.bl_date) },
        { key: "due_date_source", label: "Due Date Source", render: (r: any) => r.due_date_source ?? "" },
        { key: "funded_date", label: "Funded Date", render: (r: any) => fmtDate(r.funded_date) },
        { key: "advance_paid_date", label: "Advance Paid", render: (r: any) => fmtDate(r.advance_paid_date) },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "proformas":
      return [
        ...common,
        { key: "po_number", label: "PO Number", render: (r: any) => r.po_number ?? "" },
        { key: "proforma_number", label: "Proforma #", render: (r: any) => r.proforma_number ?? "—" },
        { key: "side", label: "Side", render: (r: any) => r.side ?? "" },
        { key: "debtor_name", label: "Debtor", render: (r: any) => r.debtor?.name ?? "—" },
        { key: "vendor_name", label: "Vendor", render: (r: any) => r.vendor?.name ?? "—" },
        { key: "client_name", label: "Client", render: (r: any) => r.client?.company_name ?? "" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "currency", label: "Currency", render: (r: any) => r.currency ?? "USD" },
        { key: "proforma_date", label: "Proforma Date", render: (r: any) => fmtDate(r.proforma_date) },
        { key: "expected_date", label: "Expected Date", render: (r: any) => fmtDate(r.expected_date) },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
        { key: "proforma_status", label: "Proforma Status", render: (r: any) => r.proforma_status ?? "" },
        { key: "contractual_terms", label: "Contractual Payment Terms", render: (r: any) => r.has_contractual_due_date ? "Yes" : "N/A" },
        { key: "proforma_funded_amount", label: "Funded Amount", render: (r: any) => r.proforma_funded_amount ? fmtMoney(r.proforma_funded_amount) : "—" },
        { key: "proforma_funded_at", label: "Funded At", render: (r: any) => fmtDate(r.proforma_funded_at) },
        { key: "proforma_funding_reference", label: "Funding Ref", render: (r: any) => r.proforma_funding_reference ?? "—" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "aging":
      return [
        { key: "buyer_name", label: "Buyer", render: (r: any) => r.buyer_name ?? "" },
        { key: "current", label: "Current", render: (r: any) => r.current ? fmtMoney(r.current) : "—" },
        { key: "bucket_1_30", label: "1–30 Days", render: (r: any) => r.bucket_1_30 ? fmtMoney(r.bucket_1_30) : "—" },
        { key: "bucket_31_60", label: "31–60 Days", render: (r: any) => r.bucket_31_60 ? fmtMoney(r.bucket_31_60) : "—" },
        { key: "bucket_61_90", label: "61–90 Days", render: (r: any) => r.bucket_61_90 ? fmtMoney(r.bucket_61_90) : "—" },
        { key: "bucket_91_120", label: "91–120 Days", render: (r: any) => r.bucket_91_120 ? fmtMoney(r.bucket_91_120) : "—" },
        { key: "bucket_over_120", label: "Over 120 Days", render: (r: any) => r.bucket_over_120 ? fmtMoney(r.bucket_over_120) : "—" },
        { key: "total_outstanding", label: "Total Outstanding", render: (r: any) => fmtMoney(r.total_outstanding ?? 0) },
      ];
    case "debtors":
      return [
        { key: "uid", label: "UID", render: (r: any) => r.id ? `#${r.id.slice(-8).toUpperCase()}` : "" },
        { key: "name", label: "Debtor Name", render: (r: any) => r.name ?? "" },
        { key: "legal_entity_name", label: "Legal Entity Name", render: (r: any) => r.legal_entity_name ?? "—" },
        { key: "registration_no", label: "Registration No.", render: (r: any) => r.registration_no ?? "—" },
        { key: "total_invoices", label: "Total Invoices", render: (r: any) => (r.total_invoices ?? 0).toLocaleString() },
        { key: "open", label: "Open", render: (r: any) => (r.open ?? 0).toLocaleString() },
        { key: "closed", label: "Closed", render: (r: any) => (r.closed ?? 0).toLocaleString() },
        { key: "outstanding", label: "Outstanding", render: (r: any) => r.outstanding != null ? fmtMoney(r.outstanding) : "—" },
        { key: "total_invoiced", label: "Total Invoiced", render: (r: any) => r.total_invoiced != null ? fmtMoney(r.total_invoiced) : "—" },
        { key: "total_paid", label: "Total Paid", render: (r: any) => r.total_paid != null ? fmtMoney(r.total_paid) : "—" },
        { key: "oldest_outstanding_invoice_date", label: "Oldest Outstanding Invoice", render: (r: any) => r.oldest_outstanding_invoice_date ? fmtDate(r.oldest_outstanding_invoice_date) : "—" },
        { key: "latest_invoice_date", label: "Latest Invoice", render: (r: any) => r.latest_invoice_date ? fmtDate(r.latest_invoice_date) : "—" },
        { key: "avg_days", label: "Avg Days", render: (r: any) => r.avg_days != null ? `${r.avg_days}d` : "—" },
        { key: "median_days", label: "Median Days", render: (r: any) => r.median_days != null ? `${r.median_days}d` : "—" },
        { key: "max_days", label: "Max Days", render: (r: any) => r.max_days != null ? `${r.max_days}d` : "—" },
        { key: "min_days", label: "Min Days", render: (r: any) => r.min_days != null ? `${r.min_days}d` : "—" },
        { key: "industry", label: "Industry", render: (r: any) => r.industry ?? "—" },
        { key: "relationship_since", label: "Relationship Since", render: (r: any) => r.relationship_since ?? "—" },
        { key: "credit_limit", label: "Credit Limit", render: (r: any) => fmtMoney(r.credit_limit) },
        { key: "risk_score", label: "Risk Score", render: (r: any) => r.risk_score?.toString() ?? "—" },
        { key: "contact_name", label: "Contact", render: (r: any) => r.contact_name ?? "—" },
        { key: "contact_email", label: "Email", render: (r: any) => r.contact_email ?? "—" },
        { key: "contact_phone", label: "Phone", render: (r: any) => r.contact_phone ?? "—" },
        { key: "registered_address", label: "Registered Address", render: (r: any) => r.registered_address ?? "—" },
        { key: "payment_terms_days", label: "Terms (Days)", render: (r: any) => r.payment_terms_days?.toString() ?? "—" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "suppliers":
      return [
        { key: "name", label: "Company", render: (r: any) => r.name ?? "" },
        { key: "industry", label: "Industry", render: (r: any) => r.industry ?? "—" },
        { key: "contact_name", label: "Contact", render: (r: any) => r.contact_name ?? "—" },
        { key: "contact_email", label: "Email", render: (r: any) => r.contact_email ?? "—" },
        { key: "contact_phone", label: "Phone", render: (r: any) => r.contact_phone ?? "—" },
        { key: "city", label: "City", render: (r: any) => r.city ?? "—" },
        { key: "country", label: "Country", render: (r: any) => r.country ?? "—" },
        { key: "payment_terms_days", label: "Terms (Days)", render: (r: any) => r.payment_terms_days?.toString() ?? "—" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "advances":
      return [
        ...common,
        { key: "side", label: "Side", render: (r: any) => r.side ?? "" },
        { key: "invoice_ref", label: "Invoice", render: (r: any) => r.invoice?.invoice_number ?? r.purchase?.invoice_number ?? r.order?.po_number ?? "—" },
        { key: "debtor_vendor", label: "Debtor/Vendor", render: (r: any) => r.invoice?.debtor?.name ?? r.purchase?.vendor?.name ?? r.order?.debtor?.name ?? r.order?.vendor?.name ?? "—" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "advance_date", label: "Date", render: (r: any) => fmtDate(r.advance_date) },
        { key: "reference", label: "Reference", render: (r: any) => r.reference ?? "—" },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "expenses":
      return [
        ...common,
        { key: "category", label: "Category", render: (r: any) => r.category ?? "" },
        { key: "description", label: "Description", render: (r: any) => r.description ?? "—" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "expense_date", label: "Date", render: (r: any) => fmtDate(r.expense_date) },
        { key: "invoice_link", label: "Linked Invoice", render: (r: any) => r.invoice?.invoice_number ?? r.purchase?.invoice_number ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "profit-loss":
      return [];
    case "inventory-tracking":
      return [
        { key: "item", label: "Item", render: (r: any) => r.item ?? "" },
        { key: "description", label: "Description", render: (r: any) => r.description ?? "—" },
        { key: "closing_quantity", label: "Closing Qty", render: (r: any) => Number(r.closing_quantity ?? 0).toLocaleString() },
        { key: "price_sale", label: "Price Sale", render: (r: any) => fmtMoney(r.price_sale ?? 0) },
        { key: "extended_price", label: "Extended Price", render: (r: any) => fmtMoney(r.extended_price ?? 0) },
        { key: "unit_cost", label: "Unit Cost", render: (r: any) => fmtMoney(r.unit_cost ?? 0) },
        { key: "extended_cost", label: "Extended Cost", render: (r: any) => fmtMoney(r.extended_cost ?? 0) },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    default:
      return common;
  }
}

// ── Column picker helpers ──

function initColumnVisibility(columns: { key: string; label: string }[]): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  columns.forEach((c) => (vis[c.key] = true));
  return vis;
}

// ── Date helpers ──

function formatDateForInput(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toISODateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── P&L Period presets ──

type PeriodPreset = "this-month" | "prev-month" | "this-quarter" | "custom";

const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "prev-month", label: "Previous Month" },
  { id: "this-quarter", label: "This Quarter" },
];

// ── Financial year / quarter / month options ──

const YEAR_OPTIONS = (() => {
  const cy = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => cy - 6 + i);
})();

const QUARTER_OPTIONS = [
  { value: 1, label: "Q1" },
  { value: 2, label: "Q2" },
  { value: 3, label: "Q3" },
  { value: 4, label: "Q4" },
];

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

function getPeriodDates(preset: PeriodPreset): { from: Date; to: Date } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  switch (preset) {
    case "this-month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
    case "prev-month":
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
    case "this-quarter": {
      const q = Math.floor(m / 3);
      return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0) };
    }
    case "custom":
      return null; // User will pick manually
  }
}

// ── P&L report type ──

interface PnLReport {
  from: string;
  to: string;
  grossSales: number;
  otherSalesIncome: number;
  salesReturns: number;
  totalTurnover: number;
  grossPurchases: number;
  logisticsAndProcurement: number;
  principalCost: number;
  referralFees: number;
  customsDuties: number;
  freightCharges: number;
  otherDirectCosts: number;
  totalCostOfSales: number;
  grossProfit: number;
  adminCostByCategory: Record<string, number>;
  totalAdminCosts: number;
  operatingProfit: number;
  profitBeforeTax: number;
  taxByCategory: Record<string, number>;
  totalTaxation: number;
  profitAfterTax: number;
}

// ── Admin cost category label mapping ──
const ADMIN_CAT_LABELS: Record<string, string> = {
  "accounting-and-bookkeeping": "Accounting and Bookkeeping",
  "administration-expenses": "Administration Expenses",
  "bank-charges": "Bank Charges",
  "bank-revaluations": "Bank Revaluations",
  "business-administration-support": "Business Administration Support",
  "consultancy-fees": "Consultancy Fees",
  "employee-gross-salary": "Employee Gross Salary",
  "employer-pension-contributions": "Employer Pension Contributions",
  "fx-realised-gains-and-losses": "FX Realised Gains and Losses",
  "insurances-other": "Insurance",
  "it-expenses": "IT Expenses",
  "it-platform-and-support": "IT Platform and Support",
  "legal-and-compliance-support": "Legal and Compliance Support",
  "legal-fees": "Legal Fees",
  "other-general-expenses": "Other General Expenses",
  "professional-fees": "Professional Fees",
  "professional-subscription": "Professional Subscriptions",
  "realised-currency-gains": "Realised Currency Gains",
  "unrealised-currency-gains": "Unrealised Currency Gains",
  "referral-fee-admin-expense": "Referral Fee - Admin Expense",
  "rent-expenses": "Rent Expenses",
  "travelling-stay-and-food": "Travel, Stay and Food",
};

// ── Report Component ──

function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("sales-invoices");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 50;

  // Buyer filter state
  const [buyerId, setBuyerId] = useState("");

  // Payment type filter state (separate toggles for bulk-pay and treasury-pay)
  const [filterBulkPay, setFilterBulkPay] = useState(false);
  const [filterTreasuryPay, setFilterTreasuryPay] = useState(false);

  // Fetch debtors list for buyer dropdown
  const { data: debtors = [] } = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  // Date range state
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  // P&L state
  const isPnL = tab === "profit-loss";
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this-month");
  const [pnlData, setPnlData] = useState<PnLReport | null>(null);

  // Financial year / quarter / month dropdown state
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  // Company name from profile
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    api.get<any>("/profiles/me").then((data) => {
      if (data?.company_name) setCompanyName(data.company_name);
    }).catch(() => {});
  }, []);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const columns = getColumns(tab);

  // Initialize/reset column visibility when tab changes
  useEffect(() => {
    setVisibleColumns(initColumnVisibility(columns));
    setColumnMenuOpen(false);
  }, [tab]);

  // Close column menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuOpen(false);
      }
    }
    if (columnMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [columnMenuOpen]);

  // Derive visible columns list
  const visibleColumnsList = columns.filter((c) => visibleColumns[c.key] !== false);

  // Tabs that support server-side pagination
  const PAGINATED_TABS: ReportTab[] = ["sales-invoices", "purchase-invoices", "aging"];
  const isPaginated = PAGINATED_TABS.includes(tab);

  const hasDateFilter = !!fromDate || !!toDate;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isPnL) {
        // Fetch P&L report
        let fromStr: string | undefined;
        let toStr: string | undefined;
        if (periodPreset === "custom") {
          if (fromDate) fromStr = toISODateString(fromDate);
          if (toDate) toStr = toISODateString(toDate);
        } else {
          const dates = getPeriodDates(periodPreset);
          if (dates) {
            fromStr = toISODateString(dates.from);
            toStr = toISODateString(dates.to);
          }
        }
        const params = new URLSearchParams();
        if (fromStr) params.set("from", fromStr);
        if (toStr) params.set("to", toStr);
        const qs = params.toString();
        const url = qs ? `/reports/profit-loss?${qs}` : `/reports/profit-loss`;
        const result = await api.get<PnLReport>(url);
        setPnlData(result);
      } else {
        const params = new URLSearchParams();
        if (isPaginated) {
          params.set("page", String(page));
          params.set("limit", String(limit));
          if (searchQuery) params.set("search", searchQuery);
          if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
          if (buyerId) params.set("buyer_id", buyerId);
        }
        // Payment type filter (comma-separated values for server-side filtering)
        const activePaymentTypes: string[] = [];
        if (filterBulkPay) activePaymentTypes.push("bulk_pay");
        if (filterTreasuryPay) activePaymentTypes.push("treasury_pay");
        if (activePaymentTypes.length > 0) {
          params.set("payment_type", activePaymentTypes.join(","));
        }
        if (fromDate) params.set("from", toISODateString(fromDate));
        if (toDate) params.set("to", toISODateString(toDate));
        const qs = params.toString();
        const url = qs ? `/reports/${tab}?${qs}` : `/reports/${tab}`;
        const result = await api.get<any>(url);

        if (isPaginated && result?.data) {
          setData(result.data ?? []);
          setTotalItems(result.total ?? 0);
          setTotalPages(result.totalPages ?? 1);
        } else {
          setData(Array.isArray(result) ? result : (result ?? []));
          const arr = Array.isArray(result) ? result : (result ?? []);
          setTotalItems(arr.length);
          setTotalPages(1);
        }
      }
    } catch (err) {
      toast.error("Failed to load report data");
      if (!isPnL) {
        setData([]);
        setTotalItems(0);
        setTotalPages(1);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, page, isPaginated, searchQuery, statusFilter, fromDate, toDate, periodPreset, isPnL, buyerId, filterBulkPay, filterTreasuryPay]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // When year / quarter / month dropdowns change, compute dates and switch to custom
  useEffect(() => {
    if (selectedYear || selectedQuarter || selectedMonth) {
      const targetYear = selectedYear ?? new Date().getFullYear();
      let from: Date, to: Date;
      if (selectedMonth) {
        from = new Date(targetYear, selectedMonth - 1, 1);
        to = new Date(targetYear, selectedMonth, 0);
      } else if (selectedQuarter) {
        const qStart = (selectedQuarter - 1) * 3;
        from = new Date(targetYear, qStart, 1);
        to = new Date(targetYear, qStart + 3, 0);
      } else {
        from = new Date(targetYear, 0, 1);
        to = new Date(targetYear, 11, 31);
      }
      setFromDate(from);
      setToDate(to);
      setPeriodPreset("custom");
    }
  }, [selectedYear, selectedQuarter, selectedMonth]);

  // Reset page when tab, filters, or dates change
  useEffect(() => {
    setPage(1);
  }, [tab, statusFilter, searchQuery, fromDate, toDate, buyerId, filterBulkPay, filterTreasuryPay]);

  // Reset year/quarter/month dropdowns when tab changes
  useEffect(() => {
    setSelectedYear(null);
    setSelectedQuarter(null);
    setSelectedMonth(null);
  }, [tab]);

  // For paginated tabs, the server handles search + status filtering.
  // For non-paginated tabs, we apply client-side filtering.
  const filtered = isPaginated
    ? data
    : data.filter((row) => {
        if (statusFilter !== "all") {
          const rowStatus = (row.status ?? row.proforma_status ?? "").toLowerCase();
          if (statusFilter === "open") {
            if (!getOpenStatuses(tab).includes(rowStatus)) return false;
          } else if (statusFilter === "closed") {
            if (!getClosedStatuses(tab).includes(rowStatus)) return false;
          } else if (rowStatus !== statusFilter) {
            return false;
          }
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const searchable = JSON.stringify(Object.values(row)).toLowerCase();
          if (!searchable.includes(q)) return false;
        }
        return true;
      });

  // ── Fetch all data for export (bypasses pagination) ──
  const fetchExportData = useCallback(async () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (buyerId) params.set("buyer_id", buyerId);
    // Payment type filter for export
    const exportPaymentTypes: string[] = [];
    if (filterBulkPay) exportPaymentTypes.push("bulk_pay");
    if (filterTreasuryPay) exportPaymentTypes.push("treasury_pay");
    if (exportPaymentTypes.length > 0) {
      params.set("payment_type", exportPaymentTypes.join(","));
    }
    if (fromDate) params.set("from", toISODateString(fromDate));
    if (toDate) params.set("to", toISODateString(toDate));
    const qs = params.toString();
    const url = qs ? `/reports/${tab}?${qs}` : `/reports/${tab}`;
    const result = await api.get<any>(url);
    const allData = Array.isArray(result) ? result : (result?.data ?? result ?? []);
    // For consistent export, apply client-side filters too (covers non-paginated tabs)
    // Only apply status filter when the data actually has status-related fields
    return allData.filter((row: any) => {
      if (statusFilter !== "all") {
        const rowStatus = (row.status ?? row.proforma_status ?? "").toLowerCase();
        // Skip status filtering if this data type doesn't have status fields (e.g. aging, portfolio, debtors)
        if (rowStatus !== "") {
          if (statusFilter === "open") {
            if (!getOpenStatuses(tab).includes(rowStatus)) return false;
          } else if (statusFilter === "closed") {
            if (!getClosedStatuses(tab).includes(rowStatus)) return false;
          } else if (rowStatus !== statusFilter) {
            return false;
          }
        }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const searchable = JSON.stringify(Object.values(row)).toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [tab, statusFilter, searchQuery, fromDate, toDate, buyerId, filterBulkPay, filterTreasuryPay]);

  // ── P&L export helpers ──
  const buildPnlRows = useCallback(() => {
    if (!pnlData) return [];
    const d = pnlData;
    const adminEntries = Object.entries(d.adminCostByCategory).sort(([a], [b]) => a.localeCompare(b));
    const taxEntries = Object.entries(d.taxByCategory).sort(([a], [b]) => a.localeCompare(b));

    const rows: Array<{ label: string; value: string; depth: number; bold?: boolean; doubleLine?: boolean; accent?: boolean }> = [];

    const push = (label: string, value: number, opts?: { depth?: number; bold?: boolean; doubleLine?: boolean; accent?: boolean }) => {
      rows.push({
        label,
        value: fmtPnlMoney(value),
        depth: opts?.depth ?? 0,
        bold: opts?.bold,
        doubleLine: opts?.doubleLine,
        accent: opts?.accent,
      });
    };

    // Turnover
    push("TURNOVER", 0, { accent: true });
    push("Gross Sales", d.grossSales, { depth: 1 });
    push("Other Sales Income", d.otherSalesIncome, { depth: 1 });
    push("Sales Returns / Adjustments", -d.salesReturns, { depth: 1 });
    push("Total Turnover", d.totalTurnover, { bold: true, doubleLine: true });

    // Cost of Sales
    push("COST OF SALES", 0, { accent: true });
    push("Gross Purchases", d.grossPurchases, { depth: 1 });
    push("Logistics & Procurement Cost", d.logisticsAndProcurement, { depth: 1 });
    push("Principal Cost", d.principalCost, { depth: 1 });
    push("Referral Fees", d.referralFees, { depth: 1 });
    push("Customs / Duties", d.customsDuties, { depth: 1 });
    push("Freight Charges", d.freightCharges, { depth: 1 });
    push("Other Direct Costs", d.otherDirectCosts, { depth: 1 });
    push("Total Cost of Sales", d.totalCostOfSales, { bold: true, doubleLine: true });

    // Gross Profit
    push("Gross Profit", d.grossProfit, { bold: true, doubleLine: true });

    // Administrative Costs
    push("ADMINISTRATIVE COSTS", 0, { accent: true });
    if (adminEntries.length === 0) {
      push("No administrative expenses recorded", 0, { depth: 1 });
    } else {
      for (const [cat, amount] of adminEntries) {
        push(ADMIN_CAT_LABELS[cat] ?? cat, amount, { depth: 1 });
      }
    }
    push("Total Administrative Costs", d.totalAdminCosts, { bold: true, doubleLine: true });

    // Operating Profit
    push("Operating Profit", d.operatingProfit, { bold: true, doubleLine: true });

    // Profit Before Tax
    push("Profit on Ordinary Activities Before Taxation", d.profitBeforeTax, { bold: true, doubleLine: true });

    // Taxation
    push("TAXATION", 0, { accent: true });
    if (taxEntries.length === 0) {
      push("No tax entries recorded", 0, { depth: 1 });
    } else {
      for (const [cat, amount] of taxEntries) {
        push(cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), amount, { depth: 1 });
      }
    }
    push("Total Taxation", d.totalTaxation, { bold: true, doubleLine: true });

    // Profit After Tax
    push("Profit After Taxation", d.profitAfterTax, { bold: true, doubleLine: true });

    return rows;
  }, [pnlData]);

  // ── Excel Export (handles both tabular and P&L) ──
  const exportExcel = async () => {
    try {
      if (isPnL) {
        if (!pnlData) { toast.error("No data to export"); return; }
        const rows = buildPnlRows();
        const reportLabel = "Profit & Loss Statement";
        const periodText = `Period: ${fmtDate(pnlData.from)} \u2014 ${fmtDate(pnlData.to)}`;
        const wsData = [
          [companyName || "Company Name"],
          [reportLabel],
          [periodText],
          [],
          ["Line Item", "Amount (USD)"],
          ...rows.map((r) => [r.label, r.value]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws["!cols"] = [{ wch: 55 }, { wch: 20 }];
        // Bold the column header row (now at index 4)
        for (let c = 0; c < 2; c++) {
          const addr = XLSX.utils.encode_cell({ r: 4, c });
          if (ws[addr]) ws[addr].s = { font: { bold: true } };
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Profit & Loss");
        XLSX.writeFile(wb, "profit-and-loss.xlsx");
        toast.success("P&L statement exported to Excel");
        return;
      }

      const allData = await fetchExportData();
      if (allData.length === 0) {
        toast.error("No data to export");
        return;
      }
      const cols = visibleColumnsList.length > 0 ? visibleColumnsList : columns;
      const reportLabel = TABS.find((t) => t.id === tab)?.label ?? "Report";
      const periodText = (fromDate || toDate)
        ? `Period: ${fromDate ? fmtDate(toISODateString(fromDate)) : "..."} \u2014 ${toDate ? fmtDate(toISODateString(toDate)) : "..."}`
        : `Generated: ${new Date().toLocaleDateString()}`;
      const wsData = [
        [companyName || "Company Name"],
        [reportLabel],
        [periodText],
        [],
        cols.map((c) => c.label),
        ...allData.map((row: any) => cols.map((c) => c.render(row))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = cols.map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, TABS.find((t) => t.id === tab)?.label ?? tab);
      XLSX.writeFile(wb, `${tab}-report.xlsx`);
      toast.success(`Excel file downloaded \u00b7 ${allData.length} records`);
    } catch (err) {
      toast.error("Failed to export Excel");
    }
  };

  // ── Helper: load company logo as base64 (cached) ──
  const logoBase64PromiseRef = useRef<Promise<string> | null>(null);
  const getLogoBase64 = useCallback(async (): Promise<string> => {
    if (logoBase64PromiseRef.current) return logoBase64PromiseRef.current;
    logoBase64PromiseRef.current = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Could not get canvas context")); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Failed to load logo"));
      img.src = "/logo.png";
    });
    return logoBase64PromiseRef.current;
  }, []);

  // ── Helper: draw a PDF footer with page numbers ──
  const drawPdfFooter = (doc: jsPDF) => {
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(
        `Page ${i} of ${pageCount} · Generated ${new Date().toLocaleString()}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: "center" },
      );
    }
  };

  // ── Helper: draw a clean white header bar across the page ──
  const drawPdfHeaderBar = (doc: jsPDF, title: string, subtitle: string, logoBase64?: string) => {
    const pw = doc.internal.pageSize.width;

    if (logoBase64) {
      // Logo on the left
      try {
        doc.addImage(logoBase64, "PNG", 12, 6, 36, 20);
      } catch {
        // Silently fall back if image fails to render
      }
      // Title & subtitle shifted right to accommodate logo
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(title, 54, 14);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, 54, 23);
    } else {
      // No logo — left-aligned layout
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(title, 14, 16);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, 14, 25);
    }

    // Horizontal divider below header
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(14, 31, pw - 14, 31);
  };

  // ── Helper: format money for PDF ──
  const pdfMoney = (val: number | null | undefined): string => {
    if (val == null) return "—";
    return "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── Specialized: Portfolio Summary PDF ──
  const exportPortfolioPdf = async (data: any[], logoBase64?: string) => {
    const row = data[0];
    if (!row) { toast.error("No portfolio data to export"); return; }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;

    // ── Header Bar ──
    drawPdfHeaderBar(doc, "Portfolio Summary Report", `Review Period: ${row.review_period ?? "All time"} · ${new Date().toLocaleDateString()}`, logoBase64);

    // ── Key Metrics Grid (3 cards per row) ──
    const cardW = (pw - 28 - 12) / 3; // three columns with 6mm gap
    const cardH = 24;
    const gridStartY = 48;
    const gap = 6;

    const metrics = [
      { label: "Total Buyers", value: (row.total_buyers ?? 0).toLocaleString(), color: [59, 130, 246] },
      { label: "Total Invoices", value: (row.total_invoices ?? 0).toLocaleString(), color: [16, 185, 129] },
      { label: "Total Invoice Value", value: pdfMoney(row.total_invoice_value), color: [245, 158, 11] },
      { label: "Total Collections", value: pdfMoney(row.total_collections), color: [139, 92, 246] },
      { label: "Total Outstanding", value: pdfMoney(row.total_outstanding), color: [239, 68, 68] },
      { label: "Closed Invoices", value: (row.closed_invoices ?? 0).toLocaleString(), color: [16, 185, 129] },
      { label: "Open Invoices", value: (row.open_invoices ?? 0).toLocaleString(), color: [245, 158, 11] },
      { label: "Avg Payment Days", value: row.avg_payment_days != null ? `${row.avg_payment_days}d` : "—", color: [59, 130, 246] },
      { label: "Median Payment Days", value: row.median_payment_days != null ? `${row.median_payment_days}d` : "—", color: [139, 92, 246] },
    ];

    metrics.forEach((m, idx) => {
      const col = idx % 3;
      const rowIdx = Math.floor(idx / 3);
      const x = 14 + col * (cardW + gap);
      const y = gridStartY + rowIdx * (cardH + gap);

      // Card background
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");

      // Colored accent bar on left
      doc.setFillColor(m.color[0], m.color[1], m.color[2]);
      doc.rect(x, y, 3, cardH, "F");

      // Label
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(m.label, x + 7, y + 9);

      // Value
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(m.value, x + 7, y + 20);
    });

    // ── Detail Table ──
    const detailStartY = gridStartY + Math.ceil(metrics.length / 3) * (cardH + gap) + 8;

    // Section label
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Portfolio Details", 14, detailStartY);

    // Thin line
    doc.setDrawColor(200, 200, 200);
    doc.line(14, detailStartY + 2, pw - 14, detailStartY + 2);

    const detailCols = [
      { key: "review_period", label: "Review Period", render: (r: any) => r.review_period ?? "" },
      { key: "total_buyers", label: "Buyers", render: (r: any) => (r.total_buyers ?? 0).toLocaleString() },
      { key: "total_invoices", label: "Invoices", render: (r: any) => (r.total_invoices ?? 0).toLocaleString() },
      { key: "total_invoice_value", label: "Invoice Value", render: (r: any) => pdfMoney(r.total_invoice_value) },
      { key: "total_collections", label: "Collections", render: (r: any) => pdfMoney(r.total_collections) },
      { key: "total_outstanding", label: "Outstanding", render: (r: any) => pdfMoney(r.total_outstanding) },
      { key: "closed_invoices", label: "Closed", render: (r: any) => (r.closed_invoices ?? 0).toLocaleString() },
      { key: "open_invoices", label: "Open", render: (r: any) => (r.open_invoices ?? 0).toLocaleString() },
      { key: "avg_payment_days", label: "Avg Days", render: (r: any) => r.avg_payment_days != null ? `${r.avg_payment_days}d` : "—" },
      { key: "median_payment_days", label: "Median Days", render: (r: any) => r.median_payment_days != null ? `${r.median_payment_days}d` : "—" },
    ];

    const autoTableP = (doc as any).autoTable;
    if (typeof autoTableP !== "function") {
      toast.error("PDF export plugin not available");
      return;
    }
    autoTableP.call(doc, {
      startY: detailStartY + 6,
      head: [detailCols.map((c) => c.label)],
      body: data.map((r: any) => detailCols.map((c) => c.render(r))),
      styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: [30, 30, 30] },
      headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, halign: "left" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 20 },
    });

    // Footer with page numbers
    drawPdfFooter(doc);
    doc.save("portfolio-summary-report.pdf");
    toast.success(`Portfolio report downloaded as PDF`);
  };

  // ── Specialized: Aging Report PDF ──
  const exportAgingPdf = async (data: any[], logoBase64?: string) => {
    if (data.length === 0) { toast.error("No aging data to export"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;

    // ── Header Bar ──
    drawPdfHeaderBar(doc, "Aging Report", `Buyer-wise aging analysis as of ${new Date().toLocaleDateString()}`, logoBase64);

    // ── Summary row ──
    const totalOutstanding = data.reduce((s: number, r: any) => s + Number(r.total_outstanding ?? 0), 0);
    const totalCurrent = data.reduce((s: number, r: any) => s + Number(r.current ?? 0), 0);
    const totalOverdue = data.reduce((s: number, r: any) => s + Number(r.bucket_1_30 ?? 0) + Number(r.bucket_31_60 ?? 0) + Number(r.bucket_61_90 ?? 0) + Number(r.bucket_91_120 ?? 0) + Number(r.bucket_over_120 ?? 0), 0);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`Total Buyers: ${data.length}`, 14, 42);
    doc.text(`Total Outstanding: ${pdfMoney(totalOutstanding)}`, 60, 42);
    doc.text(`Total Current: ${pdfMoney(totalCurrent)}`, 140, 42);
    doc.text(`Total Overdue: ${pdfMoney(totalOverdue)}`, 210, 42);

    // Underline summary
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 44, pw - 14, 44);

    // ── Aging Table ──
    const agingCols = [
      { key: "buyer_name", label: "Buyer", render: (r: any) => r.buyer_name ?? "" },
      { key: "current", label: "Current", render: (r: any) => pdfMoney(r.current), align: "right" as const },
      { key: "bucket_1_30", label: "1-30 Days", render: (r: any) => pdfMoney(r.bucket_1_30), align: "right" as const },
      { key: "bucket_31_60", label: "31-60 Days", render: (r: any) => pdfMoney(r.bucket_31_60), align: "right" as const },
      { key: "bucket_61_90", label: "61-90 Days", render: (r: any) => pdfMoney(r.bucket_61_90), align: "right" as const },
      { key: "bucket_91_120", label: "91-120 Days", render: (r: any) => pdfMoney(r.bucket_91_120), align: "right" as const },
      { key: "bucket_over_120", label: "120+ Days", render: (r: any) => pdfMoney(r.bucket_over_120), align: "right" as const, highlight: true },
      { key: "total_outstanding", label: "Total Outstanding", render: (r: any) => pdfMoney(r.total_outstanding), align: "right" as const, bold: true },
    ];

    // Color coding for overdue buckets
    const bucketColor = (key: string): number[] | undefined => {
      if (key === "bucket_31_60") return [254, 243, 199]; // amber light
      if (key === "bucket_61_90") return [254, 226, 226]; // red light
      if (key === "bucket_91_120") return [254, 202, 202]; // red
      if (key === "bucket_over_120") return [252, 165, 165]; // dark red
      return undefined;
    };

    const autoTableA = (doc as any).autoTable;
    if (typeof autoTableA !== "function") {
      toast.error("PDF export plugin not available");
      return;
    }
    autoTableA.call(doc, {
      startY: 48,
      head: [agingCols.map((c) => c.label)],
      body: data.map((r: any) => agingCols.map((c) => c.render(r))),
      styles: {
        fontSize: 8,
        cellPadding: 3,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [30, 30, 30],
      },
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "center",
      },
      columnStyles: {
        0: { halign: "left", cellWidth: 50 },
        1: { halign: "right", cellWidth: 28 },
        2: { halign: "right", cellWidth: 28 },
        3: { halign: "right", cellWidth: 28 },
        4: { halign: "right", cellWidth: 28 },
        5: { halign: "right", cellWidth: 28 },
        6: { halign: "right", cellWidth: 28 },
        7: { halign: "right", cellWidth: 35, fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 20 },
      didParseCell: (tableData: any) => {
        if (tableData.section === "body") {
          const colKey = agingCols[tableData.column.index]?.key;
          if (colKey) {
            const color = bucketColor(colKey);
            if (color) {
              const val = Number(data[tableData.row.index]?.[colKey] ?? 0);
              if (val > 0) {
                tableData.cell.styles.fillColor = color;
              }
            }
          }
        }
      },
      didDrawPage: () => {},
    });

    // ── Total row (footer summary) ──
    const finalY = (doc as any).lastAutoTable?.finalY ?? 50;
    doc.setDrawColor(30, 64, 175);
    doc.setLineWidth(0.5);
    doc.line(14, finalY + 3, pw - 14, finalY + 3);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Total Outstanding: ${pdfMoney(totalOutstanding)}`, 14, finalY + 12);
    doc.text(`Total Buyers: ${data.length}`, pw - 80, finalY + 12);

    drawPdfFooter(doc);
    doc.save("aging-report.pdf");
    toast.success(`Aging report downloaded as PDF \u00b7 ${data.length} buyers`);
  };

  // ── Specialized: Debtors Report PDF (two-table layout) ──
  const exportDebtorsPdf = async (data: any[], logoBase64?: string) => {
    if (data.length === 0) { toast.error("No debtor data to export"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;

    // ── Aggregate stats ──
    const totalDebtors = data.length;
    const totalOutstanding = data.reduce((s: number, r: any) => s + Number(r.outstanding ?? 0), 0);
    const totalInvoiced = data.reduce((s: number, r: any) => s + Number(r.total_invoiced ?? 0), 0);
    const totalPaid = data.reduce((s: number, r: any) => s + Number(r.total_paid ?? 0), 0);
    const totalInvoices = data.reduce((s: number, r: any) => s + Number(r.total_invoices ?? 0), 0);

    // ── Header Bar ──
    drawPdfHeaderBar(doc, "Debtors Report", `Comprehensive debtor analysis as of ${new Date().toLocaleDateString()}`, logoBase64);

    // ── Summary line ──
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`Total Debtors: ${totalDebtors}  ·  Total Invoices: ${totalInvoices.toLocaleString()}  ·  Total Invoiced: ${pdfMoney(totalInvoiced)}  ·  Total Paid: ${pdfMoney(totalPaid)}  ·  Total Outstanding: ${pdfMoney(totalOutstanding)}`, 14, 42);
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 44, pw - 14, 44);

    const autoTableD = (doc as any).autoTable;
    if (typeof autoTableD !== "function") {
      toast.error("PDF export plugin not available");
      return;
    }

    // ── Table 1: Debtor Details (legal name, address, industry, relationship since) ──
    const debtorDetailCols = [
      { key: "name", label: "Debtor Name", render: (r: any) => r.name ?? "", align: "left" as const, width: 45 },
      { key: "legal_entity_name", label: "Legal Entity Name", render: (r: any) => r.legal_entity_name ?? "—", align: "left" as const, width: 50 },
      { key: "registered_address", label: "Registered Address", render: (r: any) => r.registered_address ?? "—", align: "left" as const, width: 70 },
      { key: "industry", label: "Industry", render: (r: any) => r.industry ?? "—", align: "left" as const, width: 35 },
      { key: "relationship_since", label: "Relationship Since", render: (r: any) => r.relationship_since ?? "—", align: "center" as const, width: 28 },
    ];

    autoTableD.call(doc, {
      startY: 48,
      head: [["DEBTOR DETAILS"]],
      body: [],
      styles: {
        fontSize: 8,
        cellPadding: 2,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [30, 64, 175],
        fontStyle: "bold",
      },
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
        halign: "left",
      },
      margin: { left: 14, right: 14, bottom: 20 },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.15,
    });

    const table1End = (doc as any).lastAutoTable.finalY || 50;

    autoTableD.call(doc, {
      startY: table1End + 1,
      head: [debtorDetailCols.map((c) => c.label)],
      body: data.map((r: any) => debtorDetailCols.map((c) => c.render(r))),
      styles: {
        fontSize: 7,
        cellPadding: 2.5,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [30, 30, 30],
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
      },
      columnStyles: Object.fromEntries(
        debtorDetailCols.map((c, i) => [i, { halign: c.align, cellWidth: c.width }])
      ),
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 20 },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.15,
    });

    const table1FinalY = (doc as any).lastAutoTable.finalY || 50;

    // ── Table 2: Invoice Summary per Debtor ──
    const invoiceSummaryCols = [
      { key: "name", label: "Debtor Name", render: (r: any) => r.name ?? "", align: "left" as const, width: 42 },
      { key: "total_invoices", label: "Invoices", render: (r: any) => (r.total_invoices ?? 0).toLocaleString(), align: "right" as const, width: 18 },
      { key: "total_invoiced", label: "Invoiced Amount", render: (r: any) => pdfMoney(r.total_invoiced), align: "right" as const, width: 24 },
      { key: "open", label: "Open Invoices", render: (r: any) => (r.open ?? 0).toLocaleString(), align: "right" as const, width: 20 },
      { key: "closed", label: "Closed Invoices", render: (r: any) => (r.closed ?? 0).toLocaleString(), align: "right" as const, width: 20 },
      { key: "total_paid", label: "Total Collection", render: (r: any) => pdfMoney(r.total_paid), align: "right" as const, width: 24 },
      { key: "outstanding", label: "Total Outstanding", render: (r: any) => pdfMoney(r.outstanding), align: "right" as const, width: 24 },
      { key: "oldest_outstanding_invoice_date", label: "Oldest Outstanding Inv.", render: (r: any) => r.oldest_outstanding_invoice_date ?? "—", align: "center" as const, width: 26 },
      { key: "latest_invoice_date", label: "Latest Invoice", render: (r: any) => r.latest_invoice_date ?? "—", align: "center" as const, width: 22 },
      { key: "avg_days", label: "Avg Pay Days", render: (r: any) => r.avg_days != null ? `${r.avg_days}d` : "—", align: "center" as const, width: 18 },
      { key: "median_days", label: "Avg Median Days", render: (r: any) => r.median_days != null ? `${r.median_days}d` : "—", align: "center" as const, width: 20 },
    ];

    autoTableD.call(doc, {
      startY: table1FinalY + 8,
      head: [["INVOICE SUMMARY"]],
      body: [],
      styles: {
        fontSize: 8,
        cellPadding: 2,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [30, 64, 175],
        fontStyle: "bold",
      },
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
        halign: "left",
      },
      margin: { left: 14, right: 14, bottom: 20 },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.15,
    });

    const sectionHeadEnd = (doc as any).lastAutoTable.finalY || table1FinalY + 8;

    autoTableD.call(doc, {
      startY: sectionHeadEnd + 1,
      head: [invoiceSummaryCols.map((c) => c.label)],
      body: data.map((r: any) => invoiceSummaryCols.map((c) => c.render(r))),
      styles: {
        fontSize: 7,
        cellPadding: 2.5,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [30, 30, 30],
      },
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
      },
      columnStyles: Object.fromEntries(
        invoiceSummaryCols.map((c, i) => [i, { halign: c.align, cellWidth: c.width }])
      ),
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 20 },
      showFoot: "lastPage",
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.15,
      // Totals footer
      foot: [[
        "TOTALS",
        data.reduce((s: number, r: any) => s + Number(r.total_invoices ?? 0), 0).toLocaleString(),
        pdfMoney(data.reduce((s: number, r: any) => s + Number(r.total_invoiced ?? 0), 0)),
        data.reduce((s: number, r: any) => s + Number(r.open ?? 0), 0).toLocaleString(),
        data.reduce((s: number, r: any) => s + Number(r.closed ?? 0), 0).toLocaleString(),
        pdfMoney(data.reduce((s: number, r: any) => s + Number(r.total_paid ?? 0), 0)),
        pdfMoney(data.reduce((s: number, r: any) => s + Number(r.outstanding ?? 0), 0)),
        "—",
        "—",
        "—",
        "—",
      ]],
      footStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center",
      },
      didDrawPage: () => {},
    });

    drawPdfFooter(doc);
    doc.save("debtors-report.pdf");
    toast.success(`Debtors report downloaded as PDF \u00b7 ${data.length} debtors`);
  };

  // ── High-quality PDF Export (handles all report types) ──
  const exportPdf = async () => {
    try {
      if (isPnL) {
        if (!pnlData) { toast.error("No data to export"); return; }
        const rows = buildPnlRows();
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        // Professional header with logo
        const logoPnl = await getLogoBase64().catch(() => undefined);
        drawPdfHeaderBar(doc, "Profit & Loss Statement", `Period: ${fmtDate(pnlData.from)} — ${fmtDate(pnlData.to)} · Generated: ${new Date().toLocaleString()}`, logoPnl);

        const autoTable = (doc as any).autoTable;
        if (typeof autoTable !== "function") {
          toast.error("PDF export plugin not available");
          return;
        }

        const body = rows.map((r) => {
          const labelStr = r.depth > 0 ? "    ".repeat(r.depth) + r.label : r.label;
          return [labelStr, r.value];
        });

        autoTable.call(doc, {
          startY: 40,
          head: [],
          body,
          styles: {
            fontSize: 8,
            cellPadding: 2,
            lineColor: [220, 220, 220],
            lineWidth: 0.05,
            textColor: [30, 30, 30],
          },
          columnStyles: {
            0: { cellWidth: 130, halign: "left" },
            1: { cellWidth: 40, halign: "right" },
          },
          theme: "plain",
          margin: { top: 40, bottom: 20 },
          didParseCell: (data: any) => {
            if (data.section === "body") {
              const row = rows[data.row.index];
              if (row) {
                if (row.accent) {
                  data.cell.styles.fillColor = [240, 242, 255];
                  data.cell.styles.fontStyle = "bold";
                  data.cell.styles.fontSize = 9;
                } else if (row.doubleLine) {
                  data.cell.styles.fontStyle = "bold";
                } else if (row.bold) {
                  data.cell.styles.fontStyle = "bold";
                }
              }
            }
          },
          didDrawPage: (tableData: any) => {
            const pageCount = (doc as any).internal.getNumberOfPages();
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(
              `Page ${tableData.pageNumber} of ${pageCount}`,
              doc.internal.pageSize.width / 2,
              doc.internal.pageSize.height - 10,
              { align: "center" },
            );
          },
        });

        doc.save("profit-and-loss.pdf");
        toast.success("P&L statement exported to PDF");
        return;
      }

      const allData = await fetchExportData();
      if (allData.length === 0) {
        toast.error("No data to export");
        return;
      }

      // ── Specialized PDF exports for portfolio, aging, and debtors ──
      const logoBase64 = await getLogoBase64().catch(() => undefined);

      if (tab === "portfolio") {
        await exportPortfolioPdf(allData, logoBase64);
        return;
      }
      if (tab === "aging") {
        await exportAgingPdf(allData, logoBase64);
        return;
      }
      if (tab === "debtors") {
        await exportDebtorsPdf(allData, logoBase64);
        return;
      }

      // ── Generic tabular PDF export for all other tabs ──
      const cols = visibleColumnsList.length > 0 ? visibleColumnsList : columns;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // Professional header
      const reportLabel = TABS.find((t) => t.id === tab)?.label ?? "Report";
      drawPdfHeaderBar(doc, reportLabel, `Generated: ${new Date().toLocaleString()} · ${allData.length} records`, logoBase64);

      const autoTable = (doc as any).autoTable;
      if (typeof autoTable !== "function") {
        toast.error("PDF export plugin not available");
        return;
      }

      autoTable.call(doc, {
        startY: 40,
        head: [cols.map((c) => c.label)],
        body: allData.map((row: any) => cols.map((c) => c.render(row))),
        styles: {
          fontSize: 7,
          cellPadding: 1.5,
          lineColor: [200, 200, 200],
          lineWidth: 0.1,
          textColor: [30, 30, 30],
        },
        headStyles: {
          fillColor: [30, 64, 175],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "left",
        },
        alternateRowStyles: {
          fillColor: [245, 247, 250],
        },
        margin: { top: 40, bottom: 20 },
        didDrawPage: () => {},
      });

      drawPdfFooter(doc);
      doc.save(`${tab}-report.pdf`);
      toast.success(`PDF file downloaded \u00b7 ${allData.length} records`);
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to export PDF");
    }
  };

  const currentTab = TABS.find((t) => t.id === tab)!;
  const visibleCount = Object.values(visibleColumns).filter(Boolean).length;
  const totalCount = columns.length;
  const statuses = STATUS_FILTERS[tab];

  return (
    <div>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        description="View and export detailed reports for all business activities"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportExcel}
              disabled={isPnL ? !pnlData : filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button
              onClick={exportPdf}
              disabled={isPnL ? !pnlData : filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="border-b border-border px-6 md:px-10">
        <div className="flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setStatusFilter("all"); setSearchQuery(""); setBuyerId(""); setFromDate(undefined); setToDate(undefined); setFilterBulkPay(false); setFilterTreasuryPay(false); }}
              className={`whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-widest transition-colors border-b-2 ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3 md:px-10">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {isPnL ? (
          /* ── P&L Period presets + Year/Quarter/Month dropdowns ── */
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Quick presets */}
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPeriodPreset(p.id);
                  setSelectedYear(null);
                  setSelectedQuarter(null);
                  setSelectedMonth(null);
                  const dates = getPeriodDates(p.id);
                  if (dates) {
                    setFromDate(dates.from);
                    setToDate(dates.to);
                  }
                }}
                className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                  periodPreset === p.id
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {p.label}
              </button>
            ))}

            {/* Year dropdown */}
            <select
              value={selectedYear ?? ""}
              onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Year</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  FY {y}
                </option>
              ))}
            </select>

            {/* Quarter dropdown */}
            <select
              value={selectedQuarter ?? ""}
              onChange={(e) => setSelectedQuarter(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Quarter</option>
              {QUARTER_OPTIONS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>

            {/* Month dropdown */}
            <select
              value={selectedMonth ?? ""}
              onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Month</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {statuses.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {statuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                      statusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Buyer filter — only for sales-invoices */}
            {(tab === "sales-invoices") && (
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <select
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary cursor-pointer max-w-[200px]"
                >
                  <option value="">All buyers</option>
                  {debtors.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Payment type filter — only for sales-invoices */}
            {(tab === "sales-invoices") && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">Pay:</span>
                <button
                  onClick={() => setFilterBulkPay((p) => !p)}
                  className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                    filterBulkPay
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Bulk Pay
                </button>
                <button
                  onClick={() => setFilterTreasuryPay((p) => !p)}
                  className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                    filterTreasuryPay
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Treasury Pay
                </button>
              </div>
            )}
          </>
        )}

        {/* Date range filter (shown for P&L custom and other tabs) */}
        {(isPnL && periodPreset === "custom") || !isPnL ? (
          <div className="flex items-center gap-1.5">
            <Popover open={fromOpen} onOpenChange={setFromOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    fromDate
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {fromDate ? formatDateForInput(fromDate) : "From"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={(date) => {
                    setFromDate(date);
                    if (date) setPeriodPreset("custom");
                    setFromOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <span className="text-[10px] text-muted-foreground">—</span>
            <Popover open={toOpen} onOpenChange={setToOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    toDate
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {toDate ? formatDateForInput(toDate) : "To"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={(date) => {
                    setToDate(date);
                    if (date) setPeriodPreset("custom");
                    setToOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {hasDateFilter && (
              <button
                onClick={() => {
                  setFromDate(undefined);
                  setToDate(undefined);
                  setSelectedYear(null);
                  setSelectedQuarter(null);
                  setSelectedMonth(null);
                  setPeriodPreset("this-month");
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                title="Clear date filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : null}

        {/* Column visibility picker — hidden for P&L */}
        {!isPnL && (
          <div className="relative" ref={columnMenuRef}>
            <button
              onClick={() => setColumnMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <Columns className="h-3 w-3" />
              Columns ({visibleCount}/{totalCount})
            </button>
            {columnMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-card shadow-lg">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Toggle columns</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const all: Record<string, boolean> = {};
                        columns.forEach((c) => (all[c.key] = true));
                        setVisibleColumns(all);
                      }}
                      className="text-[10px] uppercase tracking-widest text-primary hover:text-primary/80 px-1.5 py-0.5"
                    >
                      All
                    </button>
                    <button
                      onClick={() => {
                        const none: Record<string, boolean> = {};
                        columns.forEach((c) => (none[c.key] = false));
                        setVisibleColumns(none);
                      }}
                      className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground px-1.5 py-0.5"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {columns.map((col) => {
                    const checked = visibleColumns[col.key] !== false;
                    return (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setVisibleColumns((prev) => ({ ...prev, [col.key]: !checked }))
                          }
                          className="rounded border-border text-primary focus:ring-primary/30 h-3.5 w-3.5"
                        />
                        <span className={checked ? "text-foreground" : "text-muted-foreground"}>
                          {col.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search — hidden for P&L */}
        {!isPnL && (
          <div className="ml-auto">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs w-48 focus:outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Data */}
      <div className="p-6 md:p-10 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isPnL ? (
          pnlData ? (
            <PnLStatement data={pnlData} />
          ) : (
            <div className="flex flex-col items-center py-20 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">No data available</p>
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No records found</p>
          </div>
        ) : (
          <>
            <Card title={`${currentTab.label} (${filtered.length})`}>
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {visibleColumnsList.map((col) => (
                        <th key={col.key} className="px-4 py-3 text-left font-medium uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, i) => (
                      <tr key={row.id ?? i} className="border-b border-border/60 hover:bg-accent/30 transition-colors">
                        {visibleColumnsList.map((col) => (
                          <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                            <span className={col.key === "amount" || col.key === "credit_limit" || col.key === "proforma_funded_amount" || col.key === "outstanding_amount" ? "num font-medium" : ""}>
                              {col.render(row)}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pagination for sales-invoices, purchase-invoices, aging */}
            {isPaginated && totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  {totalItems.toLocaleString()} total records · Page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Previous
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 7) {
                        pageNum = i + 1;
                      } else if (page <= 4) {
                        pageNum = i + 1;
                      } else if (page >= totalPages - 3) {
                        pageNum = totalPages - 6 + i;
                      } else {
                        pageNum = page - 3 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`min-w-[2rem] rounded-md border px-2 py-1.5 text-xs transition ${
                            pageNum === page
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── P&L Statement Component ──

/** Format money for P&L (negative values in parentheses) */
function fmtPnlMoney(val: number): string {
  const abs = Math.abs(val);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return val < 0 ? `(${formatted})` : `${formatted}`;
}

/** A single row in the P&L statement */
function PnlRow({ label, value, isTotal = false, isSubtotal = false, indent = false }: { label: string; value: number; isTotal?: boolean; isSubtotal?: boolean; indent?: boolean }) {
  const cls = isTotal
    ? "border-t-2 border-b-2 border-foreground/20 font-bold text-foreground"
    : isSubtotal
      ? "border-t border-foreground/10 font-semibold text-foreground"
      : indent
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <tr className={cls}>
      <td className={`px-4 py-2.5 text-sm ${indent ? "pl-8" : ""}`}>{label}</td>
      <td className={`px-4 py-2.5 text-sm text-right num font-mono ${isTotal || isSubtotal ? "font-semibold" : ""}`}>
        {fmtPnlMoney(value)}
      </td>
    </tr>
  );
}

function PnLStatement({ data }: { data: PnLReport }) {
  const { from, to } = data;
  const adminEntries = Object.entries(data.adminCostByCategory).sort(([a], [b]) => a.localeCompare(b));
  const taxEntries = Object.entries(data.taxByCategory).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card title={`Profit & Loss Statement`}>
      <div className="px-2 py-1">
        <div className="mb-4 text-xs text-muted-foreground">
          Period: {fmtDate(from)} — {fmtDate(to)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {/* ── TURNOVER ── */}
              <tr className="border-b border-border/40">
                <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-primary" colSpan={2}>
                  Turnover
                </td>
              </tr>
              <PnlRow label="Gross Sales" value={data.grossSales} indent />
              <PnlRow label="Other Sales Income" value={data.otherSalesIncome} indent />
              <PnlRow label="Sales Returns / Adjustments" value={-data.salesReturns} indent />
              <PnlRow label="Total Turnover" value={data.totalTurnover} isTotal />

              {/* ── COST OF SALES ── */}
              <tr className="border-b border-border/40">
                <td className="px-4 py-3 pt-6 text-xs font-bold uppercase tracking-wider text-primary" colSpan={2}>
                  Cost of Sales
                </td>
              </tr>
              <PnlRow label="Gross Purchases" value={data.grossPurchases} indent />
              <PnlRow label="Logistics &amp; Procurement Cost" value={data.logisticsAndProcurement} indent />
              <PnlRow label="Principal Cost" value={data.principalCost} indent />
              <PnlRow label="Referral Fees" value={data.referralFees} indent />
              <PnlRow label="Customs / Duties" value={data.customsDuties} indent />
              <PnlRow label="Freight Charges" value={data.freightCharges} indent />
              <PnlRow label="Other Direct Costs" value={data.otherDirectCosts} indent />
              <PnlRow label="Total Cost of Sales" value={data.totalCostOfSales} isTotal />

              {/* ── GROSS PROFIT ── */}
              <PnlRow label="Gross Profit" value={data.grossProfit} isTotal />

              {/* ── ADMINISTRATIVE COSTS ── */}
              <tr className="border-b border-border/40">
                <td className="px-4 py-3 pt-6 text-xs font-bold uppercase tracking-wider text-primary" colSpan={2}>
                  Administrative Costs
                </td>
              </tr>
              {adminEntries.length === 0 ? (
                <PnlRow label="No administrative expenses recorded" value={0} indent />
              ) : (
                adminEntries.map(([cat, amount]) => (
                  <PnlRow key={cat} label={ADMIN_CAT_LABELS[cat] ?? cat} value={amount} indent />
                ))
              )}
              <PnlRow label="Total Administrative Costs" value={data.totalAdminCosts} isTotal />

              {/* ── OPERATING PROFIT ── */}
              <PnlRow label="Operating Profit" value={data.operatingProfit} isTotal />

              {/* ── PROFIT BEFORE TAX ── */}
              <PnlRow label="Profit on Ordinary Activities Before Taxation" value={data.profitBeforeTax} isTotal />

              {/* ── TAXATION ── */}
              <tr className="border-b border-border/40">
                <td className="px-4 py-3 pt-6 text-xs font-bold uppercase tracking-wider text-primary" colSpan={2}>
                  Taxation
                </td>
              </tr>
              {taxEntries.length === 0 ? (
                <PnlRow label="No tax entries recorded" value={0} indent />
              ) : (
                taxEntries.map(([cat, amount]) => (
                  <PnlRow key={cat} label={cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} value={amount} indent />
                ))
              )}
              <PnlRow label="Total Taxation" value={data.totalTaxation} isTotal />

              {/* ── PROFIT AFTER TAX ── */}
              <PnlRow label="Profit After Taxation" value={data.profitAfterTax} isTotal />
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
