import { db } from "@funtush/database";
import type { AccountType } from "@funtush/database";

// ─────────────────────────────────────────────────────────────────────────────
// Financial statements service (Day 4 — P&L, Balance Sheet, Cash Flow, Tax)
//
// Nothing here stores anything. Every number is COMPUTED from the journal
// lines written on Days 2 and 3. That is the whole point of double-entry
// bookkeeping: the journal is the single source of truth, and every statement
// is just a different way of adding the same rows up.
//
//   Profit & Loss  → revenue and expense lines, for a period of time
//   Balance Sheet  → asset, liability and equity lines, up to a point in time
//   Cash Flow      → only the lines that touched a cash/bank account
//   Tax Summary    → revenue lines grouped by account, for VAT filing
//
// Every query is scoped by agencyId (Backend Guide §4/§18).
// ─────────────────────────────────────────────────────────────────────────────

// Nepal's standard VAT rate. Overridable per request because the rate changes
// by law and by product category — never hardcode a tax rate into a report.
const DEFAULT_VAT_RATE = 13;

// Root of the cash section of the chart of accounts. The cash-flow statement
// uses this account AND all of its children, so an agency that adds
// "1030 Mobile Wallet" under it is included automatically.
const CASH_ROOT_ACCOUNT_CODE = "1000"; // Cash & Bank

// Money is stored as DECIMAL(12,2). Summing many of those and converting to a
// JS number can produce 1234.5600000000002, so every figure we hand out goes
// through here.
const round2 = (value: number): number => Math.round(value * 100) / 100;

// ── period parsing ───────────────────────────────────────────────────────────

export interface DateRange {
    from: Date;
    to: Date;
    label: string;
}

// Accepts "2026-07" (one month) or "2026" (one year). Defaults to the current
// month. Everything is built in UTC because `entry_date` is a DATE column:
// using local time in Kathmandu (UTC+5:45) would shift entries into the
// neighbouring month.
export const parsePeriod = (period?: string): DateRange => {
    const now = new Date();

    const value = period?.trim() || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    if (/^\d{4}$/.test(value)) {
        const year = Number(value);

        return {
            from: new Date(Date.UTC(year, 0, 1)),
            // Month 11, day 31 = 31 December of that year.
            to: new Date(Date.UTC(year, 11, 31)),
            label: value,
        };
    }

    if (/^\d{4}-\d{2}$/.test(value)) {
        const [yearPart, monthPart] = value.split("-");
        const year = Number(yearPart);
        const month = Number(monthPart);

        if (month < 1 || month > 12) {
            throw new Error("Invalid period. Month must be between 01 and 12.");
        }

        return {
            from: new Date(Date.UTC(year, month - 1, 1)),
            // Day 0 of the NEXT month is the last day of this one — this is how
            // you get "31" for July and "28 or 29" for February without a
            // leap-year table.
            to: new Date(Date.UTC(year, month, 0)),
            label: value,
        };
    }

    throw new Error("Invalid period. Use YYYY-MM (month) or YYYY (year).");
};

// Point-in-time date for the balance sheet. Defaults to today.
export const parseAsOfDate = (date?: string): Date => {
    if (!date?.trim()) {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }

    const parsed = new Date(date.trim());

    if (isNaN(parsed.getTime())) {
        throw new Error("Invalid date. Use YYYY-MM-DD.");
    }

    return new Date(
        Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
    );
};

// ── the one query every statement is built on ────────────────────────────────

export interface AccountBalance {
    accountId: string;
    code: string;
    name: string;
    type: AccountType;
    debit: number;
    credit: number;
    // Signed to the account's NORMAL side — see below.
    balance: number;
}

// Which side of the ledger each account type "grows" on. Assets and expenses
// grow with debits; liabilities, equity and revenue grow with credits. Getting
// this backwards is the single most common beginner mistake in accounting
// code, so it lives in one place and every statement reads it from here.
const NORMAL_SIDE: Record<AccountType, "DEBIT" | "CREDIT"> = {
    ASSET: "DEBIT",
    EXPENSE: "DEBIT",
    LIABILITY: "CREDIT",
    EQUITY: "CREDIT",
    REVENUE: "CREDIT",
};

