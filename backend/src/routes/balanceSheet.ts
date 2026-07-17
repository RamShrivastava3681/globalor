import { Router, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { scanTable, getItem, TABLES } from "../db/client.js";

const router = Router();

// ── Date range filter helper ──
function dateRangeFilter(req: AuthRequest) {
  const from = (req.query.from as string) || "";
  const to = (req.query.to as string) || "";
  const isInRange = (dateStr: string | null | undefined): boolean => {
    if (!from && !to) return true;
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  return { from, to, isInRange };
}

// ── GET /api/reports/balance-sheet ──
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, isInRange } = dateRangeFilter(req);

    // ── Fetch all source data in parallel ──
    const [allAccounts, allJournalEntries, allInvoices, allPurchaseInvoices, allAdvances, allPurchaseOrders] =
      await Promise.all([
        scanTable<any>(TABLES.CHART_OF_ACCOUNTS),
        scanTable<any>(TABLES.JOURNAL_ENTRIES),
        scanTable<any>(TABLES.INVOICES),
        scanTable<any>(TABLES.PURCHASE_INVOICES),
        scanTable<any>(TABLES.ADVANCES),
        scanTable<any>(TABLES.PURCHASE_ORDERS),
      ]);

    // ── Compute account balances from journal entries ──
    const balanceMap: Record<string, { debit_total: number; credit_total: number }> = {};
    for (const entry of allJournalEntries) {
      const lines = entry.lines || [];
      for (const line of lines) {
        const accId = line.account_id;
        if (!accId) continue;
        if (!balanceMap[accId]) balanceMap[accId] = { debit_total: 0, credit_total: 0 };
        balanceMap[accId].debit_total += Number(line.debit_amount) || 0;
        balanceMap[accId].credit_total += Number(line.credit_amount) || 0;
      }
    }

    // Build account lookup with computed net balances
    const accountMap = new Map<string, any>();
    const accountsBySubType: Record<string, any[]> = {};

    for (const acc of allAccounts) {
      const b = balanceMap[acc.id] || { debit_total: 0, credit_total: 0 };
      const netBalance = b.debit_total - b.credit_total;
      const subType = acc.sub_type || "";
      const enriched = {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        sub_type: subType,
        debit_balance: netBalance > 0 ? netBalance : 0,
        credit_balance: netBalance < 0 ? Math.abs(netBalance) : 0,
        net_balance: netBalance,
      };
      accountMap.set(acc.id, enriched);

      if (!accountsBySubType[subType]) accountsBySubType[subType] = [];
      accountsBySubType[subType].push(enriched);
    }

    // ── Helper to get balance of accounts by sub_type ──
    const getSubTypeTotal = (subType: string): number => {
      const accounts = accountsBySubType[subType] || [];
      return accounts.reduce((s, a) => s + a.net_balance, 0);
    };

    // ── Helper to list individual accounts by sub_type ──
    const getSubTypeAccounts = (subType: string): any[] => {
      return (accountsBySubType[subType] || [])
        .filter((a) => a.net_balance !== 0)
        .sort((a, b) => (a.code || "").localeCompare(b.code || ""));
    };

    // ── 1. FIXED ASSETS ──
    const fixedAssetAccounts = getSubTypeAccounts("fixed_asset");
    const totalFixedAssets = getSubTypeTotal("fixed_asset");

    const fixedAssetsSection = {
      label: "Fixed Assets",
      total: totalFixedAssets,
      subsections: [
        {
          label: "Tangible Assets",
          total: totalFixedAssets,
          accounts: fixedAssetAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
            debit_balance: a.debit_balance,
            credit_balance: a.credit_balance,
          })),
        },
      ],
    };

    // ── 2. CURRENT ASSETS ──
    // Cash at bank and in hand: bank + cash + petty_cash
    const cashAccounts = [
      ...getSubTypeAccounts("bank"),
      ...getSubTypeAccounts("cash"),
      ...getSubTypeAccounts("petty_cash"),
    ].sort((a, b) => (a.code || "").localeCompare(b.code || ""));

    const totalCashAtBank = getSubTypeTotal("bank") + getSubTypeTotal("cash") + getSubTypeTotal("petty_cash");

    // Accounts Receivable: outstanding balance of ALL sales invoices (not just approved)
    // Filter by date range if provided
    const salesInvoices = from || to
      ? allInvoices.filter((inv: any) => isInRange(inv.issue_date))
      : allInvoices;

    const outstandingInvoices = salesInvoices.filter(
      (inv: any) => inv.status !== "paid" && inv.status !== "funded" && inv.status !== "rejected",
    );
    const accountsReceivable = outstandingInvoices.reduce(
      (s: number, inv: any) => s + Number(inv.amount) - (Number(inv.amount_received) || 0),
      0,
    );

    // Other Current Assets: current_asset sub_type
    const currentAssetAccounts = getSubTypeAccounts("current_asset");
    const totalOtherCurrentAssets = getSubTypeTotal("current_asset");

    const totalCurrentAssets = totalCashAtBank + accountsReceivable + totalOtherCurrentAssets;

    const currentAssetsSection = {
      label: "Current Assets",
      total: totalCurrentAssets,
      subsections: [
        {
          label: "Cash at bank and in hand",
          total: totalCashAtBank,
          accounts: cashAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
            debit_balance: a.debit_balance,
            credit_balance: a.credit_balance,
          })),
        },
        {
          label: "Accounts Receivable",
          total: accountsReceivable,
          accounts: [],
        },
        {
          label: "Other Current Assets",
          total: totalOtherCurrentAssets,
          accounts: currentAssetAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
            debit_balance: a.debit_balance,
            credit_balance: a.credit_balance,
          })),
        },
      ],
    };

    // ── 3. CURRENT LIABILITIES ──
    // Accounts Payable: outstanding balance of ALL purchase invoices (not just approved)
    // Filter by date range if provided
    const purchaseInvoices = from || to
      ? allPurchaseInvoices.filter((pi: any) => isInRange(pi.issue_date))
      : allPurchaseInvoices;

    const outstandingPurchases = purchaseInvoices.filter(
      (pi: any) => pi.status !== "paid" && pi.status !== "funded" && pi.status !== "rejected",
    );
    const accountsPayable = outstandingPurchases.reduce(
      (s: number, pi: any) => s + Number(pi.amount),
      0,
    );

    // Advance received from Customers: open advances linked to sales purchase orders
    const salesAdvances = allAdvances.filter((a: any) => a.side === "sales" && a.status === "open");
    const advanceFromCustomers = salesAdvances.reduce(
      (s: number, a: any) => s + Number(a.amount),
      0,
    );

    // Corporation Tax Payable accounts
    const corpTaxAccounts = getSubTypeAccounts("current_liability").filter(
      (a) => a.name.toLowerCase().includes("tax") || a.name.toLowerCase().includes("corporation"),
    );
    const corpTaxTotal = corpTaxAccounts.reduce((s, a) => s + a.net_balance, 0);

    // Rounding account
    const roundingAccounts = getSubTypeAccounts("current_liability").filter(
      (a) => a.name.toLowerCase().includes("rounding"),
    );
    const roundingTotal = roundingAccounts.reduce((s, a) => s + a.net_balance, 0);

    // Remaining current liability accounts
    const otherCurrentLiabilityAccounts = getSubTypeAccounts("current_liability").filter(
      (a) =>
        !a.name.toLowerCase().includes("tax") &&
        !a.name.toLowerCase().includes("corporation") &&
        !a.name.toLowerCase().includes("rounding"),
    );
    const totalOtherCurrentLiabilities = otherCurrentLiabilityAccounts.reduce((s, a) => s + a.net_balance, 0);

    const totalCreditorsOneYear =
      accountsPayable + advanceFromCustomers + corpTaxTotal + roundingTotal + totalOtherCurrentLiabilities;

    const currentLiabilitiesSection = {
      label: "Creditors: amounts falling due within one year",
      total: totalCreditorsOneYear,
      subsections: [
        {
          label: "Accounts Payable",
          total: accountsPayable,
          accounts: [],
        },
        {
          label: "Advance received from Customers",
          total: advanceFromCustomers,
          accounts: salesAdvances.map((a: any) => ({
            id: a.id,
            name: a.reference || `Advance ${a.id.slice(-8)}`,
            balance: Number(a.amount),
          })),
        },
        {
          label: "Corporation Tax Payable",
          total: corpTaxTotal,
          accounts: corpTaxAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
          })),
        },
        {
          label: "Rounding",
          total: roundingTotal,
          accounts: roundingAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
          })),
        },
        {
          label: "Other Current Liabilities",
          total: totalOtherCurrentLiabilities,
          accounts: otherCurrentLiabilityAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
            debit_balance: a.debit_balance,
            credit_balance: a.credit_balance,
          })),
        },
      ],
    };

    // ── COMPUTED SECTIONS ──
    const netCurrentAssets = totalCurrentAssets - totalCreditorsOneYear;
    const totalAssetsLessCurrentLiabilities = totalFixedAssets + netCurrentAssets;
    const netAssets = totalAssetsLessCurrentLiabilities;

    // ── 4. CAPITAL AND RESERVES ──
    const revenueAccounts = allAccounts.filter((a: any) => a.type === "revenue");
    const expenseAccounts = allAccounts.filter((a: any) => a.type === "expense");

    const totalRevenue = revenueAccounts.reduce((s: number, a: any) => {
      const b = balanceMap[a.id] || { debit_total: 0, credit_total: 0 };
      return s + (b.credit_total - b.debit_total);
    }, 0);

    const totalExpenses = expenseAccounts.reduce((s: number, a: any) => {
      const b = balanceMap[a.id] || { debit_total: 0, credit_total: 0 };
      return s + (b.debit_total - b.credit_total);
    }, 0);

    const currentYearEarnings = totalRevenue - totalExpenses;
    const retainedEarningsTotal = getSubTypeTotal("retained_earnings");
    const shareCapitalAccounts = getSubTypeAccounts("share_capital");
    const shareCapitalTotal = getSubTypeTotal("share_capital");

    const otherEquityAccounts = allAccounts
      .filter((a: any) => a.type === "equity" && a.sub_type !== "share_capital" && a.sub_type !== "retained_earnings")
      .map((a: any) => {
        const b = balanceMap[a.id] || { debit_total: 0, credit_total: 0 };
        const net = b.credit_total - b.debit_total;
        return { id: a.id, code: a.code, name: a.name, balance: net };
      })
      .filter((a: any) => a.balance !== 0)
      .sort((a: any, b: any) => (a.code || "").localeCompare(b.code || ""));

    const totalOtherEquity = otherEquityAccounts.reduce((s: number, a: any) => s + a.balance, 0);
    const totalCapitalAndReserves =
      currentYearEarnings + retainedEarningsTotal + shareCapitalTotal + totalOtherEquity;

    const capitalAndReservesSection = {
      label: "Capital and Reserves",
      total: totalCapitalAndReserves,
      subsections: [
        {
          label: "Current Year Earnings",
          total: currentYearEarnings,
          accounts: [],
        },
        {
          label: "Retained Earnings",
          total: retainedEarningsTotal,
          accounts: getSubTypeAccounts("retained_earnings").map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
          })),
        },
        {
          label: "Share Capital",
          total: shareCapitalTotal,
          accounts: shareCapitalAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            balance: a.net_balance,
          })),
        },
        {
          label: "Other Equity",
          total: totalOtherEquity,
          accounts: otherEquityAccounts,
        },
      ],
    };

    // ─────────────────────────────────────────────────────────────
    //  MERGE MANUAL BALANCE SHEET ITEMS
    // ─────────────────────────────────────────────────────────────
    const allManualItems = await scanTable<any>(TABLES.BALANCE_SHEET_ITEMS);
    const activeManualItems = allManualItems.filter((item: any) => item.is_active !== false);

    // Helper: add manual items to a subsection by matching section label
    const mergeManualIntoSubsection = (
      section: { total: number; subsections: Array<{ label: string; total: number; accounts: any[] }> },
      subsectionLabel: string,
      itemSection: string
    ) => {
      const matchingItems = activeManualItems.filter((i: any) => i.section === itemSection);
      if (matchingItems.length === 0) return;

      const sub = section.subsections.find((s) => s.label === subsectionLabel);
      if (!sub) return;

      for (const item of matchingItems) {
        sub.accounts.push({
          id: item.id,
          name: item.description,
          balance: Number(item.amount),
          source: "manual",
          date: item.date,
          notes: item.notes,
          account_id: item.account_id,
          is_opening_balance: !!item.is_opening_balance,
          manual_item_id: item.id,
        });
        sub.total += Number(item.amount);
      }

      // Recalculate section total
      section.total = section.subsections.reduce((s, sub) => s + sub.total, 0);
    };

    // Merge manual items into Fixed Assets > Tangible Assets
    mergeManualIntoSubsection(fixedAssetsSection, "Tangible Assets", "tangible_asset");

    // Merge manual items into Current Assets
    mergeManualIntoSubsection(currentAssetsSection, "Cash at bank and in hand", "cash_bank");
    mergeManualIntoSubsection(currentAssetsSection, "Accounts Receivable", "accounts_receivable");
    mergeManualIntoSubsection(currentAssetsSection, "Other Current Assets", "other_current_asset");

    // Merge manual items into Creditors
    mergeManualIntoSubsection(currentLiabilitiesSection, "Accounts Payable", "accounts_payable");
    mergeManualIntoSubsection(currentLiabilitiesSection, "Advance received from Customers", "customer_advance");
    mergeManualIntoSubsection(currentLiabilitiesSection, "Rounding", "rounding");
    mergeManualIntoSubsection(currentLiabilitiesSection, "Other Current Liabilities", "other_current_liability");

    // Merge manual items into Capital and Reserves
    mergeManualIntoSubsection(capitalAndReservesSection, "Share Capital", "share_capital");
    mergeManualIntoSubsection(capitalAndReservesSection, "Retained Earnings", "retained_earnings");
    mergeManualIntoSubsection(capitalAndReservesSection, "Other Equity", "other_equity");

    // ── Recalculate computed values after manual merges ──
    const totalFixedAssetsMerged = fixedAssetsSection.total;
    const totalCurrentAssetsMerged = currentAssetsSection.total;
    const totalCreditorsOneYearMerged = currentLiabilitiesSection.total;
    const totalCapitalAndReservesMerged = capitalAndReservesSection.total;

    const netCurrentAssetsMerged = totalCurrentAssetsMerged - totalCreditorsOneYearMerged;
    const totalAssetsLessCurrentLiabilitiesMerged = totalFixedAssetsMerged + netCurrentAssetsMerged;
    const netAssetsMerged = totalAssetsLessCurrentLiabilitiesMerged;

    // ── VERIFICATION ──
    const totalAssets = totalFixedAssetsMerged + totalCurrentAssetsMerged;
    const totalLiabilities = totalCreditorsOneYearMerged;
    const totalEquity = totalCapitalAndReservesMerged;
    const difference = totalAssets - (totalLiabilities + totalEquity);
    const isBalanced = Math.abs(difference) < 0.01;

    res.json({
      report_date: new Date().toISOString().slice(0, 10),
      from: from || undefined,
      to: to || undefined,
      sections: [
        fixedAssetsSection,
        currentAssetsSection,
        currentLiabilitiesSection,
      ],
      computed: {
        netCurrentAssets: netCurrentAssetsMerged,
        totalAssetsLessCurrentLiabilities: totalAssetsLessCurrentLiabilitiesMerged,
        netAssets: netAssetsMerged,
      },
      capitalAndReserves: capitalAndReservesSection,
      verification: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        difference,
        isBalanced,
      },
      manual_item_count: activeManualItems.length,
    });
  } catch (err) {
    console.error("Balance sheet error:", err);
    res.status(500).json({ error: "Failed to compute balance sheet" });
  }
});

