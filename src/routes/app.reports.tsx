import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { FileText, FileSpreadsheet, Loader2, Filter, Columns } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// ── Types ──

type ReportTab = "portfolio" | "proformas" | "sales-invoices" | "purchase-invoices" | "aging" | "debtors" | "suppliers" | "advances" | "expenses" | "inventory-tracking";

const TABS: { id: ReportTab; label: string }[] = [
  { id: "portfolio", label: "Portfolio Summary" },
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
// "open" = pending/approved/advanced/overdue, "closed" = paid/rejected for invoice types
const STATUS_FILTERS: Record<ReportTab, string[]> = {
  "portfolio": ["all"],
  "proformas": ["all", "open", "closed", "proforma", "invoiced", "cancelled"],
  "sales-invoices": ["all", "open", "closed", "pending", "approved", "advanced", "paid", "overdue", "rejected", "funded"],
  "purchase-invoices": ["all", "open", "closed", "pending", "approved", "paid", "overdue", "disputed", "advanced", "funded"],
  "aging": ["all", "overdue", "pending"],
  "debtors": ["all"],
  "suppliers": ["all"],
  "advances": ["all", "open", "applied", "refunded"],
  "expenses": ["all"],
  "inventory-tracking": ["all"],
};

// ── Open (non-closed) statuses for invoice-type reports ──
const OPEN_STATUSES = ["pending", "approved", "advanced", "overdue", "funded", "proforma"];
const CLOSED_STATUSES = ["paid", "rejected", "cancelled", "disputed"];

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
        { key: "noa_status", label: "NOA Status", render: (r: any) => r.noa_status ?? "" },
        { key: "payment_type", label: "Payment Type", render: (r: any) => {
            const pt = r.payment_type ?? "manual_pay";
            return pt === "mass_upload" ? "Mass Upload" : pt === "bulk_pay" ? "Bulk Pay" : "Manual Pay";
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
        { key: "name", label: "Debtor Name", render: (r: any) => r.name ?? "" },
        { key: "legal_entity_name", label: "Legal Entity Name", render: (r: any) => r.legal_entity_name ?? "—" },
        { key: "registration_no", label: "Registration No.", render: (r: any) => r.registration_no ?? "—" },
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
    case "tracking-inventory":
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

// ── Report Component ──

function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("sales-invoices");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any[]>(`/reports/${tab}`);
      setData(result ?? []);
    } catch (err) {
      toast.error("Failed to load report data");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter data
  const filtered = data.filter((row) => {
    if (statusFilter !== "all") {
      const rowStatus = (row.status ?? row.proforma_status ?? "").toLowerCase();
      if (statusFilter === "open") {
        if (!OPEN_STATUSES.includes(rowStatus)) return false;
      } else if (statusFilter === "closed") {
        if (!CLOSED_STATUSES.includes(rowStatus)) return false;
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

  // ── Excel Export ──
  const exportExcel = () => {
    try {
      const cols = visibleColumnsList.length > 0 ? visibleColumnsList : columns;
      const wsData = [
        cols.map((c) => c.label),
        ...filtered.map((row) => cols.map((c) => c.render(row))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = cols.map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, TABS.find((t) => t.id === tab)?.label ?? tab);
      XLSX.writeFile(wb, `${tab}-report.xlsx`);
      toast.success("Excel file downloaded");
    } catch (err) {
      toast.error("Failed to export Excel");
    }
  };

  // ── High-quality PDF Export ──
  const exportPdf = () => {
    try {
      const cols = visibleColumnsList.length > 0 ? visibleColumnsList : columns;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(TABS.find((t) => t.id === tab)?.label ?? "Report", 14, 20);

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
      doc.text(`Total records: ${filtered.length}`, 14, 34);

      (doc as any).autoTable({
        startY: 40,
        head: [cols.map((c) => c.label)],
        body: filtered.map((row) => cols.map((c) => c.render(row))),
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
        didDrawPage: (data: any) => {
          const pageCount = (doc as any).internal.getNumberOfPages();
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(
            `Page ${data.pageNumber} of ${pageCount}`,
            doc.internal.pageSize.width / 2,
            doc.internal.pageSize.height - 10,
            { align: "center" },
          );
        },
      });

      doc.save(`${tab}-report.pdf`);
      toast.success("PDF file downloaded");
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
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button
              onClick={exportPdf}
              disabled={filtered.length === 0}
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
              onClick={() => { setTab(t.id); setStatusFilter("all"); setSearchQuery(""); }}
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
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
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

        {/* Column visibility picker */}
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

        <div className="ml-auto">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs w-48 focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Data */}
      <div className="p-6 md:p-10">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No records found</p>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
