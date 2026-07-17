import { fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";

// ── Types ──

export type ReportTab = "portfolio" | "proformas" | "sales-invoices" | "purchase-invoices" | "aging" | "debtors" | "suppliers" | "advances" | "expenses" | "profit-loss" | "inventory-tracking" | "balance-sheet";

export interface ReportMeta {
  id: ReportTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: string;
  bgLight: string;
  iconBg: string;
  iconColor: string;
}

export interface ReportCategory {
  name: string;
  reports: ReportMeta[];
}

// ── Report Categories ──

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    name: "Financial Reports",
    reports: [
      { id: "balance-sheet" as ReportTab, label: "Balance Sheet", icon: Scale, description: "Snapshot of assets, liabilities, and equity", color: "from-blue-500 to-blue-600", bgLight: "bg-blue-50", iconBg: "bg-blue-100", iconColor: "text-blue-600" },
      { id: "profit-loss" as ReportTab, label: "Profit & Loss", icon: TrendingUp, description: "Revenue, costs, and profitability analysis", color: "from-emerald-500 to-emerald-600", bgLight: "bg-emerald-50", iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
      { id: "portfolio" as ReportTab, label: "Portfolio Summary", icon: Briefcase, description: "Overview of your entire portfolio performance", color: "from-violet-500 to-violet-600", bgLight: "bg-violet-50", iconBg: "bg-violet-100", iconColor: "text-violet-600" },
    ],
  },
  {
    name: "Invoice Reports",
    reports: [
      { id: "sales-invoices" as ReportTab, label: "Sales Invoices", icon: FileText, description: "Detailed view of all sales invoices", color: "from-amber-500 to-amber-600", bgLight: "bg-amber-50", iconBg: "bg-amber-100", iconColor: "text-amber-600" },
      { id: "purchase-invoices" as ReportTab, label: "Purchase Invoices", icon: ShoppingCart, description: "Track all purchase invoices", color: "from-rose-500 to-rose-600", bgLight: "bg-rose-50", iconBg: "bg-rose-100", iconColor: "text-rose-600" },
      { id: "proformas" as ReportTab, label: "Proforma Invoices", icon: FileSignature, description: "View proforma invoice details", color: "from-orange-500 to-orange-600", bgLight: "bg-orange-50", iconBg: "bg-orange-100", iconColor: "text-orange-600" },
    ],
  },
  {
    name: "Customer Reports",
    reports: [
      { id: "aging" as ReportTab, label: "Aging Report", icon: Clock, description: "Receivables aging analysis by buyer", color: "from-cyan-500 to-cyan-600", bgLight: "bg-cyan-50", iconBg: "bg-cyan-100", iconColor: "text-cyan-600" },
      { id: "debtors" as ReportTab, label: "Debtors", icon: Users, description: "Detailed debtor information and history", color: "from-sky-500 to-sky-600", bgLight: "bg-sky-50", iconBg: "bg-sky-100", iconColor: "text-sky-600" },
      { id: "suppliers" as ReportTab, label: "Suppliers", icon: Building2, description: "Supplier details and payment terms", color: "from-teal-500 to-teal-600", bgLight: "bg-teal-50", iconBg: "bg-teal-100", iconColor: "text-teal-600" },
    ],
  },
  {
    name: "Other Reports",
    reports: [
      { id: "advances" as ReportTab, label: "Advances", icon: Banknote, description: "Track all advances made", color: "from-purple-500 to-purple-600", bgLight: "bg-purple-50", iconBg: "bg-purple-100", iconColor: "text-purple-600" },
      { id: "expenses" as ReportTab, label: "Expenses", icon: Wallet, description: "Categorized expense tracking", color: "from-pink-500 to-pink-600", bgLight: "bg-pink-50", iconBg: "bg-pink-100", iconColor: "text-pink-600" },
      { id: "inventory-tracking" as ReportTab, label: "Inventory Tracking", icon: Boxes, description: "Stock levels and valuation", color: "from-indigo-500 to-indigo-600", bgLight: "bg-indigo-50", iconBg: "bg-indigo-100", iconColor: "text-indigo-600" },
    ],
  },
];

export const TABS: { id: ReportTab; label: string }[] = REPORT_CATEGORIES.flatMap(cat => cat.reports);

// ── Status filter options ──

export const STATUS_FILTERS: Record<ReportTab, string[]> = {
  "balance-sheet": ["all"],
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

export function getOpenStatuses(tab: ReportTab): string[] {
  if (tab === "balance-sheet" || tab === "profit-loss" || tab === "portfolio" || tab === "inventory-tracking") return [];
  if (tab === "sales-invoices" || tab === "purchase-invoices") return ["pending", "approved", "advanced", "overdue", "disputed"];
  return ["pending", "approved", "advanced", "overdue", "funded", "proforma"];
}

export function getClosedStatuses(tab: ReportTab): string[] {
  if (tab === "balance-sheet" || tab === "profit-loss" || tab === "portfolio" || tab === "inventory-tracking") return [];
  if (tab === "sales-invoices" || tab === "purchase-invoices") return ["funded", "paid"];
  return ["paid", "rejected", "cancelled", "disputed"];
}

// ── Column definitions for each report ──

export function getColumns(tab: ReportTab): { key: string; label: string; render: (row: any) => string }[] {
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
    case "balance-sheet":
      return [];
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

export function initColumnVisibility(columns: { key: string; label: string }[]): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  columns.forEach((c) => (vis[c.key] = true));
  return vis;
}

// ── Date helpers ──

export function formatDateForInput(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function toISODateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── P&L Period presets ──

export type PeriodPreset = "this-month" | "prev-month" | "this-quarter" | "custom";

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "prev-month", label: "Previous Month" },
  { id: "this-quarter", label: "This Quarter" },
];

// ── Financial year / quarter / month options ──

export const YEAR_OPTIONS = (() => {
  const cy = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => cy - 6 + i);
})();

export const QUARTER_OPTIONS = [
  { value: 1, label: "Q1" },
  { value: 2, label: "Q2" },
  { value: 3, label: "Q3" },
  { value: 4, label: "Q4" },
];

export const MONTH_OPTIONS = [
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

export function getPeriodDates(preset: PeriodPreset): { from: Date; to: Date } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

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
      return null;
  }
}

// ── P&L report type ──

export interface PnLReport {
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

export const ADMIN_CAT_LABELS: Record<string, string> = {
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

// ── P&L money formatter ──

export function fmtPnlMoney(val: number): string {
  const sign = val < 0 ? "-" : "";
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Lucide icons (re-exported for convenience) ──

import {
  Scale, TrendingUp, Briefcase, FileText, ShoppingCart, FileSignature,
  Clock, Users, Building2, Banknote, Wallet, Boxes,
} from "lucide-react";