// Totals every journal line per account within a date window, then expresses
// each account's balance on its normal side so the numbers read as positive.
const getAccountBalances = async (
    agencyId: string,
    entryDate: { gte?: Date; lte?: Date }
): Promise<AccountBalance[]> => {
    const [accounts, grouped] = await Promise.all([
        db.account.findMany({
            where: { agencyId },
            select: { id: true, code: true, name: true, type: true },
            orderBy: { code: "asc" },
        }),
        // GROUP BY account_id, SUM(debit), SUM(credit) — done by Postgres, not
        // by pulling every line into Node.
        db.journalLine.groupBy({
            by: ["accountId"],
            where: {
                journalEntry: {
                    agencyId,
                    ...(entryDate.gte || entryDate.lte ? { entryDate } : {}),
                },
            },
            _sum: { debit: true, credit: true },
        }),
    ]);

    const totalsByAccountId = new Map(
        grouped.map((row) => [
            row.accountId,
            {
                debit: Number(row._sum.debit ?? 0),
                credit: Number(row._sum.credit ?? 0),
            },
        ])
    );

    return accounts.map((account) => {
        const totals = totalsByAccountId.get(account.id) ?? { debit: 0, credit: 0 };
        const normal = NORMAL_SIDE[account.type];

        return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
            debit: round2(totals.debit),
            credit: round2(totals.credit),
            balance: round2(
                normal === "DEBIT"
                    ? totals.debit - totals.credit
                    : totals.credit - totals.debit
            ),
        };
    });
};

// Strip the accountId (internal) and drop accounts with no movement, so a
// statement shows the lines that matter instead of all 25 seeded accounts.
const toStatementLines = (balances: AccountBalance[]) =>
    balances
        .filter((account) => account.balance !== 0)
        .map(({ code, name, balance }) => ({ code, name, amount: balance }));

const sumBalances = (balances: AccountBalance[]) =>
    round2(balances.reduce((total, account) => total + account.balance, 0));

// ── GET /agencies/me/finance/pnl?period= ─────────────────────────────────────

// Profit & Loss (income statement): what the agency earned and spent over a
// period, and what was left. Only REVENUE and EXPENSE accounts appear — assets
// and liabilities are not income, they are what you own and owe.
export const getProfitAndLossService = async (agencyId: string, period?: string) => {
    const range = parsePeriod(period);

    const balances = await getAccountBalances(agencyId, { gte: range.from, lte: range.to });

    const revenueAccounts = balances.filter((a) => a.type === "REVENUE");
    const expenseAccounts = balances.filter((a) => a.type === "EXPENSE");

    const totalRevenue = sumBalances(revenueAccounts);
    const totalExpenses = sumBalances(expenseAccounts);
    const netProfit = round2(totalRevenue - totalExpenses);

    return {
        period: range.label,
        from: range.from,
        to: range.to,
        revenue: {
            lines: toStatementLines(revenueAccounts),
            total: totalRevenue,
        },
        expenses: {
            lines: toStatementLines(expenseAccounts),
            total: totalExpenses,
        },
        netProfit,
        // Profit as a percentage of revenue. Guarded against divide-by-zero
        // for a period with no sales.
        netProfitMargin: totalRevenue === 0 ? 0 : round2((netProfit / totalRevenue) * 100),
    };
};

// ── GET /agencies/me/finance/balance-sheet?date= ─────────────────────────────

