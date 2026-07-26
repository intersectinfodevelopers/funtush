// ─────────────────────────────────────────────────────────────────────────────
// Accounting engine — Day 5 integration tests
//
// The unit tests next door (finance/payroll/financialStatements .service.test.ts)
// MOCK the database, so they prove the *service logic* but never touch Postgres.
// That leaves one thing untested: the Day 1 database trigger that rejects an
// unbalanced journal entry. A mock can't reject anything — only a real database
// can. So this file talks to a REAL Postgres and exercises the whole stack:
//
//     service  →  Prisma  →  Postgres  →  double-entry trigger
//
// It maps 1:1 to the four Day 5 bullets:
//   1. unbalanced journal entry is rejected by the DB constraint
//   2. P&L matches hand-calculated totals from seeded transactions
//   3. balance sheet balances (Assets = Liabilities + Equity)
//   4. payroll mark-paid generates the correct journal entry
//
// It is SAFE to run anywhere: if no database is reachable (e.g. CI has none),
// every test is skipped instead of failing. Each `describe` also creates and
// deletes its OWN throwaway agency, so tests never see each other's data and
// never touch real tenant data.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── connect to the real database (or decide to skip) ─────────────────────────
//
// The Prisma client reads DATABASE_URL from the environment at construction
// time, and the app's test process does not auto-load .env — so we load it
// HERE, with top-level await, BEFORE importing @funtush/database. If anything
// below fails (no env, DB down, no seed tier) we flip DB_AVAILABLE to false and
// every test skips.

let DB_AVAILABLE = false;
let skipReason = "";

// Typed handles filled in once the modules are dynamically imported.
type Database = typeof import("@funtush/database");
type FinanceService = typeof import("./finance.service");
type PayrollService = typeof import("./payroll.service");
type StatementsService = typeof import("./financialStatements.service");

let db: Database["db"];
let recordIncomeService: FinanceService["recordIncomeService"];
let recordExpenseService: FinanceService["recordExpenseService"];
let createPayrollService: PayrollService["createPayrollService"];
let markPayrollPaidService: PayrollService["markPayrollPaidService"];
let getProfitAndLossService: StatementsService["getProfitAndLossService"];
let getBalanceSheetService: StatementsService["getBalanceSheetService"];

// A seed tier is required to create an agency (agencies.tier_id is NOT NULL).
let tierId = "";

try {
    // dotenv.config() does not override variables already in the environment,
    // and defaults to `.env` in the current working directory — which, under
    // `pnpm --filter @funtush/api` and turbo, is apps/api. That file holds the
    // working DATABASE_URL.
    const dotenv = await import("dotenv");
    dotenv.config();

    const database = await import("@funtush/database");
    db = database.db;

    // A one-line ping. Throws if the database is unreachable → we skip.
    await db.$queryRaw`SELECT 1`;

    const tier = await db.subscriptionTier.findFirst({ select: { id: true } });
    if (!tier) {
        throw new Error("no SubscriptionTier seeded — run the base seed first");
    }
    tierId = tier.id;

    const finance = await import("./finance.service");
    recordIncomeService = finance.recordIncomeService;
    recordExpenseService = finance.recordExpenseService;

    const payroll = await import("./payroll.service");
    createPayrollService = payroll.createPayrollService;
    markPayrollPaidService = payroll.markPayrollPaidService;

    const statements = await import("./financialStatements.service");
    getProfitAndLossService = statements.getProfitAndLossService;
    getBalanceSheetService = statements.getBalanceSheetService;

    DB_AVAILABLE = true;
} catch (error) {
    skipReason = error instanceof Error ? error.message : String(error);
    console.warn(
        `[accounting.integration] database unavailable — skipping integration tests (${skipReason})`
    );
}

// ── shared fixtures ──────────────────────────────────────────────────────────

