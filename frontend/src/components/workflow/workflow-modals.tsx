import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

export function CreateProformaModal({ task, onClose }: { task: any; onClose: () => void }) {
  const qc = useQueryClient();
  const linked = task.linked_docs?.[0];
  const poId = linked?.id ?? task.doc_id;
  const docType = linked?.type ?? task.doc_type; // purchase_order or sales_order
  const isPurchase = docType.includes("purchase");
  const detailQ = useQuery({
    queryKey: ["proforma-source", docType, poId],
    queryFn: async () => {
      if (docType === "sales_order" || docType === "sales-order") return await api.get<any>(`/goods-sales-orders/${poId}`);
      return await api.get<any>(`/goods-purchase-orders/${poId}`);
    },
    enabled: !!poId,
  });
  const src: any = detailQ.data;
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (src?.grand_total != null) setAmount(String(src.grand_total)); }, [src?.grand_total]);
  const create = useMutation({
    mutationFn: async () => {
      if (isPurchase) {
        await api.post("/purchase-orders", {
          side: "purchase",
          vendor_id: src?.supplier_id ?? null,
          po_number: src?.po_number,
          amount: Number(amount) || src?.grand_total,
          notes: notes || `Proforma for ${src?.po_number}`,
          // backend will set pending_review
        });
      } else {
        await api.post("/purchase-orders", {
          side: "sales",
          customer_id: src?.customer_id ?? src?.billing_customer_id ?? null,
          po_number: src?.so_number,
          amount: Number(amount) || src?.grand_total,
          notes: notes || `Proforma for ${src?.so_number}`,
        });
      }
    },
    onSuccess: () => { toast.success("Proforma created — sent to checker"); qc.invalidateQueries({ queryKey: ["workflow-queue"] }); qc.invalidateQueries({ queryKey: ["workflow-tasks"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">Create {isPurchase ? "Purchase" : "Sales"} Proforma <span className="font-mono text-primary">{src?.po_number ?? src?.so_number ?? ""}</span></h3><button onClick={onClose}><X className="h-4 w-4"/></button></div>
        {detailQ.isLoading ? <div className="py-6 text-sm text-muted-foreground">Loading linked order…</div> : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">Linked order: <span className="font-mono font-semibold">{src?.po_number ?? src?.so_number}</span> · {src?.supplier_name ?? src?.customer_name ?? ""} · {src?.lines?.length ?? 0} lines · total {(src?.grand_total ?? 0).toLocaleString()}</div>
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Amount</span><input className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={amount} onChange={(e)=>setAmount(e.target.value)} /></label>
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Notes</span><textarea className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" rows={2} value={notes} onChange={(e)=>setNotes(e.target.value)} /></label>
            <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button onClick={()=>create.mutate()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{create.isPending && <Loader2 className="h-4 w-4 animate-spin"/>}Create proforma</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CreateInvoiceModal({ task, onClose }: { task: any; onClose: () => void }) {
  const qc = useQueryClient();
  const linked = task.linked_docs?.[0];
  const poId = linked?.id ?? task.doc_id;
  const docType = linked?.type ?? task.doc_type;
  const isPurchase = docType.includes("purchase");
  const detailQ = useQuery({ queryKey: ["invoice-source", docType, poId], queryFn: async () => {
    if (docType.includes("sales")) return await api.get<any>(`/goods-sales-orders/${poId}`);
    return await api.get<any>(`/goods-purchase-orders/${poId}`);
  }, enabled: !!poId });
  const src: any = detailQ.data;
  const [notes, setNotes] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      if (isPurchase) {
        if (!src?.supplier_id) throw new Error("Supplier missing on PO");
        await api.post("/purchase-invoices", {
          vendor_id: src.supplier_id,
          invoice_number: `PI-${src.po_number}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
          amount: src.grand_total,
          po_number: src.po_number,
          goods_purchase_order_id: src.id,
          notes: notes || `Invoice for ${src.po_number}`,
        });
      } else {
        await api.post("/invoices", {
          customer_id: src.customer_id ?? src.billing_customer_id,
          invoice_number: `INV-${src.so_number}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
          amount: src.grand_total,
          po_number: src.so_number,
          goods_sales_order_id: src.id,
          notes: notes || `Invoice for ${src.so_number}`,
        });
      }
    },
    onSuccess: () => { toast.success("Invoice created"); qc.invalidateQueries({ queryKey: ["workflow-queue"] }); qc.invalidateQueries({ queryKey: ["workflow-tasks"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">Create {isPurchase ? "Purchase" : "Sales"} Invoice <span className="font-mono text-primary">{src?.po_number ?? src?.so_number ?? ""}</span></h3><button onClick={onClose}><X className="h-4 w-4"/></button></div>
        {detailQ.isLoading ? <div className="py-6 text-sm text-muted-foreground">Loading linked order…</div> : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">Linked: <span className="font-mono font-semibold">{src?.po_number ?? src?.so_number}</span>{task.linked_docs?.length > 1 ? ` + proforma ${task.linked_docs[1]?.number}` : ""} · {src?.lines?.length ?? 0} lines prefilled from order</div>
            <div className="max-h-40 overflow-auto rounded border border-border text-xs">{src?.lines?.slice(0,6).map((l:any,i:number)=><div key={i} className="flex justify-between border-b border-border/60 px-2 py-1"><span>{l.name}</span><span className="font-mono">{l.ordered_qty} × {(l.unit_price ?? 0).toLocaleString()}</span></div>)}</div>
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Notes</span><textarea className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" rows={2} value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Optional" /></label>
            <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button onClick={()=>create.mutate()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{create.isPending && <Loader2 className="h-4 w-4 animate-spin"/>}Create invoice</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PaymentModal({ task, onClose }: { task: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isPurchase = task.doc_type === "purchase_invoice";
  const [utr, setUtr] = useState("");
  const [irn, setIrn] = useState("");
  const [amount, setAmount] = useState(task.amount != null ? String(task.amount) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [file, setFile] = useState<File | null>(null);
  const pay = useMutation({
    mutationFn: async () => {
      // upload file if present
      let doc: any = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        try { doc = await api.upload<any>("/upload", fd); } catch {}
      }
      if (isPurchase) {
        await api.patch(`/purchase-invoices/${task.doc_id}`, {
          status: "paid",
          paid_date: date,
          paid_amount: Number(amount) || task.amount,
          paid_note: utr ? `UTR ${utr}` : undefined,
          // optionally store utr/irn as document
          ...(doc ? { documents: [doc] } : {}),
        });
      } else {
        await api.patch(`/invoices/${task.doc_id}`, {
          status: "paid",
          paid_date: date,
          receipt_date: date,
          amount_received: Number(amount) || task.amount,
          paid_note: utr || irn ? `UTR ${utr} IRN ${irn}`.trim() : undefined,
          ...(doc ? { documents: [doc] } : {}),
        });
      }
    },
    onSuccess: () => { toast.success(isPurchase ? "Payment recorded" : "Receipt recorded"); qc.invalidateQueries({ queryKey: ["workflow-queue"] }); qc.invalidateQueries({ queryKey: ["workflow-tasks"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">{isPurchase ? "Record Payment — Purchase Invoice" : "Record UTR / IRN — Sales Invoice"} <span className="font-mono text-primary">{task.doc_number}</span></h3><button onClick={onClose}><X className="h-4 w-4"/></button></div>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Amount</span><input className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={amount} onChange={(e)=>setAmount(e.target.value)} /></label>
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Date</span><input type="date" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={date} onChange={(e)=>setDate(e.target.value)} /></label>
            <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">{isPurchase ? "UTR number" : "UTR number"}</span><input className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm font-mono" value={utr} onChange={(e)=>setUtr(e.target.value)} placeholder="UTR…" /></label>
            {!isPurchase && <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">IRN (e-invoice)</span><input className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm font-mono" value={irn} onChange={(e)=>setIrn(e.target.value)} placeholder="IRN…" /></label>}
          </div>
          <label className="block"><span className="text-xs uppercase tracking-widest text-muted-foreground">Proof upload (UTR / IRN PDF/image)</span>
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm hover:bg-muted/40"><Upload className="h-4 w-4" />{file ? file.name : "Choose file"}<input type="file" className="hidden" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} /></label>
          </label>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button><button onClick={()=>pay.mutate()} disabled={pay.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{pay.isPending && <Loader2 className="h-4 w-4 animate-spin"/>}{isPurchase ? "Confirm Payment" : "Confirm Receipt"}</button></div>
        </div>
      </div>
    </div>
  );
}
