import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Trash2, Save, Eye, FileText, Building2, Package, Download, User, ArrowUpDown, Upload } from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/app/purchases")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
  }),
  component: PurchasesPage,
});

const datePresets = [
  {
    label: "Today",
    getRange: () => {
      const today = new Date().toISOString().slice(0, 10);
      return { from: today, to: today };
    },
  },
  {
    label: "This week",
    getRange: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const from = new Date(now);
      from.setDate(now.getDate() - dayOfWeek);
      const to = new Date(now);
      to.setDate(from.getDate() + 6);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "This quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), (q + 1) * 3, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "Last quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), (q - 1) * 3, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), q * 3, 0).toISOString().slice(0, 10);
      return { from, to };
    },
  },
  {
    label: "This year",
    getRange: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
      return { from, to };
    },
  },
];

function PurchasesPage() {
  const { view } = Route.useSearch();
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
  const [sortField, setSortField] = useState<"issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const piQ = useQuery({
    queryKey: ["purchase_invoices", searchQuery],
    queryFn: async () => {
      const url = searchQuery.trim() ? `/purchase-invoices?search=${encodeURIComponent(searchQuery.trim())}` : "/purchase-invoices";
      return (await api.get<any[]>(url)) ?? [];
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

  // Auto-open detail modal when navigating from a linked invoice
  useEffect(() => {
    if (view && piQ.data) {
      const found = piQ.data.find((p: any) => p.id === view);
      if (found) {
        setViewing(found);
        navigate({ to: "/app/purchases", search: { view: undefined }, replace: true });
      }
    }
  }, [view, piQ.data]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "paid") patch.paid_date = new Date().toISOString().slice(0, 10);
      await api.patch(`/purchase-invoices/${id}`, patch);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchase_invoices"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

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

  const filtered = (piQ.data ?? []).filter((p: any) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (issueDateFrom && p.issue_date && p.issue_date < issueDateFrom) return false;
    if (issueDateTo && p.issue_date && p.issue_date > issueDateTo) return false;
    return true;
  }).sort((a: any, b: any) => {
    const aVal = sortField === "issue" ? (a.issue_date ?? "9999") : (a.due_date ?? "9999");
    const bVal = sortField === "issue" ? (b.issue_date ?? "9999") : (b.due_date ?? "9999");
    const cmp = aVal.localeCompare(bVal);
    return sortOrder === "asc" ? cmp : -cmp;
  });

  const totals = (piQ.data ?? []).reduce(
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
        description="Invoices you receive from suppliers, with PO details and links to the sales they support."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> New purchase invoice
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

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Total purchases"><div className="num num-lg">{fmtMoney(totals.all)}</div></Card>
          <Card title="Open payables"><div className="num num-lg text-warning">{fmtMoney(totals.open)}</div></Card>
          <Card title="Suppliers used"><div className="num text-3xl">{new Set((piQ.data ?? []).map((p: any) => p.vendor_id)).size}</div></Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "paid", "overdue", "disputed"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>{s}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {datePresets.map((preset) => {
            const range = preset.getRange();
            const active = issueDateFrom === range.from && issueDateTo === range.to;
            return (
              <button key={preset.label} onClick={() => {
                const r = preset.getRange();
                setIssueDateFrom(r.from);
                setIssueDateTo(r.to);
              }}
                className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest transition ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                {preset.label}
              </button>
            );
          })}
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
          <input type="text" placeholder="Search purchases by invoice, supplier, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded-lg border border-border bg-background pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort by</span>
          <div className="flex gap-1">
            {(["issue", "due"] as const).map((field) => (
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
                {field === "issue" ? "Issue date" : "Due date"}
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
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Supplier</th>
                    <th className="px-5 py-2 text-left font-normal">PO</th>
                    <th className="px-5 py-2 text-left font-normal">Issue</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">Paid</th>
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
                        {isAdmin && <td className="px-5 py-3 text-muted-foreground">{p.client?.company_name || p.client?.contact_name || "—"}</td>}
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
      </div>

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
    </div>
  );
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
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
                    </div>
                  ))}
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
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
              <Detail label="Due date" value={invoice.due_date ? fmtDate(invoice.due_date) : "—"} />
              <Detail label="Payment terms" value={invoice.payment_terms_days ? `${invoice.payment_terms_days}d net (from ${invoice.due_date_source === "bl" ? "BL" : "invoice"} date)` : "—"} />
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
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