// A compact chart of accounts — one account per type the tests touch. The
// hierarchy (1010/1020 filed under 1000) matches the real seed so the balance
// sheet groups them the same way.
const TEST_CHART: { code: string; name: string; type: string; parentCode?: string }[] = [
    { code: "1000", name: "Cash & Bank", type: "ASSET" },
    { code: "1010", name: "Cash on Hand", type: "ASSET", parentCode: "1000" },
    { code: "1020", name: "Bank Account", type: "ASSET", parentCode: "1000" },
    { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
    { code: "3000", name: "Owner's Equity", type: "EQUITY" },
    { code: "4000", name: "Trek Package Revenue", type: "REVENUE" },
    { code: "4100", name: "Add-on Revenue", type: "REVENUE" },
    { code: "5000", name: "Guide Payroll", type: "EXPENSE" },
    { code: "5200", name: "Permit Fees", type: "EXPENSE" },
    { code: "5500", name: "Transportation", type: "EXPENSE" },
];

interface TestAgency {
    agencyId: string;
    // account code → account id, so tests can post directly by code.
    accounts: Map<string, string>;
}

let agencyCounter = 0;

// Creates an isolated throwaway agency and seeds its chart of accounts. The
// unique suffix keeps parallel runs from colliding on the unique email/slug.
const createTestAgency = async (): Promise<TestAgency> => {
    const suffix = `${Date.now()}-${agencyCounter++}`;
    const agency = await db.agency.create({
        data: {
            name: `Acct Test Agency ${suffix}`,
            email: `accttest-${suffix}@example.com`,
            slug: `accttest-${suffix}`,
            tierId,
        },
    });

    const accounts = new Map<string, string>();
    for (const acc of TEST_CHART) {
        const parentId = acc.parentCode ? accounts.get(acc.parentCode) : undefined;
        const created = await db.account.create({
            data: {
                agencyId: agency.id,
                code: acc.code,
                name: acc.name,
                // The Prisma enum is a plain string union at runtime.
                type: acc.type as never,
                parentId: parentId ?? null,
            },
        });
        accounts.set(acc.code, created.id);
    }

    return { agencyId: agency.id, accounts };
};

// Tear down in dependency order:
//   1. payroll — a PAID row has a CHECK requiring its journal_entry_id, so it
//      must go before the entry it points at (which would null that column).
//   2. journal entries — cascades their journal_lines, releasing the
//      ON DELETE RESTRICT that journal_lines holds on accounts.
//   3. the agency — now safely cascades to its accounts.
const deleteTestAgency = async (agencyId: string) => {
    await db.payroll.deleteMany({ where: { agencyId } });
    await db.journalEntry.deleteMany({ where: { agencyId } });
    await db.agency.delete({ where: { id: agencyId } });
};

// ── 1. Double-entry constraint: unbalanced journal entry rejected ────────────

describe.skipIf(!DB_AVAILABLE)("double-entry constraint (Postgres trigger)", () => {
    let agency: TestAgency;

    beforeAll(async () => {
        agency = await createTestAgency();
    });

    afterAll(async () => {
        await deleteTestAgency(agency.agencyId);
    });

    it("rejects an entry whose debits do not equal its credits", async () => {
        const cashId = agency.accounts.get("1010")!;
        const revenueId = agency.accounts.get("4000")!;

        // Each line is individually valid (one-sided, non-negative), but the
        // entry as a whole is off by 10 — only the deferred balance trigger,
        // which runs at COMMIT after both lines exist, can catch this.
        await expect(
            db.journalEntry.create({
                data: {
                    agencyId: agency.agencyId,
                    entryDate: new Date(),
                    description: "deliberately unbalanced — must be rejected",
                    lines: {
                        create: [
                            { accountId: cashId, debit: 100, credit: 0 },
                            { accountId: revenueId, debit: 0, credit: 90 },
                        ],
                    },
                },
            })
        ).rejects.toThrow(/balanced/i);
    });

    it("rejects a line that is both a debit and a credit at once", async () => {
        const cashId = agency.accounts.get("1010")!;

        // Violates the per-line CHECK constraint (exactly one side must be > 0).
        await expect(
            db.journalEntry.create({
                data: {
                    agencyId: agency.agencyId,
                    entryDate: new Date(),
                    description: "two-sided line — must be rejected",
                    lines: { create: [{ accountId: cashId, debit: 50, credit: 50 }] },
                },
            })
        ).rejects.toThrow();
    });

    it("accepts a correctly balanced entry (debits === credits)", async () => {
        const cashId = agency.accounts.get("1010")!;
        const revenueId = agency.accounts.get("4000")!;

        const entry = await db.journalEntry.create({
            data: {
                agencyId: agency.agencyId,
                entryDate: new Date(),
                description: "balanced entry — must be accepted",
                lines: {
                    create: [
                        { accountId: cashId, debit: 100, credit: 0 },
                        { accountId: revenueId, debit: 0, credit: 100 },
                    ],
                },
            },
            include: { lines: true },
        });

        expect(entry.id).toBeTruthy();
        expect(entry.lines).toHaveLength(2);

        const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
        const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
        expect(totalDebit).toBe(totalCredit);
    });
});

// ── 2 & 3. P&L and balance sheet from real seeded transactions ───────────────
//
// Both statements are read from the SAME seeded ledger, so they are grouped
// together and the transactions are posted once in beforeAll.

describe.skipIf(!DB_AVAILABLE)("financial statements from seeded transactions", () => {
    let agency: TestAgency;

    // Every transaction is dated inside July 2026 so the period filter is
    // deterministic regardless of when the test actually runs.
    const PERIOD = "2026-07";
    const ENTRY_DATE = "2026-07-15";

    beforeAll(async () => {
        agency = await createTestAgency();
        const { agencyId } = agency;

        // Seeded transactions (all amounts in NPR):
        //   + 200,000  trek package sale  → Cash / Trek Revenue
        //   +  20,000  add-on sale        → Cash / Add-on Revenue
        //   -  20,000  permit fee         → Permit Expense / Cash
        //   -   5,000  transport          → Transport Expense / Cash
        await recordIncomeService(agencyId, undefined, {
            amount: 200000,
            entryDate: ENTRY_DATE,
        });
        await recordIncomeService(agencyId, undefined, {
            amount: 20000,
            entryDate: ENTRY_DATE,
            revenueAccountCode: "4100",
        });
        await recordExpenseService(agencyId, undefined, {
            amount: 20000,
            category: "permits",
            entryDate: ENTRY_DATE,
        });
        await recordExpenseService(agencyId, undefined, {
            amount: 5000,
            category: "transport",
            entryDate: ENTRY_DATE,
        });
    });

    afterAll(async () => {
        await deleteTestAgency(agency.agencyId);
    });

    it("P&L matches the manually calculated totals", async () => {
        const report = await getProfitAndLossService(agency.agencyId, PERIOD);

        // Hand calculation:
        //   revenue  = 200,000 + 20,000 = 220,000
        //   expenses =  20,000 +  5,000 =  25,000
        //   profit   = 220,000 - 25,000 = 195,000
        //   margin   = 195,000 / 220,000 * 100 = 88.64 (2 dp)
        expect(report.revenue.total).toBe(220000);
        expect(report.expenses.total).toBe(25000);
        expect(report.netProfit).toBe(195000);
        expect(report.netProfitMargin).toBe(88.64);

        // The revenue split should show both revenue accounts, nothing else.
        expect(report.revenue.lines).toEqual(
            expect.arrayContaining([
                { code: "4000", name: "Trek Package Revenue", amount: 200000 },
                { code: "4100", name: "Add-on Revenue", amount: 20000 },
            ])
        );
    });

    it("balance sheet balances: Assets = Liabilities + Equity", async () => {
        const sheet = await getBalanceSheetService(agency.agencyId, "2026-07-31");

        // Cash left in the till = 200,000 + 20,000 − 20,000 − 5,000 = 195,000.
        expect(sheet.assets.total).toBe(195000);
        expect(sheet.liabilities.total).toBe(0);

        // No closing entries were posted, so the whole 195,000 profit sits in
        // equity as "current period earnings". Equity therefore = 195,000.
        expect(sheet.equity.total).toBe(195000);

        // The accounting identity, checked by the service itself.
        expect(sheet.totalLiabilitiesAndEquity).toBe(195000);
        expect(sheet.balanced).toBe(true);
        expect(sheet.assets.total).toBe(sheet.liabilities.total + sheet.equity.total);
    });
});

// ── 4. Payroll mark-paid generates the correct journal entry ─────────────────

describe.skipIf(!DB_AVAILABLE)("payroll mark-paid → journal entry", () => {
    let agency: TestAgency;

    beforeAll(async () => {
        agency = await createTestAgency();
    });

    afterAll(async () => {
        await deleteTestAgency(agency.agencyId);
    });

    it("creates a DRAFT payroll with no ledger effect, then posts on mark-paid", async () => {
        const { agencyId } = agency;

        // Step 1 — record what we owe a guide. DRAFT = a promise to pay; no
        // money has moved, so the ledger must still be empty.
        const draft = await createPayrollService(agencyId, undefined, {
            guideId: "guide_test_1",
            periodStart: "2026-07-01",
            periodEnd: "2026-07-31",
            amount: 45000,
        });

        expect(draft.status).toBe("DRAFT");
        expect(draft.journalEntryId).toBeNull();
        expect(await db.journalEntry.count({ where: { agencyId } })).toBe(0);

        // Step 2 — pay it. THIS is when the double entry is written.
        const { payroll, journalEntry } = await markPayrollPaidService(
            agencyId,
            undefined,
            draft.id
        );

        // The generated entry must be: Debit Guide Payroll / Credit Cash.
        const guidePayrollId = agency.accounts.get("5000")!;
        const cashId = agency.accounts.get("1010")!;

        expect(journalEntry.lines).toEqual([
            expect.objectContaining({ accountId: guidePayrollId, debit: expect.anything(), credit: expect.anything() }),
            expect.objectContaining({ accountId: cashId }),
        ]);

        const debitLine = journalEntry.lines.find((l) => l.accountId === guidePayrollId)!;
        const creditLine = journalEntry.lines.find((l) => l.accountId === cashId)!;
        expect(Number(debitLine.debit)).toBe(45000);
        expect(Number(debitLine.credit)).toBe(0);
        expect(Number(creditLine.credit)).toBe(45000);
        expect(Number(creditLine.debit)).toBe(0);

        // The payroll row is now PAID and linked to the entry it generated.
        expect(payroll?.status).toBe("PAID");
        expect(payroll?.journalEntryId).toBe(journalEntry.id);

        // And exactly one journal entry now exists for the agency.
        expect(await db.journalEntry.count({ where: { agencyId } })).toBe(1);
    });

    it("refuses to pay the same payroll twice", async () => {
        const { agencyId } = agency;

        const draft = await createPayrollService(agencyId, undefined, {
            guideId: "guide_test_2",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
            amount: 30000,
        });

        await markPayrollPaidService(agencyId, undefined, draft.id);

        // Paying again must throw — never double-count the expense.
        await expect(
            markPayrollPaidService(agencyId, undefined, draft.id)
        ).rejects.toThrow(/already marked as paid/i);
    });
});
