import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api } from "@/lib/api-client";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  FileText, FileSpreadsheet, Loader2, Filter, Columns, CalendarDays, X, Building2, Scale,
  TrendingUp, Briefcase, Clock, Users, Wallet, Boxes, Banknote, FileSignature, ShoppingCart,
  ArrowLeft, LayoutGrid
} from "lucide-react";
import { BalanceSheetView } from "@/components/balance-sheet";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  type ReportTab, type PnLReport, type PeriodPreset,
  REPORT_CATEGORIES, TABS, STATUS_FILTERS,
  getOpenStatuses, getClosedStatuses, getColumns,
  initColumnVisibility, toISODateString, getPeriodDates,
  PERIOD_PRESETS, YEAR_OPTIONS, QUARTER_OPTIONS, MONTH_OPTIONS,
  ADMIN_CAT_LABELS, fmtPnlMoney
} from "@/lib/reports-utils";
import { getLogoBase64, drawPdfFooter, drawPdfHeaderBar, pdfMoney } from "@/lib/pdf-helpers";

export const Route = createFileRoute("/app/reports/$tab")({
  component: ReportViewPage,
});

const PAGINATED_TABS: ReportTab[] = ["sales-invoices", "purchase-invoices", "aging"];

function ReportViewPage() {
  const navigate = useNavigate();
  const { tab } = Route.useParams();
  const tabId = tab as ReportTab;

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 50;

  const [buyerId, setBuyerId] = useState("");
  const [filterBulkPay, setFilterBulkPay] = useState(false);
  const [filterTreasuryPay, setFilterTreasuryPay] = useState(false);

  const { data: debtors = [] } = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const isBalanceSheet = tabId === "balance-sheet";
  const isPnL = tabId === "profit-loss";
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this-month");
  const [pnlData, setPnlData] = useState<PnLReport | null>(null);

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    api.get<any>("/profiles/me").then((d) => {
      if (d?.company_name) setCompanyName(d.company_name);
    }).catch(() => {});
  }, []);

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const columns = getColumns(tabId);
  const visibleColumnsList = columns.filter((c) => visibleColumns[c.key] !== false);

  useEffect(() => {
    setVisibleColumns(initColumnVisibility(columns));
    setColumnMenuOpen(false);
  }, [tabId]);

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

  const isPaginated = PAGINATED_TABS.includes(tabId);
  const hasDateFilter = !!fromDate || !!toDate;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isBalanceSheet) {
        setData([]);
        setLoading(false);
        return;
      } else if (isPnL) {
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
        const activePaymentTypes: string[] = [];
        if (filterBulkPay) activePaymentTypes.push("bulk_pay");
        if (filterTreasuryPay) activePaymentTypes.push("treasury_pay");
        if (activePaymentTypes.length > 0) {
          params.set("payment_type", activePaymentTypes.join(","));
        }
        if (fromDate) params.set("from", toISODateString(fromDate));
        if (toDate) params.set("to", toISODateString(toDate));
        const qs = params.toString();
        const url = qs ? `/reports/${tabId}?${qs}` : `/reports/${tabId}`;
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
  }, [tabId, page, isPaginated, searchQuery, statusFilter, fromDate, toDate, periodPreset, isPnL, isBalanceSheet, buyerId, filterBulkPay, filterTreasuryPay]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Year/quarter/month changes
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

  useEffect(() => {
    setPage(1);
  }, [tabId, statusFilter, searchQuery, fromDate, toDate, buyerId, filterBulkPay, filterTreasuryPay]);

  useEffect(() => {
    setSelectedYear(null);
    setSelectedQuarter(null);
    setSelectedMonth(null);
  }, [tabId]);

  const filtered = isPaginated
    ? data
    : data.filter((row) => {
        if (statusFilter !== "all") {
          const rowStatus = (row.status ?? row.proforma_status ?? "").toLowerCase();
          if (statusFilter === "open") {
            if (!getOpenStatuses(tabId).includes(rowStatus)) return false;
          } else if (statusFilter === "closed") {
            if (!getClosedStatuses(tabId).includes(rowStatus)) return false;
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

  const reportMeta = REPORT_CATEGORIES.flatMap(c => c.reports).find(r => r.id === tabId);

  // ── Fetch all data for export ──
  async function fetchExportData() {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (buyerId) params.set("buyer_id", buyerId);
    const exportPaymentTypes: string[] = [];
    if (filterBulkPay) exportPaymentTypes.push("bulk_pay");
    if (filterTreasuryPay) exportPaymentTypes.push("treasury_pay");
    if (exportPaymentTypes.length > 0) {
      params.set("payment_type", exportPaymentTypes.join(","));
    }
    if (fromDate) params.set("from", toISODateString(fromDate));
    if (toDate) params.set("to", toISODateString(toDate));
    const qs = params.toString();
    const url = qs ? `/reports/${tabId}?${qs}` : `/reports/${tabId}`;
    const result = await api.get<any>(url);
    const allData = Array.isArray(result) ? result : (result?.data ?? result ?? []);
    return allData.filter((row: any) => {
      if (statusFilter !== "all") {
        const rowStatus = (row.status ?? row.proforma_status ?? "").toLowerCase();
        if (rowStatus !== "") {
          if (statusFilter === "open") {
            if (!getOpenStatuses(tabId).includes(rowStatus)) return false;
          } else if (statusFilter === "closed") {
            if (!getClosedStatuses(tabId).includes(rowStatus)) return false;
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
  }

  function buildPnlRows() {
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

    push("TURNOVER", 0, { accent: true });
    push("Gross Sales", d.grossSales, { depth: 1 });
    push("Other Sales Income", d.otherSalesIncome, { depth: 1 });
    push("Sales Returns / Adjustments", -d.salesReturns, { depth: 1 });
    push("Total Turnover", d.totalTurnover, { bold: true, doubleLine: true });

    push("COST OF SALES", 0, { accent: true });
    push("Gross Purchases", d.grossPurchases, { depth: 1 });
    push("Logistics & Procurement Cost", d.logisticsAndProcurement, { depth: 1 });
    push("Principal Cost", d.principalCost, { depth: 1 });
    push("Referral Fees", d.referralFees, { depth: 1 });
    push("Customs / Duties", d.customsDuties, { depth: 1 });
    push("Freight Charges", d.freightCharges, { depth: 1 });
    push("Other Direct Costs", d.otherDirectCosts, { depth: 1 });
    push("Total Cost of Sales", d.totalCostOfSales, { bold: true, doubleLine: true });

    push("Gross Profit", d.grossProfit, { bold: true, doubleLine: true });

    push("ADMINISTRATIVE COSTS", 0, { accent: true });
    if (adminEntries.length === 0) {
      push("No administrative expenses recorded", 0, { depth: 1 });
    } else {
      for (const [cat, amount] of adminEntries) {
        push(ADMIN_CAT_LABELS[cat] ?? cat, amount, { depth: 1 });
      }
    }
    push("Total Administrative Costs", d.totalAdminCosts, { bold: true, doubleLine: true });

    push("Operating Profit", d.operatingProfit, { bold: true, doubleLine: true });
    push("Profit on Ordinary Activities Before Taxation", d.profitBeforeTax, { bold: true, doubleLine: true });

    push("TAXATION", 0, { accent: true });
    if (taxEntries.length === 0) {
      push("No tax entries recorded", 0, { depth: 1 });
    } else {
      for (const [cat, amount] of taxEntries) {
        push(cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), amount, { depth: 1 });
      }
    }
    push("Total Taxation", d.totalTaxation, { bold: true, doubleLine: true });

    push("Profit After Taxation", d.profitAfterTax, { bold: true, doubleLine: true });

    return rows;
  }

  // ── Excel Export ──
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
      const reportLabel = TABS.find((t) => t.id === tabId)?.label ?? "Report";
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
      XLSX.utils.book_append_sheet(wb, ws, TABS.find((t) => t.id === tabId)?.label ?? tabId);
      XLSX.writeFile(wb, `${tabId}-report.xlsx`);
      toast.success(`Excel file downloaded \u00b7 ${allData.length} records`);
    } catch (err) {
      toast.error("Failed to export Excel");
    }
  };

  // ── Logo loader for PDFs (uses module-level cache from pdf-helpers) ──
  const loadLogoBase64 = getLogoBase64;

  // ── Portfolio PDF export ──
  const exportPortfolioPdf = async (data: any[], logo?: string) => {
    const row = data[0];
    if (!row) { toast.error("No portfolio data to export"); return; }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;

    drawPdfHeaderBar(doc, "Portfolio Summary Report", `Review Period: ${row.review_period ?? "All time"} \u00b7 ${new Date().toLocaleDateString()}`, logo);

    const cardW = (pw - 28 - 12) / 3;
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
      { label: "Avg Payment Days", value: row.avg_payment_days != null ? `${row.avg_payment_days}d` : "\u2014", color: [59, 130, 246] },
      { label: "Median Payment Days", value: row.median_payment_days != null ? `${row.median_payment_days}d` : "\u2014", color: [139, 92, 246] },
    ];

    metrics.forEach((m, idx) => {
      const col = idx % 3;
      const r = Math.floor(idx / 3);
      const x = 14 + col * (cardW + gap);
      const y = gridStartY + r * (cardH + gap);

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");
      doc.setFillColor(m.color[0], m.color[1], m.color[2]);
      doc.rect(x, y, 3, cardH, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(m.label, x + 7, y + 9);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(m.value, x + 7, y + 18);
    });

    // Summary table
    const tableRowCount = Math.ceil(metrics.length / 3);
    const tableY = gridStartY + tableRowCount * (cardH + gap) + 8;
    const summaryData = [
      ["Metric", "Value"],
      ["Total Buyers", (row.total_buyers ?? 0).toLocaleString()],
      ["Total Invoices", (row.total_invoices ?? 0).toLocaleString()],
      ["Total Invoice Value", pdfMoney(row.total_invoice_value)],
      ["Total Collections", pdfMoney(row.total_collections)],
      ["Total Outstanding", pdfMoney(row.total_outstanding)],
      ["Closed Invoices", (row.closed_invoices ?? 0).toLocaleString()],
      ["Open Invoices", (row.open_invoices ?? 0).toLocaleString()],
    ];
    (doc as any).autoTable({
      startY: tableY,
      head: [summaryData[0]],
      body: summaryData.slice(1),
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });

    drawPdfFooter(doc);
    doc.save("portfolio-summary.pdf");
    toast.success("Portfolio summary exported to PDF");
  };

  // ── General PDF export ──
  const exportPdf = async () => {
    try {
      if (isPnL) {
        if (!pnlData) { toast.error("No data to export"); return; }
        const rows = buildPnlRows();
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pw = doc.internal.pageSize.width;
        const logo = await loadLogoBase64().catch(() => undefined);
        const periodText = `Period: ${fmtDate(pnlData.from)} \u2014 ${fmtDate(pnlData.to)}`;
        drawPdfHeaderBar(doc, "Profit & Loss Statement", periodText, logo);

        const tableBody = rows.map((r, i) => [
          r.label,
          r.value,
        ]);

        (doc as any).autoTable({
          startY: 38,
          head: [["Line Item", "Amount (USD)"]],
          body: tableBody,
          theme: "grid",
          headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 14, right: 14 },
          didParseCell: (data: any) => {
            if (data.row.index >= 0 && rows[data.row.index]) {
              const r = rows[data.row.index];
              if (r.bold) {
                data.cell.styles.fontStyle = "bold";
              }
              if (r.accent) {
                data.cell.styles.fillColor = [238, 242, 255];
                data.cell.styles.fontStyle = "bold";
              }
              if (r.doubleLine) {
                data.cell.styles.lineColor = [59, 130, 246];
              }
              data.cell.styles.cellPadding = { top: r.depth > 0 ? 1.5 : 3, bottom: r.depth > 0 ? 1.5 : 3, left: 14 + r.depth * 8, right: 5 };
            }
          },
        });

        drawPdfFooter(doc);
        doc.save("profit-and-loss.pdf");
        toast.success("P&L statement exported to PDF");
        return;
      }

      const allData = await fetchExportData();
      if (allData.length === 0) { toast.error("No data to export"); return; }
      const cols = visibleColumnsList.length > 0 ? visibleColumnsList : columns;
      const reportLabel = TABS.find((t) => t.id === tabId)?.label ?? tabId;
      const logo = await loadLogoBase64().catch(() => undefined);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const periodText = (fromDate || toDate)
        ? `Period: ${fromDate ? fmtDate(toISODateString(fromDate)) : "..."} \u2014 ${toDate ? fmtDate(toISODateString(toDate)) : "..."}`
        : `Generated: ${new Date().toLocaleDateString()}`;

      drawPdfHeaderBar(doc, reportLabel, periodText, logo);

      const tableBody = allData.map((row: any) =>
        cols.map((c) => {
          const val = c.render(row);
          return val.length > 40 ? val.substring(0, 40) + "..." : val;
        })
      );

      (doc as any).autoTable({
        startY: 38,
        head: [cols.map((c) => c.label)],
        body: tableBody,
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6 },
        bodyStyles: { fontSize: 6 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 10, right: 10 },
        styles: { cellPadding: 1.5 },
      });

      drawPdfFooter(doc);
      doc.save(`${tabId}-report.pdf`);
      toast.success(`PDF exported \u00b7 ${allData.length} records`);
    } catch (err) {
      toast.error("Failed to export PDF");
    }
  };

  // ── Status filter tabs for the header ──
  const statuses = STATUS_FILTERS[tabId] ?? ["all"];

  const ReportIcon = reportMeta?.icon ?? FileText;

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link
            to="/app/reports"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Reports
          </Link>
        }
        title={
          <div className="flex items-center gap-3">
            {reportMeta && (
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${reportMeta.iconBg}`}>
                <ReportIcon className={`h-5 w-5 ${reportMeta.iconColor}`} />
              </div>
            )}
            <span>{reportMeta?.label ?? "Report"}</span>
          </div>
        }
        description={`Detailed ${reportMeta?.label.toLowerCase() ?? "report"} data with export options`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportExcel}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </button>
            {!isBalanceSheet && !isPnL && (
              <button
                onClick={exportPdf}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                PDF
              </button>
            )}
          </div>
        }
      />

      {/* Quick Tab Navigation */}
      <div className="border-b border-border bg-card px-4 md:px-6 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {REPORT_CATEGORIES.flatMap(cat => cat.reports).map((t) => {
            const Icon = t.icon;
            const isActive = t.id === tabId;
            return (
              <Link
                key={t.id}
                to="/app/reports/$tab"
                params={{ tab: t.id }}
                className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? "border-[#00B8FF] text-[#00B8FF]"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Filters & Controls */}
      {!isBalanceSheet && (
        <div className="border-b border-border bg-card/50 px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter */}
            {statuses.length > 1 && (
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                {statuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-all ${
                      statusFilter === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                    }`}
                  >
                    {s === "all" ? "All" : s}
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            {!isPnL && (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-44 rounded-md border border-border bg-background px-2.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            )}

            {/* Buyer Filter (Sales Invoices / Aging) */}
            {(tabId === "sales-invoices" || tabId === "aging") && (
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="">All buyers</option>
                  {debtors.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Payment Type Filter (Sales Invoices only) */}
            {tabId === "sales-invoices" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pay type:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={filterBulkPay} onChange={(e) => setFilterBulkPay(e.target.checked)} className="h-3 w-3 rounded border-border accent-primary" />
                  <span className="text-[10px] text-muted-foreground">Bulk</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={filterTreasuryPay} onChange={(e) => setFilterTreasuryPay(e.target.checked)} className="h-3 w-3 rounded border-border accent-primary" />
                  <span className="text-[10px] text-muted-foreground">Treasury</span>
                </label>
              </div>
            )}

            {/* Date Range */}
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <Popover open={fromOpen} onOpenChange={setFromOpen}>
                <PopoverTrigger asChild>
                  <button className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground hover:bg-muted transition-colors">
                    {fromDate ? fmtDate(toISODateString(fromDate)) : "From"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={(d) => { setFromDate(d); setFromOpen(false); }} initialFocus />
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">—</span>
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger asChild>
                  <button className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground hover:bg-muted transition-colors">
                    {toDate ? fmtDate(toISODateString(toDate)) : "To"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={(d) => { setToDate(d); setToOpen(false); }} initialFocus />
                </PopoverContent>
              </Popover>
              {hasDateFilter && (
                <button onClick={() => { setFromDate(undefined); setToDate(undefined); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* P&L Period Presets */}
            {isPnL && (
              <div className="flex items-center gap-1.5">
                {PERIOD_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriodPreset(p.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-all ${
                      periodPreset === p.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* P&L Financial Year / Quarter / Month dropdowns */}
            {isPnL && (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedYear ?? ""}
                  onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Year</option>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <select
                  value={selectedQuarter ?? ""}
                  onChange={(e) => setSelectedQuarter(e.target.value ? Number(e.target.value) : null)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Quarter</option>
                  {QUARTER_OPTIONS.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
                <select
                  value={selectedMonth ?? ""}
                  onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Month</option>
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Column picker */}
            {columns.length > 0 && !isPnL && !isBalanceSheet && (
              <div className="relative" ref={columnMenuRef}>
                <button
                  onClick={() => setColumnMenuOpen(!columnMenuOpen)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                >
                  <Columns className="h-3.5 w-3.5" />
                  Columns
                </button>
                {columnMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-card shadow-lg p-2">
                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      {columns.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visibleColumns[c.key] !== false}
                            onChange={() => setVisibleColumns({ ...visibleColumns, [c.key]: !(visibleColumns[c.key] !== false) })}
                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Report Content */}
      <div className="p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isBalanceSheet ? (
          <BalanceSheetView />
        ) : isPnL ? (
          <PnLReportView pnlData={pnlData} companyName={companyName} />
        ) : tabId === "portfolio" ? (
          <PortfolioView data={data} exportPortfolioPdf={exportPortfolioPdf} />
        ) : tabId === "inventory-tracking" ? (
          <InventoryTrackingView data={filtered} columns={visibleColumnsList} loading={loading} />
        ) : (
          <TableView
            data={filtered}
            columns={visibleColumnsList}
            tabId={tabId}
            loading={loading}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            isPaginated={isPaginated}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════

function PnLReportView({ pnlData, companyName }: { pnlData: PnLReport | null; companyName: string }) {
  if (!pnlData) {
    return (
      <Card title="Profit & Loss Statement">
        <div className="py-12 text-center text-sm text-muted-foreground">
          <TrendingUp className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>Select a period above and wait for data to load.</p>
        </div>
      </Card>
    );
  }

  const d = pnlData;
  const adminEntries = Object.entries(d.adminCostByCategory).sort(([a], [b]) => a.localeCompare(b));
  const taxEntries = Object.entries(d.taxByCategory).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card
      title={
        <div>
          <div className="font-display font-semibold">Profit & Loss Statement</div>
          <div className="text-xs font-normal text-muted-foreground mt-0.5">
            {companyName} · {fmtDate(d.from)} — {fmtDate(d.to)}
          </div>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {/* Turnover Section */}
            <tr><td colSpan={2} className="py-3 pl-4 text-xs font-bold uppercase tracking-widest text-blue-600 bg-blue-50/50 dark:text-blue-400 dark:bg-blue-950/30 rounded-t-lg">Turnover</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Gross Sales</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.grossSales)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Other Sales Income</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.otherSalesIncome)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Sales Returns / Adjustments</td><td className="py-1.5 pr-6 text-right num text-rose-600">{fmtPnlMoney(-d.salesReturns)}</td></tr>
            <tr className="border-t-2 border-blue-200"><td className="py-2 pl-10 font-bold">Total Turnover</td><td className="py-2 pr-6 text-right num font-bold">{fmtPnlMoney(d.totalTurnover)}</td></tr>

            {/* Cost of Sales Section */}
            <tr><td colSpan={2} className="py-3 pl-4 text-xs font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50/50 dark:text-emerald-400 dark:bg-emerald-950/30">Cost of Sales</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Gross Purchases</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.grossPurchases)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Logistics & Procurement</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.logisticsAndProcurement)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Principal Cost</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.principalCost)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Referral Fees</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.referralFees)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Customs / Duties</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.customsDuties)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Freight Charges</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.freightCharges)}</td></tr>
            <tr><td className="py-1.5 pl-10 text-muted-foreground">Other Direct Costs</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(d.otherDirectCosts)}</td></tr>
            <tr className="border-t-2 border-emerald-200"><td className="py-2 pl-10 font-bold">Total Cost of Sales</td><td className="py-2 pr-6 text-right num font-bold">{fmtPnlMoney(d.totalCostOfSales)}</td></tr>

            {/* Gross Profit */}
            <tr className="border-t-2 border-border"><td className="py-3 pl-4 text-base font-bold">Gross Profit</td><td className="py-3 pr-6 text-right num text-base font-bold">{fmtPnlMoney(d.grossProfit)}</td></tr>

            {/* Admin Costs */}
            <tr><td colSpan={2} className="py-3 pl-4 text-xs font-bold uppercase tracking-widest text-amber-600 bg-amber-50/50 dark:text-amber-400 dark:bg-amber-950/30">Administrative Costs</td></tr>
            {adminEntries.length === 0 ? (
              <tr><td className="py-2 pl-10 text-muted-foreground italic" colSpan={2}>No administrative expenses recorded</td></tr>
            ) : (
              adminEntries.map(([cat, amount]) => (
                <tr key={cat}><td className="py-1.5 pl-10 text-muted-foreground">{ADMIN_CAT_LABELS[cat] ?? cat}</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(amount)}</td></tr>
              ))
            )}
            <tr className="border-t-2 border-amber-200"><td className="py-2 pl-10 font-bold">Total Administrative Costs</td><td className="py-2 pr-6 text-right num font-bold">{fmtPnlMoney(d.totalAdminCosts)}</td></tr>

            {/* Operating Profit */}
            <tr className="border-t-2 border-border"><td className="py-3 pl-4 text-base font-bold">Operating Profit</td><td className="py-3 pr-6 text-right num text-base font-bold">{fmtPnlMoney(d.operatingProfit)}</td></tr>

            {/* Profit Before Tax */}
            <tr className="border-t border-border"><td className="py-3 pl-4 text-base font-bold">Profit Before Taxation</td><td className="py-3 pr-6 text-right num text-base font-bold">{fmtPnlMoney(d.profitBeforeTax)}</td></tr>

            {/* Taxation */}
            <tr><td colSpan={2} className="py-3 pl-4 text-xs font-bold uppercase tracking-widest text-rose-600 bg-rose-50/50 dark:text-rose-400 dark:bg-rose-950/30">Taxation</td></tr>
            {taxEntries.length === 0 ? (
              <tr><td className="py-2 pl-10 text-muted-foreground italic" colSpan={2}>No tax entries recorded</td></tr>
            ) : (
              taxEntries.map(([cat, amount]) => (
                <tr key={cat}><td className="py-1.5 pl-10 text-muted-foreground">{cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</td><td className="py-1.5 pr-6 text-right num">{fmtPnlMoney(amount)}</td></tr>
              ))
            )}
            <tr className="border-t-2 border-rose-200"><td className="py-2 pl-10 font-bold">Total Taxation</td><td className="py-2 pr-6 text-right num font-bold">{fmtPnlMoney(d.totalTaxation)}</td></tr>

            {/* Net Profit */}
            <tr className="border-t-2 border-border"><td className="py-4 pl-4 text-lg font-bold text-primary">Profit After Taxation</td><td className="py-4 pr-6 text-right num text-lg font-bold text-primary">{fmtPnlMoney(d.profitAfterTax)}</td></tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PortfolioView({ data, exportPortfolioPdf }: { data: any[]; exportPortfolioPdf: (data: any[], logo?: string) => Promise<void> }) {
  const [logoLoaded, setLogoLoaded] = useState<string | undefined>(undefined);

  useEffect(() => {
    getLogoBase64().then(setLogoLoaded).catch(() => {});
  }, []);

  const row = data[0];
  if (!row) {
    return (
      <Card title="Portfolio Summary">
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Briefcase className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>No portfolio data available.</p>
        </div>
      </Card>
    );
  }

  const metrics = [
    { label: "Total Buyers", value: (row.total_buyers ?? 0).toLocaleString() },
    { label: "Total Invoices", value: (row.total_invoices ?? 0).toLocaleString() },
    { label: "Total Invoice Value", value: fmtMoney(row.total_invoice_value ?? 0) },
    { label: "Total Collections", value: fmtMoney(row.total_collections ?? 0) },
    { label: "Total Outstanding", value: fmtMoney(row.total_outstanding ?? 0) },
    { label: "Closed Invoices", value: (row.closed_invoices ?? 0).toLocaleString() },
    { label: "Open Invoices", value: (row.open_invoices ?? 0).toLocaleString() },
    { label: "Avg Payment Days", value: row.avg_payment_days != null ? `${row.avg_payment_days}d` : "—" },
    { label: "Median Payment Days", value: row.median_payment_days != null ? `${row.median_payment_days}d` : "—" },
  ];

  return (
    <Card
      title={
        <div className="flex items-center justify-between w-full">
          <div>
            <div className="font-display font-semibold">Portfolio Summary</div>
            <div className="text-xs font-normal text-muted-foreground mt-0.5">
              Review Period: {row.review_period ?? "All time"}
            </div>
          </div>
          <button
            onClick={() => exportPortfolioPdf(data, logoLoaded)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{m.label}</div>
            <div className="mt-1 text-xl font-bold tracking-tight">{m.value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function InventoryTrackingView({ data, columns, loading }: { data: any[]; columns: { key: string; label: string; render: (row: any) => string }[]; loading: boolean }) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    if (!sortField) return data;
    return [...data].sort((a: any, b: any) => {
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      const cmp = typeof aVal === "number" ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortField, sortDir]);

  const totalClosingQty = data.reduce((s: number, r: any) => s + Number(r.closing_quantity ?? 0), 0);
  const totalExtendedPrice = data.reduce((s: number, r: any) => s + Number(r.extended_price ?? 0), 0);
  const totalExtendedCost = data.reduce((s: number, r: any) => s + Number(r.extended_cost ?? 0), 0);
  const grossMargin = totalExtendedPrice - totalExtendedCost;
  const marginPct = totalExtendedPrice > 0 ? (grossMargin / totalExtendedPrice) * 100 : 0;

  return (
    <Card
      title={
        <div className="flex items-center gap-6">
          <span>Inventory Tracking</span>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Total Qty: <strong className="text-foreground">{totalClosingQty.toLocaleString()}</strong></span>
            <span>Total Value: <strong className="text-foreground">{fmtMoney(totalExtendedPrice)}</strong></span>
            <span>Gross Margin: <strong className={grossMargin >= 0 ? "text-emerald-600" : "text-rose-600"}>{fmtMoney(grossMargin)} ({marginPct.toFixed(1)}%)</strong></span>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Boxes className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>No inventory data available.</p>
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="px-6 py-3 text-left font-normal cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => {
                      if (sortField === c.key) {
                        setSortDir(sortDir === "asc" ? "desc" : "asc");
                      } else {
                        setSortField(c.key);
                        setSortDir("asc");
                      }
                    }}
                  >
                    {c.label}
                    {sortField === c.key && (
                      <span className="ml-1 text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row: any, idx: number) => (
                <tr key={row.id ?? idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  {columns.map((c) => (
                    <td key={c.key} className="px-6 py-2.5">{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TableView({
  data, columns, tabId, loading, page, totalPages, totalItems, isPaginated, onPageChange,
}: {
  data: any[];
  columns: { key: string; label: string; render: (row: any) => string }[];
  tabId: ReportTab;
  loading: boolean;
  page: number;
  totalPages: number;
  totalItems: number;
  isPaginated: boolean;
  onPageChange: (p: number) => void;
}) {
  return (
    <Card
      title={
        <div className="flex items-center gap-3">
          <span>{TABS.find((t) => t.id === tabId)?.label ?? "Report"}</span>
          {totalItems > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {totalItems.toLocaleString()} records
            </span>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p>No data found for this report.</p>
        </div>
      ) : (
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                {columns.map((c) => (
                  <th key={c.key} className="px-6 py-3 text-left font-normal whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row: any, idx: number) => (
                <tr key={row.id ?? idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  {columns.map((c) => (
                    <td key={c.key} className="px-6 py-2.5 whitespace-nowrap">{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {isPaginated && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-6 py-3">
              <div className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {totalItems.toLocaleString()} total records
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => onPageChange(p)}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        p === page
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