// Balance Sheet: a photograph of the agency on one day. Unlike the P&L it is
// cumulative — every entry from the beginning of time up to `date`.
//
// The accounting equation must hold:  Assets = Liabilities + Equity
//
// One subtlety: we never post year-end "closing entries" that sweep profit
// into Retained Earnings. So the profit earned so far is not yet sitting in an
// equity account. If we ignored it the sheet would be out of balance by
// exactly the profit — so we compute it and show it as its own equity line.
export const getBalanceSheetService = async (agencyId: string, date?: string) => {
    const asOf = parseAsOfDate(date);

    const balances = await getAccountBalances(agencyId, { lte: asOf });

    const assetAccounts = balances.filter((a) => a.type === "ASSET");
    const liabilityAccounts = balances.filter((a) => a.type === "LIABILITY");
    const equityAccounts = balances.filter((a) => a.type === "EQUITY");
    const revenueAccounts = balances.filter((a) => a.type === "REVENUE");
    const expenseAccounts = balances.filter((a) => a.type === "EXPENSE");

    const totalAssets = sumBalances(assetAccounts);
    const totalLiabilities = sumBalances(liabilityAccounts);
    const bookedEquity = sumBalances(equityAccounts);

    // Lifetime profit that has not been closed into an equity account yet.
    const currentEarnings = round2(sumBalances(revenueAccounts) - sumBalances(expenseAccounts));
    const totalEquity = round2(bookedEquity + currentEarnings);

    return {
        asOf,
        assets: {
            lines: toStatementLines(assetAccounts),
            total: totalAssets,
        },
        liabilities: {
            lines: toStatementLines(liabilityAccounts),
            total: totalLiabilities,
        },
        equity: {
            lines: [
                ...toStatementLines(equityAccounts),
                // Only shown when there is something to show.
                ...(currentEarnings !== 0
                    ? [
                          {
                              code: "—",
                              name: "Current Period Earnings (not yet closed)",
                              amount: currentEarnings,
                          },
                      ]
                    : []),
            ],
            total: totalEquity,
        },
        // Self-check exposed in the response. If the ledger is healthy this is
        // always true; if it ever turns false, something bypassed the
        // double-entry rules and the report says so loudly.
        totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity),
        balanced: round2(totalAssets - (totalLiabilities + totalEquity)) === 0,
    };
};

// ── GET /agencies/me/finance/cash-flow?period= ───────────────────────────────

// Cash Flow: money actually in and out of the cash/bank accounts. Different
// from profit — an agency can be profitable and still run out of cash (an
// unpaid invoice is revenue but not cash).
export const getCashFlowService = async (agencyId: string, period?: string) => {
    const range = parsePeriod(period);

    // Find the cash root account and everything filed under it.
    const cashRoot = await db.account.findFirst({
        where: { agencyId, code: CASH_ROOT_ACCOUNT_CODE },
        select: { id: true },
    });

    if (!cashRoot) {
        throw new Error(
            `Account ${CASH_ROOT_ACCOUNT_CODE} (Cash & Bank) not found for this agency. Seed the chart of accounts first (pnpm db:seed:accounting).`
        );
    }

    const cashAccounts = await db.account.findMany({
        where: {
            agencyId,
            OR: [{ id: cashRoot.id }, { parentId: cashRoot.id }],
        },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
    });

    const cashAccountIds = cashAccounts.map((a) => a.id);

    const cashLineFilter = (entryDate: { gte?: Date; lt?: Date; lte?: Date }) => ({
        accountId: { in: cashAccountIds },
        journalEntry: { agencyId, entryDate },
    });

    const [openingTotals, periodByAccount, cashEntries] = await Promise.all([
        // Everything before the period started = the opening balance.
        db.journalLine.aggregate({
            where: cashLineFilter({ lt: range.from }),
            _sum: { debit: true, credit: true },
        }),
        // Movement during the period, split per cash account.
        db.journalLine.groupBy({
            by: ["accountId"],
            where: cashLineFilter({ gte: range.from, lte: range.to }),
            _sum: { debit: true, credit: true },
        }),
        // Which journal entries touched cash — needed to work out WHY.
        db.journalLine.findMany({
            where: cashLineFilter({ gte: range.from, lte: range.to }),
            select: { journalEntryId: true },
            distinct: ["journalEntryId"],
        }),
    ]);

    const openingBalance = round2(
        Number(openingTotals._sum.debit ?? 0) - Number(openingTotals._sum.credit ?? 0)
    );

    const totalsByAccountId = new Map(
        periodByAccount.map((row) => [
            row.accountId,
            { debit: Number(row._sum.debit ?? 0), credit: Number(row._sum.credit ?? 0) },
        ])
    );

    const accountBreakdown = cashAccounts.map((account) => {
        const totals = totalsByAccountId.get(account.id) ?? { debit: 0, credit: 0 };

        return {
            code: account.code,
            name: account.name,
            // Debit on an asset = money came IN. Credit = money went OUT.
            inflows: round2(totals.debit),
            outflows: round2(totals.credit),
            net: round2(totals.debit - totals.credit),
        };
    });

    const totalInflows = round2(accountBreakdown.reduce((s, a) => s + a.inflows, 0));
    const totalOutflows = round2(accountBreakdown.reduce((s, a) => s + a.outflows, 0));

    // Every entry has exactly two sides. For an entry that touched cash, the
    // OTHER side says what the cash was for: credited counterpart = where the
    // money came from, debited counterpart = what the money was spent on.
    const counterparts = await db.journalLine.groupBy({
        by: ["accountId"],
        where: {
            journalEntryId: { in: cashEntries.map((line) => line.journalEntryId) },
            accountId: { notIn: cashAccountIds },
        },
        _sum: { debit: true, credit: true },
    });

    const counterpartAccounts = await db.account.findMany({
        where: { agencyId, id: { in: counterparts.map((row) => row.accountId) } },
        select: { id: true, code: true, name: true },
    });

    const accountMetaById = new Map(counterpartAccounts.map((a) => [a.id, a]));

    const inflowsByCategory = counterparts
        .filter((row) => Number(row._sum.credit ?? 0) > 0)
        .map((row) => ({
            code: accountMetaById.get(row.accountId)?.code ?? "—",
            name: accountMetaById.get(row.accountId)?.name ?? "Unknown",
            amount: round2(Number(row._sum.credit ?? 0)),
        }))
        .sort((a, b) => b.amount - a.amount);

    const outflowsByCategory = counterparts
        .filter((row) => Number(row._sum.debit ?? 0) > 0)
        .map((row) => ({
            code: accountMetaById.get(row.accountId)?.code ?? "—",
            name: accountMetaById.get(row.accountId)?.name ?? "Unknown",
            amount: round2(Number(row._sum.debit ?? 0)),
        }))
        .sort((a, b) => b.amount - a.amount);

    return {
        period: range.label,
        from: range.from,
        to: range.to,
        openingBalance,
        inflows: { total: totalInflows, byCategory: inflowsByCategory },
        outflows: { total: totalOutflows, byCategory: outflowsByCategory },
        netCashFlow: round2(totalInflows - totalOutflows),
        closingBalance: round2(openingBalance + totalInflows - totalOutflows),
        accounts: accountBreakdown,
    };
};

