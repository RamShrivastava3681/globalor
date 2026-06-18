import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { FileText, FileSpreadsheet, Loader2, Filter } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// ── Types ──

type ReportTab = "proformas" | "sales-invoices" | "purchase-invoices" | "aging" | "debtors" | "suppliers" | "advances" | "expenses";

const TABS: { id: ReportTab; label: string }[] = [
  { id: "proformas", label: "Proforma invoices" },
  { id: "sales-invoices", label: "Sales invoices" },
  { id: "purchase-invoices", label: "Purchase invoices" },
  { id: "aging", label: "Aging report" },
  { id: "debtors", label: "Debtors" },
  { id: "suppliers", label: "Suppliers" },
  { id: "advances", label: "Advances" },
  { id: "expenses", label: "Expenses" },
];

// ── Status filter options ──
// "open" = pending/approved/advanced/overdue, "closed" = paid/rejected for invoice types
const STATUS_FILTERS: Record<ReportTab, string[]> = {
  "proformas": ["all", "open", "closed", "proforma", "invoiced", "cancelled"],
  "sales-invoices": ["all", "open", "closed", "pending", "approved", "advanced", "paid", "overdue", "rejected", "funded"],
  "purchase-invoices": ["all", "open", "closed", "pending", "approved", "paid", "overdue", "disputed", "advanced", "funded"],
  "aging": ["all", "overdue", "pending"],
  "debtors": ["all"],
  "suppliers": ["all"],
  "advances": ["all", "open", "applied", "refunded"],
  "expenses": ["all"],
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
    case "sales-invoices":
      return [
        ...common,
        { key: "invoice_number", label: "Invoice #", render: (r: any) => r.invoice_number ?? "" },
        { key: "debtor_name", label: "Debtor", render: (r: any) => r.debtor?.name ?? "" },
        { key: "client_name", label: "Client", render: (r: any) => r.client?.company_name ?? "" },
        { key: "amount", label: "Amount", render: (r: any) => fmtMoney(r.amount) },
        { key: "advance_rate", label: "Advance Rate", render: (r: any) => `${r.advance_rate ?? 0}%` },
        { key: "fee_rate", label: "Fee Rate", render: (r: any) => `${r.fee_rate ?? 0}%` },
        { key: "issue_date", label: "Issue Date", render: (r: any) => fmtDate(r.issue_date) },
        { key: "due_date", label: "Due Date", render: (r: any) => fmtDate(r.due_date) },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
        { key: "paid_date", label: "Paid Date", render: (r: any) => fmtDate(r.paid_date) },
        { key: "amount_received", label: "Amount Received", render: (r: any) => r.amount_received ? fmtMoney(r.amount_received) : "—" },
        { key: "short_payment", label: "Short Payment", render: (r: any) => r.short_payment ? fmtMoney(r.short_payment) : "—" },
        { key: "late_days", label: "Late Days", render: (r: any) => r.late_days?.toString() ?? "—" },
        { key: "noa_status", label: "NOA Status", render: (r: any) => r.noa_status ?? "" },
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
        { key: "due_date", label: "Due Date", render: (r: any) => fmtDate(r.due_date) },
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
        { key: "proforma_funded_amount", label: "Funded Amount", render: (r: any) => r.proforma_funded_amount ? fmtMoney(r.proforma_funded_amount) : "—" },
        { key: "proforma_funded_at", label: "Funded At", render: (r: any) => fmtDate(r.proforma_funded_at) },
        { key: "proforma_funding_reference", label: "Funding Ref", render: (r: any) => r.proforma_funding_reference ?? "—" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "aging":
      return [
        { key: "invoice_number", label: "Invoice #", render: (r: any) => r.invoice_number ?? "" },
        { key: "debtor_name", label: "Debtor", render: (r: any) => r.debtor_name ?? "" },
        { key: "amount", label: "Total", render: (r: any) => fmtMoney(r.amount) },
        { key: "due_date", label: "Due Date", render: (r: any) => fmtDate(r.due_date) },
        { key: "bucket_1_30", label: "1-30 days", render: (r: any) => r.aging_bucket === "1–30 days" ? fmtMoney(r.amount) : "—" },
        { key: "bucket_31_60", label: "31-60 days", render: (r: any) => r.aging_bucket === "31–60 days" ? fmtMoney(r.amount) : "—" },
        { key: "bucket_61_90", label: "61-90 days", render: (r: any) => r.aging_bucket === "61–90 days" ? fmtMoney(r.amount) : "—" },
        { key: "bucket_90_plus", label: "90+ days", render: (r: any) => r.aging_bucket === "90+ days" ? fmtMoney(r.amount) : "—" },
        { key: "aging_days", label: "Days", render: (r: any) => r.is_overdue ? `${r.aging_days}d` : r.days_remaining > 0 ? `${r.days_remaining}d left` : "—" },
        { key: "status", label: "Status", render: (r: any) => r.status ?? "" },
      ];
    case "debtors":
      return [
        { key: "name", label: "Name", render: (r: any) => r.name ?? "" },
        { key: "industry", label: "Industry", render: (r: any) => r.industry ?? "—" },
        { key: "credit_limit", label: "Credit Limit", render: (r: any) => fmtMoney(r.credit_limit) },
        { key: "risk_score", label: "Risk Score", render: (r: any) => r.risk_score?.toString() ?? "—" },
        { key: "contact_name", label: "Contact", render: (r: any) => r.contact_name ?? "—" },
        { key: "contact_email", label: "Email", render: (r: any) => r.contact_email ?? "—" },
        { key: "contact_phone", label: "Phone", render: (r: any) => r.contact_phone ?? "—" },
        { key: "city", label: "City", render: (r: any) => r.city ?? "—" },
        { key: "country", label: "Country", render: (r: any) => r.country ?? "—" },
        { key: "payment_terms_days", label: "Terms (Days)", render: (r: any) => r.payment_terms_days?.toString() ?? "—" },
        { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => fmtDate(r.created_at) },
      ];
    case "suppliers":
      return [
        { key: "company_name", label: "Company", render: (r: any) => r.company_name ?? "" },
        { key: "industry", label: "Industry", render: (r: any) => r.industry ?? "—" },
        { key: "advance_rate", label: "Advance Rate", render: (r: any) => `${(r.advance_rate * 100).toFixed(1)}%` },
        { key: "fee_rate", label: "Fee Rate", render: (r: any) => `${(r.fee_rate * 100).toFixed(1)}%` },
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
    default:
      return common;
  }
}

// ── Report Component ──

function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("sales-invoices");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

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
    // Status filter
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
    // Text search
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
      const columns = getColumns(tab);
      const wsData = [
        columns.map((c) => c.label),
        ...filtered.map((row) => columns.map((c) => c.render(row))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      // Set column widths
      ws["!cols"] = columns.map(() => ({ wch: 20 }));
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
      const columns = getColumns(tab);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // Header
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(TABS.find((t) => t.id === tab)?.label ?? "Report", 14, 20);

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
      doc.text(`Total records: ${filtered.length}`, 14, 34);

      // Table with autoTable plugin for crisp rendering
      (doc as any).autoTable({
        startY: 40,
        head: [columns.map((c) => c.label)],
        body: filtered.map((row) => columns.map((c) => c.render(row))),
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
          // Footer
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
  const columns = getColumns(tab);
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
                    {columns.map((col) => (
                      <th key={col.key} className="px-4 py-3 text-left font-medium uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={row.id ?? i} className="border-b border-border/60 hover:bg-accent/30 transition-colors">
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                          <span className={col.key === "amount" || col.key === "credit_limit" || col.key === "proforma_funded_amount" ? "num font-medium" : ""}>
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
