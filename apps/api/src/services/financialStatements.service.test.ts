import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    parsePeriod,
    parseAsOfDate,
    getProfitAndLossService,
    getBalanceSheetService,
    getCashFlowService,
    getTaxSummaryService,
} from "./financialStatements.service";
import { db } from "@funtush/database";

vi.mock("@funtush/database", () => {
    const mockDb = {
        account: { findFirst: vi.fn(), findMany: vi.fn() },
        journalLine: { groupBy: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    };

    return { db: mockDb };
});

const AGENCY_ID = "agency_1";

// A miniature chart of accounts, enough to exercise all five account types.
const ACCOUNTS = [
    { id: "a_cash_root", code: "1000", name: "Cash & Bank", type: "ASSET", parentId: null },
    { id: "a_cash", code: "1010", name: "Cash on Hand", type: "ASSET", parentId: "a_cash_root" },
    { id: "a_bank", code: "1020", name: "Bank Account", type: "ASSET", parentId: "a_cash_root" },
    { id: "a_equip", code: "1500", name: "Trekking Equipment", type: "ASSET", parentId: null },
    { id: "l_payable", code: "2000", name: "Accounts Payable", type: "LIABILITY", parentId: null },
    { id: "l_tax", code: "2200", name: "Taxes Payable", type: "LIABILITY", parentId: null },
    { id: "e_owner", code: "3000", name: "Owner's Equity", type: "EQUITY", parentId: null },
    { id: "r_trek", code: "4000", name: "Trek Package Revenue", type: "REVENUE", parentId: null },
    { id: "r_addon", code: "4100", name: "Add-on Revenue", type: "REVENUE", parentId: null },
    { id: "x_guide", code: "5000", name: "Guide Payroll", type: "EXPENSE", parentId: null },
    { id: "x_permit", code: "5200", name: "Permit Fees", type: "EXPENSE", parentId: null },
];

// Feed the service a fixed set of per-account debit/credit totals.
const stubLedger = (totals: Record<string, { debit?: number; credit?: number }>) => {
    vi.mocked(db.account.findMany).mockResolvedValue(ACCOUNTS as never);
    vi.mocked(db.journalLine.groupBy).mockResolvedValue(
        Object.entries(totals).map(([accountId, t]) => ({
            accountId,
            _sum: { debit: t.debit ?? 0, credit: t.credit ?? 0 },
        })) as never
    );
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("parsePeriod", () => {
    it("expands YYYY-MM into the whole month, in UTC", () => {
        const range = parsePeriod("2026-07");

        expect(range.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
        expect(range.to.toISOString()).toBe("2026-07-31T00:00:00.000Z");
        expect(range.label).toBe("2026-07");
    });

    it("gets February right, including leap years", () => {
        expect(parsePeriod("2026-02").to.toISOString()).toBe("2026-02-28T00:00:00.000Z");
        expect(parsePeriod("2028-02").to.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    });

    it("expands YYYY into the whole year", () => {
        const range = parsePeriod("2026");

        expect(range.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(range.to.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    });

    it("defaults to the current month when omitted", () => {
        const now = new Date();
        const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

        expect(parsePeriod().label).toBe(expected);
    });

    it("rejects garbage and impossible months", () => {
        expect(() => parsePeriod("last-july")).toThrow("Invalid period.");
        expect(() => parsePeriod("2026-13")).toThrow("Month must be between 01 and 12.");
    });
});

describe("parseAsOfDate", () => {
    it("normalises a date to midnight UTC", () => {
        expect(parseAsOfDate("2026-07-15").toISOString()).toBe("2026-07-15T00:00:00.000Z");
    });

    it("rejects an invalid date", () => {
        expect(() => parseAsOfDate("not-a-date")).toThrow("Invalid date.");
    });
});

describe("getProfitAndLossService", () => {
    it("computes revenue, expenses and net profit from journal lines", async () => {
        stubLedger({
            a_cash: { debit: 200000, credit: 65000 },
            r_trek: { credit: 180000 },
            r_addon: { credit: 20000 },
            x_guide: { debit: 45000 },
            x_permit: { debit: 20000 },
        });

        const report = await getProfitAndLossService(AGENCY_ID, "2026-07");

        expect(report.revenue.total).toBe(200000);
        expect(report.expenses.total).toBe(65000);
        expect(report.netProfit).toBe(135000);
        expect(report.netProfitMargin).toBe(67.5);
    });

    it("shows only revenue and expense accounts — never assets", async () => {
        stubLedger({
            a_cash: { debit: 200000 },
            r_trek: { credit: 180000 },
            x_guide: { debit: 45000 },
        });

        const report = await getProfitAndLossService(AGENCY_ID, "2026-07");

        expect(report.revenue.lines.map((l) => l.code)).toEqual(["4000"]);
        expect(report.expenses.lines.map((l) => l.code)).toEqual(["5000"]);
    });

    it("nets a refund (debit on a revenue account) out of revenue", async () => {
        stubLedger({ r_trek: { credit: 180000, debit: 30000 } });

        const report = await getProfitAndLossService(AGENCY_ID, "2026-07");

        expect(report.revenue.total).toBe(150000);
    });

    it("scopes the query to the agency and the requested period", async () => {
        stubLedger({});

        await getProfitAndLossService(AGENCY_ID, "2026-07");

        const args = vi.mocked(db.journalLine.groupBy).mock.calls[0][0] as unknown as {
            where: { journalEntry: { agencyId: string; entryDate: { gte: Date; lte: Date } } };
        };

        expect(args.where.journalEntry.agencyId).toBe(AGENCY_ID);
        expect(args.where.journalEntry.entryDate).toEqual({
            gte: new Date("2026-07-01T00:00:00.000Z"),
            lte: new Date("2026-07-31T00:00:00.000Z"),
        });
    });

    it("returns zeroes, not NaN, for a period with no activity", async () => {
        stubLedger({});

        const report = await getProfitAndLossService(AGENCY_ID, "2026-07");

        expect(report.revenue.total).toBe(0);
        expect(report.expenses.total).toBe(0);
        expect(report.netProfit).toBe(0);
        expect(report.netProfitMargin).toBe(0);
    });
});

describe("getBalanceSheetService", () => {
    it("balances: Assets = Liabilities + Equity, with unclosed profit in equity", async () => {
        // Owner puts in 100,000 cash; agency sells a trek for 180,000 cash and
        // pays 45,000 of guide wages. Cash = 100,000 + 180,000 − 45,000.
        stubLedger({
            a_cash: { debit: 280000, credit: 45000 },
            e_owner: { credit: 100000 },
            r_trek: { credit: 180000 },
            x_guide: { debit: 45000 },
        });

        const sheet = await getBalanceSheetService(AGENCY_ID, "2026-07-31");

        expect(sheet.assets.total).toBe(235000);
        expect(sheet.liabilities.total).toBe(0);
        // 100,000 owner capital + 135,000 profit not yet closed.
        expect(sheet.equity.total).toBe(235000);
        expect(sheet.totalLiabilitiesAndEquity).toBe(235000);
        expect(sheet.balanced).toBe(true);
    });

    it("adds the unclosed profit as its own equity line", async () => {
        stubLedger({
            a_cash: { debit: 280000, credit: 45000 },
            e_owner: { credit: 100000 },
            r_trek: { credit: 180000 },
            x_guide: { debit: 45000 },
        });

        const sheet = await getBalanceSheetService(AGENCY_ID, "2026-07-31");

        expect(sheet.equity.lines).toEqual([
            { code: "3000", name: "Owner's Equity", amount: 100000 },
            { code: "—", name: "Current Period Earnings (not yet closed)", amount: 135000 },
        ]);
    });

    it("reports liabilities as positive numbers (their normal credit side)", async () => {
        stubLedger({
            a_cash: { debit: 50000 },
            l_payable: { credit: 50000 },
        });

        const sheet = await getBalanceSheetService(AGENCY_ID, "2026-07-31");

        expect(sheet.liabilities.lines).toEqual([
            { code: "2000", name: "Accounts Payable", amount: 50000 },
        ]);
        expect(sheet.balanced).toBe(true);
    });

    it("is cumulative — no start date, everything up to `date`", async () => {
        stubLedger({});

        await getBalanceSheetService(AGENCY_ID, "2026-07-31");

        const args = vi.mocked(db.journalLine.groupBy).mock.calls[0][0] as unknown as {
            where: { journalEntry: { entryDate: { gte?: Date; lte: Date } } };
        };

        expect(args.where.journalEntry.entryDate.gte).toBeUndefined();
        expect(args.where.journalEntry.entryDate.lte).toEqual(
            new Date("2026-07-31T00:00:00.000Z")
        );
    });
});

describe("getCashFlowService", () => {
    // Cash flow reads the account table twice (root lookup, then the cash
    // family) and the counterpart account names, so its mocks are staged.
    const stubCashFlow = (options: {
        opening?: { debit: number; credit: number };
        period?: { accountId: string; debit: number; credit: number }[];
        counterparts?: { accountId: string; debit: number; credit: number }[];
    }) => {
        vi.mocked(db.account.findFirst).mockResolvedValue({ id: "a_cash_root" } as never);
        vi.mocked(db.account.findMany).mockImplementation((async (args: {
            where: { id?: { in: string[] } };
        }) => {
            // Second call resolves counterpart account names by id.
            if (args.where.id && "in" in args.where.id) {
                return ACCOUNTS.filter((a) => args.where.id!.in.includes(a.id));
            }
            // First call: the cash family.
            return ACCOUNTS.filter((a) => ["1000", "1010", "1020"].includes(a.code));
        }) as never);

        vi.mocked(db.journalLine.aggregate).mockResolvedValue({
            _sum: options.opening ?? { debit: 0, credit: 0 },
        } as never);

        vi.mocked(db.journalLine.groupBy)
            .mockResolvedValueOnce(
                (options.period ?? []).map((r) => ({
                    accountId: r.accountId,
                    _sum: { debit: r.debit, credit: r.credit },
                })) as never
            )
            .mockResolvedValueOnce(
                (options.counterparts ?? []).map((r) => ({
                    accountId: r.accountId,
                    _sum: { debit: r.debit, credit: r.credit },
                })) as never
            );

        vi.mocked(db.journalLine.findMany).mockResolvedValue([
            { journalEntryId: "entry_1" },
            { journalEntryId: "entry_2" },
        ] as never);
    };

    it("computes opening, inflows, outflows and closing balance", async () => {
        stubCashFlow({
            opening: { debit: 120000, credit: 20000 },
            period: [{ accountId: "a_cash", debit: 180000, credit: 45000 }],
        });

        const report = await getCashFlowService(AGENCY_ID, "2026-07");

        expect(report.openingBalance).toBe(100000);
        expect(report.inflows.total).toBe(180000);
        expect(report.outflows.total).toBe(45000);
        expect(report.netCashFlow).toBe(135000);
        // closing = opening + in − out
        expect(report.closingBalance).toBe(235000);
    });

    it("explains inflows and outflows by the other side of each entry", async () => {
        stubCashFlow({
            period: [{ accountId: "a_cash", debit: 180000, credit: 45000 }],
            counterparts: [
                // Credited counterpart = where the cash came from.
                { accountId: "r_trek", debit: 0, credit: 180000 },
                // Debited counterpart = what the cash was spent on.
                { accountId: "x_guide", debit: 45000, credit: 0 },
            ],
        });

        const report = await getCashFlowService(AGENCY_ID, "2026-07");

        expect(report.inflows.byCategory).toEqual([
            { code: "4000", name: "Trek Package Revenue", amount: 180000 },
        ]);
        expect(report.outflows.byCategory).toEqual([
            { code: "5000", name: "Guide Payroll", amount: 45000 },
        ]);
    });

    it("breaks the movement down per cash account", async () => {
        stubCashFlow({
            period: [
                { accountId: "a_cash", debit: 50000, credit: 10000 },
                { accountId: "a_bank", debit: 130000, credit: 35000 },
            ],
        });

        const report = await getCashFlowService(AGENCY_ID, "2026-07");

        expect(report.accounts).toEqual([
            { code: "1000", name: "Cash & Bank", inflows: 0, outflows: 0, net: 0 },
            { code: "1010", name: "Cash on Hand", inflows: 50000, outflows: 10000, net: 40000 },
            { code: "1020", name: "Bank Account", inflows: 130000, outflows: 35000, net: 95000 },
        ]);
    });

    it("tells the user to seed the chart of accounts when 1000 is missing", async () => {
        vi.mocked(db.account.findFirst).mockResolvedValue(null as never);

        await expect(getCashFlowService(AGENCY_ID, "2026-07")).rejects.toThrow(
            "Account 1000 (Cash & Bank) not found for this agency."
        );
    });
});

describe("getTaxSummaryService", () => {
    it("breaks revenue down by category with VAT at the default 13%", async () => {
        stubLedger({
            r_trek: { credit: 180000 },
            r_addon: { credit: 20000 },
            x_permit: { debit: 20000 },
        });

        const report = await getTaxSummaryService(AGENCY_ID, "2026-07");

        expect(report.vatRate).toBe(13);
        // Revenue accounts with no activity are left out entirely.
        expect(report.revenueByCategory).toEqual([
            { code: "4000", name: "Trek Package Revenue", netRevenue: 180000, estimatedVat: 23400 },
            { code: "4100", name: "Add-on Revenue", netRevenue: 20000, estimatedVat: 2600 },
        ]);
        expect(report.totals.netRevenue).toBe(200000);
        expect(report.totals.outputVat).toBe(26000);
        expect(report.totals.inputVat).toBe(2600);
        expect(report.totals.netVatPayable).toBe(23400);
    });

    it("accepts an explicit VAT rate", async () => {
        stubLedger({ r_trek: { credit: 100000 } });

        const report = await getTaxSummaryService(AGENCY_ID, "2026-07", 0);

        expect(report.vatRate).toBe(0);
        expect(report.totals.outputVat).toBe(0);
    });

    it("rejects an impossible VAT rate", async () => {
        stubLedger({});

        await expect(getTaxSummaryService(AGENCY_ID, "2026-07", 150)).rejects.toThrow(
            "vatRate must be a number between 0 and 100."
        );
    });

    it("reports the cumulative Taxes Payable balance", async () => {
        stubLedger({ r_trek: { credit: 100000 }, l_tax: { credit: 13000 } });

        const report = await getTaxSummaryService(AGENCY_ID, "2026-07");

        expect(report.taxesPayableBalance).toBe(13000);
    });

    it("states its assumptions in the response", async () => {
        stubLedger({});

        const report = await getTaxSummaryService(AGENCY_ID, "2026-07");

        expect(report.assumptions.length).toBeGreaterThan(0);
    });
});