// ── GET /agencies/me/finance/tax-summary?period= ─────────────────────────────

// Tax summary: revenue broken down by category so an accountant can fill in a
// VAT return. Funtush does not file taxes for the agency — this produces the
// numbers, the agency's accountant signs them off.
export const getTaxSummaryService = async (
    agencyId: string,
    period?: string,
    vatRate?: number
) => {
    const range = parsePeriod(period);

    const rate = vatRate === undefined ? DEFAULT_VAT_RATE : Number(vatRate);

    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new Error("vatRate must be a number between 0 and 100.");
    }

    const balances = await getAccountBalances(agencyId, { gte: range.from, lte: range.to });

    const revenueAccounts = balances.filter((a) => a.type === "REVENUE");
    const expenseAccounts = balances.filter((a) => a.type === "EXPENSE");

    const totalRevenue = sumBalances(revenueAccounts);
    const totalExpenses = sumBalances(expenseAccounts);

    // Assumption, stated in the response so nobody has to guess: amounts are
    // recorded VAT-exclusive, so output VAT is charged ON TOP of revenue.
    const outputVat = round2((totalRevenue * rate) / 100);
    const inputVat = round2((totalExpenses * rate) / 100);

    // Liability balance carried on the books for tax (2200 Taxes Payable),
    // cumulative up to the end of the period.
    const cumulative = await getAccountBalances(agencyId, { lte: range.to });
    const taxesPayable = cumulative.find((a) => a.code === "2200");

    return {
        period: range.label,
        from: range.from,
        to: range.to,
        vatRate: rate,
        // Only categories that actually earned something — a filing does not
        // need a row of zeroes for every unused account in the chart.
        revenueByCategory: revenueAccounts
            .filter((account) => account.balance !== 0)
            .map(({ code, name, balance }) => ({
                code,
                name,
                netRevenue: balance,
                estimatedVat: round2((balance * rate) / 100),
            })),
        totals: {
            netRevenue: totalRevenue,
            outputVat,
            deductibleExpenses: totalExpenses,
            inputVat,
            // What would be remitted if every expense were VAT-deductible.
            netVatPayable: round2(outputVat - inputVat),
        },
        taxesPayableBalance: taxesPayable?.balance ?? 0,
        assumptions: [
            "Amounts are recorded VAT-exclusive; output VAT is calculated on top of net revenue.",
            "Input VAT assumes every recorded expense is VAT-deductible — the agency's accountant must exclude non-deductible items.",
            "This is a computed summary for filing support, not a filed return.",
        ],
    };
};
