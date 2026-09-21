import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { logisticsApi } from "@/lib/logisticsApi";
import { shipmentLabel, shipmentPill, SHIPMENT_STATUSES, EXCEPTION_STATUSES } from "@/lib/logisticsStatus";
import { PageHeader, Card, Stat, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Truck, Loader2, FileText, AlertTriangle, RefreshCw,
  Upload, XCircle, Search, Ship, Plane, TrainFront, Bike,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/logistics")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: { tab?: string; from_type?: string; from_id?: string } = {};
    if (typeof search?.tab === "string") out.tab = search.tab;
    if (typeof search?.from_type === "string") out.from_type = search.from_type;
    if (typeof search?.from_id === "string") out.from_id = search.from_id;
    return out;
  },
  component: LogisticsPage,
});

type TabId = "dashboard" | "inbound" | "outbound" | "bookings" | "tracking" | "exceptions" | "documents" | "providers" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
  { id: "bookings", label: "Bookings" },
  { id: "tracking", label: "Tracking" },
  { id: "exceptions", label: "Exceptions" },
  { id: "documents", label: "Documents" },
  { id: "providers", label: "Providers" },
  { id: "settings", label: "Settings" },
];

const MODE_ICON: Record<string, any> = { road: Truck, air: Plane, sea: Ship, rail: TrainFront, courier: Bike };