// ── GET /api/reports/balance-sheet/section-transactions ──
// Returns all journal entry lines for multiple accounts, aggregated
router.get("/section-transactions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const accountIdsParam = (req.query.accountIds as string) || "";
    const sectionLabel = (req.query.label as string) || "Section";
    const { from, to, isInRange } = dateRangeFilter(req);
    const accountIds = accountIdsParam.split(",").filter(Boolean);

    if (accountIds.length === 0) {
      return res.status(400).json({ error: "No account IDs provided" });
    }

    // Fetch accounts and journal entries in parallel
    const [allAccounts, allEntries] = await Promise.all([
      scanTable<any>(TABLES.CHART_OF_ACCOUNTS),
      scanTable<any>(TABLES.JOURNAL_ENTRIES),
    ]);

    // Build account lookup
    const accountMap = new Map<string, any>();
    for (const acc of allAccounts) {
      accountMap.set(acc.id, acc);
    }

    // Collect all transactions for the specified accounts, respecting date range
    const accountIdSet = new Set(accountIds);
    const transactions: Array<{
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
    }> = [];

    for (const entry of allEntries) {
      // Respect date range filter on journal entry date
      if (from || to) {
        if (!isInRange(entry.entry_date)) continue;
      }
      const lines = entry.lines || [];
      for (const line of lines) {
        if (line.account_id && accountIdSet.has(line.account_id)) {
          const acc = accountMap.get(line.account_id);
          transactions.push({
            id: line.id,
            account_id: line.account_id,
            account_code: acc?.code || "",
            account_name: acc?.name || "Unknown",
            journal_entry_id: entry.id,
            entry_date: entry.entry_date,
            reference: entry.reference || "",
            line_description: line.description || "",
            debit_amount: Number(line.debit_amount) || 0,
            credit_amount: Number(line.credit_amount) || 0,
          });
        }
      }
    }

    // Sort by entry date ascending
    transactions.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id.localeCompare(b.id));

    // Compute per-account summary
    const accountSummaries = accountIds.map((id) => {
      const acc = accountMap.get(id);
      const txns = transactions.filter((t) => t.account_id === id);
      const totalDebits = txns.reduce((s, t) => s + t.debit_amount, 0);
      const totalCredits = txns.reduce((s, t) => s + t.credit_amount, 0);
      const isNormalDebit = ["asset", "expense"].includes(acc?.type || "");
      const netBalance = isNormalDebit ? totalDebits - totalCredits : totalCredits - totalDebits;
      return {
        account_id: id,
        account_code: acc?.code || "",
        account_name: acc?.name || "Unknown",
        account_type: acc?.type || "",
        total_debits: totalDebits,
        total_credits: totalCredits,
        net_balance: netBalance,
      };
    });

    const totalDebits = transactions.reduce((s, t) => s + t.debit_amount, 0);
    const totalCredits = transactions.reduce((s, t) => s + t.credit_amount, 0);

    res.json({
      section_label: sectionLabel,
      account_count: accountIds.length,
      transaction_count: transactions.length,
      account_summaries: accountSummaries,
      transactions,
      total_debits: totalDebits,
      total_credits: totalCredits,
    });
  } catch (err) {
    console.error("Section transactions error:", err);
    res.status(500).json({ error: "Failed to fetch section transactions" });
  }
});

