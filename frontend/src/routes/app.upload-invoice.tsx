import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { api, getToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import {
  FileText, Loader2, CheckCircle, ArrowLeft,
  Building2, Receipt, FileUp, Eye, X, ListChecks,
  ChevronRight, Sparkles, ShieldCheck, Database, UserCheck,
  Scan, ClipboardList, SaveAll, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/upload-invoice")({
  component: UploadInvoicePage,
});

type ParsedData = {
  debtor: {
    name: string;
    registered_address: string;
    contact_email: string;
    contact_phone: string;
    registration_no: string;
  };
  invoice: {
    invoice_number: string;
    amount: number;
    issue_date: string;
    due_date: string;
    po_number: string;
  };
  raw_text_preview: string;
};

type UploadedFile = {
  path: string;
  name: string;
  type: string;
  size: number;
  uploaded_at: string;
};

type Step = "upload" | "analyzing" | "review" | "confirm";

function UploadInvoicePage() {
  const { user, canWrite } = useAuth();
  const canCreate = canWrite("invoices");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [step, setStep] = useState<Step>("upload");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [matchedDebtor, setMatchedDebtor] = useState<any | null>(null);
  const [matchedDebtors, setMatchedDebtors] = useState<any[]>([]);

  // Editable fields for review step
  const [debtorForm, setDebtorForm] = useState({
    name: "",
    registered_address: "",
    contact_email: "",
    contact_phone: "",
    registration_no: "",
  });
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_number: "",
    amount: 0,
    issue_date: "",
    due_date: "",
    po_number: "",
    advance_rate: 80,
    fee_rate: 2.5,
    payment_terms_days: 30,
  });

  // Fetch existing debtors for matching
  const debtorsQ = useQuery({
    queryKey: ["debtors-for-upload"],
    queryFn: async () => (await api.get<any[]>("/debtors")) ?? [],
  });

  // ── File upload mutation ──
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("scope", "invoices");
      return await api.post<UploadedFile[]>("/upload", formData);
    },
    onSuccess: (files) => {
      if (files && files.length > 0) {
        setUploadedFile(files[0]);
        setStep("analyzing");
        // Auto-trigger analysis
        parseInvoiceMutation.mutate(files[0].path);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  // ── Parse invoice mutation ──
  const parseInvoiceMutation = useMutation({
    mutationFn: async (filePath: string) => {
      return await api.post<ParsedData>("/invoices/parse-invoice", { filePath });
    },
    onSuccess: (data) => {
      setParsedData(data);

      // Fill forms
      setDebtorForm({
        name: data.debtor.name || "",
        registered_address: data.debtor.registered_address || "",
        contact_email: data.debtor.contact_email || "",
        contact_phone: data.debtor.contact_phone || "",
        registration_no: data.debtor.registration_no || "",
      });

      const issueDate = data.invoice.issue_date
        ? data.invoice.issue_date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const termsDays = data.invoice.due_date
        ? Math.max(1, Math.round((new Date(data.invoice.due_date).getTime() - new Date(issueDate).getTime()) / 86400000))
        : 30;

      setInvoiceForm({
        invoice_number: data.invoice.invoice_number || "",
        amount: data.invoice.amount || 0,
        issue_date: issueDate,
        due_date: data.invoice.due_date ? data.invoice.due_date.slice(0, 10) : "",
        po_number: data.invoice.po_number || "",
        advance_rate: 80,
        fee_rate: 2.5,
        payment_terms_days: termsDays,
      });

      // Try to find matching debtor
      if (data.debtor.name) {
        const existing = debtorsQ.data ?? [];
        const nameLower = data.debtor.name.toLowerCase().trim();
        const matches = existing.filter((d: any) =>
          d.name.toLowerCase().includes(nameLower) || nameLower.includes(d.name.toLowerCase())
        );
        setMatchedDebtors(matches);
        if (matches.length === 1) {
          setMatchedDebtor(matches[0]);
        }
      }

      setStep("review");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to parse invoice");
      setStep("upload");
    },
  });

  // ── Create debtor (if new) mutation ──
  const createDebtorMutation = useMutation({
    mutationFn: async () => {
      if (matchedDebtor) return matchedDebtor;
      if (!debtorForm.name.trim()) throw new Error("Debtor name is required");
      return await api.post("/debtors", {
        name: debtorForm.name.trim(),
        registered_address: debtorForm.registered_address || null,
        contact_email: debtorForm.contact_email || null,
        contact_phone: debtorForm.contact_phone || null,
        registration_no: debtorForm.registration_no || null,
      });
    },
  });

  // ── Create invoice mutation ──
  const createInvoiceMutation = useMutation({
    mutationFn: async (debtorId: string) => {
      return await api.post("/invoices", {
        debtor_id: debtorId,
        invoice_number: invoiceForm.invoice_number.trim(),
        amount: invoiceForm.amount,
        issue_date: invoiceForm.issue_date,
        due_date: invoiceForm.due_date || null,
        po_number: invoiceForm.po_number || null,
        advance_rate: invoiceForm.advance_rate,
        fee_rate: invoiceForm.fee_rate,
        payment_terms_days: invoiceForm.payment_terms_days,
        documents: uploadedFile ? [uploadedFile] : [],
      });
    },
    onSuccess: (invoice: any) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["debtors"] });
      setStep("confirm");
      toast.success("Invoice created successfully!");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create invoice"),
  });

  // ── Final creation handler ──
  const [isCreating, setIsCreating] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);
  const [wasDebtorCreated, setWasDebtorCreated] = useState(false);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      // Step 1: Get or create debtor
      let debtorId: string;
      if (matchedDebtor) {
        debtorId = matchedDebtor.id;
        setWasDebtorCreated(false);
      } else {
        const newDebtor = await createDebtorMutation.mutateAsync();
        debtorId = newDebtor.id;
        setMatchedDebtor(newDebtor);
        setWasDebtorCreated(true);
      }

      // Step 2: Create invoice
      const invoice = await createInvoiceMutation.mutateAsync(debtorId);
      setCreatedInvoice(invoice);
    } catch (e) {
      // Error handled in individual mutations
    } finally {
      setIsCreating(false);
    }
  };

  const resetAll = () => {
    setStep("upload");
    setUploadedFile(null);
    setParsedData(null);
    setMatchedDebtor(null);
    setMatchedDebtors([]);
    setCreatedInvoice(null);
  };

  // ── File upload handler ──
  const handleFile = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    const isPdf = file.type.includes("pdf") || file.name.endsWith(".pdf");
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(file.name);
    if (!isPdf && !isImage) {
      toast.error("Please upload a PDF or image file (JPEG, PNG)");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File size must be under 15 MB");
      return;
    }
    uploadMutation.mutate(file);
  };

  // ── Drag handlers ──
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFile(e.dataTransfer.files);
  };

  const handleRetry = resetAll;

  const isPending = uploadMutation.isPending || parseInvoiceMutation.isPending;

  if (!canCreate) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <ShieldCheck className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-medium text-foreground">Access restricted</h3>
        <p className="mt-1 text-sm text-muted-foreground">You don't have permission to create invoices.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Automated Upload"
        title="Upload Invoice"
        description="Upload a PDF or image invoice. We&apos;ll extract the details, you review and confirm."
        actions={
          step !== "upload" ? (
            <button onClick={resetAll} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">
              <RefreshCw className="h-4 w-4" /> New invoice
            </button>
          ) : undefined
        }
      />

      {/* Step indicator */}
      <div className="border-b border-border bg-card px-6 md:px-10">
        <div className="flex gap-0">
          {[
            { key: "upload", label: "Upload", icon: FileUp },
            { key: "analyzing", label: "Analyze", icon: Scan },
            { key: "review", label: "Review", icon: ClipboardList },
            { key: "confirm", label: "Confirm", icon: SaveAll },
          ].map((s, idx) => {
            const Icon = s.icon;
            const active = step === s.key;
            const done = ["upload", "analyzing", "review", "confirm"].indexOf(step) > idx;
            return (
              <div key={s.key} className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                active
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                  : done
                  ? "text-success"
                  : "text-muted-foreground"
              }`}>
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  active ? "bg-primary/15 text-primary" : done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <Icon className="h-4 w-4 hidden sm:inline" />
                <span className="hidden sm:inline">{s.label}</span>
                {idx < 3 && <ChevronRight className="ml-2 h-3.5 w-3.5 text-muted-foreground/40 hidden sm:inline" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-6 md:p-10">
        {step === "upload" && (
          <UploadStep
            fileInputRef={fileInputRef}
            dragActive={dragActive}
            isPending={isPending}
            onFile={handleFile}
            onDrag={handleDrag}
            onDrop={handleDrop}
            onBrowse={() => fileInputRef.current?.click()}
          />
        )}

        {step === "analyzing" && <AnalyzingStep uploadedFile={uploadedFile} />}

        {step === "review" && (
          <ReviewStep
            debtorForm={debtorForm}
            setDebtorForm={setDebtorForm}
            invoiceForm={invoiceForm}
            setInvoiceForm={setInvoiceForm}
            matchedDebtor={matchedDebtor}
            matchedDebtors={matchedDebtors}
            onSelectExisting={(d: any) => {
              setMatchedDebtor(d);
              setDebtorForm(prev => ({
                ...prev,
                name: d.name,
                registered_address: d.registered_address || prev.registered_address,
                contact_email: d.contact_email || prev.contact_email,
                contact_phone: d.contact_phone || prev.contact_phone,
                registration_no: d.registration_no || prev.registration_no,
              }));
            }}
            onUseNew={() => setMatchedDebtor(null)}
            onBack={() => setStep("upload")}
            onCreate={handleCreate}
            isCreating={isCreating}
            uploadedFile={uploadedFile}
            parsedData={parsedData}
          />
        )}

        {step === "confirm" && (
          <ConfirmStep
            createdInvoice={createdInvoice}
            matchedDebtor={matchedDebtor}
            wasDebtorCreated={wasDebtorCreated}
            uploadedFile={uploadedFile}
            onNew={handleRetry}
            onViewInvoice={() => {
              if (createdInvoice) {
                navigate({ to: "/app/invoices", search: { tab: "list", view: createdInvoice.id } });
              }
            }}
            onViewDebtor={() => {
              if (matchedDebtor) {
                navigate({ to: "/app/debtors" });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1: Upload ──

function UploadStep({
  fileInputRef, dragActive, isPending, onFile, onDrag, onDrop, onBrowse,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragActive: boolean;
  isPending: boolean;
  onFile: (files: FileList | null) => void;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <Card className="p-0 overflow-hidden">
        <div
          onDragEnter={onDrag}
          onDragLeave={onDrag}
          onDragOver={onDrag}
          onDrop={onDrop}
          onClick={onBrowse}
          className={`relative cursor-pointer transition-all duration-300 ${
            dragActive
              ? "border-primary bg-primary/5 scale-[1.02]"
              : "hover:border-primary/50 hover:bg-accent/30"
          }`}
        >
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            {isPending ? (
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="h-16 w-16 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
                  <FileText className="absolute inset-0 m-auto h-7 w-7 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Uploading invoice...</p>
                  <p className="mt-1 text-xs text-muted-foreground">Please wait while we upload your file</p>
                </div>
              </div>
            ) : (
              <>
                <div className="relative mb-6">
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                    <FileUp className="h-9 w-9 text-primary" />
                  </div>
                  <div className="absolute -right-2 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-success shadow-sm">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Upload Invoice</h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Drag and drop your invoice (PDF or image) here, or click to browse. We'll automatically extract all the details using OCR.
                </p>
                <div className="mt-8 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
                  <FileText className="h-4 w-4" />
                  Select PDF or image
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Supports PDF, JPEG, PNG up to 15 MB
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,application/pdf,image/jpeg,image/png,image/gif,image/bmp,image/tiff,image/webp"
        className="hidden"
        onChange={(e) => { onFile(e.target.files); e.target.value = ""; }}
      />

      {/* Quick info */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <Scan className="mx-auto mb-2 h-5 w-5 text-primary" />
          <p className="text-xs font-medium text-foreground">Auto-extraction</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Invoice details read automatically</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <ListChecks className="mx-auto mb-2 h-5 w-5 text-primary" />
          <p className="text-xs font-medium text-foreground">Review & Edit</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Verify everything before saving</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <Database className="mx-auto mb-2 h-5 w-5 text-primary" />
          <p className="text-xs font-medium text-foreground">One-click Create</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Debtor + invoice created together</p>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Analyzing ──

function AnalyzingStep({ uploadedFile }: { uploadedFile: UploadedFile | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-8">
        <div className="h-20 w-20 animate-spin rounded-full border-[3px] border-primary/15 border-t-primary" />
        <Scan className="absolute inset-0 m-auto h-8 w-8 text-primary" />
      </div>
      <h3 className="text-xl font-semibold text-foreground">Analyzing invoice...</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Reading and extracting fields from your document
      </p>
      {uploadedFile && (
        <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {uploadedFile.name}
          <span className="text-muted-foreground/60">·</span>
          {(uploadedFile.size / 1024).toFixed(0)} KB
        </div>
      )}

      {/* Animated dots to show progress */}
      <div className="mt-10 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-full bg-primary/60"
            style={{
              animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

// ── Step 3: Review ──

function ReviewStep({
  debtorForm, setDebtorForm, invoiceForm, setInvoiceForm,
  matchedDebtor, matchedDebtors, onSelectExisting, onUseNew,
  onBack, onCreate, isCreating, uploadedFile, parsedData,
}: {
  debtorForm: any; setDebtorForm: (f: any) => void;
  invoiceForm: any; setInvoiceForm: (f: any) => void;
  matchedDebtor: any; matchedDebtors: any[];
  onSelectExisting: (d: any) => void; onUseNew: () => void;
  onBack: () => void; onCreate: () => void; isCreating: boolean;
  uploadedFile: UploadedFile | null; parsedData: ParsedData | null;
}) {
  const updateDebtor = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDebtorForm({ ...debtorForm, [k]: e.target.value });

  const updateInvoice = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInvoiceForm({ ...invoiceForm, [k]: e.target.value });

  const numeric = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInvoiceForm({ ...invoiceForm, [k]: parseFloat(e.target.value) || 0 });

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Extracted info banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Data extracted successfully</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            We've automatically extracted the information below. Please review and correct any errors before creating.
          </p>
        </div>
      </div>

      {/* ── Debtor Section ── */}
      <Card title="Debtor Information">
        {/* Existing debtor match */}
        {matchedDebtors.length > 0 && (
          <div className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-success mb-2">
              <UserCheck className="h-3.5 w-3.5" />
              {matchedDebtor
                ? `Matched existing debtor: ${matchedDebtor.name}`
                : `${matchedDebtors.length} similar debtor${matchedDebtors.length > 1 ? "s" : ""} found in system`}
            </div>
            <div className="flex flex-wrap gap-2">
              {matchedDebtors.map((d: any) => (
                <button
                  key={d.id}
                  onClick={() => onSelectExisting(d)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition ${
                    matchedDebtor?.id === d.id
                      ? "border-success bg-success/10 text-success"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  <Building2 className="h-3 w-3" />
                  {d.name}
                  <CheckCircle className={`h-3 w-3 ${matchedDebtor?.id === d.id ? "opacity-100" : "opacity-0"}`} />
                </button>
              ))}
              {matchedDebtor && (
                <button
                  onClick={onUseNew}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-warning hover:text-warning transition"
                >
                  <X className="h-3 w-3" /> Use as new instead
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <L label="Company Name *">
            <input className="inp" value={debtorForm.name} onChange={updateDebtor("name")} placeholder="Acme Corp" />
          </L>
          <L label="Registration / Tax ID">
            <input className="inp" value={debtorForm.registration_no} onChange={updateDebtor("registration_no")} placeholder="e.g. CR-2024-001" />
          </L>
          <L label="Email">
            <input className="inp" type="email" value={debtorForm.contact_email} onChange={updateDebtor("contact_email")} placeholder="billing@acme.com" />
          </L>
          <L label="Phone">
            <input className="inp" value={debtorForm.contact_phone} onChange={updateDebtor("contact_phone")} placeholder="+1 555-0000" />
          </L>
          <L label="Address" full>
            <input className="inp" value={debtorForm.registered_address} onChange={updateDebtor("registered_address")} placeholder="123 Business Ave, City" />
          </L>
        </div>
      </Card>

      {/* ── Invoice Section ── */}
      <Card title="Invoice Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <L label="Invoice Number *">
            <input className="inp" value={invoiceForm.invoice_number} onChange={updateInvoice("invoice_number")} placeholder="INV-2024-001" />
          </L>
          <L label="Amount *">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input className="inp pl-7" type="number" step="0.01" min="0" value={invoiceForm.amount} onChange={numeric("amount")} />
            </div>
          </L>
          <L label="Issue Date">
            <input className="inp" type="date" value={invoiceForm.issue_date} onChange={updateInvoice("issue_date")} />
          </L>
          <L label="Due Date">
            <input className="inp" type="date" value={invoiceForm.due_date} onChange={updateInvoice("due_date")} />
          </L>
          <L label="PO Number">
            <input className="inp" value={invoiceForm.po_number} onChange={updateInvoice("po_number")} placeholder="PO-2024-001" />
          </L>
          <L label="Payment Terms (days)">
            <input className="inp" type="number" min="0" value={invoiceForm.payment_terms_days} onChange={numeric("payment_terms_days")} />
          </L>
          <L label="Advance Rate (%)">
            <div className="flex items-center gap-2">
              <input className="inp" type="number" min="0" max="100" step="1" value={invoiceForm.advance_rate} onChange={(e) => setInvoiceForm({ ...invoiceForm, advance_rate: parseFloat(e.target.value) || 0 })} />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </L>
          <L label="Fee Rate (%)">
            <div className="flex items-center gap-2">
              <input className="inp" type="number" min="0" max="100" step="0.1" value={invoiceForm.fee_rate} onChange={(e) => setInvoiceForm({ ...invoiceForm, fee_rate: parseFloat(e.target.value) || 0 })} />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </L>
        </div>

        {/* Amount Summary */}
        <div className="mt-4 rounded-lg border border-border bg-background/40 p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Invoice Amount</span>
              <div className="mt-1 text-lg font-semibold">{fmtMoney(invoiceForm.amount)}</div>
            </div>
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Advance Amount</span>
              <div className="mt-1 text-lg font-semibold text-primary">
                {fmtMoney(invoiceForm.amount * (invoiceForm.advance_rate / 100))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Attached document ── */}
      {uploadedFile && (
        <Card title="Attached Document">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{uploadedFile.name}</p>
                <p className="text-xs text-muted-foreground">{(uploadedFile.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
            <button
              onClick={() => {
                const token = getToken();
                const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4444";
                const encodedPath = uploadedFile.path.split("/").map(encodeURIComponent).join("/");
                window.open(`${baseUrl}/upload/signed-url/${encodedPath}?token=${token}`, "_blank", "noopener");
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary transition-colors"
            >
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
          </div>
        </Card>
      )}

      {/* ── Raw text preview (collapsible) ── */}
      {parsedData?.raw_text_preview && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors select-none">
            Raw extracted text (for reference)
          </summary>
          <div className="max-h-48 overflow-y-auto border-t border-border px-4 py-3">
            <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{parsedData.raw_text_preview}</pre>
          </div>
        </details>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={onCreate}
          disabled={isCreating || !debtorForm.name.trim() || !invoiceForm.invoice_number.trim() || !invoiceForm.amount}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              {matchedDebtor ? "Create Invoice" : "Create Debtor & Invoice"}
            </>
          )}
        </button>
      </div>
      <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
    </div>
  );
}

// ── Step 4: Confirm ──

function ConfirmStep({
  createdInvoice, matchedDebtor, wasDebtorCreated, uploadedFile,
  onNew, onViewInvoice, onViewDebtor,
}: {
  createdInvoice: any; matchedDebtor: any; wasDebtorCreated: boolean; uploadedFile: UploadedFile | null;
  onNew: () => void; onViewInvoice: () => void; onViewDebtor: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl border border-success/30 bg-gradient-to-b from-success/5 to-transparent p-10 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <CheckCircle className="h-10 w-10 text-success" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Invoice Created Successfully!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The invoice and debtor have been added to the system.
        </p>

        {/* Summary */}
        <div className="mx-auto mt-8 max-w-md space-y-3 text-left">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Invoice</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Number</span>
                <span className="font-mono font-medium">{createdInvoice?.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{fmtMoney(createdInvoice?.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Issue Date</span>
                <span>{fmtDate(createdInvoice?.issue_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                  Draft
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Debtor</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{matchedDebtor?.name}</span>
              </div>
              {matchedDebtor?.contact_email && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{matchedDebtor.contact_email}</span>
                </div>
              )}
            </div>
          </div>

          {uploadedFile && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Document</span>
                <span className="ml-auto text-xs text-muted-foreground">{uploadedFile.name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={onViewInvoice}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Eye className="h-4 w-4" /> View Invoice
          </button>
          {wasDebtorCreated && (
            <button
              onClick={onViewDebtor}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm hover:bg-muted transition-colors"
            >
              <Building2 className="h-4 w-4" /> View Debtor
            </button>
          )}
          <button
            onClick={onNew}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm hover:bg-muted transition-colors"
          >
            <FileUp className="h-4 w-4" /> Upload Another
          </button>
        </div>
      </div>
    </div>
  );
}

// ── helper components ──

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block ${full ? "sm:col-span-2" : ""}`}>
    <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
    {children}
  </label>;
}
