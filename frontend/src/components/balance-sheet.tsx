import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Loader2, Scale, AlertTriangle, Check, X, ArrowRight, ExternalLink, FolderOpen } from "lucide-react";

export interface BalanceSheetData {
  report_date: string;
  sections: Array<{
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
        debit_balance?: number;
        credit_balance?: number;
      }>;
    }>;
  }>;
  computed: {
    netCurrentAssets: number;
    totalAssetsLessCurrentLiabilities: number;
    netAssets: number;
  };
  capitalAndReserves: {
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
      }>;
    }>;
  };
  verification: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    difference: number;
    isBalanced: boolean;
  };
}

interface AccountTransaction {
  id: string;
  journal_entry_id: string;
  entry_date: string;
  reference: string;
  line_description: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
}

interface AccountTransactionsData {
  account: { id: string; code: string; name: string; type: string };
  transactions: AccountTransaction[];
  total_debits: number;
  total_credits: number;
  net_balance: number;
}

interface SectionTransactionsData {
  section_label: string;
  account_count: number;
  transaction_count: number;
  account_summaries: Array<{
    account_id: string;
    account_code: string;
    account_name: string;
    account_type: string;
    total_debits: number;
    total_credits: number;
    net_balance: number;
  }>;
  transactions: Array<{
    id: string;
    account_id: string;
    account_code: string;
    account_name: string;
    journal_entry_id: string;
    entry_date: string;
    reference: string;
    line_description: string;
    debit_amount: number;
    credit_amount: number;
  }>;
  total_debits: number;
  total_credits: number;
}

function fmtNeg(val: number): string {
  if (val < 0) return `(${fmtMoney(Math.abs(val))})`;
  return fmtMoney(val);
}

// ── Helper: collect all account IDs from any section/capital block ──
function collectSectionAccountIds(section: {
  subsections: Array<{ accounts: Array<{ id: string }> }>;
}): string[] {
  const ids = new Set<string>();
  for (const sub of section.subsections) {
    for (const acc of sub.accounts) {
      if (acc.id) ids.add(acc.id);
    }
  }
  return Array.from(ids);
}