// ── GET /api/reports/balance-sheet/account-transactions/:accountId ──
// Returns all journal entry lines for a specific account, with running balance
router.get("/account-transactions/:accountId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { accountId } = req.params;

    // Fetch the account
    const account = await getItem(TABLES.CHART_OF_ACCOUNTS, { id: accountId });
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Fetch all journal entries
    const allEntries = await scanTable<any>(TABLES.JOURNAL_ENTRIES);

    // Extract lines for this account, sorted by entry date
    const transactions: Array<{
      id: string;
      journal_entry_id: string;
      entry_date: string;
      reference: string;
      line_description: string;
      debit_amount: number;
      credit_amount: number;
      running_balance: number;
    }> = [];

    // Collect all lines for this account with journal entry metadata
    for (const entry of allEntries) {
      const lines = entry.lines || [];
      for (const line of lines) {
        if (line.account_id === accountId) {
          transactions.push({
            id: line.id,
            journal_entry_id: entry.id,
            entry_date: entry.entry_date,
            reference: entry.reference || "",
            line_description: line.description || "",
            debit_amount: Number(line.debit_amount) || 0,
            credit_amount: Number(line.credit_amount) || 0,
            running_balance: 0, // will compute below
          });
        }
      }
    }

    // Sort by entry date ascending, then by line order
    transactions.sort((a, b) => {
      const dateCmp = (a.entry_date || "").localeCompare(b.entry_date || "");
      if (dateCmp !== 0) return dateCmp;
      return a.id.localeCompare(b.id);
    });

    // Compute running balance
    // For asset/expense accounts: balance starts at 0, debits increase, credits decrease
    // For liability/equity/revenue accounts: credits increase, debits decrease
    const isNormalDebit = ["asset", "expense"].includes((account as any).type || "");
    let running = 0;

    for (const t of transactions) {
      if (isNormalDebit) {
        running += t.debit_amount - t.credit_amount;
      } else {
        running += t.credit_amount - t.debit_amount;
      }
      t.running_balance = running;
    }

    res.json({
      account: {
        id: accountId,
        code: (account as any).code,
        name: (account as any).name,
        type: (account as any).type,
      },
      transactions,
      total_debits: transactions.reduce((s, t) => s + t.debit_amount, 0),
      total_credits: transactions.reduce((s, t) => s + t.credit_amount, 0),
      net_balance: running,
    });
  } catch (err) {
    console.error("Account transactions error:", err);
    res.status(500).json({ error: "Failed to fetch account transactions" });
  }
});

export default router;
