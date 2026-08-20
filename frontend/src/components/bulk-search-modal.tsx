import { useState, useRef } from "react";
import { api } from "@/lib/api-client";
import { fmtMoney, fmtDate, StatusPill } from "@/components/ledger-ui";
import { Search, X, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export interface BulkSearchResult {
  found: any[];
  notFoundInPlatform: string[];
  notInExcel: Array<{ id: string; invoice_number: string; amount: number; issue_date: string | null; debtor_name?: string | null; vendor_name?: string | null }>;
  notInExcelTotal: number;
  amountMismatches: Array<{ invoice_number: string; excel_amount: number; platform_amount: number; difference: number }>;
  summary: {
    excelCount: number;
    foundCount: number;
    notFoundCount: number;
    platformCount: number;
    notInExcelCount: number;
    amountMismatchCount: number;
  };
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: "primary" | "success" | "destructive" | "warning" | "muted" }) {
  const colorMap = {
    primary: "bg-primary/10 text-primary border-primary/30",
    success: "bg-success/10 text-success border-success/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    muted: "bg-muted text-muted-foreground border-border",
  };
  return (
    <div className={`rounded-lg border ${colorMap[color]} p-3 text-center`}>
      <div className="text-xl font-bold font-mono">{value}</div>
      <div className="text-[10px] uppercase tracking-widest mt-1 opacity-80">{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export function BulkSearchModal({ onClose, mode = "sales" }: { onClose: () => void; mode?: "sales" | "purchase" }) {
  const [step, setStep] = useState<"upload" | "results">("upload");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkSearchResult | null>(null);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"found" | "missingPlatform" | "missingExcel" | "amountMismatch">("found");
  const [hasAmounts, setHasAmounts] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

        // Try to find a column that looks like invoice numbers
        const headers = Object.keys(json[0] || {});
        const invCol = headers.find(
          (h) =>
            h.toLowerCase().includes("invoice") ||
            h.toLowerCase().includes("number") ||
            h.toLowerCase().includes("inv")
        );

        // Try to find a column that looks like an amount
        const amtCol = headers.find(
          (h) =>
            h.toLowerCase().includes("amount") ||
            h.toLowerCase().includes("total") ||
            h.toLowerCase().includes("value")
        );

        let items: Array<{ invoice_number: string; amount?: number }>;

        if (invCol) {
          items = json
            .map((row) => {
              const invNum = String(row[invCol] ?? "").trim();
              if (!invNum) return null;
              const result: { invoice_number: string; amount?: number } = { invoice_number: invNum };
              if (amtCol) {
                const rawAmt = String(row[amtCol] ?? "").replace(/[$,€£\s]/g, "");
                if (rawAmt) {
                  const parsedAmt = Number(rawAmt);
                  if (!isNaN(parsedAmt)) result.amount = parsedAmt;
                }
              }
              return result;
            })
            .filter((item): item is { invoice_number: string; amount?: number } => item !== null);
        } else {
          // Try the first column
          const firstCol = headers[0];
          if (!firstCol) {
            toast.error("Could not find any columns in the file");
            return;
          }
          items = json
            .map((row) => {
              const invNum = String(row[firstCol] ?? "").trim();
              if (!invNum) return null;
              return { invoice_number: invNum } as { invoice_number: string; amount?: number };
            })
            .filter((item): item is { invoice_number: string; amount?: number } => item !== null);
        }

        if (items.length === 0) {
          toast.error("No invoice numbers found in the file. Make sure there's a column with invoice numbers.");
          return;
        }

        if (items.length > 10000) {
          toast.error(`Too many invoice numbers (${items.length}). Maximum is 10,000.`);
          return;
        }

        const detectedAmounts = items.some((i) => i.amount !== undefined);
        setHasAmounts(detectedAmounts);
        setInvoiceCount(items.length);
        await performSearch(items);
      } catch (err) {
        toast.error("Could not parse the file. Please upload a valid Excel or CSV file.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const performSearch = async (items: Array<{ invoice_number: string; amount?: number }>) => {
    setLoading(true);
    try {
      const endpoint = mode === "purchase" ? "/purchase-invoices/bulk-search" : "/invoices/bulk-search";
      // Send items array (with optional amounts) for amount checking
      const res = await api.post<BulkSearchResult>(endpoint, { items });
      setResult(res);
      setStep("results");
      if (res.amountMismatches?.length > 0) {
        setActiveTab("amountMismatch");
      } else {
        setActiveTab(res.found.length > 0 ? "found" : "missingPlatform");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            <Search className="mr-1.5 inline h-5 w-5 text-primary" />
            Bulk {mode === "purchase" ? "purchase invoice" : "invoice"} search
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          {step === "upload" && (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
                <strong className="text-primary">How it works:</strong> Upload an Excel or CSV file containing invoice numbers (and optionally an <strong>Amount</strong> column).
                The system will search your {mode === "purchase" ? "purchase" : "sales"} invoices and show:
                <ul className="mt-2 list-disc pl-4 space-y-1">
                  <li>Invoices that match your file</li>
                  <li>Invoice numbers from your file that are <strong>not</strong> in the platform</li>
                  <li>Platform invoices that are <strong>not</strong> in your file</li>
                  <li><strong>Amount mismatches</strong> between your file and the platform (when an Amount column is present)</li>
                </ul>
              </div>

              {loading ? (
                <div className="flex flex-col items-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">Searching {invoiceCount} invoice numbers across your platform...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12">
                  <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">Upload Excel or CSV file with invoice numbers</p>
                  <p className="text-xs text-muted-foreground/70 mb-4">Optionally include an <strong>Amount</strong> column to check for mismatches</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.tsv,.ods"
                    onChange={handleFile}
                    className="block w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20 cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          {step === "results" && result && (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className={`grid gap-3 ${hasAmounts && (result.summary.amountMismatchCount ?? 0) > 0 ? "grid-cols-3 md:grid-cols-6" : "grid-cols-2 md:grid-cols-5"}`}>
                <SummaryCard
                  label="In file"
                  value={result.summary.excelCount.toLocaleString()}
                  color="primary"
                />
                <SummaryCard
                  label="Matched ✓"
                  value={result.summary.foundCount.toLocaleString()}
                  color="success"
                />
                <SummaryCard
                  label="Not in platform ✗"
                  value={result.summary.notFoundCount.toLocaleString()}
                  color="destructive"
                />
                <SummaryCard
                  label="Platform total"
                  value={result.summary.platformCount.toLocaleString()}
                  color="muted"
                />
                <SummaryCard
                  label="Not in file"
                  value={result.summary.notInExcelCount.toLocaleString()}
                  color="warning"
                />
                {hasAmounts && (result.summary.amountMismatchCount ?? 0) > 0 && (
                  <SummaryCard
                    label="Amount mismatch ⚠"
                    value={result.summary.amountMismatchCount.toLocaleString()}
                    color="warning"
                  />
                )}
              </div>

              {/* Tabs for different result views */}
              <div className="flex gap-1 border-b border-border overflow-x-auto">
                <TabButton
                  active={activeTab === "found"}
                  onClick={() => setActiveTab("found")}
                  label={`Found in platform (${result.found.length})`}
                />
                <TabButton
                  active={activeTab === "missingPlatform"}
                  onClick={() => setActiveTab("missingPlatform")}
                  label={`Missing from platform (${result.notFoundInPlatform.length})`}
                />
                <TabButton
                  active={activeTab === "missingExcel"}
                  onClick={() => setActiveTab("missingExcel")}
                  label={`Not in file (${result.notInExcelTotal.toLocaleString()})`}
                />
                {hasAmounts && (result.amountMismatches?.length ?? 0) > 0 && (
                  <TabButton
                    active={activeTab === "amountMismatch"}
                    onClick={() => setActiveTab("amountMismatch")}
                    label={`Amount mismatch (${result.amountMismatches.length})`}
                  />
                )}
              </div>

              {/* Found in platform */}
              {activeTab === "found" && (
                <div className="-mx-5 overflow-x-auto">
                  {result.found.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No matching invoices found in the platform.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-5 py-2 text-left font-normal">Invoice #</th>
                          <th className="px-5 py-2 text-left font-normal">{mode === "purchase" ? "Supplier" : "Debtor"}</th>
                          <th className="px-5 py-2 text-left font-normal">Issue date</th>
                          <th className="px-5 py-2 text-right font-normal">Platform amount</th>
                          {hasAmounts && <th className="px-5 py-2 text-right font-normal">File amount</th>}
                          {hasAmounts && <th className="px-5 py-2 text-right font-normal">Difference</th>}
                          <th className="px-5 py-2 text-right font-normal">Received</th>
                          <th className="px-5 py-2 text-left font-normal">Status</th>
                          <th className="px-5 py-2 text-left font-normal">Due date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.found.map((inv: any) => (
                          <tr key={inv.id} className={`border-b border-border/60 hover:bg-muted/30 ${inv.amount_mismatch ? "bg-warning/5" : ""}`}>
                            <td className="px-5 py-3 font-mono text-xs font-medium">{inv.invoice_number}</td>
                            <td className="px-5 py-3">{mode === "purchase" ? (inv.vendor?.name ?? "—") : (inv.debtor?.name ?? "—")}</td>
                            <td className="px-5 py-3 text-sm">{fmtDate(inv.issue_date)}</td>
                            <td className="px-5 py-3 text-right num">{fmtMoney(inv.amount)}</td>
                            {hasAmounts && (
                              <td className="px-5 py-3 text-right num">
                                {inv.excel_amount != null ? fmtMoney(inv.excel_amount) : "—"}
                              </td>
                            )}
                            {hasAmounts && (
                              <td className="px-5 py-3 text-right num">
                                {inv.amount_difference != null ? (
                                  <span className={inv.amount_mismatch ? "text-destructive font-medium" : ""}>
                                    {inv.amount_difference > 0 ? "+" : ""}{fmtMoney(inv.amount_difference)}
                                  </span>
                                ) : "—"}
                              </td>
                            )}
                            <td className="px-5 py-3 text-right num text-muted-foreground">{inv.amount_received != null ? fmtMoney(inv.amount_received) : "—"}</td>
                            <td className="px-5 py-3"><StatusPill status={inv.status} /></td>
                            <td className="px-5 py-3 text-sm">{fmtDate(inv.due_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Amount Mismatch */}
              {activeTab === "amountMismatch" && result.amountMismatches && (
                <div>
                  {result.amountMismatches.length === 0 ? (
                    <div className="py-10 text-center text-sm text-success">
                      All amounts match between your file and the platform! ✓
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 text-xs text-muted-foreground">
                        <strong className="text-warning">{result.amountMismatches.length}</strong> invoice{result.amountMismatches.length !== 1 ? "s have" : " has"} an <strong className="text-warning">amount mismatch</strong> between your file and the platform.
                      </div>
                      <div className="-mx-5 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                            <tr className="border-b border-border">
                              <th className="px-5 py-2 text-left font-normal">Invoice #</th>
                              <th className="px-5 py-2 text-right font-normal">File amount</th>
                              <th className="px-5 py-2 text-right font-normal">Platform amount</th>
                              <th className="px-5 py-2 text-right font-normal">Difference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.amountMismatches.map((mismatch, idx) => (
                              <tr key={idx} className="border-b border-border/60 hover:bg-warning/5">
                                <td className="px-5 py-3 font-mono text-xs font-medium">{mismatch.invoice_number}</td>
                                <td className="px-5 py-3 text-right num">{fmtMoney(mismatch.excel_amount)}</td>
                                <td className="px-5 py-3 text-right num">{fmtMoney(mismatch.platform_amount)}</td>
                                <td className="px-5 py-3 text-right num text-destructive font-medium">
                                  {mismatch.difference > 0 ? "+" : ""}{fmtMoney(mismatch.difference)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Missing from platform */}
              {activeTab === "missingPlatform" && (
                <div>
                  {result.notFoundInPlatform.length === 0 ? (
                    <div className="py-10 text-center text-sm text-success">
                      All {result.summary.excelCount.toLocaleString()} invoice numbers from your file were found in the platform! ✓
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 text-xs text-muted-foreground">
                        These {result.notFoundInPlatform.length} invoice number{result.notFoundInPlatform.length !== 1 ? "s" : ""} from your file were <strong className="text-destructive">not found</strong> in the platform.
                      </div>
                      <div className="-mx-5 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                            <tr className="border-b border-border">
                              <th className="px-5 py-2 text-left font-normal">#</th>
                              <th className="px-5 py-2 text-left font-normal">Invoice number</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.notFoundInPlatform.map((num, idx) => (
                              <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                                <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                                <td className="px-5 py-3 font-mono text-xs text-destructive">{num}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Not in Excel */}
              {activeTab === "missingExcel" && (
                <div>
                  <div className="mb-3 text-xs text-muted-foreground">
                    Showing {result.notInExcel.length} of {result.notInExcelTotal.toLocaleString()} platform invoice{result.notInExcelTotal !== 1 ? "s" : ""} not in your file
                    {result.notInExcel.length < result.notInExcelTotal ? " (only first 500 shown)" : ""}.
                  </div>
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-5 py-2 text-left font-normal">Invoice #</th>
                          <th className="px-5 py-2 text-left font-normal">{mode === "purchase" ? "Supplier" : "Debtor"}</th>
                          <th className="px-5 py-2 text-left font-normal">Issue date</th>
                          <th className="px-5 py-2 text-right font-normal">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.notInExcel.map((item) => (
                          <tr key={item.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="px-5 py-3 font-mono text-xs">{item.invoice_number}</td>
                            <td className="px-5 py-3">{mode === "purchase" ? (item.vendor_name ?? "—") : (item.debtor_name ?? "—")}</td>
                            <td className="px-5 py-3 text-sm">{fmtDate(item.issue_date)}</td>
                            <td className="px-5 py-3 text-right num">{fmtMoney(item.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => {
                    setStep("upload");
                    setResult(null);
                    setInvoiceCount(0);
                    setHasAmounts(false);
                    setActiveTab("found");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  Upload another file
                </button>
                <button onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