export function BalanceSheetView({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [drillDownAccount, setDrillDownAccount] = useState<string | null>(null);
  const [sectionDrillDown, setSectionDrillDown] = useState<{
    label: string;
    accountIds: string[];
  } | null>(null);

  // Build query string from date filter params
  const queryString = (fromDate || toDate)
    ? `?${fromDate ? `from=${encodeURIComponent(fromDate)}` : ""}${fromDate && toDate ? "&" : ""}${toDate ? `to=${encodeURIComponent(toDate)}` : ""}`
    : "";

  const { data, isLoading } = useQuery<BalanceSheetData>({
    queryKey: ["balance-sheet", fromDate ?? "", toDate ?? ""],
    queryFn: async () => (await api.get<BalanceSheetData>(`/reports/balance-sheet${queryString}`))!,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        <Scale className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p>Could not load balance sheet data.</p>
      </div>
    );
  }

  const d = data;

  return (
    <div className="space-y-6">
      {/* Verification Banner */}
      {d.verification.isBalanced ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium text-emerald-800 dark:text-emerald-300">
            Balance Sheet is in balance
          </span>
          <span className="text-emerald-600/60 dark:text-emerald-400/60">
            · Assets ${d.verification.totalAssets.toLocaleString()} = Liabilities $
            {d.verification.totalLiabilities.toLocaleString()} + Equity $
            {d.verification.totalEquity.toLocaleString()}
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

      {/* Main Sections */}
      <Card>
        <div className="space-y-0">
          {/* Fixed Assets */}
          {(() => {
            const sec = d.sections.find(s => s.label === "Fixed Assets");
            return sec ? (
              <SectionBlock
                section={sec}
                onAccountClick={(id) => setDrillDownAccount(id)}
                onTotalClick={() => {
                  const ids = collectSectionAccountIds(sec);
                  if (ids.length > 0) setSectionDrillDown({ label: "Fixed Assets", accountIds: ids });
                }}
              />
            ) : null;
          })()}

          <div className="border-t border-border/60" />

          {/* Current Assets */}
          {(() => {
            const sec = d.sections.find(s => s.label === "Current Assets");
            return sec ? (
              <SectionBlock
                section={sec}
                onAccountClick={(id) => setDrillDownAccount(id)}
                onTotalClick={() => {
                  const ids = collectSectionAccountIds(sec);
                  if (ids.length > 0) setSectionDrillDown({ label: "Current Assets", accountIds: ids });
                }}
              />
            ) : null;
          })()}

          <div className="border-t border-border/60" />

          {/* Creditors: amounts falling due within one year */}
          {(() => {
            const sec = d.sections.find(s => s.label === "Creditors: amounts falling due within one year");
            return sec ? (
              <SectionBlock
                section={sec}
                onAccountClick={(id) => setDrillDownAccount(id)}
                onTotalClick={() => {
                  const ids = collectSectionAccountIds(sec);
                  if (ids.length > 0) setSectionDrillDown({ label: "Creditors", accountIds: ids });
                }}
              />
            ) : null;
          })()}

          <div className="border-t-2 border-border" />

          {/* Net Current Assets (Liabilities) */}
          <ComputedRow
            label="Net Current Assets (Liabilities)"
            value={d.computed.netCurrentAssets}
            onClick={() => {
              // Show all accounts from current assets + creditors
              const ca = d.sections.find(s => s.label === "Current Assets");
              const cl = d.sections.find(s => s.label === "Creditors: amounts falling due within one year");
              const ids = [
                ...(ca ? collectSectionAccountIds(ca) : []),
                ...(cl ? collectSectionAccountIds(cl) : []),
              ];
              if (ids.length > 0) setSectionDrillDown({ label: "Net Current Assets (Liabilities)", accountIds: ids });
            }}
          />

          <div className="border-t-2 border-border" />

          {/* Total Assets less Current Liabilities */}
          <ComputedRow
            label="Total Assets less Current Liabilities"
            value={d.computed.totalAssetsLessCurrentLiabilities}
            bold
            onClick={() => {
              // Show all accounts from ALL sections
              const allIds: string[] = [];
              for (const sec of d.sections) {
                allIds.push(...collectSectionAccountIds(sec));
              }
              if (allIds.length > 0) setSectionDrillDown({ label: "Total Assets less Current Liabilities", accountIds: allIds });
            }}
          />

          <div className="border-t-2 border-border" />

          {/* Net Assets */}
          <ComputedRow
            label="Net Assets"
            value={d.computed.netAssets}
            bold
            doubleTop
            onClick={() => {
              // Same as total assets less current liabilities
              const allIds: string[] = [];
              for (const sec of d.sections) {
                allIds.push(...collectSectionAccountIds(sec));
              }
              if (allIds.length > 0) setSectionDrillDown({ label: "Net Assets", accountIds: allIds });
            }}
          />

          <div className="border-t-2 border-border" />

          {/* Capital and Reserves */}
          {(() => {
            const sec = d.capitalAndReserves;
            return sec ? (
              <SectionBlock
                section={sec}
                isCapital
                onAccountClick={(id) => setDrillDownAccount(id)}
                onTotalClick={() => {
                  const ids = collectSectionAccountIds(sec);
                  if (ids.length > 0) setSectionDrillDown({ label: "Capital and Reserves", accountIds: ids });
                }}
              />
            ) : null;
          })()}

          <div className="border-t-2 border-border" />

          {/* Total Capital and Reserves */}
          <ComputedRow
            label="Total Capital and Reserves"
            value={d.capitalAndReserves.total}
            bold
            onClick={() => {
              const ids = collectSectionAccountIds(d.capitalAndReserves);
              if (ids.length > 0) setSectionDrillDown({ label: "Total Capital and Reserves", accountIds: ids });
            }}
          />
        </div>
      </Card>

      {/* Account Drill-down Modal */}
      {drillDownAccount && (
        <AccountTransactionsModal
          accountId={drillDownAccount}
          onClose={() => setDrillDownAccount(null)}
        />
      )}

      {/* Section Drill-down Modal */}
      {sectionDrillDown && (
        <SectionTransactionsModal
          label={sectionDrillDown.label}
          accountIds={sectionDrillDown.accountIds}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setSectionDrillDown(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SECTION DRILL-DOWN MODAL
// ═══════════════════════════════════════════════════════════════

function SectionTransactionsModal({
  label,
  accountIds,
  fromDate,
  toDate,
  onClose,
}: {
  label: string;
  accountIds: string[];
  fromDate?: string;
  toDate?: string;
  onClose: () => void;
}) {
  // Build query params including date filter
  const sectionQueryString = (() => {
    const params = new URLSearchParams();
    params.set("accountIds", accountIds.join(","));
    params.set("label", label);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return params.toString();
  })();

  const { data, isLoading, isError } = useQuery<SectionTransactionsData>({
    queryKey: ["section-transactions", label, ...accountIds.sort(), fromDate ?? "", toDate ?? ""],
    queryFn: async () =>
      (await api.get<SectionTransactionsData>(
        `/reports/balance-sheet/section-transactions?${sectionQueryString}`,
      ))!,
  });

  const [viewMode, setViewMode] = useState<"all" | "by-account">("all");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">
              {label}
            </h3>
            {data && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {data.transaction_count} txns · {data.account_count} accounts
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm">
            <AlertTriangle className="h-6 w-6 text-rose-500" />
            <p className="text-rose-600 dark:text-rose-400">Failed to load section transactions.</p>
          </div>
        ) : !data || data.transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <p>No journal entries found for this section.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* View toggle */}
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <button
                onClick={() => setViewMode("all")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All Transactions
              </button>
              <button
                onClick={() => setViewMode("by-account")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === "by-account"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                By Account
              </button>
            </div>

            {viewMode === "by-account" ? (
              /* ── By-Account View ── */
              <div className="space-y-4">
                {data.account_summaries
                  .filter((s) => s.total_debits > 0 || s.total_credits > 0)
                  .map((summary) => (
                    <div
                      key={summary.account_id}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {summary.account_code && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {summary.account_code}
                            </span>
                          )}
                          <span className="text-sm font-semibold">{summary.account_name}</span>
                          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                            {summary.account_type}
                          </span>
                        </div>
                        <span className="text-sm font-bold num">
                          {fmtMoney(Math.abs(summary.net_balance))}
                          {summary.net_balance >= 0 ? " Dr" : " Cr"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <div>Debits: <span className="font-medium text-foreground num">{fmtMoney(summary.total_debits)}</span></div>
                        <div>Credits: <span className="font-medium text-foreground num">{fmtMoney(summary.total_credits)}</span></div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              /* ── All Transactions Table ── */
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-normal">Date</th>
                      <th className="px-4 py-2.5 text-left font-normal">Account</th>
                      <th className="px-4 py-2.5 text-left font-normal">Reference</th>
                      <th className="px-4 py-2.5 text-left font-normal">Description</th>
                      <th className="px-4 py-2.5 text-right font-normal">Debit</th>
                      <th className="px-4 py-2.5 text-right font-normal">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t, idx) => (
                      <tr
                        key={t.id}
                        className="border-t border-border/40 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(t.entry_date)}</td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate">
                          {t.account_code && (
                            <span className="font-mono text-[10px] text-muted-foreground mr-1">
                              {t.account_code}
                            </span>
                          )}
                          <span className="text-xs">{t.account_name}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground max-w-[100px] truncate">
                          {t.reference || "—"}
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate">
                          {t.line_description || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right num">
                          {t.debit_amount > 0 ? (
                            <span className="font-medium">{fmtMoney(t.debit_amount)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right num">
                          {t.credit_amount > 0 ? (
                            <span className="font-medium">{fmtMoney(t.credit_amount)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/20">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-foreground">
                        Totals
                      </td>
                      <td className="px-4 py-3 text-right num font-bold">{fmtMoney(data.total_debits)}</td>
                      <td className="px-4 py-3 text-right num font-bold">{fmtMoney(data.total_credits)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Showing {data.transactions.length} transaction{data.transactions.length !== 1 ? "s" : ""} across {data.account_count} account{data.account_count !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ACCOUNT DRILL-DOWN MODAL (existing)
// ═══════════════════════════════════════════════════════════════

function AccountTransactionsModal({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<AccountTransactionsData>({
    queryKey: ["account-transactions", accountId],
    queryFn: async () =>
      (await api.get<AccountTransactionsData>(
        `/reports/balance-sheet/account-transactions/${accountId}`,
      ))!,
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">
              {data ? (
                <>
                  <span className="font-mono text-sm text-muted-foreground mr-2">
                    [{data.account.code}]
                  </span>
                  {data.account.name}
                </>
              ) : (
                "Account Transactions"
              )}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm">
            <AlertTriangle className="h-6 w-6 text-rose-500" />
            <p className="text-rose-600 dark:text-rose-400">Failed to load account transactions.</p>
            <p className="text-muted-foreground">The account may have been deleted or a network error occurred.</p>
          </div>
        ) : !data || data.transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <p>No journal entries found for this account.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* Summary card */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-muted/20 p-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Account Type
                </div>
                <div className="mt-0.5 text-sm font-medium capitalize">{data.account.type}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Total Debits
                </div>
                <div className="mt-0.5 text-sm font-medium num">{fmtMoney(data.total_debits)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Total Credits
                </div>
                <div className="mt-0.5 text-sm font-medium num">{fmtMoney(data.total_credits)}</div>
              </div>
            </div>

            {/* Transactions table */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-normal">Date</th>
                    <th className="px-4 py-2.5 text-left font-normal">Reference</th>
                    <th className="px-4 py-2.5 text-left font-normal">Description</th>
                    <th className="px-4 py-2.5 text-right font-normal">Debit</th>
                    <th className="px-4 py-2.5 text-right font-normal">Credit</th>
                    <th className="px-4 py-2.5 text-right font-normal">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((t, idx) => (
                    <tr
                      key={t.id}
                      className="border-t border-border/40 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(t.entry_date)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground max-w-[120px] truncate">
                        {t.reference || "—"}
                      </td>
                      <td className="px-4 py-2.5 max-w-[250px] truncate">
                        {t.line_description || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right num">
                        {t.debit_amount > 0 ? (
                          <span className="font-medium">{fmtMoney(t.debit_amount)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right num">
                        {t.credit_amount > 0 ? (
                          <span className="font-medium">{fmtMoney(t.credit_amount)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right num font-medium ${
                          t.running_balance >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {fmtMoney(Math.abs(t.running_balance))}
                        {t.running_balance >= 0 ? " Dr" : " Cr"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/20">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-foreground">
                      Net Balance
                    </td>
                    <td className="px-4 py-3 text-right num font-bold">{fmtMoney(data.total_debits)}</td>
                    <td className="px-4 py-3 text-right num font-bold">{fmtMoney(data.total_credits)}</td>
                    <td className="px-4 py-3 text-right num font-bold">
                      {fmtMoney(Math.abs(data.net_balance))}
                      {data.net_balance >= 0 ? " Dr" : " Cr"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="text-xs text-muted-foreground">
              {data.transactions.length} transaction{data.transactions.length !== 1 ? "s" : ""} · Running balance shows{" "}
              {data.account.type === "asset" || data.account.type === "expense"
                ? "debits minus credits"
                : "credits minus debits"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SECTION BLOCK
// ═══════════════════════════════════════════════════════════════

function SectionBlock({
  section,
  isCapital,
  onAccountClick,
  onTotalClick,
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
        debit_balance?: number;
        credit_balance?: number;
      }>;
    }>;
  };
  isCapital?: boolean;
  onAccountClick?: (accountId: string) => void;
  onTotalClick?: () => void;
}) {
  const hasAccounts = section.subsections.some((sub) => sub.accounts.length > 0);

  return (
    <div>
      {/* Section Title */}
      <div className="flex items-center justify-between bg-muted/30 px-6 py-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          {section.label}
        </h3>
        <span className="text-sm font-bold num">{fmtNeg(section.total)}</span>
      </div>

      {/* Subsections */}
      {section.subsections.map((sub, idx) => (
        <div key={idx}>
          {/* Subsection Label */}
          <div className="flex items-center justify-between border-t border-border/40 px-6 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {sub.label}
            </span>
            {sub.accounts.length > 0 && (
              <span className="text-xs font-semibold num text-muted-foreground">
                {fmtNeg(sub.total)}
              </span>
            )}
          </div>

          {/* Account Lines */}
          {sub.accounts.length === 0 ? (
            <div className="px-6 py-2 text-xs italic text-muted-foreground/60">
              No accounts in this category
            </div>
          ) : (
            sub.accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => onAccountClick?.(acc.id)}
                className="group flex w-full items-center justify-between border-t border-border/20 px-6 py-2 hover:bg-primary/5 transition-colors text-left"
                title="Click to view transactions"
              >
                <span className="text-sm pl-4 flex items-center gap-1.5">
                  {acc.code && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {acc.code}
                    </span>
                  )}
                  {acc.name}
                  <ExternalLink className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary/60 transition-opacity opacity-0 group-hover:opacity-100" />
                </span>
                <span className="text-sm tabular-nums num shrink-0">
                  {acc.debit_balance !== undefined && acc.debit_balance > 0
                    ? fmtMoney(acc.debit_balance)
                    : acc.credit_balance !== undefined && acc.credit_balance > 0
                    ? fmtMoney(acc.credit_balance)
                    : fmtNeg(acc.balance)}
                </span>
              </button>
            ))
          )}

          {/* Subsection Total separator */}
          {section.subsections.length > 1 && sub.accounts.length > 0 && idx < section.subsections.length - 1 && (
            <div className="border-t border-dashed border-border/30 mx-6" />
          )}
        </div>
      ))}

      {/* Section Total Bar — clickable */}
      {!isCapital && hasAccounts && (
        <button
          onClick={onTotalClick}
          className="group flex w-full items-center justify-between border-t border-border/60 bg-muted/10 px-6 py-2.5 hover:bg-primary/5 transition-colors text-left"
          title="Click to view all transactions in this section"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
            Total {section.label}
            <FolderOpen className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary/60 transition-opacity opacity-0 group-hover:opacity-100" />
          </span>
          <span className="text-sm font-bold num">{fmtNeg(section.total)}</span>
        </button>
      )}

      {/* Non-clickable total bar when no accounts */}
      {!isCapital && !hasAccounts && (
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/10 px-6 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Total {section.label}
          </span>
          <span className="text-sm font-bold num">{fmtNeg(section.total)}</span>
        </div>
      )}
    </div>
  );
}

function ComputedRow({
  label,
  value,
  bold,
  doubleTop,
  onClick,
}: {
  label: string;
  value: number;
  bold?: boolean;
  doubleTop?: boolean;
  onClick?: () => void;
}) {
  const isClickable = !!onClick;
  const Comp = isClickable ? "button" : "div";

  return (
    <Comp
      onClick={onClick}
      className={`group flex w-full items-center justify-between px-6 py-3 ${
        doubleTop ? "border-t-2 border-border" : ""
      } ${bold ? "bg-muted/15" : ""} ${isClickable ? "hover:bg-primary/5 cursor-pointer transition-colors" : ""}`}
      title={isClickable ? "Click to view all underlying transactions" : undefined}
    >
      <span
        className={`text-sm flex items-center gap-1.5 ${
          bold ? "font-bold text-foreground" : "font-semibold text-muted-foreground"
        }`}
      >
        {label}
        {isClickable && (
          <FolderOpen className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary/60 transition-opacity opacity-0 group-hover:opacity-100" />
        )}
      </span>
      <span className={`text-sm num ${bold ? "font-bold" : "font-semibold"}`}>
        {fmtNeg(value)}
      </span>
    </Comp>
  );
}
