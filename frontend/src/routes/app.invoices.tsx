import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, StatusPill, fmtMoney, fmtDate, daysBetween } from "@/components/ledger-ui";
import { Plus, X, Loader2, Link2, Send, Copy, Trash2, Save, Eye, FileText, Building2, User, Package, Download, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { DocumentUploader, type DocMeta } from "@/components/document-uploader";

export const Route = createFileRoute("/app/invoices")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
  }),
  component: InvoicesPage,
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
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [sortField, setSortField] = useState<"issue" | "due">("issue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const invoicesQ = useQuery({
    queryKey: ["invoices", "list"],
    queryFn: async () => (await api.get<any[]>("/invoices")) ?? [],
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

  const canSendNoa = canWrite("invoices") || canWrite("checker-desk");
  const copyNoa = (i: any) => {
    const link = `${window.location.origin}/noa/${i.noa_token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("NOA link copied");
  };

  // Auto-open detail modal when navigating from a linked invoice
  useEffect(() => {
    if (view && invoicesQ.data) {
      const found = invoicesQ.data.find((i: any) => i.id === view);
      if (found) {
        setViewing(found);
        navigate({ to: "/app/invoices", search: { view: undefined }, replace: true });
      }
    }
  }, [view, invoicesQ.data]);

  const filtered = (invoicesQ.data ?? []).filter((i: any) => {
    if (filter !== "all" && i.status !== filter) return false;
    if (issueDateFrom && i.issue_date && i.issue_date < issueDateFrom) return false;
    if (issueDateTo && i.issue_date && i.issue_date > issueDateTo) return false;
    const q = searchQuery.toLowerCase();
    return (
      i.invoice_number?.toLowerCase().includes(q) ||
      i.debtor?.name?.toLowerCase().includes(q) ||
      i.po_number?.toLowerCase().includes(q) ||
      i.status?.toLowerCase().includes(q) ||
      i.client?.company_name?.toLowerCase().includes(q) ||
      i.client?.contact_name?.toLowerCase().includes(q)
    );
  }).sort((a: any, b: any) => {
    const aVal = sortField === "issue" ? (a.issue_date ?? "9999") : (a.due_date ?? "9999");
    const bVal = sortField === "issue" ? (b.issue_date ?? "9999") : (b.due_date ?? "9999");
    const cmp = aVal.localeCompare(bVal);
    return sortOrder === "asc" ? cmp : -cmp;
  });

  return (
    <div>
      <PageHeader
        eyebrow="Invoices"
        title={isAdmin ? "Invoice queue" : "Your invoices"}
        description={isAdmin ? "Submitted invoices route to the checker for approval before reaching treasury." : "Submit invoices; the checker reviews them before they enter the funding queue."}
        actions={
          canCreate ? (
            <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New invoice
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="p-6 md:p-10 space-y-6">
        <div className="flex flex-wrap gap-2">
          {["all", "pending", "approved", "advanced", "paid", "overdue", "rejected"].map((s) => (
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
          <input type="text" placeholder="Search invoices by number, debtor, PO..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
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
          {invoicesQ.isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No invoices.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">UID</th>
                    <th className="px-5 py-2 text-left font-normal">Invoice</th>
                    {isAdmin && <th className="px-5 py-2 text-left font-normal">Client</th>}
                    <th className="px-5 py-2 text-left font-normal">Debtor</th>
                    <th className="px-5 py-2 text-left font-normal">Issue</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Due</th>
                    <th className="px-5 py-2 text-left font-normal">Paid</th>
                    <th className="px-5 py-2 text-right font-normal">Late days</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-left font-normal">NOA</th>
                    <th className="px-5 py-2 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => {
                    const dpd = i.due_date && i.status !== "paid" ? daysBetween(i.due_date) : 0;
                    const lateDays = i.status === "paid"
                      ? (i.late_days != null ? Number(i.late_days) : 0)
                      : Math.max(0, dpd);
                    return (
                      <tr key={i.id} className="border-b border-border/60 hover:bg-muted/30">
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
                        <td className="px-5 py-3 text-sm">{fmtDate(i.due_date)}</td>
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
          )}
        </Card>
      </div>

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
  const effectiveDue = form.due_date || computedDue;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.debtor_id) throw new Error("Please add a debtor first.");
      const payload: any = {
        debtor_id: form.debtor_id,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        fee_rate: 0,
        issue_date: form.issue_date,
        due_date: hasDueDate ? effectiveDue : null,
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
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
          <Field label="Total invoice amount (USD)"><input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" title="Enter a positive number (e.g. 123.45)" className="inp" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
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
                    if (!v) setForm({ ...form, due_date: "" });
                    else setForm({ ...form, due_date: computedDue });
                  }} />
                  Enable due date
                </label>
                {hasDueDate && (
                  <input type="date" value={effectiveDue} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="inp" />
                )}
              </div>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-vault" onClick={(e) => e.stopPropagation()}>
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
              <Detail label="Due date" value={fmtDate(invoice.due_date)} />
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
                {purchase.due_date && <Detail label="Due date" value={fmtDate(purchase.due_date)} />}
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