function Pill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${shipmentPill(status)}`}>
      {shipmentLabel(status)}
    </span>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const num = (v: any) => (v === "" || v === undefined || v === null ? undefined : Number(v));

export function LogisticsPage() {
  const { canWrite, isViewer, isChecker, isAdmin } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const canEdit = canWrite("logistics") && !isViewer;
  const canApprove = isChecker || isAdmin;

  const [tab, setTab] = useState<TabId>((search.tab as TabId) || "dashboard");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");

  // Auto-open create dialog when arriving from PO / Dispatch ("Create shipment" entry point)
  useEffect(() => {
    if (search.from_type && search.from_id) setCreateOpen(true);
  }, [search.from_type, search.from_id]);

  const summaryQ = useQuery({
    queryKey: ["logistics-summary"],
    queryFn: () => logisticsApi.summary(),
    retry: false,
  });
  const listQ = useQuery({
    queryKey: ["shipments"],
    queryFn: () => logisticsApi.list(),
    retry: false,
  });
  const providersQ = useQuery({
    queryKey: ["logistics-providers"],
    queryFn: () => logisticsApi.providers(),
    retry: false,
  });

  const shipments: any[] = useMemo(() => listQ.data ?? [], [listQ.data]);
  const filtered = (fn: (s: any) => boolean) => {
    const q = listSearch.trim().toLowerCase();
    return shipments.filter((s) => {
      if (!fn(s)) return false;
      if (!q) return true;
      return `${s.shipment_number} ${s.tracking_number ?? ""} ${s.booking_reference ?? ""} ${s.linked_doc_no ?? ""} ${s.pickup?.name ?? ""} ${s.delivery?.name ?? ""}`.toLowerCase().includes(q);
    });
  };

  const counts = summaryQ.data?.counts ?? {};
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shipments"] });
    qc.invalidateQueries({ queryKey: ["logistics-summary"] });
    if (detailId) qc.invalidateQueries({ queryKey: ["shipment", detailId] });
  };

  const switchTab = (t: TabId) => {
    setTab(t);
    navigate({ to: "/app/logistics", search: { tab: t } as any });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="WhizUnik Hub · Logistics"
        title="Logistics"
        description="Book freight, track shipments and reconcile freight cost — one view for inbound, outbound, domestic and cross-border."
        actions={canEdit ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New shipment
          </Button>
        ) : undefined}
      />

      <Tabs value={tab} onValueChange={(v) => switchTab(v as TabId)}>
        <TabsList className="flex flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
              {t.id === "exceptions" && (counts.exceptions ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">{counts.exceptions}</span>
              )}
              {t.id === "bookings" && (counts.awaiting_booking ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{counts.awaiting_booking}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4 pt-2">
          <DashboardTab summaryQ={summaryQ} />
        </TabsContent>

        <TabsContent value="inbound" className="pt-2">
          <ListCard title="Inbound shipments" search={listSearch} setSearch={setListSearch} rows={filtered((s) => s.shipment_type === "inbound")} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="outbound" className="pt-2">
          <ListCard title="Outbound shipments" search={listSearch} setSearch={setListSearch} rows={filtered((s) => s.shipment_type === "outbound")} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="bookings" className="pt-2">
          <ListCard
            title="Bookings — awaiting action"
            search={listSearch}
            setSearch={setListSearch}
            rows={filtered((s) => ["draft", "quote_requested", "quote_received", "booked", "pickup_scheduled"].includes(s.status))}
            onOpen={setDetailId}
          />
        </TabsContent>
        <TabsContent value="tracking" className="pt-2">
          <ListCard title="Tracking — all active shipments" search={listSearch} setSearch={setListSearch} rows={filtered((s) => !["draft", "cancelled"].includes(s.status))} onOpen={setDetailId} showTracking />
        </TabsContent>
        <TabsContent value="exceptions" className="pt-2">
          <ListCard title="Exceptions" search={listSearch} setSearch={setListSearch} rows={filtered((s) => EXCEPTION_STATUSES.has(s.status))} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="documents" className="pt-2">
          <DocumentsTab shipments={shipments} />
        </TabsContent>
        <TabsContent value="providers" className="pt-2">
          <ProvidersTab providersQ={providersQ} canAdmin={isAdmin} onChanged={() => qc.invalidateQueries({ queryKey: ["logistics-providers"] })} />
        </TabsContent>
        <TabsContent value="settings" className="pt-2">
          <SettingsTab canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {createOpen && (
        <CreateDialog
          fromType={search.from_type}
          fromId={search.from_id}
          onClose={() => {
            setCreateOpen(false);
            navigate({ to: "/app/logistics", search: { tab } as any });
          }}
          onCreated={(id) => {
            setCreateOpen(false);
            invalidate();
            setDetailId(id);
          }}
        />
      )}

      {detailId && (
        <DetailSheet id={detailId} onClose={() => setDetailId(null)} canEdit={canEdit} canApprove={canApprove} onChanged={invalidate} />
      )}
    </div>
  );
}

// ── Dashboard ──

function DashboardTab({ summaryQ }: { summaryQ: any }) {
  if (summaryQ.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…</div>;
  if (summaryQ.isError) return <Card><div className="text-sm text-muted-foreground">Dashboard unavailable.</div></Card>;
  const d = summaryQ.data ?? {};
  const c = d.counts ?? {};
  const tile = (label: string, value: number, tone: "neutral" | "good" | "warn" | "bad" = "neutral") => (
    <Stat label={label} value={String(value)} numValue={value} format="number" tone={tone} />
  );
  const entries = (obj: Record<string, number> = {}) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tile("Awaiting booking", c.awaiting_booking ?? 0, (c.awaiting_booking ?? 0) > 0 ? "warn" : "neutral")}
        {tile("Booked, not picked up", c.booked_not_picked ?? 0)}
        {tile("In transit", c.in_transit ?? 0)}
        {tile("Delayed", c.delayed ?? 0, (c.delayed ?? 0) > 0 ? "bad" : "neutral")}
        {tile("Delivered", c.delivered ?? 0, "good")}
        {tile("Exceptions", c.exceptions ?? 0, (c.exceptions ?? 0) > 0 ? "bad" : "neutral")}
        {tile("Returns", c.returns ?? 0, (c.returns ?? 0) > 0 ? "warn" : "neutral")}
        {tile("Inbound overdue", c.inbound_overdue ?? 0, (c.inbound_overdue ?? 0) > 0 ? "bad" : "neutral")}
        {tile("Awaiting customs", c.customs_pending ?? 0, (c.customs_pending ?? 0) > 0 ? "warn" : "neutral")}
        {tile("ETA breaches", d.eta_breaches ?? 0, (d.eta_breaches ?? 0) > 0 ? "warn" : "neutral")}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Freight by transporter">
          {entries(d.freight_by_provider).length === 0 && <div className="text-sm text-muted-foreground">No billed freight yet.</div>}
          {entries(d.freight_by_provider).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><span className="truncate">{k}</span><span className="font-semibold">{fmtMoney(v)}</span></div>
          ))}
        </Card>
        <Card title="Freight by mode">
          {entries(d.freight_by_mode).length === 0 && <div className="text-sm text-muted-foreground">No billed freight yet.</div>}
          {entries(d.freight_by_mode).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><span className="capitalize">{k}</span><span className="font-semibold">{fmtMoney(v)}</span></div>
          ))}
        </Card>
        <Card title="Quote vs billed variance">
          <div className="text-2xl font-bold">{fmtMoney(d.quote_variance_total ?? 0)}</div>
          <div className="text-xs text-muted-foreground">Total (final − quoted) across shipments with both values.</div>
        </Card>
      </div>
    </div>
  );
}

// ── Shipment list ──

function ListCard({ title, rows, search, setSearch, onOpen, showTracking }: {
  title: string; rows: any[]; search: string; setSearch: (v: string) => void;
  onOpen: (id: string) => void; showTracking?: boolean;
}) {
  return (
    <Card
      title={`${title} (${rows.length})`}
      action={
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search no. / tracking / party…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No shipments here yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shipment</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Route</TableHead>
                {showTracking && <TableHead>Tracking</TableHead>}
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Freight</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const ModeIcon = MODE_ICON[s.mode] ?? Truck;
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpen(s.id)}>
                    <TableCell>
                      <div className="font-semibold">{s.shipment_number}</div>
                      <div className="text-xs text-muted-foreground">{s.linked_doc_no ?? "Manual"} · {fmtDate(s.created_at)}</div>
                    </TableCell>
                    <TableCell className="capitalize">{s.shipment_type}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{s.pickup?.name} → {s.delivery?.name}</TableCell>
                    {showTracking && <TableCell className="font-mono text-xs">{s.tracking_number ?? "—"}</TableCell>}
                    <TableCell className="text-xs">{s.carrier_name ?? s.provider_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.total_freight || s.booked_freight || s.quoted_freight || 0)}</TableCell>
                    <TableCell><Pill status={s.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <ModeIconLegend />
      </div>
    </Card>
  );
}

function ModeIconLegend() {
  return <span className="flex items-center gap-2"><Truck className="h-3.5 w-3.5" /> road <Plane className="h-3.5 w-3.5" /> air <Ship className="h-3.5 w-3.5" /> sea <TrainFront className="h-3.5 w-3.5" /> rail <Bike className="h-3.5 w-3.5" /> courier</span>;
}

// ── Create dialog ──

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="col-span-2 pt-3 text-sm font-semibold text-foreground">{children}</h3>;
}

const LINKED_DOC_OPTIONS = [
  { value: "manual", label: "Manual shipment (no linked document)" },
  { value: "goods_purchase_order", label: "Approved purchase order → inbound" },
  { value: "goods_dispatch", label: "Confirmed dispatch → outbound" },
  { value: "sales_invoice", label: "Approved sales invoice → outbound" },
  { value: "purchase_invoice", label: "Purchase invoice → inbound" },
];

// ── Searchable linked-document picker (replaces manual ID paste) ──

export type LinkableDoc = {
  id: string; number: string; party: string | null;
  date: string | null; amount: number; status: string;
};

function LinkedDocPicker({ docType, value, selectedLabel, onPick, placeholder }: {
  docType: string;
  value?: string;
  selectedLabel?: string | null;
  onPick: (doc: LinkableDoc | null) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const docsQ = useQuery({
    queryKey: ["linkable-docs", docType, debounced],
    queryFn: () => logisticsApi.linkableDocs(docType, debounced),
    enabled: docType !== "manual" && open,
    retry: false,
  });
  const docs: LinkableDoc[] = docsQ.data ?? [];

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{selectedLabel || value}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{value}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              onPick(null);
            }}
          >
            <XCircle className="h-4 w-4" /> Change
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={placeholder ?? "Search by number, party or ID…"}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
          </div>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                {docsQ.isLoading && (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                  </div>
                )}
                {!docsQ.isLoading && docsQ.isError && (
                  <div className="px-3 py-3 text-xs text-destructive">Search failed — try again.</div>
                )}
                {!docsQ.isLoading && !docsQ.isError && docs.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    {debounced ? `No eligible documents match “${debounced}”.` : "No eligible documents found."}
                  </div>
                )}
                {docs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      onPick(d);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{d.number}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[d.party, d.status].filter(Boolean).join(" · ")}
                        {d.date ? ` · ${fmtDate(d.date)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold">{fmtMoney(d.amount)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CreateDialog({ fromType, fromId, onClose, onCreated }: {
  fromType?: string; fromId?: string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({
    shipment_type: "outbound",
    linked_doc_type: fromType ?? "manual",
    linked_doc_id: fromId ?? "",
    priority: "normal",
    mode: "road",
    service_type: "standard",
    border: "domestic",
    currency: "USD",
    freight_payment: "prepaid",
    freight_payment_status: "unbilled",
    package_unit: "cartons",
    package_count: "1",
    actual_weight: "0",
    volumetric_weight: "0",
    declared_value: "0",
    estimated_freight: "0",
    quoted_freight: "0",
    final_freight: "0",
    fuel_surcharge: "0",
    insurance_charge: "0",
    other_charges: "0",
    dangerous_goods: "no",
    insurance_required: "no",
    pickup_name: "", delivery_name: "",
    provider_id: "",
  });
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const providersQ = useQuery({
    queryKey: ["logistics-providers"],
    queryFn: () => logisticsApi.providers(),
    retry: false,
  });
  const providers: any[] = providersQ.data ?? [];

  const applyPrefillResult = (prefill: any, linked_doc_no: string | null, docType: string) => {
    setForm((f) => ({
      ...f,
      shipment_type: prefill.shipment_type ?? f.shipment_type,
      pickup_name: prefill.pickup?.name ?? f.pickup_name ?? "",
      pickup_contact: prefill.pickup?.contact_person ?? f.pickup_contact ?? "",
      pickup_address: prefill.pickup?.address ?? f.pickup_address ?? "",
      pickup_city: prefill.pickup?.city ?? f.pickup_city ?? "",
      pickup_state: prefill.pickup?.state ?? f.pickup_state ?? "",
      pickup_country: prefill.pickup?.country ?? f.pickup_country ?? "",
      pickup_postal: prefill.pickup?.postal_code ?? f.pickup_postal ?? "",
      pickup_tax: prefill.pickup?.tax_id ?? f.pickup_tax ?? "",
      delivery_name: prefill.delivery?.name ?? f.delivery_name ?? "",
      delivery_contact: prefill.delivery?.contact_person ?? f.delivery_contact ?? "",
      delivery_address: prefill.delivery?.address ?? f.delivery_address ?? "",
      delivery_city: prefill.delivery?.city ?? f.delivery_city ?? "",
      delivery_state: prefill.delivery?.state ?? f.delivery_state ?? "",
      delivery_country: prefill.delivery?.country ?? f.delivery_country ?? "",
      delivery_postal: prefill.delivery?.postal_code ?? f.delivery_postal ?? "",
      delivery_tax: prefill.delivery?.tax_id ?? f.delivery_tax ?? "",
      requested_delivery_date: prefill.requested_delivery_date ?? f.requested_delivery_date ?? "",
      goods_description: prefill.goods_description ?? f.goods_description ?? "",
      declared_value: prefill.declared_value ?? f.declared_value ?? "",
      estimated_freight: prefill.estimated_freight ?? f.estimated_freight ?? "",
      delivery_challan_number: prefill.eway?.delivery_challan_number ?? f.delivery_challan_number ?? "",
      linked_doc_no: linked_doc_no ?? f.linked_doc_no ?? null,
    }));
    setPrefillNote(`Pre-filled from ${linked_doc_no ?? docType}. Buyer/supplier, items, quantities, addresses and values pulled automatically.`);
  };

  const handleLinkedDocPick = (doc: LinkableDoc | null) => {
    if (!doc) {
      setForm((f) => ({ ...f, linked_doc_id: "", linked_doc_no: null }));
      setPrefillNote(null);
      return;
    }
    const docType = form.linked_doc_type;
    setForm((f) => ({ ...f, linked_doc_id: doc.id, linked_doc_no: doc.number }));
    logisticsApi.prefill(docType, doc.id)
      .then(({ prefill, linked_doc_no }) => applyPrefillResult(prefill, linked_doc_no ?? doc.number, docType))
      .catch((e: any) => {
        setPrefillNote(e.message ?? "Pre-fill failed.");
        toast.error(e.message ?? "Pre-fill failed.");
      });
  };

  useEffect(() => {
    if (!fromType || !fromId || fromType === "manual") return;
    logisticsApi.prefill(fromType, fromId)
      .then(({ prefill, linked_doc_no }) => {
        setForm((f) => ({ ...f, linked_doc_id: fromId, linked_doc_no: linked_doc_no ?? null }));
        applyPrefillResult(prefill, linked_doc_no, fromType);
      })
      .catch((e: any) => setPrefillNote(e.message ?? "Pre-fill failed."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromType, fromId]);

  const chargeable = Math.max(Number(form.actual_weight || 0), Number(form.volumetric_weight || 0));

  const createM = useMutation({
    mutationFn: () =>
      logisticsApi.create({
        shipment_type: form.shipment_type,
        linked_doc_type: form.linked_doc_id && form.linked_doc_type !== "manual" ? form.linked_doc_type : "manual",
        linked_doc_id: form.linked_doc_id || undefined,
        priority: form.priority,
        business_unit: form.business_unit || undefined,
        sales_channel: form.sales_channel || undefined,
        mode: form.mode,
        service_type: form.service_type,
        border: form.border,
        currency: form.currency,
        freight_payment: form.freight_payment,
        pickup: {
          name: form.pickup_name,
          contact_person: form.pickup_contact || undefined,
          mobile: form.pickup_mobile || undefined,
          email: form.pickup_email || undefined,
          address: form.pickup_address || undefined,
          city: form.pickup_city || undefined,
          state: form.pickup_state || undefined,
          country: form.pickup_country || undefined,
          postal_code: form.pickup_postal || undefined,
          tax_id: form.pickup_tax || undefined,
        },
        pickup_window_from: form.pickup_window_from || undefined,
        pickup_window_to: form.pickup_window_to || undefined,
        delivery: {
          name: form.delivery_name,
          contact_person: form.delivery_contact || undefined,
          mobile: form.delivery_mobile || undefined,
          email: form.delivery_email || undefined,
          address: form.delivery_address || undefined,
          city: form.delivery_city || undefined,
          state: form.delivery_state || undefined,
          country: form.delivery_country || undefined,
          postal_code: form.delivery_postal || undefined,
          tax_id: form.delivery_tax || undefined,
        },
        requested_delivery_date: form.requested_delivery_date || undefined,
        package_unit: form.package_unit || undefined,
        package_count: num(form.package_count) ?? 0,
        package_unit_count: num(form.package_count) ?? 0,
        actual_weight: num(form.actual_weight) ?? 0,
        volumetric_weight: num(form.volumetric_weight) ?? 0,
        length_cm: num(form.length_cm) ?? undefined,
        width_cm: num(form.width_cm) ?? undefined,
        height_cm: num(form.height_cm) ?? undefined,
        declared_value: num(form.declared_value) ?? 0,
        goods_description: form.goods_description || undefined,
        hs_code: form.hs_code || undefined,
        insurance_required: form.insurance_required === "yes",
        dangerous_goods: form.dangerous_goods === "yes",
        handling_notes: form.handling_notes || undefined,
        internal_notes: form.internal_notes || undefined,
        estimated_freight: num(form.estimated_freight) ?? 0,
        quoted_freight: num(form.quoted_freight) ?? 0,
        final_freight: num(form.final_freight) ?? 0,
        fuel_surcharge: num(form.fuel_surcharge) ?? 0,
        insurance_charge: num(form.insurance_charge) ?? 0,
        other_charges: num(form.other_charges) ?? 0,
        freight_invoice_id: form.freight_invoice_id || undefined,
        freight_supplier: form.freight_supplier || undefined,
        freight_payment_status: form.freight_payment_status || undefined,
        cost_centre: form.cost_centre || undefined,
        provider_id: form.provider_id || undefined,
        carrier_name: form.carrier_name || undefined,
        service_level: form.service_level || undefined,
        tracking_number: form.tracking_number || undefined,
        booking_reference: form.booking_reference || undefined,
        container_number: form.container_number || undefined,
        vehicle_number: form.vehicle_number || undefined,
        transporter_id: form.transporter_id || undefined,
        driver_name: form.driver_name || undefined,
        driver_mobile: form.driver_mobile || undefined,
        expected_pickup_date: form.expected_pickup_date || undefined,
        expected_delivery_date: form.expected_delivery_date || undefined,
        eway: {
          eway_bill_number: form.eway_bill_number || undefined,
          eway_bill_date: form.eway_bill_date || undefined,
          eway_validity: form.eway_validity || undefined,
          transporter_id: form.transporter_id || undefined,
          vehicle_number: form.vehicle_number || undefined,
          lr_number: form.lr_number || undefined,
          delivery_challan_number: form.delivery_challan_number || undefined,
        },
        ...(form.border === "cross_border" ? {
          cross_border: {
            incoterms: form.incoterms || undefined,
            origin_country: form.origin_country || undefined,
            destination_country: form.destination_country || undefined,
            commercial_invoice_number: form.commercial_invoice_number || undefined,
            customs_broker: form.customs_broker || undefined,
          },
        } : {}),
      }),
    onSuccess: (s) => {
      toast.success(`Shipment ${s.shipment_number} created as draft — Request quotes, then Confirm booking. No stock moved.`);
      onCreated(s.id);
    },
    onError: (e: any) => toast.error(e.message ?? "Create failed"),
  });

  const sel = (k: string, options: string[]) => (
    <Select value={form[k]} onValueChange={(v) => set(k, v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
    </Select>
  );
  const yesNo = (k: string) => (
    <Select value={form[k] ?? "no"} onValueChange={(v) => set(k, v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent>
    </Select>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>New shipment</DialogTitle></DialogHeader>
        {prefillNote && <div className="rounded-lg bg-muted px-3 py-2 text-xs">{prefillNote}</div>}
        <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          Draft → Request quotes → Confirm booking → Track → POD &amp; carrier-bill link. Booking, pickup and delivery never move stock — GRN / confirmed dispatch govern inventory.
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* ── Basics ── */}
          <SectionTitle>Shipment</SectionTitle>
          <Field label="Shipment type">{sel("shipment_type", ["inbound", "outbound", "transfer", "return"])}</Field>
          <Field label="Priority">{sel("priority", ["normal", "urgent", "critical"])}</Field>
          <Field label="Linked document" span>
            <Select
              value={form.linked_doc_type}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, linked_doc_type: v, linked_doc_id: "", linked_doc_no: null }));
                setPrefillNote(null);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LINKED_DOC_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {form.linked_doc_type !== "manual" && (
            <Field label="Linked document — search & select" span>
              <LinkedDocPicker
                docType={form.linked_doc_type}
                value={form.linked_doc_id}
                selectedLabel={form.linked_doc_no}
                onPick={handleLinkedDocPick}
                placeholder="Search by document no. / party… then click to select"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Only eligible documents are listed. Selecting one auto-fills route, parties and values.
              </p>
            </Field>
          )}
          <Field label="Business unit"><Input value={form.business_unit ?? ""} onChange={(e) => set("business_unit", e.target.value)} /></Field>
          <Field label="Sales channel"><Input value={form.sales_channel ?? ""} onChange={(e) => set("sales_channel", e.target.value)} /></Field>

          {/* ── Pickup ── */}
          <SectionTitle>Pickup / sender</SectionTitle>
          <Field label="Pickup party *"><Input value={form.pickup_name ?? ""} onChange={(e) => set("pickup_name", e.target.value)} placeholder="Supplier / warehouse" /></Field>
          <Field label="Contact person"><Input value={form.pickup_contact ?? ""} onChange={(e) => set("pickup_contact", e.target.value)} /></Field>
          <Field label="Mobile"><Input value={form.pickup_mobile ?? ""} onChange={(e) => set("pickup_mobile", e.target.value)} /></Field>
          <Field label="Email"><Input value={form.pickup_email ?? ""} onChange={(e) => set("pickup_email", e.target.value)} /></Field>
          <Field label="Address" span><Input value={form.pickup_address ?? ""} onChange={(e) => set("pickup_address", e.target.value)} /></Field>
          <Field label="City"><Input value={form.pickup_city ?? ""} onChange={(e) => set("pickup_city", e.target.value)} /></Field>
          <Field label="State"><Input value={form.pickup_state ?? ""} onChange={(e) => set("pickup_state", e.target.value)} /></Field>
          <Field label="Country"><Input value={form.pickup_country ?? ""} onChange={(e) => set("pickup_country", e.target.value)} /></Field>
          <Field label="PIN / postal"><Input value={form.pickup_postal ?? ""} onChange={(e) => set("pickup_postal", e.target.value)} /></Field>
          <Field label="Tax ID / GSTIN"><Input value={form.pickup_tax ?? ""} onChange={(e) => set("pickup_tax", e.target.value)} /></Field>
          <Field label="Pickup window from"><Input type="datetime-local" value={form.pickup_window_from ?? ""} onChange={(e) => set("pickup_window_from", e.target.value)} /></Field>
          <Field label="Pickup window to"><Input type="datetime-local" value={form.pickup_window_to ?? ""} onChange={(e) => set("pickup_window_to", e.target.value)} /></Field>

          {/* ── Delivery ── */}
          <SectionTitle>Delivery / consignee</SectionTitle>
          <Field label="Consignee *"><Input value={form.delivery_name ?? ""} onChange={(e) => set("delivery_name", e.target.value)} placeholder="Warehouse / customer" /></Field>
          <Field label="Contact person"><Input value={form.delivery_contact ?? ""} onChange={(e) => set("delivery_contact", e.target.value)} /></Field>
          <Field label="Mobile"><Input value={form.delivery_mobile ?? ""} onChange={(e) => set("delivery_mobile", e.target.value)} /></Field>
          <Field label="Email"><Input value={form.delivery_email ?? ""} onChange={(e) => set("delivery_email", e.target.value)} /></Field>
          <Field label="Address" span><Input value={form.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} /></Field>
          <Field label="City"><Input value={form.delivery_city ?? ""} onChange={(e) => set("delivery_city", e.target.value)} /></Field>
          <Field label="State"><Input value={form.delivery_state ?? ""} onChange={(e) => set("delivery_state", e.target.value)} /></Field>
          <Field label="Country"><Input value={form.delivery_country ?? ""} onChange={(e) => set("delivery_country", e.target.value)} /></Field>
          <Field label="PIN / postal"><Input value={form.delivery_postal ?? ""} onChange={(e) => set("delivery_postal", e.target.value)} /></Field>
          <Field label="Consignee GSTIN"><Input value={form.delivery_tax ?? ""} onChange={(e) => set("delivery_tax", e.target.value)} /></Field>
          <Field label="Requested delivery date"><Input type="date" value={form.requested_delivery_date ?? ""} onChange={(e) => set("requested_delivery_date", e.target.value)} /></Field>

          {/* ── Cargo ── */}
          <SectionTitle>Cargo</SectionTitle>
          <Field label="Mode">{sel("mode", ["road", "air", "sea", "rail", "courier"])}</Field>
          <Field label="Service type">{sel("service_type", ["standard", "express", "surface", "air", "freight", "container"])}</Field>
          <Field label="Scope">{sel("border", ["domestic", "cross_border"])}</Field>
          <Field label="Package unit">{sel("package_unit", ["cartons", "boxes", "pallets", "bags", "drums", "rolls", "pieces"])}</Field>
          <Field label="Package count"><Input type="number" min={0} value={form.package_count ?? ""} onChange={(e) => set("package_count", e.target.value)} /></Field>
          <Field label="Actual weight (kg)"><Input type="number" min={0} value={form.actual_weight ?? ""} onChange={(e) => set("actual_weight", e.target.value)} /></Field>
          <Field label="Volumetric weight (kg)"><Input type="number" min={0} value={form.volumetric_weight ?? ""} onChange={(e) => set("volumetric_weight", e.target.value)} /></Field>
          <Field label="Chargeable weight (kg)"><Input value={String(chargeable)} disabled /></Field>
          <Field label="Length (cm)"><Input type="number" min={0} value={form.length_cm ?? ""} onChange={(e) => set("length_cm", e.target.value)} /></Field>
          <Field label="Width (cm)"><Input type="number" min={0} value={form.width_cm ?? ""} onChange={(e) => set("width_cm", e.target.value)} /></Field>
          <Field label="Height (cm)"><Input type="number" min={0} value={form.height_cm ?? ""} onChange={(e) => set("height_cm", e.target.value)} /></Field>
          <Field label="Declared goods value"><Input type="number" min={0} value={form.declared_value ?? ""} onChange={(e) => set("declared_value", e.target.value)} /></Field>
          <Field label="Currency">{sel("currency", ["USD", "INR", "EUR", "GBP", "AED", "SAR"])}</Field>
          <Field label="HSN / HS code"><Input value={form.hs_code ?? ""} onChange={(e) => set("hs_code", e.target.value)} /></Field>
          <Field label="Product description" span><Textarea value={form.goods_description ?? ""} onChange={(e) => set("goods_description", e.target.value)} rows={2} /></Field>
          <Field label="Dangerous goods">{yesNo("dangerous_goods")}</Field>
          <Field label="Insurance required">{yesNo("insurance_required")}</Field>
          <Field label="Special handling instructions" span><Textarea value={form.handling_notes ?? ""} onChange={(e) => set("handling_notes", e.target.value)} rows={2} /></Field>

          {/* ── Commercial ── */}
          <SectionTitle>Commercial</SectionTitle>
          <Field label="Freight payment">{sel("freight_payment", ["prepaid", "to_pay", "collect", "third_party"])}</Field>
          <Field label="Cost centre"><Input value={form.cost_centre ?? ""} onChange={(e) => set("cost_centre", e.target.value)} /></Field>
          <Field label="Estimated freight"><Input type="number" min={0} value={form.estimated_freight ?? ""} onChange={(e) => set("estimated_freight", e.target.value)} /></Field>
          <Field label="Quoted freight"><Input type="number" min={0} value={form.quoted_freight ?? ""} onChange={(e) => set("quoted_freight", e.target.value)} /></Field>
          <Field label="Final billed freight"><Input type="number" min={0} value={form.final_freight ?? ""} onChange={(e) => set("final_freight", e.target.value)} /></Field>
          <Field label="Fuel surcharge"><Input type="number" min={0} value={form.fuel_surcharge ?? ""} onChange={(e) => set("fuel_surcharge", e.target.value)} /></Field>
          <Field label="Insurance charge"><Input type="number" min={0} value={form.insurance_charge ?? ""} onChange={(e) => set("insurance_charge", e.target.value)} /></Field>
          <Field label="Other charges"><Input type="number" min={0} value={form.other_charges ?? ""} onChange={(e) => set("other_charges", e.target.value)} /></Field>
          <Field label="Freight invoice reference"><Input value={form.freight_invoice_id ?? ""} onChange={(e) => set("freight_invoice_id", e.target.value)} /></Field>
          <Field label="Freight supplier"><Input value={form.freight_supplier ?? ""} onChange={(e) => set("freight_supplier", e.target.value)} /></Field>
          <Field label="Freight payment status">{sel("freight_payment_status", ["unbilled", "partial", "billed", "paid"])}</Field>

          {/* ── Carrier ── */}
          <SectionTitle>Carrier</SectionTitle>
          <Field label="Logistics provider" span>
            <Select value={form.provider_id || "none"} onValueChange={(v) => set("provider_id", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {providers.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.provider_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Carrier / transporter"><Input value={form.carrier_name ?? ""} onChange={(e) => set("carrier_name", e.target.value)} /></Field>
          <Field label="Service level"><Input value={form.service_level ?? ""} onChange={(e) => set("service_level", e.target.value)} /></Field>
          <Field label="Tracking / AWB / LR / BL number"><Input value={form.tracking_number ?? ""} onChange={(e) => set("tracking_number", e.target.value)} /></Field>
          <Field label="Booking reference"><Input value={form.booking_reference ?? ""} onChange={(e) => set("booking_reference", e.target.value)} /></Field>
          <Field label="Container number"><Input value={form.container_number ?? ""} onChange={(e) => set("container_number", e.target.value)} /></Field>
          <Field label="Vehicle number"><Input value={form.vehicle_number ?? ""} onChange={(e) => set("vehicle_number", e.target.value)} /></Field>
          <Field label="Transporter ID"><Input value={form.transporter_id ?? ""} onChange={(e) => set("transporter_id", e.target.value)} /></Field>
          <Field label="Driver name"><Input value={form.driver_name ?? ""} onChange={(e) => set("driver_name", e.target.value)} /></Field>
          <Field label="Driver mobile"><Input value={form.driver_mobile ?? ""} onChange={(e) => set("driver_mobile", e.target.value)} /></Field>
          <Field label="Expected pickup date"><Input type="date" value={form.expected_pickup_date ?? ""} onChange={(e) => set("expected_pickup_date", e.target.value)} /></Field>
          <Field label="Expected delivery date"><Input type="date" value={form.expected_delivery_date ?? ""} onChange={(e) => set("expected_delivery_date", e.target.value)} /></Field>

          {/* ── Compliance ── */}
          <SectionTitle>Domestic compliance</SectionTitle>
          <Field label="e-Way bill number"><Input value={form.eway_bill_number ?? ""} onChange={(e) => set("eway_bill_number", e.target.value)} /></Field>
          <Field label="e-Way bill date"><Input type="date" value={form.eway_bill_date ?? ""} onChange={(e) => set("eway_bill_date", e.target.value)} /></Field>
          <Field label="Valid until"><Input type="date" value={form.eway_validity ?? ""} onChange={(e) => set("eway_validity", e.target.value)} /></Field>
          <Field label="LR / GR number"><Input value={form.lr_number ?? ""} onChange={(e) => set("lr_number", e.target.value)} /></Field>
          <Field label="Delivery challan number"><Input value={form.delivery_challan_number ?? ""} onChange={(e) => set("delivery_challan_number", e.target.value)} /></Field>

          {/* ── Notes ── */}
          <SectionTitle>Notes</SectionTitle>
          <Field label="Internal notes" span><Textarea value={form.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} rows={2} /></Field>
        </div>
        {form.border === "cross_border" && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
            <Field label="Incoterms"><Input value={form.incoterms ?? ""} onChange={(e) => set("incoterms", e.target.value)} placeholder="EXW / FOB / CIF / DDP" /></Field>
            <Field label="Customs broker"><Input value={form.customs_broker ?? ""} onChange={(e) => set("customs_broker", e.target.value)} /></Field>
            <Field label="Origin country"><Input value={form.origin_country ?? ""} onChange={(e) => set("origin_country", e.target.value)} /></Field>
            <Field label="Destination country"><Input value={form.destination_country ?? ""} onChange={(e) => set("destination_country", e.target.value)} /></Field>
            <Field label="Commercial invoice no."><Input value={form.commercial_invoice_number ?? ""} onChange={(e) => set("commercial_invoice_number", e.target.value)} /></Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={createM.isPending || !form.pickup_name || !form.delivery_name} onClick={() => createM.mutate()}>
            {createM.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail sheet ──

function DetailSheet({ id, onClose, canEdit, canApprove, onChanged }: {
  id: string; onClose: () => void; canEdit: boolean; canApprove: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: ["shipment", id],
    queryFn: () => logisticsApi.detail(id),
    retry: false,
  });
  const providersQ = useQuery({
    queryKey: ["logistics-providers"],
    queryFn: () => logisticsApi.providers(),
    retry: false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shipment", id] });
    onChanged();
  };

  const d = detailQ.data;
  const s = d?.shipment;
  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{s ? `Shipment ${s.shipment_number}` : "Shipment"}</SheetTitle></SheetHeader>
        {detailQ.isLoading && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {detailQ.isError && <div className="py-8 text-sm text-destructive">Failed to load shipment.</div>}
        {s && (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill status={s.status} />
              <span className="text-xs capitalize text-muted-foreground">{s.shipment_type} · {s.mode} · {s.border.replace("_", "-")}</span>
              {s.tracking_number && <span className="font-mono text-xs">AWB/LR: {s.tracking_number}</span>}
            </div>
            {s.booking_failure && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span>Provider booking failed: {s.booking_failure} — retry integrated booking or book manually. The request is retained.</span>
              </div>
            )}
            <InfoGrid s={s} />
            {canEdit && (
              <>
                <QuotesBlock s={s} quotes={d?.quotes ?? []} providers={providersQ.data ?? []} onChanged={refresh} />
                <BookingBlock s={s} providers={providersQ.data ?? []} canApprove={canApprove} onChanged={refresh} />
              </>
            )}
            <TimelineBlock events={d?.events ?? []} />
            {canEdit && <ManualEventForm id={id} onChanged={refresh} />}
            <DocsBlock s={s} canEdit={canEdit} onChanged={refresh} />
            {canEdit && <FreightLinkBlock s={s} onChanged={refresh} />}
            <AuditBlock audit={d?.audit ?? []} />
            {canEdit && canApprove && !["delivered", "cancelled", "returned"].includes(s.status) && (
              <CancelBlock id={id} onChanged={refresh} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoGrid({ s }: { s: any }) {
  const row = (k: string, v: any) => (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v ?? "—"}</span>
    </div>
  );
  const variance = Number(s.final_freight || 0) > 0 && Number(s.quoted_freight || 0) > 0
    ? Number(s.final_freight) - Number(s.quoted_freight) : null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card title="Route">
        {row("Pickup", s.pickup?.name)}
        {row("Consignee", s.delivery?.name)}
        {row("Linked doc", s.linked_doc_no ?? "Manual")}
        {row("Requested delivery", s.requested_delivery_date ? fmtDate(s.requested_delivery_date) : null)}
        {row("Expected delivery", s.expected_delivery_date ? fmtDate(s.expected_delivery_date) : null)}
        {row("e-Way Bill", s.eway?.eway_bill_number)}
        {row("LR / Vehicle", [s.eway?.lr_number, s.vehicle_number].filter(Boolean).join(" / ") || null)}
      </Card>
      <Card title="Freight">
        {row("Estimated", fmtMoney(s.estimated_freight))}
        {row("Quoted", fmtMoney(s.quoted_freight))}
        {row("Booked", fmtMoney(s.booked_freight))}
        {row("Final billed", fmtMoney(s.final_freight))}
        {row("Variance", variance === null ? null : `${variance >= 0 ? "+" : ""}${fmtMoney(variance)}`)}
        {row("Carrier invoice", s.freight_invoice_id ? "Linked" : "Not linked")}
        <div className="pt-1 text-[11px] text-muted-foreground">Booking creates no payable. Link the approved carrier bill when it arrives.</div>
      </Card>
    </div>
  );
}

function QuotesBlock({ s, quotes, providers, onChanged }: { s: any; quotes: any[]; providers: any[]; onChanged: () => void }) {
  const [manual, setManual] = useState(false);
  const [mq, setMq] = useState<Record<string, any>>({ provider_name: "", freight_charge: "" });
  const integrated = providers.filter((p: any) => p.active && p.integration_status === "integrated");

  const reqM = useMutation({
    mutationFn: (provider_id?: string) => logisticsApi.requestQuotes(s.id, provider_id),
    onSuccess: (r) => {
      toast.success(r.quotes.length > 0 ? `${r.quotes.length} quote(s) received.` : "No quotes returned.");
      if (r.failures?.length) toast.warning(r.failures.map((f) => `${f.provider}: ${f.error}`).join("; "));
      onChanged();
    },
    onError: (e: any) => toast.error(e.message ?? "Quote request failed"),
  });
  const selM = useMutation({
    mutationFn: (qid: string) => logisticsApi.selectQuote(s.id, qid),
    onSuccess: () => { toast.success("Quote selected."); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Select failed"),
  });
  const addM = useMutation({
    mutationFn: () => logisticsApi.addQuote(s.id, {
      provider_name: mq.provider_name, carrier_name: mq.carrier_name || undefined,
      freight_charge: Number(mq.freight_charge) || 0, fuel_charges: Number(mq.fuel_charges) || 0,
      other_charges: Number(mq.other_charges) || 0, insurance_charge: Number(mq.insurance_charge) || 0,
      estimated_delivery_date: mq.estimated_delivery_date || undefined,
      cancellation_terms: mq.cancellation_terms || undefined,
    }),
    onSuccess: () => { toast.success("Manual quote added."); setManual(false); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Add failed"),
  });

  return (
    <Card
      title={`Freight quotes (${quotes.length})`}
      action={
        <div className="flex gap-1">
          {integrated.length > 0 && (
            <Button size="sm" variant="outline" disabled={reqM.isPending} onClick={() => reqM.mutate(undefined)}>
              {reqM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Request quotes
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setManual((v) => !v)}><Plus className="h-3.5 w-3.5" /> Manual</Button>
        </div>
      }
    >
      {quotes.length === 0 && !manual && <div className="text-sm text-muted-foreground">No quotes yet — request from an integrated provider or enter a manual transporter quote.</div>}
      {quotes.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>ETA</TableHead><TableHead className="text-right">Total</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id} className={q.is_selected ? "bg-primary/5" : ""}>
                <TableCell><div className="text-sm font-medium">{q.provider_name}</div><div className="text-xs text-muted-foreground">{q.carrier_name} · {q.service_level}</div></TableCell>
                <TableCell className="text-xs">{q.estimated_delivery_date ? fmtDate(q.estimated_delivery_date) : "—"}</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney(q.total_cost)}</TableCell>
                <TableCell className="text-right">
                  {q.is_selected ? <span className="text-xs font-semibold text-primary">Selected</span> : (
                    <Button size="sm" variant="ghost" disabled={selM.isPending} onClick={() => selM.mutate(q.id)}>Select</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {manual && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border p-2">
          <div className="col-span-2"><Label className="text-xs">Transporter / provider *</Label><Input value={mq.provider_name ?? ""} onChange={(e) => setMq({ ...mq, provider_name: e.target.value })} /></div>
          <div><Label className="text-xs">Freight *</Label><Input type="number" value={mq.freight_charge ?? ""} onChange={(e) => setMq({ ...mq, freight_charge: e.target.value })} /></div>
          <div><Label className="text-xs">ETA</Label><Input type="date" value={mq.estimated_delivery_date ?? ""} onChange={(e) => setMq({ ...mq, estimated_delivery_date: e.target.value })} /></div>
          <div className="col-span-2"><Button size="sm" disabled={addM.isPending || !mq.provider_name || mq.freight_charge === ""} onClick={() => addM.mutate()}>Add quote</Button></div>
        </div>
      )}
    </Card>
  );
}

function BookingBlock({ s, providers, canApprove, onChanged }: { s: any; providers: any[]; canApprove: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<Record<string, any>>({ carrier_name: "", tracking_number: "", booked_freight: "" });
  const integrated = providers.filter((p: any) => p.active && p.integration_status === "integrated");
  const booked = ["booked", "pickup_scheduled", "picked_up", "in_transit", "at_hub", "at_customs", "customs_hold", "out_for_delivery", "delivered"].includes(s.status);

  const manM = useMutation({
    mutationFn: () => logisticsApi.bookManual(s.id, {
      carrier_name: b.carrier_name, tracking_number: b.tracking_number,
      booked_freight: Number(b.booked_freight) || 0, fuel_surcharge: Number(b.fuel_surcharge) || 0,
      insurance_charge: Number(b.insurance_charge) || 0, other_charges: Number(b.other_charges) || 0,
      vehicle_number: b.vehicle_number || undefined, driver_name: b.driver_name || undefined,
      driver_mobile: b.driver_mobile || undefined, transporter_id: b.transporter_id || undefined,
      expected_pickup_date: b.expected_pickup_date || undefined, expected_delivery_date: b.expected_delivery_date || undefined,
      provider_id: b.provider_id || undefined,
    }),
    onSuccess: () => { toast.success("Booking recorded. Stock unchanged — GRN/dispatch still govern inventory."); setOpen(false); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Booking failed"),
  });
  const intM = useMutation({
    mutationFn: (provider_id: string) => logisticsApi.bookIntegrated(s.id, provider_id),
    onSuccess: () => { toast.success("Booked via provider."); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Provider booking failed — shipment retained for retry."),
  });

  if (booked) {
    return (
      <Card title="Booking">
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Carrier</span><span className="font-medium">{s.carrier_name ?? "—"}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Tracking</span><span className="font-mono">{s.tracking_number ?? "—"}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Booking ref</span><span className="font-mono">{s.booking_reference ?? "—"}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Booked freight</span><span className="font-medium">{fmtMoney(s.booked_freight)}</span></div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Book freight" action={<Button size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Manual booking"}</Button>}>
      {integrated.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {integrated.map((p: any) => (
            <Button key={p.id} size="sm" variant="outline" disabled={intM.isPending} onClick={() => intM.mutate(p.id)}>
              {intM.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Truck className="mr-1 h-3.5 w-3.5" />} Book via {p.provider_name}
            </Button>
          ))}
        </div>
      )}
      {open && (
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Carrier / transporter *</Label><Input value={b.carrier_name ?? ""} onChange={(e) => setB({ ...b, carrier_name: e.target.value })} /></div>
          <div><Label className="text-xs">Tracking / AWB / LR no. *</Label><Input value={b.tracking_number ?? ""} onChange={(e) => setB({ ...b, tracking_number: e.target.value })} /></div>
          <div><Label className="text-xs">Freight *</Label><Input type="number" value={b.booked_freight ?? ""} onChange={(e) => setB({ ...b, booked_freight: e.target.value })} /></div>
          <div><Label className="text-xs">Expected delivery</Label><Input type="date" value={b.expected_delivery_date ?? ""} onChange={(e) => setB({ ...b, expected_delivery_date: e.target.value })} /></div>
          <div><Label className="text-xs">Vehicle no.</Label><Input value={b.vehicle_number ?? ""} onChange={(e) => setB({ ...b, vehicle_number: e.target.value })} /></div>
          <div><Label className="text-xs">Driver / mobile</Label><Input value={b.driver_name ?? ""} onChange={(e) => setB({ ...b, driver_name: e.target.value })} /></div>
          <div className="col-span-2">
            <Button size="sm" disabled={manM.isPending || !b.carrier_name || !b.tracking_number || b.booked_freight === ""} onClick={() => manM.mutate()}>
              {manM.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Confirm manual booking
            </Button>
            {!canApprove && <span className="ml-2 text-[11px] text-muted-foreground">Cancellation and freight changes need a manager.</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

function TimelineBlock({ events }: { events: any[] }) {
  if (events.length === 0) return null;
  const srcLabel: Record<string, string> = { carrier_api: "Carrier API", webhook: "Webhook", manual: "Manual" };
  return (
    <Card title={`Tracking timeline (${events.length})`}>
      <ol className="relative ml-2 space-y-3 border-l pl-4">
        {events.map((e) => (
          <li key={e.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Pill status={e.status} />
              <span className="text-xs text-muted-foreground">{fmtDate(e.event_at)} · {e.location ?? "—"} · {srcLabel[e.source] ?? e.source}</span>
            </div>
            {e.carrier_raw_status && e.carrier_raw_status !== e.status && (
              <div className="text-[11px] text-muted-foreground">Carrier: {e.carrier_raw_status}</div>
            )}
            {e.description && <div className="text-sm">{e.description}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ManualEventForm({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [ev, setEv] = useState<Record<string, any>>({ status: "in_transit", location: "", description: "" });
  const m = useMutation({
    mutationFn: () => logisticsApi.addEvent(id, {
      status: ev.status, location: ev.location || undefined, description: ev.description || undefined,
    }),
    onSuccess: () => { toast.success("Tracking updated."); setEv({ status: "in_transit", location: "", description: "" }); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });
  return (
    <Card title="Add tracking update">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={ev.status} onValueChange={(v) => setEv({ ...ev, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SHIPMENT_STATUSES.map((st) => <SelectItem key={st} value={st}>{shipmentLabel(st)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Location</Label><Input value={ev.location ?? ""} onChange={(e) => setEv({ ...ev, location: e.target.value })} /></div>
        <div className="col-span-2"><Label className="text-xs">Note</Label><Input value={ev.description ?? ""} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></div>
        <div className="col-span-2"><Button size="sm" disabled={m.isPending} onClick={() => m.mutate()}>Add update</Button></div>
      </div>
    </Card>
  );
}

function DocsBlock({ s, canEdit, onChanged }: { s: any; canEdit: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState("pod");
  const [busy, setBusy] = useState(false);
  const docs: any[] = s.documents ?? [];

  const uploadDocs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      fd.append("scope", "logistics");
      const uploaded = await api.upload<Array<{ path: string; name: string; type: string; size: number }>>("/upload", fd);
      for (const u of uploaded) {
        await logisticsApi.addDocument(s.id, { ...u, kind });
      }
      toast.success("Document attached.");
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Documents & POD (${docs.length})`} action={canEdit ? (
      <div className="flex items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{["pod", "label", "invoice", "certificate", "other"].map((k) => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
        </Select>
        <label className="cursor-pointer">
          <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium">
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />} Attach
          </span>
          <input type="file" multiple className="hidden" onChange={(e) => uploadDocs(e.target.files)} />
        </label>
      </div>
    ) : undefined}>
      {docs.length === 0 && <div className="text-sm text-muted-foreground">No documents yet. Attach POD on delivery, plus labels and certificates.</div>}
      {docs.map((d: any, i: number) => (
        <div key={i} className="flex items-center justify-between py-1 text-sm">
          <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.name}<span className="rounded bg-muted px-1 text-[10px] uppercase">{d.kind}</span></span>
          <a className="text-xs text-primary underline" href={`/api/upload/signed-url/${d.path}`} target="_blank" rel="noreferrer">Open</a>
        </div>
      ))}
    </Card>
  );
}

function FreightLinkBlock({ s, onChanged }: { s: any; onChanged: () => void }) {
  const [piId, setPiId] = useState("");
  const [piLabel, setPiLabel] = useState<string | null>(null);
  const [final, setFinal] = useState("");
  const m = useMutation({
    mutationFn: () => logisticsApi.linkFreightInvoice(s.id, { freight_invoice_id: piId, final_freight: final === "" ? undefined : Number(final) }),
    onSuccess: () => { toast.success("Carrier invoice linked for reconciliation."); setPiId(""); setPiLabel(null); setFinal(""); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Link failed"),
  });
  if (s.freight_invoice_id) return null;
  return (
    <Card title="Link carrier bill">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <div>
          <Label className="text-xs">Carrier purchase invoice — search & select</Label>
          <LinkedDocPicker
            docType="purchase_invoice"
            value={piId}
            selectedLabel={piLabel}
            placeholder="Search PI number / vendor… then click to select"
            onPick={(doc) => {
              setPiId(doc?.id ?? "");
              setPiLabel(doc?.number ?? null);
              if (doc && final === "") setFinal(String(doc.amount ?? ""));
            }}
          />
        </div>
        <div><Label className="text-xs">Final billed (optional)</Label><Input className="w-40" type="number" value={final} onChange={(e) => setFinal(e.target.value)} /></div>
        <div className="flex items-end"><Button size="sm" disabled={m.isPending || !piId} onClick={() => m.mutate()}>Link</Button></div>
      </div>
      <div className="pt-1 text-[11px] text-muted-foreground">Creates no payable — links the approved PI so billed cost reconciles against the quote.</div>
    </Card>
  );
}

function AuditBlock({ audit }: { audit: any[] }) {
  if (audit.length === 0) return null;
  return (
    <Card title={`Audit trail (${audit.length})`}>
      <div className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {audit.map((a: any) => (
          <div key={a.id} className="flex justify-between gap-2 border-b py-1">
            <span><span className="font-semibold">{a.action.replace(/_/g, " ")}</span></span>
            <span className="text-muted-foreground">{fmtDate(a.created_at)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CancelBlock({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => logisticsApi.cancel(id, reason || undefined),
    onSuccess: () => { toast.success("Shipment cancelled."); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Cancel failed"),
  });
  if (!confirm) {
    return <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}><XCircle className="mr-1 h-4 w-4" /> Cancel booking</Button>;
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-destructive/40 p-3">
      <div className="flex-1"><Label className="text-xs">Cancellation reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button variant="outline" onClick={() => setConfirm(false)}>Keep</Button>
      <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>Confirm cancel</Button>
    </div>
  );
}

// ── Documents tab (all attachments across shipments) ──

function DocumentsTab({ shipments }: { shipments: any[] }) {
  const rows = useMemo(() => {
    const out: any[] = [];
    for (const s of shipments) {
      for (const d of s.documents ?? []) out.push({ ...d, shipment_number: s.shipment_number, shipment_id: s.id });
    }
    return out;
  }, [shipments]);
  return (
    <Card title={`All logistics documents (${rows.length})`}>
      {rows.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No attachments yet.</div> : (
        <Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Kind</TableHead><TableHead>Shipment</TableHead><TableHead>Uploaded</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((d, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm">{d.name}</TableCell>
                <TableCell><span className="rounded bg-muted px-1 text-[10px] uppercase">{d.kind}</span></TableCell>
                <TableCell className="font-mono text-xs">{d.shipment_number}</TableCell>
                <TableCell className="text-xs">{fmtDate(d.uploaded_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ── Providers tab ──

function ProvidersTab({ providersQ, canAdmin, onChanged }: { providersQ: any; canAdmin: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({ provider_name: "", modes: ["road"], integration_status: "manual", adapter_key: "manual" });
  const adaptersQ = useQuery({ queryKey: ["logistics-adapters"], queryFn: () => logisticsApi.adapters(), enabled: open, retry: false });

  const saveM = useMutation({
    mutationFn: () => logisticsApi.createProvider({
      provider_name: form.provider_name, carrier_name: form.carrier_name || undefined,
      modes: form.modes?.length ? form.modes : ["road"],
      domestic: form.cross_border ? true : true, cross_border: !!form.cross_border,
      service_areas: form.service_areas || undefined, integration_status: form.integration_status,
      adapter_key: form.integration_status === "manual" ? "manual" : form.adapter_key,
      account_ref: form.account_ref || undefined, billing_terms: form.billing_terms || undefined,
      support_contact: form.support_contact || undefined, escalation_contact: form.escalation_contact || undefined,
      active: form.active !== false,
    }),
    onSuccess: () => { toast.success("Provider added. Credentials stay in the server secret store, never here."); setOpen(false); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  const toggleM = useMutation({
    mutationFn: (p: any) => logisticsApi.updateProvider(p.id, { active: !p.active }),
    onSuccess: () => { onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const rows: any[] = providersQ.data ?? [];
  return (
    <Card title={`Transporter / provider master (${rows.length})`} action={canAdmin ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Add provider</Button> : undefined}>
      {rows.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No providers yet — add a manual transporter to start booking.</div>}
      {rows.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Modes</TableHead><TableHead>Integration</TableHead><TableHead>Support</TableHead><TableHead>Status</TableHead>{canAdmin && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {rows.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell><div className="font-medium">{p.provider_name}</div><div className="text-xs text-muted-foreground">{p.carrier_name ?? p.account_ref ?? ""}</div></TableCell>
                <TableCell className="text-xs">{(p.modes ?? []).join(", ")}{p.cross_border ? " · cross-border" : ""}</TableCell>
                <TableCell className="text-xs">{p.integration_status} · {p.adapter_key}</TableCell>
                <TableCell className="text-xs">{p.support_contact ?? "—"}</TableCell>
                <TableCell>{p.active ? <span className="text-xs font-semibold text-green-600">Active</span> : <span className="text-xs text-muted-foreground">Inactive</span>}</TableCell>
                {canAdmin && <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => toggleM.mutate(p)}>{p.active ? "Deactivate" : "Activate"}</Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {open && (
        <Dialog open onOpenChange={() => setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>New provider</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label className="text-xs">Provider name *</Label><Input value={form.provider_name ?? ""} onChange={(e) => setForm({ ...form, provider_name: e.target.value })} /></div>
              <div><Label className="text-xs">Carrier name</Label><Input value={form.carrier_name ?? ""} onChange={(e) => setForm({ ...form, carrier_name: e.target.value })} /></div>
              <div><Label className="text-xs">Integration</Label>
                <Select value={form.integration_status} onValueChange={(v) => setForm({ ...form, integration_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="manual">manual</SelectItem><SelectItem value="integrated">integrated</SelectItem><SelectItem value="disabled">disabled</SelectItem></SelectContent>
                </Select>
              </div>
              {form.integration_status === "integrated" && (
                <div><Label className="text-xs">Adapter</Label>
                  <Select value={form.adapter_key} onValueChange={(v) => setForm({ ...form, adapter_key: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(adaptersQ.data ?? []).map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div><Label className="text-xs">Account / client code ref</Label><Input value={form.account_ref ?? ""} onChange={(e) => setForm({ ...form, account_ref: e.target.value })} placeholder="Reference only — no secrets" /></div>
              <div className="col-span-2"><Label className="text-xs">Service areas</Label><Input value={form.service_areas ?? ""} onChange={(e) => setForm({ ...form, service_areas: e.target.value })} /></div>
              <div><Label className="text-xs">Support contact</Label><Input value={form.support_contact ?? ""} onChange={(e) => setForm({ ...form, support_contact: e.target.value })} /></div>
              <div><Label className="text-xs">Escalation contact</Label><Input value={form.escalation_contact ?? ""} onChange={(e) => setForm({ ...form, escalation_contact: e.target.value })} /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.cross_border} onChange={(e) => setForm({ ...form, cross_border: e.target.checked })} /> Serves cross-border</label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={saveM.isPending || !form.provider_name} onClick={() => saveM.mutate()}>Save provider</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ── Settings tab ──

function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const settingsQ = useQuery({ queryKey: ["logistics-settings"], queryFn: () => logisticsApi.settings(), retry: false });
  const [form, setForm] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (settingsQ.data && !form) setForm(settingsQ.data);
  }, [settingsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveM = useMutation({
    mutationFn: () => logisticsApi.saveSettings(form ?? {}),
    onSuccess: () => toast.success("Settings saved."),
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  if (settingsQ.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const f = form ?? settingsQ.data ?? {};
  const numField = (k: string, label: string) => (
    <div><Label className="text-xs">{label}</Label><Input type="number" disabled={!canEdit} value={f[k] ?? ""} onChange={(e) => setForm({ ...f, [k]: Number(e.target.value) })} /></div>
  );
  return (
    <Card title="Logistics settings" action={canEdit ? <Button size="sm" disabled={saveM.isPending} onClick={() => saveM.mutate()}>Save</Button> : undefined}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {numField("delay_buffer_days", "Delay buffer (days)")}
        {numField("stale_tracking_hours", "Stale tracking threshold (hrs)")}
        {numField("eway_expiry_warn_hours", "e-Way Bill warn window (hrs)")}
        {numField("pod_grace_hours", "POD grace (hrs after delivery)")}
        {numField("freight_variance_pct", "Freight variance alert (%)")}
        <div>
          <Label className="text-xs">Default mode</Label>
          <Select disabled={!canEdit} value={f.default_mode ?? "road"} onValueChange={(v) => setForm({ ...f, default_mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["road", "air", "sea", "rail", "courier"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="pt-2 text-xs text-muted-foreground">
        Webhook endpoint for carriers: <span className="font-mono">POST /api/logistics/webhooks/:adapterKey</span> (HMAC verified per adapter).
      </div>
    </Card>
  );
}

// ── Re-exports used as entry points from PO / Dispatch screens ──

export function CreateShipmentLink({ type, id, label, disabled }: { type: string; id: string; label?: string; disabled?: boolean }) {
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => navigate({ to: "/app/logistics", search: { tab: "dashboard", from_type: type, from_id: id } as any })}
    >
      <Truck className="mr-1 h-3.5 w-3.5" /> {label ?? "Create shipment"}
    </Button>
  );
}
