import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { AnimatedMoney } from "@/components/animated-number";
import { Plus, X, Loader2, Link2, Trash2, Save, Eye, FileText, Building2, Package, Download, User, ArrowUpDown, Upload, DollarSign, Printer, AlertTriangle, LayoutDashboard, PenLine, List, BarChart3, AlertCircle, Clock, Lock } from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { getLogoBase64, drawPdfHeaderBar, drawPdfFooter, pdfMoney, pdfDate, pdfSectionHeading } from "@/lib/pdf-helpers";
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/app/purchases")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || "dashboard",
    view: (search.view as string) || undefined,
  }),
  component: PurchasesPage,
});

function PurchasesPage() {
  const { view, tab } = Route.useSearch();
  const navigate = useNavigate();
  const { user, isAdmin, isChecker, isClient, isTreasury, isOperations, canWrite } = useAuth();
  const canCreate = canWrite("purchase-invoices");
  const canEdit = canWrite("purchase-invoices");
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sortField, setSortField] = useState<"created" | "issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const limit = 50;

  const [duplicateCheckOpen, setDuplicateCheckOpen] = useState(false);

  // All purchase invoices query for dashboard stats
  const allPiQ = useQuery({
    queryKey: ["purchase_invoices", "all"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices")) ?? [],
  });
  const allPi = allPiQ.data ?? [];

  // Dashboard stats
  const dashboardStats = useMemo(() => {
    const inv = allPi;
    const total = inv.length;
    const totalAmount = inv.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const draft = inv.filter((p: any) => p.status === "draft");
    const draftAmount = draft.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const submitted = inv.filter((p: any) => p.status === "submitted");
    const submittedAmount = submitted.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const inFunding = inv.filter((p: any) => ["approved", "advanced", "funded"].includes(p.status));
    const fundingAmount = inFunding.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const paid = inv.filter((p: any) => p.status === "paid");
    const paidAmount = paid.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const overdue = inv.filter((p: any) => p.status === "overdue");
    const overdueAmount = overdue.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const disputed = inv.filter((p: any) => p.status === "disputed");
    const disputedAmount = disputed.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const suppliersUsed = new Set(inv.map((p: any) => p.vendor_id).filter(Boolean)).size;
    const openPayables = inv.filter((p: any) => !["paid", "disputed"].includes(p.status));
    const openPayablesAmount = openPayables.reduce((s: number, p: any) => s + Number(p.amount), 0);
    return {
      total, totalAmount,
      draftCount: draft.length, draftAmount,
      submittedCount: submitted.length, submittedAmount,
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draftAmount + submittedAmount,
      fundingCount: inFunding.length, fundingAmount,
      paidCount: paid.length, paidAmount,
      overdueCount: overdue.length, overdueAmount,
      disputedCount: disputed.length, disputedAmount,
      suppliersUsed,
      openPayablesCount: openPayables.length, openPayablesAmount,
    };
  }, [allPi]);

  const setTab = (t: string) => navigate({ to: "/app/purchases", search: { tab: t, view: undefined }, replace: true });

  const tabs = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "create", label: "Create Invoice", icon: PenLine },
    { key: "list", label: "All Invoices", icon: List },
  ];

  const piQ = useQuery({
    queryKey: ["purchase_invoices", searchQuery, issueDateFrom, issueDateTo, createdFrom, createdTo, page, limit, sortField, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (issueDateFrom) params.set("issueDateFrom", issueDateFrom);
      if (issueDateTo) params.set("issueDateTo", issueDateTo);
      if (createdFrom) params.set("createdFrom", createdFrom);
      if (createdTo) params.set("createdTo", createdTo);
      params.set("page", String(page));
      params.set("limit", String(limit));
      params.set("sortField", sortField);
      params.set("sort", sortOrder);
      return (await api.get<any>(`/purchase-invoices?${params.toString()}`)) ?? { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  });

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
  });

  const salesQ = useQuery({
    queryKey: ["invoices-by-pi"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
  });

  const miniInvoicesQ = useQuery({
    queryKey: ["invoices-mini-for-link"],
    queryFn: async () => (await api.get<any[]>("/invoices/mini")) ?? [],
  });

  const stockMovementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const viewedInventory = useMemo(() => {
    if (!viewing) return [];
    return (stockMovementsQ.data ?? []).filter((m: any) => m.purchase_invoice_id === viewing.id);
  }, [viewing, stockMovementsQ.data]);

  const linkedSales = (piId: string) => (salesQ.data ?? []).filter((s: any) => s.purchase_invoice_id === piId);

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, filter, issueDateFrom, issueDateTo, createdFrom, createdTo, sortField, sortOrder]);

  // Auto-open detail modal when navigating from a linked invoice
  useEffect(() => {
    if (view && piQ.data) {
      const data = Array.isArray(piQ.data) ? piQ.data : (piQ.data?.data ?? []);
      const found = data.find((p: any) => p.id === view);
      if (found) {
        setViewing(found);
        navigate({ to: "/app/purchases", search: { view: undefined }, replace: true });
      }
    }
  }, [view, piQ.data]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchase-invoices/${id}`);
    },
    onSuccess: () => {
      toast.success("Purchase invoice removed");
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Handle both paginated { data, total } and legacy array responses
  const invoiceData = Array.isArray(piQ.data) ? piQ.data : (piQ.data?.data ?? []);
  const totalItems = !Array.isArray(piQ.data) ? piQ.data?.total ?? 0 : invoiceData.length;
  const totalPages = !Array.isArray(piQ.data) ? piQ.data?.totalPages ?? 1 : 1;

  const closedStatuses = ["paid", "funded", "rejected", "disputed"];
  const filtered = invoiceData.filter((p: any) => {
    if (filter !== "all") {
      if (filter === "closed") {
        if (!closedStatuses.includes(p.status)) return false;
      } else if (p.status !== filter) return false;
    }
    return true;
  });

  const totals = invoiceData.reduce(
    (a: any, p: any) => {
      a.all += Number(p.amount);
      if (p.status !== "paid") a.open += Number(p.amount);
      return a;
    },
    { all: 0, open: 0 },
  );

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase invoices"
        description={
          tab === "dashboard"
            ? "Overview of all your purchase invoices at a glance."
            : tab === "create"
            ? "Create a new purchase invoice to submit for review."
            : "View, review, and manage all your purchase invoices."
        }
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> New purchase invoice
              </button>
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Upload className="h-4 w-4" /> Mass import
              </button>
              <button onClick={() => setDuplicateCheckOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-warning/50 px-4 py-2 text-sm font-medium text-warning hover:bg-warning/5">
                <AlertTriangle className="h-4 w-4" /> Check duplicates
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      {/* Tab Navigation */}
      <div className="border-b border-border bg-white px-6 md:px-10">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "dashboard" && <DashboardView stats={dashboardStats} invoices={allPi} />}
      {tab === "create" && <CreatePurchaseView />}
      {tab === "list" && (
        <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Total purchases"><div className="num num-lg"><AnimatedMoney value={totals.all} /></div></Card>
          <Card title="Open payables"><div className="num num-lg text-warning"><AnimatedMoney value={totals.open} /></div></Card>
          <Card title="Suppliers used"><div className="num text-3xl">{new Set(invoiceData.map((p: any) => p.vendor_id)).size}</div></Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", "approved", "closed"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "approved" ? "Open (Approved)" : "Closed"}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Issue from</label>
            <input type="date" value={issueDateFrom}
              onChange={(e) => setIssueDateFrom(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">to</label>
            <input type="date" value={issueDateTo}
              onChange={(e) => setIssueDateTo(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          {(issueDateFrom || issueDateTo) && (
            <button onClick={() => { setIssueDateFrom(""); setIssueDateTo(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear dates
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Created from</label>
            <input type="date" value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">to</label>
            <input type="date" value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          {(createdFrom || createdTo) && (
            <button onClick={() => { setCreatedFrom(""); setCreatedTo(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear dates
            </button>
          )}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search purchases by invoice number, supplier name, PO, status..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
          <div className="flex gap-1">
            {(["created", "issue", "due"] as const).map((field) => (
              <button
                key={field}
                onClick={() => {
                  if (sortField === field) {
                    setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                  } else {
                    setSortField(field);
                    setSortOrder("asc");
                  }
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                  sortField === field
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <ArrowUpDown className="h-3 w-3" />
                {field === "created" ? "Created date" : field === "issue" ? "Issue date" : "ERP Due date"}
                {sortField === field && (
                  <span className="text-[10px]">{sortOrder === "asc" ? "↑" : "↓"}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Card>
          {piQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No purchase invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice Number</th>
                    <th className="px-5 py-2 text-left font-normal">Client</th>
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Issue date</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">ERP Due Date</th>
                    <th className="px-5 py-2 text-left font-normal">Contractual Payment Terms</th>
                    <th className="px-5 py-2 text-left font-normal">Paid date</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">Linked sales</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p: any) => {
                    const dpd = p.due_date && p.status !== "paid" ? daysBetween(p.due_date) : 0;
                    let lateDays = Math.max(0, dpd);
                    if (p.status === "paid" && p.due_date && p.paid_date) {
                      const ms = new Date(p.paid_date).getTime() - new Date(p.due_date).getTime();
                      lateDays = Math.max(0, Math.round(ms / 86400000));
                    }
                    const links = linkedSales(p.id);
                    return (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={p.id}>#{p.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3 font-mono text-xs">{p.invoice_number}</td>
                        <td className="px-5 py-3 text-muted-foreground">{p.client?.company_name || p.client?.contact_name || "—"}</td>
                        <td className="px-5 py-3">{p.vendor?.name ?? "—"}</td>
                        <td className="px-5 py-3">
                          {p.po_number ? (
                            <div>
                              <div className="font-mono text-xs">{p.po_number}</div>
                              <div className="text-[10px] text-muted-foreground">{p.po_date ? fmtDate(p.po_date) : ""}</div>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3 text-sm">{fmtDate(p.issue_date)}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(p.amount)}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(p.due_date)}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            p.has_contractual_due_date ? "border-success/50 text-success" : "border-border text-muted-foreground"
                          }`}>
                            {p.has_contractual_due_date ? "Yes" : "N/A"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm">{p.status === "paid" ? fmtDate(p.paid_date) : <span className="text-muted-foreground">—</span>}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={p.status} /></td>
                        <td className="px-5 py-3">
                          {links.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              {links.map((s: any) => (
                                <Link key={s.id} to="/app/invoices" search={{ view: s.id }} className="flex items-center gap-1 text-xs text-primary hover:underline">
                                  <Link2 className="h-3 w-3" />{s.invoice_number}
                                  <span className="text-muted-foreground">→ {s.debtor?.name ?? "?"}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            <button onClick={() => setViewing(p)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                              <Eye className="h-3 w-3" /> View
                            </button>
                            <button onClick={() => exportPurchaseInvoicePdf(p)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                              <Printer className="h-3 w-3" /> PDF
                            </button>
                            {p.status === "pending" && (
                              canReview ? (
                                <Link to="/app/checker" className="text-[10px] uppercase tracking-widest text-primary hover:underline">Review →</Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Awaiting checker</span>
                              )
                            )}
                            {(p.status === "approved" || p.status === "advanced") && (
                              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                            )}
                            {p.status === "paid" && <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>}
                            {p.status === "overdue" && <span className="text-[10px] uppercase tracking-widest text-destructive">Overdue</span>}
                            {canEdit && (
                              <>
                                <button onClick={() => { setEditing(p); setOpen(true); }} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                                <button onClick={() => { if (confirm(`Remove purchase invoice ${p.invoice_number}?`)) remove.mutate(p.id); }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <div className="text-xs text-muted-foreground">
              {totalItems.toLocaleString()} total purchase invoices · Page {page} of {totalPages}
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
      </div>
      )}

      {open && user && (
        <PurchaseInvoiceFormModal
          editing={editing}
          vendors={vendorsQ.data ?? []}
          invoices={miniInvoicesQ.data ?? []}
          linkedSales={editing ? linkedSales(editing.id) : []}
          onClose={() => { setOpen(false); setEditing(null); }}
          onDone={() => { qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); qc.invalidateQueries({ queryKey: ["invoices-by-pi"] }); }}
        />
      )}

      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} vendors={vendorsQ.data ?? []} />}

      {viewing && (
        <PurchaseInvoiceDetailModal
          invoice={viewing}
          salesLinks={linkedSales(viewing.id)}
          inventory={viewedInventory}
          onClose={() => setViewing(null)}
        />
      )}

      {duplicateCheckOpen && (
        <DuplicateCheckModal onClose={() => setDuplicateCheckOpen(false)} />
      )}
    </div>
  );
}

// ── Page 1: Purchase Dashboard ──

function DashboardView({ stats, invoices }: { stats: any; invoices: any[] }) {
  const { isAdmin } = useAuth();

  // Supplier/vendor filter
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");

  const vendors = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const inv of invoices) {
      if (inv.vendor_id && inv.vendor?.name) map.set(inv.vendor_id, { id: inv.vendor_id, name: inv.vendor.name });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!selectedVendorId) return invoices;
    return invoices.filter((i: any) => i.vendor_id === selectedVendorId);
  }, [invoices, selectedVendorId]);

  const localStats = useMemo(() => {
    const inv = filteredInvoices;
    const total = inv.length;
    const totalAmount = inv.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const draft = inv.filter((p: any) => p.status === "draft");
    const submitted = inv.filter((p: any) => p.status === "submitted");
    const inFunding = inv.filter((p: any) => ["approved", "advanced", "funded"].includes(p.status));
    const paid = inv.filter((p: any) => p.status === "paid");
    const overdue = inv.filter((p: any) => p.status === "overdue");
    const disputed = inv.filter((p: any) => p.status === "disputed");
    const openPayables = inv.filter((p: any) => !["paid", "disputed"].includes(p.status));
    return {
      total,
      totalAmount,
      draftCount: draft.length, draftAmount: draft.reduce((s: number, p: any) => s + Number(p.amount), 0),
      submittedCount: submitted.length, submittedAmount: submitted.reduce((s: number, p: any) => s + Number(p.amount), 0),
      awaitingCheckerCount: draft.length + submitted.length,
      awaitingCheckerAmount: draft.reduce((s, p) => s + Number(p.amount), 0) + submitted.reduce((s, p) => s + Number(p.amount), 0),
      fundingCount: inFunding.length, fundingAmount: inFunding.reduce((s: number, p: any) => s + Number(p.amount), 0),
      paidCount: paid.length, paidAmount: paid.reduce((s: number, p: any) => s + Number(p.amount), 0),
      overdueCount: overdue.length, overdueAmount: overdue.reduce((s: number, p: any) => s + Number(p.amount), 0),
      disputedCount: disputed.length, disputedAmount: disputed.reduce((s: number, p: any) => s + Number(p.amount), 0),
      suppliersUsed: new Set(inv.map((p: any) => p.vendor_id).filter(Boolean)).size,
      openPayablesCount: openPayables.length,
      openPayablesAmount: openPayables.reduce((s: number, p: any) => s + Number(p.amount), 0),
    };
  }, [filteredInvoices]);

  const displayStats = selectedVendorId ? localStats : stats;

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    const amounts: Record<string, number> = {};
    const statusFilters = ["all", "draft", "submitted", "approved", "paid", "overdue", "disputed"];
    for (const status of statusFilters) {
      if (status === "all") continue;
      const items = filteredInvoices.filter((i: any) => i.status === status);
      counts[status] = items.length;
      amounts[status] = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
    }
    return { counts, amounts };
  }, [filteredInvoices]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const inv of filteredInvoices) {
      const name = inv.vendor?.name || "Unknown";
      const entry = map.get(name) || { name, count: 0, total: 0 };
      entry.count++;
      entry.total += Number(inv.amount);
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filteredInvoices]);

  const mostOverdue = useMemo(() => {
    const now = new Date();
    return filteredInvoices
      .filter((i: any) => i.status === "overdue" && i.due_date)
      .map((i: any) => {
        const due = new Date(i.due_date);
        const daysPastDue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        return { ...i, daysPastDue };
      })
      .sort((a: any, b: any) => b.daysPastDue - a.daysPastDue)
      .slice(0, 5);
  }, [filteredInvoices]);

  const chartData = useMemo(() => {
    const months = new Map<string, { month: string; count: number; amount: number }>();
    for (const inv of filteredInvoices) {
      const date = inv.issue_date || inv.created_at;
      if (!date) continue;
      const key = date.slice(0, 7);
      const entry = months.get(key) || { month: key, count: 0, amount: 0 };
      entry.count++;
      entry.amount += Number(inv.amount) || 0;
      months.set(key, entry);
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [filteredInvoices]);

  if (filteredInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium text-foreground">No purchase invoices yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">{selectedVendorId ? "No invoices found for this supplier." : "Create your first purchase invoice."}</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-8">
      {/* Supplier Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <select value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30">
            <option value="">All Suppliers</option>
            {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
          </select>
        </div>
        {selectedVendorId && (
          <button onClick={() => setSelectedVendorId("")} className="text-xs text-muted-foreground hover:text-foreground underline">Clear filter</button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {selectedVendorId ? <>{filteredInvoices.length} invoices · {fmtMoney(displayStats.totalAmount)}</> : <>{invoices.length} invoices total</>}
        </span>
      </div>

      {/* Primary KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Purchases" value={String(displayStats.total)} />
        <Stat label="Total Amount" value={fmtMoney(displayStats.totalAmount)} />
        <Stat label="Paid Invoices" value={String(displayStats.paidCount)} delta={fmtMoney(displayStats.paidAmount)} tone="good" />
        <Stat label="Open Payables" value={fmtMoney(displayStats.openPayablesAmount)} delta={`${displayStats.openPayablesCount} invoices`} tone="warn" />
      </div>

      {/* Secondary KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting Checker" value={String(displayStats.awaitingCheckerCount)} delta={fmtMoney(displayStats.awaitingCheckerAmount)} tone="warn" />
        <Stat label="In Funding Queue" value={String(displayStats.fundingCount)} delta={fmtMoney(displayStats.fundingAmount)} tone="neutral" />
        <Stat label="Overdue" value={String(displayStats.overdueCount)} delta={fmtMoney(displayStats.overdueAmount)} tone={displayStats.overdueCount > 0 ? "bad" : "good"} />
        <Stat label="Disputed" value={String(displayStats.disputedCount)} delta={fmtMoney(displayStats.disputedAmount)} tone={displayStats.disputedCount > 0 ? "bad" : "good"} />
      </div>

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <Card title={<div className="flex items-center gap-2"><span>Purchase Trend</span><span className="text-xs font-normal text-muted-foreground">Monthly volume &amp; value</span></div>}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGradientP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="areaGradientP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(262 80% 50%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(262 80% 50%)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v) => { const d = new Date(v + "-01"); return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }} className="text-xs text-muted-foreground" />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v) => "$" + (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "K" : v)}
                  className="text-xs text-muted-foreground" domain={[0, (max: number) => Math.ceil(max * 1.15 / 100000) * 100000]} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tickMargin={8}
                  className="text-xs text-muted-foreground" domain={[0, (max: number) => Math.ceil(max * 1.15 / 5) * 5]} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = new Date(label + "-01");
                  const monthLabel = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                  const amount = payload.find(p => p.dataKey === "amount")?.value as number || 0;
                  const count = payload.find(p => p.dataKey === "count")?.value as number || 0;
                  return (
                    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium mb-1">{monthLabel}</div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(38 92% 50%)" }} />
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono font-medium tabular-nums">{fmtMoney(amount)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(262 80% 50%)" }} />
                        <span className="text-muted-foreground">Invoices:</span>
                        <span className="font-mono font-medium tabular-nums">{count}</span>
                      </div>
                    </div>
                  );
                }} />
                <Bar yAxisId="left" dataKey="amount" fill="url(#barGradientP)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Area yAxisId="right" dataKey="count" fill="url(#areaGradientP)" stroke="hsl(262 80% 50%)" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, strokeWidth: 1, stroke: "hsl(var(--background))", fill: "hsl(262 80% 50%)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Status Breakdown & Top Suppliers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status Breakdown">
          <div className="space-y-3">
            {["draft", "submitted", "approved", "paid", "overdue", "disputed"].map((status) => {
              const count = statusBreakdown.counts[status] ?? 0;
              const amount = statusBreakdown.amounts[status] ?? 0;
              if (count === 0) return null;
              return (
                <div key={status} className="flex items-center justify-between">
                  <StatusPill status={status} />
                  <div className="text-right">
                    <div className="text-sm font-medium">{count}</div>
                    <div className="text-xs text-muted-foreground">{fmtMoney(amount)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Top Suppliers by Volume">
          <div className="space-y-3">
            {topSuppliers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No supplier data yet.</div>
            ) : (
              topSuppliers.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{s.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium num">{fmtMoney(s.total)}</div>
                    <div className="text-[10px] text-muted-foreground">{s.count} invoice{s.count !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Overdue Alerts */}
      {mostOverdue.length > 0 && (
        <Card title={<div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><span>Overdue Alerts</span><span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{displayStats.overdueCount} overdue</span></div>}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">The following {mostOverdue.length} invoice{mostOverdue.length !== 1 ? "s are" : " is"} past due and require attention.</p>
            <div className="-mx-6 -mb-6">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 text-left font-normal">Invoice</th><th className="px-6 py-3 text-left font-normal">Supplier</th>
                    <th className="px-6 py-3 text-right font-normal">Amount</th><th className="px-6 py-3 text-right font-normal">Days Overdue</th>
                    <th className="px-6 py-3 text-left font-normal">Due Date</th><th className="px-6 py-3 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mostOverdue.map((i: any) => (
                    <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="px-6 py-3">{i.vendor?.name ?? "—"}</td>
                      <td className="px-6 py-3 text-right num text-destructive">{fmtMoney(i.amount)}</td>
                      <td className="px-6 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.daysPastDue > 60 ? "bg-destructive/15 text-destructive" : i.daysPastDue > 30 ? "bg-warning/15 text-warning" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>
                          <AlertCircle className="h-3 w-3" />{i.daysPastDue}d
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">{fmtDate(i.due_date)}</td>
                      <td className="px-6 py-3"><StatusPill status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {displayStats.overdueCount > 5 && (
              <div className="pt-2 text-center text-xs text-muted-foreground">+ {displayStats.overdueCount - 5} more overdue invoice{(displayStats.overdueCount - 5) !== 1 ? "s" : ""} not shown</div>
            )}
          </div>
        </Card>
      )}

      {/* Recent Invoices */}
      <Card title="Recent Purchase Invoices">
        <div className="-mx-6 -mb-6">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left font-normal">Invoice</th><th className="px-6 py-3 text-left font-normal">Supplier</th>
                <th className="px-6 py-3 text-right font-normal">Amount</th><th className="px-6 py-3 text-left font-normal">Status</th><th className="px-6 py-3 text-left font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.slice(0, 10).map((i: any) => (
                <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                  <td className="px-6 py-3">{i.vendor?.name ?? "—"}</td>
                  <td className="px-6 py-3 text-right num">{fmtMoney(i.amount)}</td>
                  <td className="px-6 py-3"><StatusPill status={i.status} /></td>
                  <td className="px-6 py-3 text-sm text-muted-foreground">{fmtDate(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Page 2: Create Purchase Invoice ──

function CreatePurchaseView() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canCreate = canWrite("purchase-invoices");
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const vendorsQ = useQuery({
    queryKey: ["vendors-min"],
    queryFn: async () => (await api.get<any[]>("/vendors")) ?? [],
  });

  if (!canCreate) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Lock className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium">No permission</h3>
        <p className="mt-1 text-sm text-muted-foreground">You don't have permission to create purchase invoices.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 md:p-10">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">New Purchase Invoice</h2>
        <button onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
          <Upload className="h-3.5 w-3.5" /> Mass import
        </button>
      </div>
      <PurchaseInvoiceForm
        editing={null}
        vendors={vendorsQ.data ?? []}
        onClose={() => navigate({ to: "/app/purchases", search: { tab: "list" }, replace: true })}
        onDone={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
        isStandalone
      />
      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} vendors={vendorsQ.data ?? []} />}
    </div>
  );
}

// Shared Purchase Invoice Form (standalone and modal)
function PurchaseInvoiceForm({ editing, vendors, onClose, onDone, isStandalone }: {
  editing: any | null; vendors: any[]; onClose: () => void; onDone: () => void; isStandalone?: boolean;
}) {
  // This replicates the original PurchaseInvoiceFormModal logic but renders inline instead of as a modal
  return (
    <PurchaseInvoiceFormModal
      editing={editing}
      vendors={vendors}
      invoices={[]}
      linkedSales={[]}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

// ── Purchase Invoice PDF Export ──
async function exportPurchaseInvoicePdf(invoice: any) {
  try {
    const logo = await getLogoBase64().catch(() => undefined);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;
    const margin = 14;
    const contentW = pw - 2 * margin;

    // ── Header ──
    drawPdfHeaderBar(doc, `Purchase Invoice ${invoice.invoice_number}`, `Status: ${invoice.status?.replace("_", " ").toUpperCase()} · ${pdfDate(invoice.issue_date)}`, logo);

    let y = 42;

    // ── Invoice Details Section ──
    pdfSectionHeading(doc, "INVOICE DETAILS", margin, y, contentW);
    y += 8;

    const invoiceFields = [
      { label: "Invoice Number", value: invoice.invoice_number },
      { label: "Amount", value: pdfMoney(invoice.amount) },
      { label: "Issue Date", value: pdfDate(invoice.issue_date) },
      { label: "ERP Due Date", value: pdfDate(invoice.due_date) },
      { label: "Payment Terms", value: invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (${invoice.due_date_source === "bl" ? "from BL" : "from invoice"})` : "—" },
      { label: "Contractual Terms", value: invoice.has_contractual_due_date ? "Yes" : "N/A" },
      { label: "Status", value: invoice.status?.replace("_", " ") ?? "—" },
      { label: "PO Number", value: invoice.po_number || "—" },
      { label: "PO Date", value: pdfDate(invoice.po_date) },
      { label: "BL Date", value: pdfDate(invoice.bl_date) },
      { label: "Created", value: pdfDate(invoice.created_at) },
    ];

    const colW = contentW / 2;
    invoiceFields.forEach((f, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = margin + col * colW;
      const rowY = y + row * 6;

      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100, 116, 139);
      doc.text(f.label, x, rowY);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      doc.text(f.value, x + 42, rowY);
    });

    y += Math.ceil(invoiceFields.length / 2) * 6 + 4;

    // ── Payment / Funding Details ──
    if (invoice.paid_date || invoice.funded_date || invoice.advance_paid_date) {
      pdfSectionHeading(doc, "PAYMENT & FUNDING DETAILS", margin, y, contentW);
      y += 8;

      const payFields = [
        { label: "Paid Date", value: pdfDate(invoice.paid_date) },
        { label: "Funded Date", value: pdfDate(invoice.funded_date) },
        { label: "Advance Paid Date", value: pdfDate(invoice.advance_paid_date) },
      ];
      if (invoice.paid_note) payFields.push({ label: "Payment Note", value: invoice.paid_note });

      payFields.forEach((f, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const x = margin + col * colW;
        const rowY = y + row * 6;

        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(100, 116, 139);
        doc.text(f.label, x, rowY);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(8);
        doc.text(f.value, x + 42, rowY);
      });

      y += Math.ceil(payFields.length / 2) * 6 + 4;
    }

    // ── Supplier / Vendor Details ──
    const vendor = invoice.vendor;
    if (vendor) {
      y += 2;
      pdfSectionHeading(doc, "SUPPLIER DETAILS", margin, y, contentW);
      y += 8;

      const vendorFields = [
        { label: "Name", value: vendor.name || "—" },
        { label: "Contact", value: vendor.contact_name || "—" },
        { label: "Email", value: vendor.contact_email || "—" },
        { label: "Phone", value: vendor.contact_phone || "—" },
        { label: "Industry", value: vendor.industry || "—" },
        { label: "Address", value: [vendor.address_line, vendor.city, vendor.country].filter(Boolean).join(", ") || "—" },
        { label: "Website", value: vendor.website || "—" },
      ];

      vendorFields.forEach((f, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const x = margin + col * colW;
        const rowY = y + row * 6;

        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(100, 116, 139);
        doc.text(f.label, x, rowY);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(8);
        doc.text(f.value, x + 42, rowY);
      });

      y += Math.ceil(vendorFields.length / 2) * 6 + 4;
    }

    // ── Client Details ──
    const client = invoice.client;
    if (client) {
      y += 2;
      pdfSectionHeading(doc, "CLIENT (FACTOR)", margin, y, contentW);
      y += 8;

      const clientFields = [
        { label: "Company", value: client.company_name || "—" },
        { label: "Contact", value: client.contact_name || "—" },
        { label: "Email", value: client.email || "—" },
      ];

      clientFields.forEach((f, idx) => {
        const x = margin + (idx % 2) * colW;
        const rowY = y + Math.floor(idx / 2) * 6;

        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(100, 116, 139);
        doc.text(f.label, x, rowY);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(8);
        doc.text(f.value, x + 42, rowY);
      });

      y += Math.ceil(clientFields.length / 2) * 6 + 4;
    }

    // ── Notes ──
    if (invoice.notes) {
      y += 2;
      pdfSectionHeading(doc, "NOTES", margin, y, contentW);
      y += 8;
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 116, 139);
      doc.text(invoice.notes, margin, y);
      y += 8;
    }

    // ── Linked Sales Invoices ──
    const linkedSales = invoice.linkedSales || [];
    if (linkedSales.length > 0) {
      y += 2;
      pdfSectionHeading(doc, "LINKED SALES INVOICES", margin, y, contentW);
      y += 8;

      const lsHead = [["Invoice #", "Debtor", "Amount", "Status"]];
      const lsBody = linkedSales.map((s: any) => [
        s.invoice_number || "—",
        s.debtor?.name || "—",
        pdfMoney(s.amount),
        s.status?.replace("_", " ") || "—",
      ]);

      (doc as any).autoTable.call(doc, {
        startY: y,
        head: lsHead,
        body: lsBody,
        styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: [30, 30, 30] },
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, halign: "left" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: margin, right: margin, bottom: 20 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // ── Documents ──
    if (invoice.documents && invoice.documents.length > 0) {
      y += 2;
      pdfSectionHeading(doc, "ATTACHMENTS", margin, y, contentW);
      y += 8;

      const docHead = [["Name", "Type", "Size"]];
      const docBody = invoice.documents.map((d: any) => [
        d.name || "—",
        d.type || "—",
        d.size ? `${(d.size / 1024).toFixed(0)} KB` : "—",
      ]);

      (doc as any).autoTable.call(doc, {
        startY: y,
        head: docHead,
        body: docBody,
        styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: [30, 30, 30] },
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, halign: "left" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: margin, right: margin, bottom: 20 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    drawPdfFooter(doc);
    doc.save(`purchase-invoice-${invoice.invoice_number?.replace(/[^a-zA-Z0-9]/g, "-") || "export"}.pdf`);
    toast.success(`Purchase invoice PDF downloaded`);
  } catch (err) {
    console.error("Purchase invoice PDF export error:", err);
    toast.error("Failed to export purchase invoice PDF");
  }
}

function PurchaseInvoiceFormModal({ editing, vendors, invoices, linkedSales, onClose, onDone }: { editing: any | null; vendors: any[]; invoices: any[]; linkedSales: any[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    invoice_number: editing?.invoice_number ?? "",
    vendor_id: editing?.vendor_id ?? "",
    amount: String(editing?.amount ?? ""),
    po_number: editing?.po_number ?? "",
    po_date: editing?.po_date ?? "",
    issue_date: editing?.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: editing?.due_date ?? "",
    payment_terms_days: String(editing?.payment_terms_days ?? "30"),
    has_contractual_due_date: editing?.has_contractual_due_date ?? false,
    bl_date: editing?.bl_date ?? "",
    due_date_source: editing?.due_date_source ?? "invoice",
    notes: editing?.notes ?? "",
  }));
  const [docs, setDocs] = useState<DocMeta[]>(editing?.documents ?? []);
  const [invEnabled, setInvEnabled] = useState(false);
  const [invItems, setInvItems] = useState<Array<{ item_name: string; sku: string; quantity: string; unit: string; unit_cost: string }>>([]);
  const [linkedSalesInvoiceId, setLinkedSalesInvoiceId] = useState(() => {
    return editing && linkedSales.length > 0 ? linkedSales[0].id : "";
  });
  const initialLinkedIdsRef = useRef<string[]>(editing ? linkedSales.map((s: any) => s.id) : []);

  const [hasDueDate, setHasDueDate] = useState(() => {
    if (editing?.due_date) return true;
    const terms = Number(editing?.payment_terms_days ?? 30) || 30;
    const base = editing?.due_date_source === "bl" && editing?.bl_date ? editing.bl_date : (editing?.issue_date ?? new Date().toISOString().slice(0, 10));
    return !!base;
  });

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-purchase", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  const advancesTotal = ((poLookupQ.data?.advances ?? []) as any[])
    .filter((a: any) => a.status !== "refunded")
    .reduce((s: number, a: any) => s + Number(a.amount), 0);
  useEffect(() => {
    if (!editing && poLookupQ.data?.proformas) {
      const purchasePf = poLookupQ.data.proformas.find((p: any) => p.side === "purchase");
      if (purchasePf?.vendor_id && !form.vendor_id) {
        setForm((prev: any) => ({ ...prev, vendor_id: purchasePf.vendor_id }));
      }
    }
  }, [poLookupQ.data]);

  const balanceDue = Math.max(0, Number(form.amount || 0) - advancesTotal);

  const termsDays = Number(form.payment_terms_days) || 30;
  const computedDue = (() => {
    const base = form.due_date_source === "bl" && form.bl_date ? form.bl_date : form.issue_date;
    if (!base) return "";
    const d = new Date(base);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.vendor_id) throw new Error("Add a supplier first.");
      if (!form.invoice_number.trim()) throw new Error("Invoice number required");
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Amount must be > 0");
      const payload: any = {
        vendor_id: form.vendor_id,
        invoice_number: form.invoice_number.trim(),
        amount: Number(form.amount),
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        issue_date: form.issue_date,
        due_date: hasDueDate ? effectiveDue : null,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        bl_date: form.bl_date || null,
        due_date_source: form.due_date_source,
        notes: form.notes || null,
        documents: docs,
      };
      if (!editing && invEnabled) {
        const items = invItems.filter((it) => it.item_name.trim() && Number(it.quantity) > 0);
        if (items.length > 0) {
          payload.inventory_items = items.map((item) => ({
            item_name: item.item_name.trim(),
            sku: item.sku || null,
            quantity: Number(item.quantity),
            unit: item.unit || "unit",
            unit_cost: item.unit_cost ? Number(item.unit_cost) : null,
          }));
        }
      }
      if (editing) {
        await api.patch(`/purchase-invoices/${editing.id}`, payload);
        // Handle linking/unlinking sales invoices
        const prevIds = initialLinkedIdsRef.current;
        const newId = linkedSalesInvoiceId;
        // Unlink previously linked sales that are no longer selected
        for (const oldId of prevIds) {
          if (oldId !== newId) {
            await api.patch(`/invoices/${oldId}`, { purchase_invoice_id: null });
          }
        }
        // Link the newly selected sales invoice
        if (newId && !prevIds.includes(newId)) {
          await api.patch(`/invoices/${newId}`, { purchase_invoice_id: editing.id });
        }
      } else {
        await api.post("/purchase-invoices", payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      onDone();
      toast.success(editing ? "Purchase invoice updated" : "Purchase invoice recorded");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit purchase invoice" : "New purchase invoice"}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5 p-5">
          {vendors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              Add a supplier first in the Suppliers tab.
            </div>
          )}

          {!editing && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
              <div className="grid gap-3 md:grid-cols-2">
                <L label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></L>
                <L label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></L>
              </div>
            </div>
          )}

          {!editing && form.po_number.trim() && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Advances paid against PO {form.po_number}</div>
              {poLookupQ.isFetching ? (
                <div className="text-muted-foreground">Looking up…</div>
              ) : (poLookupQ.data?.advances ?? []).length === 0 ? (
                <div className="text-muted-foreground">No advances recorded for this PO number on the purchase side.</div>
              ) : (
                <ul className="space-y-0.5">
                  {((poLookupQ.data?.advances ?? []) as any[]).map((a: any) => (
                    <li key={a.id} className="flex justify-between"><span className="text-muted-foreground">{fmtDate(a.advance_date)} {a.reference ? `· ${a.reference}` : ""}</span><span className="num text-primary">{fmtMoney(a.amount)}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span>Total invoice amount</span><span className="num">{fmtMoney(Number(form.amount || 0))}</span>
              </div>
              <div className="flex justify-between"><span>Advance paid</span><span className="num text-primary">{fmtMoney(advancesTotal)}</span></div>
              <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                <span>Balance due to supplier</span><span className="num">{fmtMoney(balanceDue)}</span>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <L label="Invoice number *"><input required maxLength={80} className="inp" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></L>
            <L label="Supplier *">
              <select required className="inp" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">Select supplier</option>
                {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </L>
            <L label="Total invoice amount *"><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></L>
            <L label="Issue date"><input required type="date" className="inp" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></L>
            <L label="BL date"><input type="date" className="inp" value={form.bl_date} onChange={(e) => setForm({ ...form, bl_date: e.target.value })} /></L>
            <L label="Payment terms (days)"><input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} /></L>
            <L label="Due date source">
              <select className="inp" value={form.due_date_source} onChange={(e) => setForm({ ...form, due_date_source: e.target.value })}>
                <option value="invoice">From invoice date</option>
                <option value="bl">From BL date</option>
              </select>
            </L>
            <L label={`Due date (auto: ${termsDays}d net from ${form.due_date_source === "bl" ? "BL" : "invoice"} date)`}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hasDueDate} onChange={(e) => {
                    const v = e.target.checked;
                    setHasDueDate(v);
                    if (!v) setForm({ ...form, due_date: "" });
                    else setForm({ ...form, due_date: computedDue });
                  }} />
                  Enable due date
                </label>
                {hasDueDate && (
                  <input type="date" className="inp" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                )}
              </div>
            </L>
            <L label="Contractual payment terms">
              <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <input type="checkbox" checked={form.has_contractual_due_date} onChange={(e) => setForm({ ...form, has_contractual_due_date: e.target.checked })} />
                Has contractual payment terms
              </label>
            </L>
          </div>

          <L label="Notes"><textarea rows={2} className="inp" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>

          {editing && (
            <L label="Link to sales invoice (optional)">
              <select className="inp" value={linkedSalesInvoiceId} onChange={(e) => setLinkedSalesInvoiceId(e.target.value)}>
                <option value="">— No link —</option>
                {invoices.map((inv: any) => (
                  <option key={inv.id} value={inv.id}>{inv.invoice_number} · {fmtMoney(inv.amount)}</option>
                ))}
              </select>
            </L>
          )}

          {!editing && (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={invEnabled} onChange={(e) => setInvEnabled(e.target.checked)} />
                <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-in / credit)</span>
              </label>
              {invEnabled && (
                <div className="mt-3 space-y-4">
                  {invItems.map((item, idx) => (
                    <div key={idx} className="relative rounded-md border border-border bg-background/40 p-3 pt-5">
                      <button type="button" onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute right-2 top-2 text-muted-foreground hover:text-destructive" aria-label="Remove item">
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        <L label="Item *">
                          <input className="inp" value={item.item_name} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, item_name: e.target.value } : it))} />
                        </L>
                        <L label="SKU">
                          <input className="inp" value={item.sku} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, sku: e.target.value } : it))} />
                        </L>
                        <L label="Quantity *">
                          <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 10.5)" className="inp" value={item.quantity} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                        </L>
                        <L label="Unit">
                          <input className="inp" value={item.unit} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} />
                        </L>
                        <L label="Unit cost">
                          <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 49.99)" className="inp" value={item.unit_cost} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_cost: e.target.value } : it))} />
                        </L>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-xs">
                        <span className="text-muted-foreground">Item total</span>
                        <span className="num font-medium">{fmtMoney((Number(item.quantity) || 0) * (Number(item.unit_cost) || 0))}</span>
                      </div>
                    </div>
                  ))}
                  {invItems.length > 0 && (
                    <div className="-mt-2 flex justify-between border-t border-border pt-2 text-sm font-medium">
                      <span>Total inventory value</span>
                      <span className="num text-primary">{fmtMoney(invItems.reduce((s, item) => s + (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0), 0))}</span>
                    </div>
                  )}
                  <button type="button" onClick={() => setInvItems((prev) => [...prev, { item_name: "", sku: "", quantity: "", unit: "unit", unit_cost: "" }])}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
                    <Plus className="h-3.5 w-3.5" /> Add item
                  </button>
                </div>
              )}
            </div>
          )}
          <DocumentUploader userId={""} scope="purchase_invoices" docs={docs} onChange={setDocs}
            hint="Attach the supplier invoice, BL, packing list, or other supporting paperwork." />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editing ? "Save changes" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function PurchaseInvoiceDetailModal({ invoice, salesLinks, inventory, onClose }: { invoice: any; salesLinks: any[]; inventory: any[]; onClose: () => void }) {
  const invDocs: DocMeta[] = Array.isArray(invoice.documents) ? invoice.documents : [];
  const vendor = invoice.vendor;

  const openDoc = async (d: DocMeta) => {
    try {
      const encodedPath = d.path.split("/").map(encodeURIComponent).join("/");
      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4444";
      window.open(`${baseUrl}/upload/signed-url/${encodedPath}?token=${token}`, "_blank", "noopener");
    } catch {
      toast.error("Could not open document");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg">{invoice.invoice_number}</h3>
            <StatusPill status={invoice.status} />
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Invoice summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Purchase invoice details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Amount" value={fmtMoney(invoice.amount)} />
              <Detail label="Issue date" value={fmtDate(invoice.issue_date)} />
              <Detail label="ERP Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (from ${invoice.due_date_source === "bl" ? "BL" : "invoice"} date)` : "—"} />
              <Detail label="Contractual payment terms" value={invoice.has_contractual_due_date ? "Yes" : "N/A"} />
              {invoice.bl_date && <Detail label="BL date" value={fmtDate(invoice.bl_date)} />}
              <Detail label="Paid date" value={invoice.paid_date ? fmtDate(invoice.paid_date) : "—"} />
              <Detail label="Advance paid date" value={invoice.advance_paid_date ? fmtDate(invoice.advance_paid_date) : "—"} />
              <Detail label="Funded date" value={invoice.funded_date ? fmtDate(invoice.funded_date) : "—"} />
              <Detail label="Created" value={fmtDate(invoice.created_at)} />
              <Detail label="Last updated" value={fmtDate(invoice.updated_at)} />
              {invoice.po_number && <Detail label="PO number" value={invoice.po_number} />}
              {invoice.po_date && <Detail label="PO date" value={fmtDate(invoice.po_date)} />}
            </div>              {invoice.paid_note && (
                <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Payment note</div>
                  <p className="mt-1 text-xs italic">{invoice.paid_note}</p>
                </div>
              )}
              {invoice.notes && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                <p className="mt-1 text-xs italic">{invoice.notes}</p>
              </div>
            )}
          </div>

          {/* Supplier / Vendor details */}
          {vendor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />Supplier
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={vendor.name} />
                <Detail label="Contact" value={vendor.contact_name || "—"} />
                <Detail label="Email" value={vendor.contact_email || "—"} />
                <Detail label="Phone" value={vendor.contact_phone || "—"} />
                <Detail label="Industry" value={vendor.industry || "—"} />
                {vendor.address_line && <Detail label="Address" value={[vendor.address_line, vendor.city, vendor.country].filter(Boolean).join(", ")} />}
                {vendor.website && <Detail label="Website" value={vendor.website} />}
              </div>
            </div>
          )}

          {/* Client info */}
          {invoice.client && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <User className="mr-1 inline h-3.5 w-3.5" />Client
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Detail label="Company" value={invoice.client.company_name || "—"} />
                <Detail label="Contact" value={invoice.client.contact_name || "—"} />
                <Detail label="Email" value={invoice.client.email || "—"} />
              </div>
            </div>
          )}

          {/* Linked sales invoices */}
          {salesLinks.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Link2 className="mr-1 inline h-3.5 w-3.5" />Linked sales invoices ({salesLinks.length})
              </h4>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Invoice</th>
                      <th className="px-4 py-2 text-left font-normal">Debtor</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                      <th className="px-4 py-2 text-left font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesLinks.map((s: any) => (
                      <tr key={s.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-mono text-xs">
                          <Link to="/app/invoices" search={{ view: s.id }} className="text-primary hover:underline">{s.invoice_number}</Link>
                        </td>
                        <td className="px-4 py-2.5">{s.debtor?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right num">{fmtMoney(s.amount)}</td>
                        <td className="px-4 py-2.5"><StatusPill status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({invDocs.length})
            </h4>
            {invDocs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No documents attached to this purchase invoice.</div>
            ) : (
              <ul className="space-y-1.5">
                {invDocs.map((d) => (
                  <li key={d.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate" title={d.name}>{d.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(d.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button type="button" onClick={() => openDoc(d)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                      <Download className="h-3 w-3" /> Open
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Inventory movements */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <Package className="mr-1 inline h-3.5 w-3.5" />Inventory entries ({inventory.length})
            </h4>
            {inventory.length === 0 ? (
              <div className="text-xs text-muted-foreground">No inventory movements linked to this purchase invoice.</div>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Item</th>
                      <th className="px-4 py-2 text-left font-normal">SKU</th>
                      <th className="px-4 py-2 text-right font-normal">Qty</th>
                      <th className="px-4 py-2 text-left font-normal">Unit</th>
                      <th className="px-4 py-2 text-right font-normal">Unit cost</th>
                      <th className="px-4 py-2 text-left font-normal">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((m: any) => (
                      <tr key={m.id} className="border-b border-border/60">
                        <td className="px-4 py-2.5">{m.item_name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.sku || "—"}</td>
                        <td className="px-4 py-2.5 text-right num">{Number(m.quantity).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.unit}</td>
                        <td className="px-4 py-2.5 text-right num">{m.unit_cost != null ? fmtMoney(m.unit_cost) : "—"}</td>
                        <td className="px-4 py-2.5">{fmtDate(m.movement_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// ── Mass Import Modal ──

interface ImportRow {
  invoice_number: string;
  amount: number;
  issue_date: string;
}

function MassImportModal({ onClose, vendors }: { onClose: () => void; vendors: any[] }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [vendorId, setVendorId] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [dueDateSource, setDueDateSource] = useState<"invoice" | "bl">("invoice");
  const [blDate, setBlDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!vendorId) {
      toast.error("Please select a supplier first");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

        const parsed: ImportRow[] = json.map((row: any, idx: number) => {
          // Try common column name variations
          const invNum = row.invoice_number ?? row["Invoice Number"] ?? row.invoiceNum ?? row.Invoice ?? row["Invoice#"] ?? "";
          const amt = Number(row.amount ?? row["Amount"] ?? row.Amount ?? 0);
          const issDate = row.issue_date ?? row["Issue Date"] ?? row.issueDate ?? row.Date ?? row.date ?? "";

          // Normalize date if it's a serial number (Excel date)
          let dateStr = "";
          if (typeof issDate === "number" && !isNaN(issDate)) {
            // Excel serial date
            const d = new Date((issDate - 25569) * 86400 * 1000);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString().slice(0, 10);
            }
          } else if (typeof issDate === "string") {
            // For string dates, just take the first 10 characters (YYYY-MM-DD)
            const cleaned = issDate.trim();
            if (cleaned) {
              // Try parsing directly
              const d = new Date(cleaned);
              if (!isNaN(d.getTime())) {
                dateStr = d.toISOString().slice(0, 10);
              } else {
                // If it already looks like YYYY-MM-DD, use it directly
                if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
                  dateStr = cleaned;
                }
              }
            }
          }

          return {
            invoice_number: String(invNum).trim(),
            amount: isNaN(amt) ? 0 : amt,
            issue_date: dateStr,
          };
        }).filter((r) => r.invoice_number && r.amount > 0 && r.issue_date);

        if (parsed.length === 0) {
          toast.error("No valid rows found. Expected columns: invoice_number, amount, issue_date");
          return;
        }

        setRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Could not parse the Excel file. Please check the format.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const batchImport = useMutation({
    mutationFn: async () => {
      const payload = {
        vendor_id: vendorId,
        payment_terms_days: Number(paymentTermsDays) || 30,
        due_date_source: dueDateSource,
        bl_date: blDate || null,
        po_number: poNumber.trim() || null,
        po_date: poDate || null,
        invoices: rows.map((r) => ({
          invoice_number: r.invoice_number,
          amount: r.amount,
          issue_date: r.issue_date,
        })),
      };
      return await api.post<{ created: any[]; errors: Array<{ invoice_number: string; error: string }> }>("/purchase-invoices/batch", payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ created: data.created.length, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created.length} purchase invoices created successfully`);
      } else {
        toast.success(`${data.created.length} created, ${errList.length} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const computedDue = useMemo(() => {
    if (!rows.length) return "";
    const base = dueDateSource === "bl" && blDate ? blDate : rows[0].issue_date;
    if (!base) return "";
    try {
      const d = new Date(base);
      if (isNaN(d.getTime())) return "";
      d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
      return d.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }, [rows, dueDateSource, blDate, paymentTermsDays]);

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "form" ? "Mass import purchase invoices" : step === "preview" ? "Preview imported invoices" : "Import complete"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <strong className="text-primary">Excel format:</strong> Upload a spreadsheet (.xlsx, .xls, .xlsb, .xlsm), CSV, TSV, or ODS file with columns:{' '}
              <code className="font-mono text-primary">invoice_number</code>,{' '}
              <code className="font-mono text-primary">amount</code>,{' '}
              <code className="font-mono text-primary">issue_date</code>.
              Each row becomes a separate purchase invoice. Due dates are auto-calculated from payment terms.
            </div>

            <L label="Supplier *">
              <select required value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="inp">
                <option value="">Select supplier</option>
                {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </L>

            <div className="grid grid-cols-2 gap-3">
              <L label="Payment terms (days) *">
                <input required type="number" min="0" className="inp" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
              </L>
              <L label="Due date source">
                <select className="inp" value={dueDateSource} onChange={(e) => setDueDateSource(e.target.value as any)}>
                  <option value="invoice">From invoice date</option>
                  <option value="bl">From BL date</option>
                </select>
              </L>
            </div>

            {dueDateSource === "bl" && (
              <L label="BL date">
                <input type="date" className="inp" value={blDate} onChange={(e) => setBlDate(e.target.value)} />
              </L>
            )}

            <div className="grid grid-cols-2 gap-3">
              <L label="PO number (optional)">
                <input className="inp" placeholder="PO-2026-001" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </L>
              <L label="PO date">
                <input type="date" className="inp" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </L>
            </div>

            <div className="border-t border-border pt-4">
              <L label="Upload Excel / CSV file *">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                  onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                />
              </L>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono text-foreground">{fileName}</span> ·
                Found <strong className="text-foreground">{rows.length}</strong> invoices
                · Total <strong className="text-foreground">{fmtMoney(totalAmount)}</strong>
              </div>
              <button onClick={() => setStep("form")} className="text-xs text-primary hover:underline">Change file</button>
            </div>

            <div className="rounded-md border border-border bg-background/40 p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span>{vendors.find((v: any) => v.id === vendorId)?.name ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payment terms</span><span>{paymentTermsDays}d net (from {dueDateSource === "bl" ? "BL" : "invoice"} date)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Due date example</span><span className="font-mono">{computedDue || "—"}</span></div>
              {poNumber && <div className="flex justify-between"><span className="text-muted-foreground">PO number</span><span className="font-mono">{poNumber}</span></div>}
            </div>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">#</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice number</th>
                    <th className="px-5 py-2 text-left font-normal">Issue date</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due date (computed)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    let dueStr = "—";
                    try {
                      const base = dueDateSource === "bl" && blDate ? blDate : r.issue_date;
                      if (base) {
                        const d = new Date(base);
                        if (!isNaN(d.getTime())) {
                          d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
                          dueStr = d.toISOString().slice(0, 10);
                        }
                      }
                    } catch {}
                    return (
                      <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-5 py-3 text-sm">{r.issue_date ? fmtDate(r.issue_date) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                        <td className="px-5 py-3 text-sm font-mono">{dueStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button
                disabled={batchImport.isPending}
                onClick={() => batchImport.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {batchImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
              <div className="text-2xl font-display text-success">{result.created}</div>
              <div className="text-xs text-muted-foreground mt-1">Purchase invoices created successfully</div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="text-xs uppercase tracking-widest text-destructive mb-2">Failed ({result.errors.length})</div>
                <ul className="space-y-1">
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-xs text-destructive">{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        )}

        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ── Duplicate Check Modal ──
function DuplicateCheckModal({ onClose }: { onClose: () => void }) {
  const dupQ = useQuery({
    queryKey: ["invoices", "check-duplicates"],
    queryFn: async () => (await api.get<any>("/invoices/check-duplicates")) ?? { duplicates: [], totalDuplicates: 0 },
  });

  const duplicates = dupQ.data?.duplicates ?? [];
  const totalDuplicates = dupQ.data?.totalDuplicates ?? 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg">
              <AlertTriangle className="mr-1.5 inline h-5 w-5 text-warning" />
              Duplicate invoice numbers
            </h3>
            {dupQ.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          {dupQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Scanning all invoices for duplicates…</div>
          ) : dupQ.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Failed to check for duplicates. Please try again.
            </div>
          ) : totalDuplicates === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="text-3xl mb-2">✓</div>
              <div className="text-sm text-success font-medium">No duplicate invoice numbers found!</div>
              <div className="text-xs text-muted-foreground mt-1">All invoice numbers across sales and purchase invoices are unique.</div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2 text-sm">
                <span className="rounded-full border border-warning/50 bg-warning/10 px-3 py-1 font-mono text-xs font-medium text-warning">
                  {totalDuplicates} duplicate invoice number{totalDuplicates !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  Found across both sales and purchase invoices
                </span>
              </div>

              <div className="space-y-4">
                {duplicates.map((dup: any) => (
                  <div key={dup.invoice_number} className="rounded-lg border border-border bg-background/40 overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center justify-between border-b border-border bg-warning/5 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        <span className="font-mono text-sm font-medium">{dup.invoice_number}</span>
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                          {dup.count} entries
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Total: {fmtMoney(dup.entries.reduce((s: number, e: any) => s + Number(e.amount), 0))}
                      </span>
                    </div>

                    {/* Entries table */}
                    <div className="-mx-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                          <tr className="border-b border-border">
                            <th className="px-4 py-2 text-left font-normal">Type</th>
                            <th className="px-4 py-2 text-left font-normal">UID</th>
                            <th className="px-4 py-2 text-left font-normal">Debtor / Supplier</th>
                            <th className="px-4 py-2 text-left font-normal">Issue date</th>
                            <th className="px-4 py-2 text-right font-normal">Amount</th>
                            <th className="px-4 py-2 text-left font-normal">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dup.entries.map((entry: any) => (
                            <tr key={entry.id} className="border-b border-border/60 hover:bg-muted/30">
                              <td className="px-4 py-2.5">
                                {entry.type === "sales" ? (
                                  <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">Sales</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/5 px-2 py-0.5 text-[10px] font-medium text-warning">Purchase</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">#{entry.id.slice(-8).toUpperCase()}</td>
                              <td className="px-4 py-2.5">
                                {entry.type === "sales"
                                  ? (entry.debtor?.name ?? "—")
                                  : (entry.vendor?.name ?? "—")
                                }
                              </td>
                              <td className="px-4 py-2.5 text-sm">{fmtDate(entry.issue_date)}</td>
                              <td className="px-4 py-2.5 text-right num">{fmtMoney(entry.amount)}</td>
                              <td className="px-4 py-2.5"><StatusPill status={entry.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
            <button
              onClick={() => dupQ.refetch()}
              disabled={dupQ.isRefetching}
              className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm text-primary hover:bg-primary/5 disabled:opacity-50"
            >
              {dupQ.isRefetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

