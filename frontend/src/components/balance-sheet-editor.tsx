import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api-client";
import { Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { BalanceSheetData } from "@/components/balance-sheet";
import {
  Loader2, Scale, AlertTriangle, Check, X, Plus, Pencil, Trash2,
  Save, Ban, BookOpen, Layers, History, FileDown, DollarSign
} from "lucide-react";
import { toast } from "sonner";

// ── Section enums matching backend ──
const BALANCE_SHEET_SECTIONS = [
  "tangible_asset",
  "cash_bank",
  "accounts_receivable",
  "accounts_payable",
  "customer_advance",
  "rounding",
  "share_capital",
  "retained_earnings",
  "other_current_asset",
  "other_current_liability",
  "other_equity",
] as const;

type BalanceSheetSection = (typeof BALANCE_SHEET_SECTIONS)[number];

const SECTION_LABELS: Record<BalanceSheetSection, string> = {
  tangible_asset: "Tangible Assets",
  cash_bank: "Cash at bank and in hand",
  accounts_receivable: "Accounts Receivable",
  accounts_payable: "Accounts Payable",
  customer_advance: "Advance received from Customers",
  rounding: "Rounding",
  share_capital: "Share Capital",
  retained_earnings: "Retained Earnings",
  other_current_asset: "Other Current Assets",
  other_current_liability: "Other Current Liabilities",
  other_equity: "Other Equity",
};

interface SubField {
  id: string;
  name: string;
  amount: number;
  date: string;
}

interface BalanceSheetItem {
  id: string;
  section: BalanceSheetSection;
  description: string;
  amount: number;
  date: string;
  sub_fields?: SubField[];
  account_id?: string;
  notes?: string;
  is_active: boolean;
  is_opening_balance?: boolean;
  created_at: string;
  updated_at: string;
}

// ── Subsection mapping: which sections map to which balance sheet subsections ──
const SECTION_TO_SUBSECTION: Record<string, { sectionLabel: string; subsectionLabel: string }> = {
  tangible_asset: { sectionLabel: "Fixed Assets", subsectionLabel: "Tangible Assets" },
  cash_bank: { sectionLabel: "Current Assets", subsectionLabel: "Cash at bank and in hand" },
  accounts_receivable: { sectionLabel: "Current Assets", subsectionLabel: "Accounts Receivable" },
  other_current_asset: { sectionLabel: "Current Assets", subsectionLabel: "Other Current Assets" },
  accounts_payable: { sectionLabel: "Creditors: amounts falling due within one year", subsectionLabel: "Accounts Payable" },
  customer_advance: { sectionLabel: "Creditors: amounts falling due within one year", subsectionLabel: "Advance received from Customers" },
  rounding: { sectionLabel: "Creditors: amounts falling due within one year", subsectionLabel: "Rounding" },
  other_current_liability: { sectionLabel: "Creditors: amounts falling due within one year", subsectionLabel: "Other Current Liabilities" },
  share_capital: { sectionLabel: "Capital and Reserves", subsectionLabel: "Share Capital" },
  retained_earnings: { sectionLabel: "Capital and Reserves", subsectionLabel: "Retained Earnings" },
  other_equity: { sectionLabel: "Capital and Reserves", subsectionLabel: "Other Equity" },
};

function fmtNeg(val: number): string {
  if (val < 0) return `(${fmtMoney(Math.abs(val))})`;
  return fmtMoney(val);
}

export function BalanceSheetEditor() {
  const qc = useQueryClient();
  const [openingMode, setOpeningMode] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BalanceSheetItem | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // ── Fetch balance sheet data (merged auto + manual) ──
  const { data: bsData, isLoading: bsLoading } = useQuery<BalanceSheetData>({
    queryKey: ["balance-sheet", "", ""],
    queryFn: async () => (await api.get<BalanceSheetData>("/reports/balance-sheet"))!,
    refetchInterval: 30_000,
  });

  // ── Fetch manual items separately for editing ──
  const { data: manualData, isLoading: manualLoading } = useQuery<{ items: BalanceSheetItem[]; grouped: Record<string, BalanceSheetItem[]> }>({
    queryKey: ["balance-sheet-items"],
    queryFn: async () => (await api.get<{ items: BalanceSheetItem[]; grouped: Record<string, BalanceSheetItem[]> }>("/balance-sheet-items"))!,
    refetchInterval: 30_000,
  });

  const manualItems = manualData?.items ?? [];

  // ── Derived data: group manual items by section ──
  const manualBySection = manualData?.grouped ?? {};

  // ── CRUD Mutations ──
  const createItem = useMutation({
    mutationFn: async (data: Partial<BalanceSheetItem>) => {
      return await api.post("/balance-sheet-items", data);
    },
    onSuccess: () => {
      toast.success("Manual entry added");
      qc.invalidateQueries({ queryKey: ["balance-sheet"] });
      qc.invalidateQueries({ queryKey: ["balance-sheet-items"] });
      setShowForm(false);
      setEditingItem(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create entry"),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...data }: Partial<BalanceSheetItem> & { id: string }) => {
      return await api.patch(`/balance-sheet-items/${id}`, data);
    },
    onSuccess: () => {
      toast.success("Entry updated");
      qc.invalidateQueries({ queryKey: ["balance-sheet"] });
      qc.invalidateQueries({ queryKey: ["balance-sheet-items"] });
      setShowForm(false);
      setEditingItem(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update entry"),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      return await api.delete(`/balance-sheet-items/${id}`);
    },
    onSuccess: () => {
      toast.success("Entry deleted");
      qc.invalidateQueries({ queryKey: ["balance-sheet"] });
      qc.invalidateQueries({ queryKey: ["balance-sheet-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete entry"),
  });

  // ── Loading state ──
  if (bsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bsData) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        <Scale className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p>Could not load balance sheet data.</p>
      </div>
    );
  }

  const d = bsData;

  // ── Collect manual items for a specific section/subsection ──
  const getManualItemsForSubsection = (sectionLabel: string, subsectionLabel: string): BalanceSheetItem[] => {
    return manualItems.filter((item) => {
      const mapping = SECTION_TO_SUBSECTION[item.section];
      return mapping?.sectionLabel === sectionLabel && mapping?.subsectionLabel === subsectionLabel;
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Balance Sheet</span>
          <span className="text-xs text-muted-foreground">{d.report_date}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Opening Balances Toggle */}
          <button
            onClick={() => setOpeningMode(!openingMode)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              openingMode
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            {openingMode ? "Opening mode ON" : "Opening Balances"}
          </button>
          {/* Add Manual Entry */}
          <button
            onClick={() => { setEditingItem(null); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Add manual entry
          </button>
        </div>
      </div>

      {/* ── Verification Banner ── */}
      {d.verification.isBalanced ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium text-emerald-800 dark:text-emerald-300">
            Balance Sheet is in balance
          </span>
          <span className="text-emerald-600/60 dark:text-emerald-400/60">
            · A: {fmtMoney(d.verification.totalAssets)} = L: {fmtMoney(d.verification.totalLiabilities)} + E: {fmtMoney(d.verification.totalEquity)}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-800 dark:bg-rose-950">
          <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          <span className="font-medium text-rose-800 dark:text-rose-300">
            Out of balance by {fmtMoney(Math.abs(d.verification.difference))}
          </span>
        </div>
      )}

      {/* ── Main Sections ── */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        {/* Fixed Assets */}
        {(() => {
          const sec = d.sections.find(s => s.label === "Fixed Assets");
          return sec ? (
            <EditorSectionBlock
              section={sec}
              manualItems={manualItems}
              sectionKey="Fixed Assets"
              getManualItemsForSubsection={getManualItemsForSubsection}
              onEdit={(item) => { setEditingItem(item); setShowForm(true); }}
              onDelete={(id) => deleteItem.mutate(id)}
              isExpanded={expandedSection === "Fixed Assets"}
              onToggle={() => setExpandedSection(expandedSection === "Fixed Assets" ? null : "Fixed Assets")}
            />
          ) : null;
        })()}

        <div className="border-t border-border/60" />

        {/* Current Assets */}
        {(() => {
          const sec = d.sections.find(s => s.label === "Current Assets");
          return sec ? (
            <EditorSectionBlock
              section={sec}
              manualItems={manualItems}
              sectionKey="Current Assets"
              getManualItemsForSubsection={getManualItemsForSubsection}
              onEdit={(item) => { setEditingItem(item); setShowForm(true); }}
              onDelete={(id) => deleteItem.mutate(id)}
              isExpanded={expandedSection === "Current Assets"}
              onToggle={() => setExpandedSection(expandedSection === "Current Assets" ? null : "Current Assets")}
            />
          ) : null;
        })()}

        <div className="border-t border-border/60" />

        {/* Creditors */}
        {(() => {
          const sec = d.sections.find(s => s.label === "Creditors: amounts falling due within one year");
          return sec ? (
            <EditorSectionBlock
              section={sec}
              manualItems={manualItems}
              sectionKey="Creditors: amounts falling due within one year"
              getManualItemsForSubsection={getManualItemsForSubsection}
              onEdit={(item) => { setEditingItem(item); setShowForm(true); }}
              onDelete={(id) => deleteItem.mutate(id)}
              isExpanded={expandedSection === "Creditors"}
              onToggle={() => setExpandedSection(expandedSection === "Creditors" ? null : "Creditors")}
            />
          ) : null;
        })()}

        <div className="border-t-2 border-border" />

        {/* Net Current Assets */}
        <ComputedRow label="Net Current Assets (Liabilities)" value={d.computed.netCurrentAssets} />

        <div className="border-t-2 border-border" />

        {/* Total Assets less Current Liabilities */}
        <ComputedRow label="Total Assets less Current Liabilities" value={d.computed.totalAssetsLessCurrentLiabilities} bold />

        <div className="border-t-2 border-border" />

        {/* Net Assets */}
        <ComputedRow label="Net Assets" value={d.computed.netAssets} bold doubleTop />

        <div className="border-t-2 border-border" />

        {/* Capital and Reserves */}
        {(() => {
          const sec = d.capitalAndReserves;
          return sec ? (
            <EditorSectionBlock
              section={sec}
              manualItems={manualItems}
              sectionKey="Capital and Reserves"
              getManualItemsForSubsection={getManualItemsForSubsection}
              onEdit={(item) => { setEditingItem(item); setShowForm(true); }}
              onDelete={(id) => deleteItem.mutate(id)}
              isExpanded={expandedSection === "Capital and Reserves"}
              onToggle={() => setExpandedSection(expandedSection === "Capital and Reserves" ? null : "Capital and Reserves")}
              isCapital
            />
          ) : null;
        })()}

        <div className="border-t-2 border-border" />

        {/* Total Capital and Reserves */}
        <ComputedRow label="Total Capital and Reserves" value={d.capitalAndReserves.total} bold />

        {/* Verification row */}
        <div className="border-t-2 border-border bg-muted/10 px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Assets − (Liabilities + Equity)
            </span>
            <span className={`text-sm font-bold num ${
              d.verification.isBalanced ? "text-emerald-600" : "text-rose-600"
            }`}>
              {d.verification.isBalanced ? (
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Balanced
                </span>
              ) : (
                fmtNeg(d.verification.difference)
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ── Manual Entry Form Modal ── */}
      {showForm && (
        <ManualEntryForm
          editing={editingItem}
          openingMode={openingMode}
          onClose={() => { setShowForm(false); setEditingItem(null); }}
          onSave={(data) => {
            if (editingItem) {
              updateItem.mutate({ id: editingItem.id, ...data });
            } else {
              createItem.mutate(data);
            }
          }}
          isPending={createItem.isPending || updateItem.isPending}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EDITOR SECTION BLOCK — Displays auto + manual entries
// ═══════════════════════════════════════════════════════════════

function fmtItemAmount(item: BalanceSheetItem): number {
  if (item.sub_fields && item.sub_fields.length > 0) {
    return item.sub_fields.reduce((s, sf) => s + (Number(sf.amount) || 0), 0);
  }
  return Number(item.amount);
}

function EditorSectionBlock({
  section,
  manualItems,
  sectionKey,
  getManualItemsForSubsection,
  onEdit,
  onDelete,
  isExpanded,
  onToggle,
  isCapital,
}: {
  section: {
    label: string;
    total: number;
    subsections: Array<{
      label: string;
      total: number;
      accounts: Array<{
        id: string;
        code?: string;
        name: string;
        balance: number;
        source?: string;
        is_opening_balance?: boolean;
        manual_item_id?: string;
        date?: string;
        notes?: string;
        sub_fields?: SubField[];
      }>;
    }>;
  };
  manualItems: BalanceSheetItem[];
  sectionKey: string;
  getManualItemsForSubsection: (sectionLabel: string, subsectionLabel: string) => BalanceSheetItem[];
  onEdit: (item: BalanceSheetItem) => void;
  onDelete: (id: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  isCapital?: boolean;
}) {
  const hasManualItems = manualItems.some((item) => {
    const mapping = SECTION_TO_SUBSECTION[item.section];
    return mapping?.sectionLabel === section.label;
  });

  return (
    <div>
      {/* Section Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-muted/30 px-6 py-3 hover:bg-muted/50 transition-colors"
      >
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          {section.label}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold num">{fmtNeg(section.total)}</span>
          <span className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-6 py-4 space-y-6">
          {section.subsections.map((sub, idx) => {
            const manualSubItems = getManualItemsForSubsection(section.label, sub.label);
            const autoAccounts = sub.accounts.filter((a) => a.source !== "manual");
            const hasAuto = autoAccounts.length > 0;
            const hasManual = manualSubItems.length > 0;

            return (
              <div key={idx} className="space-y-2">
                {/* Subsection Label */}
                <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {sub.label}
                  </span>
                  <span className="text-xs font-semibold num text-muted-foreground">
                    {fmtNeg(sub.total)}
                  </span>
                </div>

                {/* Two-column layout: Auto | Manual */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* Auto Column */}
                  <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 dark:border-blue-900 dark:bg-blue-950/20">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                        Auto from platform
                      </span>
                    </div>
                    {!hasAuto ? (
                      <div className="text-[11px] italic text-muted-foreground/60">No auto data</div>
                    ) : (
                      <div className="space-y-0.5">
                        {autoAccounts.map((acc) => (
                          <div key={acc.id} className="flex items-center justify-between text-xs py-0.5">
                            <span className="text-muted-foreground truncate mr-2">
                              {acc.code && <span className="font-mono text-[10px]">{acc.code} </span>}
                              {acc.name}
                            </span>
                            <span className="num font-medium shrink-0">{fmtMoney(acc.balance)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual Column */}
                  <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-amber-500" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          Manual entries
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {manualSubItems.reduce((s, i) => s + i.amount, 0) > 0 ? (
                          <span className="font-medium num">{fmtMoney(manualSubItems.reduce((s, i) => s + i.amount, 0))}</span>
                        ) : null}
                      </span>
                    </div>
                    {!hasManual ? (
                      <div className="text-[11px] italic text-muted-foreground/60">No manual entries</div>
                    ) : (
                      <div className="space-y-1">
                        {manualSubItems.map((item) => {
                          const hasSubFields = item.sub_fields && item.sub_fields.length > 0;
                          const itemAmt = fmtItemAmount(item);
                          return (
                            <div key={item.id}>
                              <div className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-amber-100/50 dark:hover:bg-amber-950/30 transition-colors">
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  {item.is_opening_balance && (
                                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-300">
                                      Opening
                                    </span>
                                  )}
                                  {hasSubFields && (
                                    <Layers className="h-3 w-3 shrink-0 text-violet-500" />
                                  )}
                                  <span className="truncate font-medium">{item.description}</span>
                                  {item.date && (
                                    <span className="text-muted-foreground/60 shrink-0">{fmtDate(item.date)}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  <span className="num font-medium">{fmtMoney(itemAmt)}</span>
                                  <button
                                    onClick={() => onEdit(item)}
                                    className="p-0.5 text-muted-foreground/40 hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                                    title="Edit"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => onDelete(item.id)}
                                    className="p-0.5 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                              {/* Sub-fields nested under parent */}
                              {hasSubFields && item.sub_fields && (
                                <div className="ml-5 pl-3 border-l-2 border-violet-200 dark:border-violet-800/60 space-y-0.5 mt-0.5">
                                  {item.sub_fields.map((sf) => (
                                    <div
                                      key={sf.id}
                                      className="flex items-center justify-between rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="h-1 w-1 rounded-full bg-violet-400 shrink-0" />
                                        <span className="truncate">{sf.name}</span>
                                        <span className="text-muted-foreground/50 shrink-0">{fmtDate(sf.date)}</span>
                                      </div>
                                      <span className="num shrink-0">{fmtMoney(Number(sf.amount) || 0)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Non-expanded summary */}
      {!isExpanded && (
        <div className="px-6 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {section.subsections.length} subsection{section.subsections.length !== 1 ? "s" : ""}
            {hasManualItems && " · Has manual entries"}
          </span>
          <span className="flex items-center gap-2">
            {!isCapital && (
              <button
                onClick={onToggle}
                className="text-primary hover:underline text-[10px]"
              >
                Expand
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  COMPUTED ROW
// ═══════════════════════════════════════════════════════════════

function ComputedRow({
  label,
  value,
  bold,
  doubleTop,
}: {
  label: string;
  value: number;
  bold?: boolean;
  doubleTop?: boolean;
}) {
  return (
    <div
      className={`flex w-full items-center justify-between px-6 py-3 ${
        doubleTop ? "border-t-2 border-border" : ""
      } ${bold ? "bg-muted/15" : ""}`}
    >
      <span className={`text-sm ${bold ? "font-bold text-foreground" : "font-semibold text-muted-foreground"}`}>
        {label}
      </span>
      <span className={`text-sm num ${bold ? "font-bold" : "font-semibold"}`}>
        {fmtNeg(value)}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MANUAL ENTRY FORM MODAL
// ═══════════════════════════════════════════════════════════════

function generateId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 11);
}

function ManualEntryForm({
  editing,
  openingMode,
  onClose,
  onSave,
  isPending,
}: {
  editing: BalanceSheetItem | null;
  openingMode: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  isPending: boolean;
}) {
  const [section, setSection] = useState<BalanceSheetSection>(
    editing?.section ?? "tangible_asset"
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [amount, setAmount] = useState(editing?.amount?.toString() ?? "");
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(editing?.account_id ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [isOpening, setIsOpening] = useState(editing?.is_opening_balance ?? openingMode ?? false);
  const [subFields, setSubFields] = useState<SubField[]>(
    editing?.sub_fields && editing.sub_fields.length > 0
      ? editing.sub_fields.map(sf => ({ ...sf }))
      : []
  );
  const [useSubFields, setUseSubFields] = useState(
    editing?.sub_fields !== undefined && editing.sub_fields.length > 0
  );

  // Compute total from sub_fields
  const subFieldsTotal = subFields.reduce((sum, sf) => sum + (Number(sf.amount) || 0), 0);

  // Fetch chart of accounts for dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: async () => (await api.get<any[]>("/accounts")) ?? [],
  });

  // Filter accounts to show ones relevant to the selected section
  const sectionAccountTypes: Record<BalanceSheetSection, string[]> = {
    tangible_asset: ["fixed_asset"],
    cash_bank: ["bank", "cash", "petty_cash"],
    accounts_receivable: ["current_asset"],
    accounts_payable: ["current_liability"],
    customer_advance: ["current_liability"],
    rounding: ["current_liability"],
    share_capital: ["share_capital"],
    retained_earnings: ["retained_earnings"],
    other_current_asset: ["current_asset"],
    other_current_liability: ["current_liability"],
    other_equity: ["equity"],
  };

  const relevantSubTypes = sectionAccountTypes[section] ?? [];
  const filteredAccounts = accounts.filter(
    (a: any) => relevantSubTypes.includes(a.sub_type) || a.sub_type === section
  );

  const handleAddSubField = () => {
    setSubFields(prev => [...prev, {
      id: generateId(),
      name: "",
      amount: 0,
      date: date,
    }]);
  };

  const handleRemoveSubField = (id: string) => {
    setSubFields(prev => prev.filter(sf => sf.id !== id));
  };

  const handleSubFieldChange = (id: string, field: keyof SubField, value: string | number) => {
    setSubFields(prev => prev.map(sf => {
      if (sf.id !== id) return sf;
      return { ...sf, [field]: value };
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!date) { toast.error("Date is required"); return; }

    if (useSubFields) {
      if (subFields.length === 0) {
        toast.error("Add at least one sub-field or switch to manual amount");
        return;
      }
      // Validate sub-fields
      for (const sf of subFields) {
        if (!sf.name.trim()) { toast.error("Each sub-field needs a name"); return; }
        if (isNaN(Number(sf.amount))) { toast.error("Each sub-field needs a valid amount"); return; }
        if (!sf.date) { toast.error("Each sub-field needs a date"); return; }
      }
      onSave({
        section,
        description: description.trim(),
        amount: subFieldsTotal,
        date,
        sub_fields: subFields.map(sf => ({
          id: sf.id,
          name: sf.name.trim(),
          amount: Number(sf.amount) || 0,
          date: sf.date,
        })),
        account_id: accountId || undefined,
        notes: notes.trim() || undefined,
        is_opening_balance: isOpening,
      });
    } else {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum)) { toast.error("A valid amount is required"); return; }
      onSave({
        section,
        description: description.trim(),
        amount: amountNum,
        date,
        account_id: accountId || undefined,
        notes: notes.trim() || undefined,
        is_opening_balance: isOpening,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">
              {editing ? "Edit manual entry" : "Add manual entry"}
            </h3>
            {isOpening && (
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-300">
                Opening
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Section */}
          <L label="Balance Sheet Section *">
            <select
              className="inp"
              value={section}
              onChange={(e) => setSection(e.target.value as BalanceSheetSection)}
            >
              {BALANCE_SHEET_SECTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {SECTION_LABELS[sec]}
                </option>
              ))}
            </select>
          </L>

          {/* Description */}
          <L label="Description *">
            <input
              required
              className="inp"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Office furniture adjustment"
              maxLength={500}
            />
          </L>

          {/* Amount entry mode toggle */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={useSubFields}
                onChange={(e) => {
                  setUseSubFields(e.target.checked);
                  if (e.target.checked && subFields.length === 0) {
                    handleAddSubField();
                  }
                }}
              />
              <div className="h-5 w-9 rounded-full bg-muted-foreground/30 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-violet-500 peer-checked:after:translate-x-full" />
            </label>
            <div>
              <span className="text-sm font-medium">Use sub-fields (line items)</span>
              <p className="text-[11px] text-muted-foreground">
                Break down this entry into individual line items with name, amount & date
              </p>
            </div>
          </div>

          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-4">
            <L label={useSubFields ? "Total (auto-calculated)" : "Amount *"}>
              {useSubFields ? (
                <div className="inp num flex items-center gap-2 bg-violet-50/30 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
                  <span className="text-sm font-bold text-violet-700 dark:text-violet-400">
                    {fmtMoney(subFieldsTotal)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {subFields.length} line{subFields.length !== 1 ? "s" : ""}
                  </span>
                </div>
              ) : (
                <input
                  required
                  type="text"
                  inputMode="decimal"
                  className="inp num"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              )}
            </L>
            <L label="Date *">
              <input
                required
                type="date"
                className="inp"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </L>
          </div>

          {/* ── Sub-fields Section ── */}
          {useSubFields && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/20 p-4 dark:border-violet-900 dark:bg-violet-950/10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-400">
                    Line Items
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAddSubField}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300 dark:hover:bg-violet-900/50 transition-all"
                >
                  <Plus className="h-3 w-3" />
                  Add line item
                </button>
              </div>

              <div className="space-y-2">
                {subFields.map((sf, idx) => (
                  <div
                    key={sf.id}
                    className="group grid grid-cols-12 gap-2 items-start rounded-md border border-violet-200/60 bg-white p-2 dark:border-violet-800/60 dark:bg-violet-950/20"
                  >
                    <div className="col-span-1 flex items-center justify-center">
                      <span className="text-[10px] font-mono text-muted-foreground">{idx + 1}</span>
                    </div>
                    <div className="col-span-4">
                      <input
                        type="text"
                        className="inp text-xs py-1.5"
                        value={sf.name}
                        onChange={(e) => handleSubFieldChange(sf.id, "name", e.target.value)}
                        placeholder="Item name"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="inp num text-xs py-1.5"
                        value={sf.amount || ""}
                        onChange={(e) => handleSubFieldChange(sf.id, "amount", e.target.value)}
                        placeholder="Amount"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="date"
                        className="inp text-xs py-1.5"
                        value={sf.date}
                        onChange={(e) => handleSubFieldChange(sf.id, "date", e.target.value)}
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveSubField(sf.id)}
                        className="p-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                        title="Remove line item"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {subFields.length > 0 && (
                <div className="mt-3 flex items-center justify-between border-t border-violet-200/60 pt-2 dark:border-violet-800/60">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total
                  </span>
                  <span className="text-sm font-bold num text-violet-700 dark:text-violet-400">
                    {fmtMoney(subFieldsTotal)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Account mapping */}
          <L label="Link to Account (optional)">
            <select className="inp" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">No account mapping</option>
              {filteredAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  [{a.code}] {a.name} ({a.type})
                </option>
              ))}
            </select>
          </L>

          {/* Opening Balance Toggle */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isOpening}
                onChange={(e) => setIsOpening(e.target.checked)}
              />
              <div className="h-5 w-9 rounded-full bg-muted-foreground/30 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-amber-500 peer-checked:after:translate-x-full" />
            </label>
            <div>
              <span className="text-sm font-medium">Opening balance entry</span>
              <p className="text-[11px] text-muted-foreground">
                Mark this as an opening balance carried forward from a prior period
              </p>
            </div>
          </div>

          {/* Notes */}
          <L label="Notes (optional)">
            <textarea
              className="inp min-h-[60px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this entry"
              maxLength={1000}
              rows={2}
            />
          </L>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              {editing ? "Save changes" : "Add entry"}
            </button>
          </div>
        </form>

        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

// ── Shared label helper ──
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
