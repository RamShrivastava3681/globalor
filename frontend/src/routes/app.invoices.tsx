import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Send, Copy, Trash2, Save, Eye, FileText, Building2, User, Package, Download, ArrowUpDown, Upload, Printer } from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { getLogoBase64, drawPdfHeaderBar, drawPdfFooter, pdfMoney, pdfDate, pdfSectionHeading } from "@/lib/pdf-helpers";

export const Route = createFileRoute("/app/invoices")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
  }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const { isAdmin, isChecker, isClient, isTreasury, isOperations, user, canWrite } = useAuth();
  const canReview = isAdmin || isChecker;
  const canCreate = canWrite("invoices");
  const canEdit = canWrite("invoices");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [sortField, setSortField] = useState<"created" | "issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list", page, limit, sortField, sortOrder, searchQuery, filter, issueDateFrom, issueDateTo],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sortField, sort: sortOrder, filter });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (issueDateFrom) params.set("issueDateFrom", issueDateFrom);
      if (issueDateTo) params.set("issueDateTo", issueDateTo);
      const res = await api.get<any>("/invoices?" + params.toString());
      return res ?? { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  });

  const stockMovementsQ = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await api.get<any[]>("/stock-movements")) ?? [],
  });

  const viewedInventory = useMemo(() => {
    if (!viewing) return [];
    return (stockMovementsQ.data ?? []).filter((m: any) => m.invoice_id === viewing.id);
  }, [viewing, stockMovementsQ.data]);

  const availableInventory = useMemo(() => {
    const m = new Map<string, { sku: string; item_name: string; unit: string; qty: number; inQty: number; inValue: number }>();
    for (const r of (stockMovementsQ.data ?? []) as any[]) {
      const skuKey = r.sku || r.item_name;
      const k = `${skuKey}|${r.unit}`;
      const sign = r.direction === "in" ? 1 : -1;
      const cur = m.get(k) ?? { sku: r.sku || "", item_name: r.item_name, unit: r.unit || "unit", qty: 0, inQty: 0, inValue: 0 };
      cur.qty += sign * Number(r.quantity);
      // Only stock-in movements contribute to inventory cost basis
      if (r.direction === "in") {
        cur.inQty += Number(r.quantity);
        cur.inValue += Number(r.quantity) * Number(r.unit_cost ?? 0);
      }
      m.set(k, cur);
    }
    return [...m.values()].map(c => {
      const avgCost = c.inQty > 0 ? c.inValue / c.inQty : 0;
      return { ...c, value: c.qty > 0 ? c.qty * avgCost : 0 };
    }).filter((item) => item.qty > 0).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [stockMovementsQ.data]);

  const debtorsQ = useQuery({
    queryKey: ["debtors"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  const purchasesQ = useQuery({
    queryKey: ["purchases-for-link"],
    queryFn: async () => (await api.get<any[]>("/purchase-invoices/mini")) ?? [],
  });

  const sendNoa = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.post<{ noa_status: string; noa_link: string }>(`/invoices/${id}/send-noa`);
      return result;
    },
    onSuccess: (result, id) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const link = `${window.location.origin}/noa/${result.noa_link.replace("/noa/", "")}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success("NOA link copied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/invoices/${id}`);
    },
    onSuccess: () => {
      toast.success("Invoice removed");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Paginated data from server — sorting and filtering are server-side
  const invoiceData = invoicesQ.data?.data ?? [];
  const totalInvoices = invoicesQ.data?.total ?? 0;
  const totalPages = invoicesQ.data?.totalPages ?? 1;

  const canSendNoa = canWrite("invoices") || canWrite("checker-desk");

  // Bulk actions
  const allSelected = invoiceData.length > 0 && invoiceData.every((i: any) => selectedIds.has(i.id));
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoiceData.map((i: any) => i.id)));
    }
  };

  const bulkRemove = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post("/invoices/bulk-delete", { ids });
    },
    onSuccess: () => {
      toast.success(`${selectedIds.size} invoice${selectedIds.size !== 1 ? "s" : ""} removed`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (!count) return;
    if (!confirm(`Remove ${count} selected invoice${count !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    bulkRemove.mutate([...selectedIds]);
  };
  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  // Auto-open detail modal: fetch the specific invoice by id since we may not have it loaded
  useEffect(() => {
    if (view) {
      (async () => {
        // Try to find it in the current page first
        const found = invoiceData.find((i: any) => i.id === view);
        if (found) {
          setViewing(found);
        } else {
          // Fetch the single invoice via dedicated endpoint
          try {
            const match = await api.get<any>("/invoices/" + view);
            if (match) setViewing(match);
          } catch {
            // silently fail — invoice may have been deleted
          }
        }
        navigate({ to: "/app/invoices", search: { view: undefined }, replace: true });
      })();
    }
  }, [view]);

  // All filtering is now server-side — the data is already filtered before pagination

  // Reset to page 1 when search, filter, date range, or page size changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, filter, issueDateFrom, issueDateTo, limit]);

  return (
    <div>
      <PageHeader
        eyebrow="Invoices"
        title={isAdmin ? "Invoice queue" : "Your invoices"}
        description={isAdmin ? "Submitted invoices route to the checker for approval before reaching treasury." : "Submit invoices; the checker reviews them before they enter the funding queue."}
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> New invoice
              </button>
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <Upload className="h-4 w-4" /> Mass import
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        <div className="flex flex-wrap gap-2">
          {["all", "open", "close"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s === "all" ? "All" : s === "open" ? "Open (Created)" : "Close (Funded)"}</button>
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
        <div className="relative">
          <input type="text" placeholder="Search invoices by number, debtor, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>

        {(filter !== "all" || searchQuery || issueDateFrom || issueDateTo) && (
          <div className="-mt-1 mb-2 flex justify-end">
            <button onClick={() => { setFilter("all"); setSearchQuery(""); setIssueDateFrom(""); setIssueDateTo(""); }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline transition-colors">
              <X className="h-3 w-3" /> Clear all filters
            </button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
          <div className="flex gap-1">
            {(["created", "issue", "due"] as const).map((field) => (
              <button
                key={field}
                onClick={() => {
                  setPage(1);
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
          {invoicesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : invoiceData.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-5 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedIds.size}</span> selected
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear selection
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkRemove.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {bulkRemove.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Delete selected
                    </button>
                  </div>
                </div>
              )}
              <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                    </th>
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice Number</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-left font-normal">Issue date</th>
                    <th className="px-5 py-2 text-right font-normal">Invoice Amount</th>
                    <th className="px-5 py-2 text-right font-normal">Received</th>
                    <th className="px-5 py-2 text-right font-normal">Short payment</th>
                    <th className="px-5 py-2 text-left font-normal">ERP Due Date</th>
                    <th className="px-5 py-2 text-left font-normal">Contractual Payment Terms</th>
                    <th className="px-5 py-2 text-left font-normal">Paid date</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceData.map((i: any) => {
                    const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                    const lateDays = i.status === "paid"
                      ? (i.late_days != null ? Number(i.late_days) : 0)
                      : Math.max(0, dpd);
                    return (
                      <tr key={i.id} className={`border-b border-border/60 hover:bg-muted/30 ${selectedIds.has(i.id) ? "bg-primary/5" : ""}`}>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(i.id)}
                            onChange={() => toggleSelect(i.id)}
                            className="h-4 w-4 rounded border-border accent-primary"
                          />
                        </td>
                        <td className="px-5 py-3 font-mono text-[10px] text-muted-foreground" title={i.id}>#{i.id.slice(-8).toUpperCase()}</td>
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs">{i.invoice_number}</div>
                          {i.po_number && <div className="text-[10px] text-muted-foreground">PO {i.po_number}{i.po_date ? ` · ${fmtDate(i.po_date)}` : ""}</div>}
                          {i.purchase && (
                            <Link to="/app/purchases" search={{ view: i.purchase.id }} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                              <Link2 className="h-2.5 w-2.5" /> {i.purchase.invoice_number} · {i.purchase.vendor?.name ?? ""}
                            </Link>
                          )}
                        </td>
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{i.client?.company_name || i.client?.contact_name || "—"}</td>}
                        <td className="px-5 py-3">{i.debtor?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(i.issue_date)}</td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(i.amount)}</td>
                        <td className="px-5 py-3 text-right num text-muted-foreground">{i.amount_received != null ? fmtMoney(i.amount_received) : "—"}</td>
                        <td className={`px-5 py-3 text-right num ${Number(i.short_payment) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{i.short_payment != null ? fmtMoney(i.short_payment) : "—"}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                            i.has_contractual_due_date ? "border-success/50 text-success" : "border-border text-muted-foreground"
                          }`}>
                            {i.has_contractual_due_date ? "Yes" : "N/A"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm">{i.status === "paid" ? fmtDate(i.paid_date) : <span className="text-muted-foreground">—</span>}</td>
                        <td className={`px-5 py-3 text-right num ${lateDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>{lateDays}</td>
                        <td className="px-5 py-3"><StatusPill status={i.status} /></td>
                        <td className="px-5 py-3">
                          <NoaBadge status={i.noa_status} />
                          {i.noa_comments && <div className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={i.noa_comments}>"{i.noa_comments}"</div>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            <button onClick={() => setViewing(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                              <Eye className="h-3 w-3" /> View
                            </button>
                            <button onClick={() => exportSalesInvoicePdf(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">
                              <Printer className="h-3 w-3" /> PDF
                            </button>
                            {canSendNoa && i.noa_status === "not_sent" && (
                              <button onClick={() => sendNoa.mutate(i.id)} className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10">
                                <Send className="h-3 w-3" /> Send NOA
                              </button>
                            )}
                            {i.noa_status !== "not_sent" && (
                              <button onClick={() => copyNoa(i)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted">
                                <Copy className="h-3 w-3" /> Copy NOA link
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button onClick={() => { setEditing(i); setOpen(true); }} className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-primary hover:text-primary">Edit</button>
                                <button onClick={() => { if (confirm(`Remove invoice ${i.invoice_number}?`)) remove.mutate(i.id); }}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {isAdmin && i.status === "pending" && (
                              canReview ? (
                                <Link to="/app/checker" className="text-[10px] uppercase tracking-widest text-primary hover:underline">Review →</Link>
                              ) : (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Awaiting checker</span>
                              )
                            )}
                            {isAdmin && (i.status === "approved" || i.status === "advanced" || i.status === "funded") && (
                              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">In funding queue</span>
                            )}
                            {isAdmin && i.status === "paid" && (
                              <span className="text-[10px] uppercase tracking-widest text-success">Closed</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>

        {/* Pagination controls — page size always visible */}
        <div className="flex items-center justify-between pt-4">
          <div className="flex items-center gap-3">
            {totalPages > 0 && (
              <div className="text-xs text-muted-foreground">
                {totalInvoices.toLocaleString()} total invoices{totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Show</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {[10, 20, 50, 100, 200, 500].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground">per page</span>
            </div>
          </div>
          {totalPages > 1 && (
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
                  // Show pages around current page
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
          )}
        </div>
      </div>

      {importOpen && <MassImportModal onClose={() => setImportOpen(false)} debtors={debtorsQ.data ?? []} />}

      {open && <InvoiceFormModal editing={editing} onClose={() => { setOpen(false); setEditing(null); }} debtors={debtorsQ.data ?? []} purchases={purchasesQ.data ?? []} availableInventory={availableInventory} />}

      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          inventory={viewedInventory}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

// ── Sales Invoice PDF Export ──
async function exportSalesInvoicePdf(invoice: any) {
  try {
    const logo = await getLogoBase64().catch(() => undefined);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.width;
    const margin = 14;
    const contentW = pw - 2 * margin;

    // ── Header ──
    drawPdfHeaderBar(doc, `Invoice ${invoice.invoice_number}`, `Status: ${invoice.status?.replace("_", " ").toUpperCase()} · ${pdfDate(invoice.issue_date)}`, logo);

    let y = 42;

    // ── Invoice Details Section ──
    pdfSectionHeading(doc, "INVOICE DETAILS", margin, y, contentW);
    y += 8;

    // Two-column grid for invoice details
    const invoiceFields = [
      { label: "Invoice Number", value: invoice.invoice_number },
      { label: "Amount", value: pdfMoney(invoice.amount) },
      { label: "Issue Date", value: pdfDate(invoice.issue_date) },
      { label: "ERP Due Date", value: pdfDate(invoice.due_date) },
      { label: "Payment Terms", value: invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (${invoice.due_date_source === "bl" ? "from BL" : "from invoice"})` : "—" },
      { label: "Contractual Terms", value: invoice.has_contractual_due_date ? "Yes" : "N/A" },
      { label: "Status", value: invoice.status?.replace("_", " ") ?? "—" },
      { label: "NOA Status", value: invoice.noa_status?.replace("_", " ") ?? "—" },
      { label: "PO Number", value: invoice.po_number || "—" },
      { label: "PO Date", value: pdfDate(invoice.po_date) },
      { label: "BL Date", value: pdfDate(invoice.bl_date) },
      { label: "Created", value: pdfDate(invoice.created_at) },
    ];

    // Draw as a 2-column grid
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

    const fieldsEnd = y + Math.ceil(invoiceFields.length / 2) * 6 + 4;

    // ── Payment Details (if paid) ──
    if (invoice.status === "paid" || invoice.amount_received != null) {
      y = fieldsEnd + 2;
      pdfSectionHeading(doc, "PAYMENT DETAILS", margin, y, contentW);
      y += 8;

      const payFields = [
        { label: "Paid Date", value: pdfDate(invoice.paid_date) },
        { label: "Amount Received", value: pdfMoney(invoice.amount_received) },
        { label: "Short Payment", value: pdfMoney(invoice.short_payment) },
        { label: "Late Days", value: invoice.late_days != null ? `${invoice.late_days}d` : "—" },
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

    // ── Debtor Details ──
    const debtor = invoice.debtor;
    if (debtor) {
      y = Math.max(y, fieldsEnd) + 2;
      pdfSectionHeading(doc, "DEBTOR DETAILS", margin, y, contentW);
      y += 8;

      const debtorFields = [
        { label: "Name", value: debtor.name || "—" },
        { label: "Legal Entity", value: debtor.legal_entity_name || "—" },
        { label: "Registration No.", value: debtor.registration_no || "—" },
        { label: "Industry", value: debtor.industry || "—" },
        { label: "Credit Limit", value: pdfMoney(debtor.credit_limit) },
        { label: "Risk Score", value: debtor.risk_score != null ? `${debtor.risk_score}/100` : "—" },
        { label: "Contact", value: debtor.contact_name || "—" },
        { label: "Email", value: debtor.contact_email || "—" },
        { label: "Phone", value: debtor.contact_phone || "—" },
        { label: "Registered Address", value: debtor.registered_address || "—" },
        { label: "Relationship Since", value: debtor.relationship_since || "—" },
      ];

      debtorFields.forEach((f, idx) => {
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

      y += Math.ceil(debtorFields.length / 2) * 6 + 4;

      // Debtor notes
      if (debtor.notes) {
        y += 2;
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(100, 116, 139);
        doc.text(`Notes: ${debtor.notes}`, margin, y);
        y += 6;
      }
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

    // ── Linked Purchase Invoices ──
    if (invoice.purchases && invoice.purchases.length > 0) {
      y += 2;
      pdfSectionHeading(doc, "LINKED PURCHASE INVOICES", margin, y, contentW);
      y += 8;

      const head = [["Invoice #", "Supplier", "Amount", "Status"]];
      const body = invoice.purchases.map((p: any) => [
        p.invoice_number || "—",
        p.vendor?.name || "—",
        pdfMoney(p.amount),
        p.status?.replace("_", " ") || "—",
      ]);

      (doc as any).autoTable.call(doc, {
        startY: y,
        head,
        body,
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

    // ── Footer ──
    drawPdfFooter(doc);
    doc.save(`invoice-${invoice.invoice_number?.replace(/[^a-zA-Z0-9]/g, "-") || "export"}.pdf`);
    toast.success(`Invoice PDF downloaded`);
  } catch (err) {
    console.error("Invoice PDF export error:", err);
    toast.error("Failed to export invoice PDF");
  }
}

function NoaBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "Not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "Awaiting reply", cls: "border-warning/50 text-warning" },
    accepted: { label: "Accepted", cls: "border-success/50 text-success" },
    rejected: { label: "Rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "Commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${v.cls}`}>{v.label}</span>;
}

function InvoiceFormModal({ editing, onClose, debtors, purchases, availableInventory }: { editing: any | null; onClose: () => void; debtors: any[]; purchases: any[]; availableInventory: Array<{ sku: string; item_name: string; unit: string; qty: number; value: number }> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    invoice_number: editing?.invoice_number ?? "",
    debtor_id: editing?.debtor_id ?? "",
    amount: String(editing?.amount ?? ""),
    issue_date: editing?.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: editing?.due_date ?? "",
    payment_terms_days: String(editing?.payment_terms_days ?? "30"),
    bl_date: editing?.bl_date ?? "",
    due_date_source: editing?.due_date_source ?? "invoice",
    has_contractual_due_date: editing?.has_contractual_due_date ?? false,
    po_number: editing?.po_number ?? "",
    po_date: editing?.po_date ?? "",
    purchase_invoice_id: editing?.purchase_invoice_id ?? "",
  }));
  const [docs, setDocs] = useState<DocMeta[]>(editing?.documents ?? []);
  const [invEnabled, setInvEnabled] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const [invItems, setInvItems] = useState<Array<{ item_name: string; sku: string; quantity: string; unit: string; unit_cost: string }>>([]);

  const [hasDueDate, setHasDueDate] = useState(() => {
    if (editing?.due_date) return true;
    const terms = Number(editing?.payment_terms_days ?? 30) || 30;
    const base = editing?.due_date_source === "bl" && editing?.bl_date ? editing.bl_date : (editing?.issue_date ?? new Date().toISOString().slice(0, 10));
    return !!base;
  });

  // Track whether the user has manually overridden the auto-computed due date
  const [isDueDateOverridden, setIsDueDateOverridden] = useState(() => {
    if (!editing?.due_date) return false;
    // If editing an existing invoice that has a due_date, check if it differs from the computed value
    const terms = Number(editing?.payment_terms_days ?? 30) || 30;
    const base = editing?.due_date_source === "bl" && editing?.bl_date ? editing.bl_date : editing?.issue_date;
    if (base) {
      const d = new Date(base);
      d.setDate(d.getDate() + terms);
      const computed = d.toISOString().slice(0, 10);
      return editing.due_date !== computed;
    }
    return !!editing.due_date;
  });

  // Auto-calculate total amount from inventory items when inventory tracking is enabled
  const inventoryTotal = useMemo(() => {
    if (!invEnabled) return 0;
    return invItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const cost = Number(item.unit_cost) || 0;
      return sum + qty * cost;
    }, 0);
  }, [invItems, invEnabled]);

  useEffect(() => {
    if (invEnabled && inventoryTotal > 0) {
      setForm((prev) => ({ ...prev, amount: String(inventoryTotal) }));
    }
  }, [inventoryTotal, invEnabled]);

  const filteredInv = useMemo(() => {
    if (!invSearch.trim() || !availableInventory) return [];
    const q = invSearch.toLowerCase();
    return availableInventory.filter((i) => i.sku.toLowerCase().includes(q) || i.item_name.toLowerCase().includes(q));
  }, [invSearch, availableInventory]);

  const addInvItem = (item: { sku: string; item_name: string; unit: string; qty: number; value: number }) => {
    if (invItems.some((it) => it.sku === item.sku)) return;
    setInvItems((prev) => [...prev, { item_name: item.item_name, sku: item.sku, quantity: "", unit: item.unit, unit_cost: "" }]);
  };

  const poLookupQ = useQuery({
    queryKey: ["po-lookup-sales", form.po_number],
    enabled: !!form.po_number.trim(),
    queryFn: async () => {
      const data = await api.get<any>(`/purchase-orders/by-po/${encodeURIComponent(form.po_number.trim())}`);
      return data ?? { proformas: [], advances: [] };
    },
  });

  useEffect(() => {
    if (!editing && poLookupQ.data?.proformas) {
      const salesPf = poLookupQ.data.proformas.find((p: any) => p.side === "sales");
      if (salesPf?.debtor_id && !form.debtor_id) {
        setForm((prev: any) => ({ ...prev, debtor_id: salesPf.debtor_id }));
      }
    }
  }, [poLookupQ.data]);

  const termsDays = Number(form.payment_terms_days) || 30;
  const computedDue = (() => {
    const base = form.due_date_source === "bl" && form.bl_date ? form.bl_date : form.issue_date;
    if (!base) return "";
    const d = new Date(base);
    d.setDate(d.getDate() + termsDays);
    return d.toISOString().slice(0, 10);
  })();
  // Always show computedDue when hasDueDate is true, unless manually overridden
  const effectiveDue = hasDueDate ? (isDueDateOverridden ? form.due_date : computedDue) : "";

  const save = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please add a debtor first.");
      const payload: any = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: hasDueDate ? (isDueDateOverridden ? form.due_date : computedDue) : null,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        bl_date: form.bl_date || null,
        due_date_source: form.due_date_source,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        purchase_invoice_id: form.purchase_invoice_id || null,
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
        await api.patch(`/invoices/${editing.id}`, payload);
      } else {
        await api.post("/invoices", payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["advances"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      toast.success(editing ? "Invoice updated" : "Invoice submitted for review.");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{editing ? "Edit invoice" : "Submit invoice"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-5">
          {debtors.length === 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              No debtors exist yet. Ask your factor admin to add one in the Debtors tab.
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-primary">Purchase order</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PO number"><input maxLength={80} className="inp" value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} placeholder="PO-2026-001" /></Field>
              <Field label="PO date"><input type="date" className="inp" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} /></Field>
            </div>
          </div>

          {form.po_number.trim() && poLookupQ.data?.proformas && poLookupQ.data.proformas.filter((p: any) => p.side === "sales").length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="mb-1 uppercase tracking-widest text-primary">Proforma linked to PO {form.po_number}</div>
              {(() => {
                const salesPf = poLookupQ.data.proformas.find((p: any) => p.side === "sales");
                if (!salesPf) return <div className="text-muted-foreground">No sales proforma found for this PO.</div>;
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Proforma #</span><span className="font-mono">{salesPf.proforma_number || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="num">{fmtMoney(salesPf.amount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-warning">{salesPf.proforma_status?.replace("_", " ")}</span></div>
                  </div>
                );
              })()}
            </div>
          )}

          <Field label="Invoice number"><input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className="inp" placeholder="INV-00123" /></Field>
          <Field label="Debtor">
            <select required value={form.debtor_id} onChange={(e) => setForm({ ...form, debtor_id: e.target.value })} className="inp">
              <option value="">Select debtor</option>
              {debtors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Total invoice amount (USD)">
            <input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            {invEnabled && inventoryTotal > 0 && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Auto-calculated from inventory: <span className="font-mono text-primary">{fmtMoney(inventoryTotal)}</span>
                {Number(form.amount) !== inventoryTotal && (
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, amount: String(inventoryTotal) }))}
                    className="ml-2 underline hover:text-primary">
                    Recalculate
                  </button>
                )}
              </div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="inp" /></Field>
            <Field label="BL date">
              <input type="date" value={form.bl_date} onChange={(e) => setForm({ ...form, bl_date: e.target.value })} className="inp" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment terms (days)">
              <input required type="number" min="0" className="inp" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
            </Field>
            <Field label="Due date source">
              <select className="inp" value={form.due_date_source} onChange={(e) => setForm({ ...form, due_date_source: e.target.value })}>
                <option value="invoice">From invoice date</option>
                <option value="bl">From BL date</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Due date (auto: ${termsDays}d net from ${form.due_date_source === "bl" ? "BL" : "invoice"} date)`}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hasDueDate} onChange={(e) => {
                    const v = e.target.checked;
                    setHasDueDate(v);
                    setIsDueDateOverridden(false);
                    if (!v) setForm({ ...form, due_date: "" });
                    else setForm({ ...form, due_date: "" });
                  }} />
                  Enable due date
                </label>
                {hasDueDate && (
                  <div className="flex items-center gap-2">
                    <input type="date" value={effectiveDue} onChange={(e) => {
                      setIsDueDateOverridden(true);
                      setForm({ ...form, due_date: e.target.value });
                    }} className="inp flex-1" />
                    {isDueDateOverridden && (
                      <button type="button" onClick={() => {
                        setIsDueDateOverridden(false);
                        setForm({ ...form, due_date: "" });
                      }}
                        className="shrink-0 rounded-md border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary transition-colors">
                        Auto
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Field>
            <Field label="Contractual payment terms">
              <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <input type="checkbox" checked={form.has_contractual_due_date} onChange={(e) => setForm({ ...form, has_contractual_due_date: e.target.checked })} />
                Has contractual payment terms
              </label>
              <p className="mt-1 text-[10px] text-muted-foreground">
                When checked, displays "Yes" in the invoices list. Does not affect late days or due date calculations.
              </p>
            </Field>
          </div>

            <Field label="Link to purchase invoice (optional)">
              <select className="inp" value={form.purchase_invoice_id} onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}>
                <option value="">— No link —</option>
                {purchases.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.invoice_number} · {fmtMoney(p.amount)}</option>
                ))}
              </select>
            </Field>
          {!editing && (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={invEnabled} onChange={(e) => setInvEnabled(e.target.checked)} />
                <span className="uppercase tracking-widest text-muted-foreground">Track inventory (stock-out / debit)</span>
              </label>
              {invEnabled && (
                <div className="mt-3 space-y-4">
                  {/* SKU search to add items from available stock */}
                  {availableInventory.length > 0 && (
                    <div className="relative">
                      <input type="text" placeholder="Search by SKU or item name..." value={invSearch}
                        onChange={(e) => setInvSearch(e.target.value)}
                        className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                      {invSearch.trim() && (
                        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                          {filteredInv.length === 0 ? (
                            <div className="p-2 text-xs text-muted-foreground">No matching items in stock</div>
                          ) : filteredInv.map((avail) => (
                            <button key={avail.sku} type="button"
                              onClick={() => { addInvItem(avail); setInvSearch(""); }}
                              className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-muted/50 transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-primary">{avail.sku || avail.item_name}</span>
                                <span className="text-muted-foreground">{avail.item_name}</span>
                              </div>
                              <span className="text-muted-foreground">{avail.qty} {avail.unit} on hand · {fmtMoney(avail.qty > 0 ? avail.value / avail.qty : 0)}/unit</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {availableInventory.length === 0 && (
                    <div className="text-xs text-muted-foreground">No stock available. Add inventory via purchase invoices first.</div>
                  )}
                  {/* Selected items */}
                  {invItems.map((item, idx) => (
                    <div key={idx} className="relative rounded-md border border-border bg-background/40 p-3 pt-5">
                      <button type="button" onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute right-2 top-2 text-muted-foreground hover:text-destructive" aria-label="Remove item">
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">{item.sku}</span>
                        <span className="text-xs text-muted-foreground">{item.item_name} · {item.unit}</span>
                      </div>
                      <div className="mb-3 text-[10px] text-muted-foreground">Available: {(() => { const a = availableInventory.find((i: any) => i.sku === item.sku); return a ? `${a.qty} ${a.unit}` : "—"; })()}</div>
                      <div className="mb-2 text-[10px] text-muted-foreground">
                        Stock-in price: {(() => {
                          const a = availableInventory.find((i: any) => i.sku === item.sku);
                          return a && a.qty > 0 ? fmtMoney(a.value / a.qty) : "—";
                        })()}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Qty to sell *">
                          <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 10.5)" className="inp" value={item.quantity} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                        </Field>
                        <Field label="Unit cost (selling price)">
                          <input type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 49.99)" className="inp" value={item.unit_cost} onChange={(e) => setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, unit_cost: e.target.value } : it))} />
                        </Field>
                      </div>
                    </div>
                  ))}
                  {invItems.length === 0 && availableInventory.length > 0 && (
                    <div className="text-xs text-muted-foreground">Search and select items above to add them to this invoice.</div>
                  )}
                </div>
              )}
            </div>
          )}
          <DocumentUploader userId={""} scope="invoices" docs={docs} onChange={setDocs}
            hint="Attach the invoice PDF, BL, packing list, or other supporting paperwork." />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editing ? "Save changes" : "Submit"}
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

function InvoiceDetailModal({ invoice, inventory, onClose }: { invoice: any; inventory: any[]; onClose: () => void }) {
  const invDocs: DocMeta[] = Array.isArray(invoice.documents) ? invoice.documents : [];
  const debtor = invoice.debtor;
  const purchase = invoice.purchase;
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
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
              invoice.noa_status === "accepted" ? "border-success/50 text-success"
              : invoice.noa_status === "rejected" ? "border-destructive/50 text-destructive"
              : invoice.noa_status === "sent" ? "border-warning/50 text-warning"
              : "border-border text-muted-foreground"
            }`}>
              NOA: {invoice.noa_status?.replace("_", " ")}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* Invoice summary */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">Invoice details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Detail label="Amount" value={fmtMoney(invoice.amount)} />
              <Detail label="Amount received" value={invoice.amount_received != null ? fmtMoney(invoice.amount_received) : "—"} />
              <Detail label="Issue date" value={fmtDate(invoice.issue_date)} />
              <Detail label="ERP Due date" value={fmtDate(invoice.due_date)} />
              <Detail label="Contractual payment terms" value={invoice.has_contractual_due_date ? "Yes" : "N/A"} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (from ${invoice.due_date_source === "bl" ? "BL" : "invoice"} date)` : "—"} />
              {invoice.bl_date && <Detail label="BL date" value={fmtDate(invoice.bl_date)} />}
              <Detail label="Paid date" value={invoice.paid_date ? fmtDate(invoice.paid_date) : "—"} />
              <Detail label="Advance received" value={invoice.advance_received_date ? fmtDate(invoice.advance_received_date) : "—"} />
              <Detail label="Created" value={fmtDate(invoice.created_at)} />
              <Detail label="Last updated" value={fmtDate(invoice.updated_at)} />
              {invoice.po_number && <Detail label="PO number" value={invoice.po_number} />}
              {invoice.po_date && <Detail label="PO date" value={fmtDate(invoice.po_date)} />}
              {invoice.short_payment != null && <Detail label="Short payment" value={fmtMoney(invoice.short_payment)} />}
              {invoice.late_days != null && <Detail label="Late days" value={String(invoice.late_days)} />}
              {invoice.paid_note && <Detail label="Payment note" value={invoice.paid_note} />}
            </div>
            {invoice.noa_comments && (
              <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">NOA comments</div>
                <p className="mt-1 text-xs italic">"{invoice.noa_comments}"</p>
              </div>
            )}
          </div>

          {/* Debtor details */}
          {debtor && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Building2 className="mr-1 inline h-3.5 w-3.5" />Debtor
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Name" value={debtor.name} />
                <Detail label="Contact" value={debtor.contact_name || "—"} />
                <Detail label="Email" value={debtor.contact_email || "—"} />
                <Detail label="Phone" value={debtor.contact_phone || "—"} />
                <Detail label="Industry" value={debtor.industry || "—"} />
                <Detail label="Credit limit" value={fmtMoney(debtor.credit_limit)} />
                <Detail label="Risk score" value={debtor.risk_score != null ? `${debtor.risk_score}/100` : "—"} />
                {debtor.address_line && <Detail label="Address" value={[debtor.address_line, debtor.city, debtor.country].filter(Boolean).join(", ")} />}
                {debtor.website && <Detail label="Website" value={debtor.website} />}
              </div>
              {debtor.notes && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
                  <p className="mt-1 text-xs text-muted-foreground">{debtor.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Linked purchase invoice / supplier */}
          {purchase && (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
                <Link2 className="mr-1 inline h-3.5 w-3.5" />Linked purchase invoice
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Detail label="Invoice #" value={purchase.invoice_number} />
                <Detail label="Amount" value={fmtMoney(purchase.amount)} />
                <Detail label="Status" value={purchase.status} />
                {purchase.vendor && (
                  <>
                    <Detail label="Supplier" value={purchase.vendor.name} />
                    <Detail label="Supplier contact" value={purchase.vendor.contact_name || "—"} />
                    <Detail label="Supplier email" value={purchase.vendor.contact_email || "—"} />
                  </>
                )}
                {purchase.due_date && <Detail label="ERP Due date" value={fmtDate(purchase.due_date)} />}
                {purchase.po_number && <Detail label="PO number" value={purchase.po_number} />}
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

          {/* Documents */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-primary">
              <FileText className="mr-1 inline h-3.5 w-3.5" />Attachments ({invDocs.length})
            </h4>
            {invDocs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No documents attached to this invoice.</div>
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
              <div className="text-xs text-muted-foreground">No inventory movements linked to this invoice.</div>
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
            <button onClick={() => exportSalesInvoicePdf(invoice)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:border-primary hover:text-primary transition-colors">
              <Printer className="h-3.5 w-3.5" /> Download PDF
            </button>
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>{children}</label>;
}

// ── Mass Import Modal ──

interface ImportRow {
  invoice_number: string;
  amount: number;
  issue_date: string;
}

function MassImportModal({ onClose, debtors }: { onClose: () => void; debtors: any[] }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "preview" | "done">("form");
  const [debtorId, setDebtorId] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [dueDateSource, setDueDateSource] = useState<"invoice" | "bl">("invoice");
  const [blDate, setBlDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [hasContractualDueDate, setHasContractualDueDate] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!debtorId) {
      toast.error("Please select a debtor first");
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
          let dateStr = String(issDate);
          if (typeof issDate === "number" && !isNaN(issDate)) {
            // Excel serial date
            const d = new Date((issDate - 25569) * 86400 * 1000);
            dateStr = d.toISOString().slice(0, 10);
          }

          return {
            invoice_number: String(invNum).trim(),
            amount: isNaN(amt) ? 0 : amt,
            issue_date: dateStr || "",
          };
        }).filter((r) => r.invoice_number && r.amount > 0);

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
        debtor_id: debtorId,
        payment_terms_days: Number(paymentTermsDays) || 30,
        due_date_source: dueDateSource,
        bl_date: blDate || null,
        has_contractual_due_date: hasContractualDueDate,
        po_number: poNumber.trim() || null,
        po_date: poDate || null,
        advance_rate: 0,
        fee_rate: 0,
        invoices: rows.map((r) => ({
          invoice_number: r.invoice_number,
          amount: r.amount,
          issue_date: r.issue_date,
        })),
      };
      return await api.post<{ created: any[]; errors: Array<{ invoice_number: string; error: string }> }>("/invoices/batch", payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      const errList = (data.errors ?? []).map((e) => `${e.invoice_number}: ${e.error}`);
      setResult({ created: data.created.length, errors: errList });
      setStep("done");
      if (errList.length === 0) {
        toast.success(`${data.created.length} invoices created successfully`);
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
    const d = new Date(base);
    d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
    return d.toISOString().slice(0, 10);
  }, [rows, dueDateSource, blDate, paymentTermsDays]);

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {step === "form" ? "Mass import invoices" : step === "preview" ? "Preview imported invoices" : "Import complete"}
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
              Each row becomes a separate invoice. Due dates are auto-calculated from payment terms.
            </div>

            <Field label="Debtor *">
              <select required value={debtorId} onChange={(e) => setDebtorId(e.target.value)} className="inp">
                <option value="">Select debtor</option>
                {debtors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment terms (days) *">
                <input required type="number" min="0" className="inp" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
              </Field>
              <Field label="Due date source">
                <select className="inp" value={dueDateSource} onChange={(e) => setDueDateSource(e.target.value as any)}>
                  <option value="invoice">From invoice date</option>
                  <option value="bl">From BL date</option>
                </select>
              </Field>
            </div>

            {dueDateSource === "bl" && (
              <Field label="BL date">
                <input type="date" className="inp" value={blDate} onChange={(e) => setBlDate(e.target.value)} />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="PO number (optional)">
                <input className="inp" placeholder="PO-2026-001" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </Field>
              <Field label="PO date">
                <input type="date" className="inp" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </Field>
            </div>

            <div className="border-t border-border pt-4">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={hasContractualDueDate} onChange={(e) => setHasContractualDueDate(e.target.checked)} />
                <span className="uppercase tracking-widest text-muted-foreground">Has contractual payment terms</span>
              </label>
              <p className="mt-1 text-[10px] text-muted-foreground">
                When checked, displays "Yes" in the invoices list for all imported invoices. Does not affect late days or due date calculations.
              </p>
            </div>

            <div className="border-t border-border pt-4">
              <Field label="Upload Excel / CSV file *">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                  onChange={handleFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                />
              </Field>
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
              <div className="flex justify-between"><span className="text-muted-foreground">Debtor</span><span>{debtors.find((d: any) => d.id === debtorId)?.name ?? "—"}</span></div>
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
                    const base = dueDateSource === "bl" && blDate ? blDate : r.issue_date;
                    const d = new Date(base);
                    d.setDate(d.getDate() + (Number(paymentTermsDays) || 30));
                    const dueStr = d.toISOString().slice(0, 10);
                    return (
                      <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-5 py-3 text-sm">{fmtDate(r.issue_date)}</td>
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
              <div className="text-xs text-muted-foreground mt-1">Invoices created successfully</div>
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

