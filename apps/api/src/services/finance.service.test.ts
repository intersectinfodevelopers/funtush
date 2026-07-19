import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    recordIncomeService,
    recordExpenseService,
    getTransactionsService,
    EXPENSE_CATEGORY_ACCOUNTS,
} from "./finance.service";
import { db } from "@funtush/database";

// Mock the database layer — these tests verify the double-entry LOGIC (which
// lines get generated, with which amounts, on which accounts), not Postgres.
vi.mock("@funtush/database", () => {
    const mockDb = {
        account: {
            findFirst: vi.fn(),
        },
        booking: {
            findFirst: vi.fn(),
        },
        journalEntry: {
            create: vi.fn(),
        },
        journalLine: {
            count: vi.fn(),
            findMany: vi.fn(),
        },
    };

    return { db: mockDb };
});

const AGENCY_ID = "agency_1";
const USER_ID = "agency_user_1";

// Prisma's generated arg types are too strict to destructure mock calls
// directly — read them back through this loose, test-friendly shape instead.
interface CreatedEntry {
    agencyId: string;
    createdBy?: string;
    currencyCode: string;
    bookingId?: string;
    description: string;
    lines: { create: { accountId: string; debit: number; credit: number }[] };
}

const createdEntry = (): CreatedEntry =>
    (vi.mocked(db.journalEntry.create).mock.calls[0][0] as unknown as { data: CreatedEntry }).data;

interface FindManyArgs {
    where: {
        journalEntry: { agencyId: string; entryDate?: { gte?: Date; lte?: Date } };
        account?: { code: string };
    };
    skip: number;
    take: number;
}

const findManyArgs = (): FindManyArgs =>
    vi.mocked(db.journalLine.findMany).mock.calls[0][0] as unknown as FindManyArgs;

const cashAccount = { id: "acc_cash", agencyId: AGENCY_ID, code: "1010", name: "Cash on Hand", type: "ASSET" };
const bankAccount = { id: "acc_bank", agencyId: AGENCY_ID, code: "1020", name: "Bank Account", type: "ASSET" };
const revenueAccount = { id: "acc_rev", agencyId: AGENCY_ID, code: "4000", name: "Trek Package Revenue", type: "REVENUE" };
const permitAccount = { id: "acc_permit", agencyId: AGENCY_ID, code: "5200", name: "Permit Fees", type: "EXPENSE" };

// Return the right mock account for whatever code the service asks for.
const stubAccounts = (...accounts: (typeof cashAccount)[]) => {
    vi.mocked(db.account.findFirst).mockImplementation(((args: { where: { code: string } }) =>
        Promise.resolve(
            accounts.find((a) => a.code === args.where.code) ?? null
        )) as never);
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.journalEntry.create).mockImplementation(((args: { data: unknown }) =>
        Promise.resolve(args.data)) as never);
});

describe("recordIncomeService", () => {
    it("generates a balanced entry: Debit Cash, Credit Revenue", async () => {
        stubAccounts(cashAccount, revenueAccount);

        await recordIncomeService(AGENCY_ID, USER_ID, { amount: 1500.5 });

        expect(db.journalEntry.create).toHaveBeenCalledTimes(1);
        const data = createdEntry();

        expect(data.agencyId).toBe(AGENCY_ID);
        expect(data.createdBy).toBe(USER_ID);
        expect(data.lines.create).toEqual([
            { accountId: "acc_cash", debit: 1500.5, credit: 0 },
            { accountId: "acc_rev", debit: 0, credit: 1500.5 },
        ]);

        // Double-entry invariant: total debits === total credits.
        const totalDebit = data.lines.create.reduce((s, l) => s + l.debit, 0);
        const totalCredit = data.lines.create.reduce((s, l) => s + l.credit, 0);
        expect(totalDebit).toBe(totalCredit);
    });

    it("stores currency_code alongside the amount, defaulting to NPR", async () => {
        stubAccounts(cashAccount, revenueAccount);

        await recordIncomeService(AGENCY_ID, USER_ID, { amount: 100 });

        expect(createdEntry().currencyCode).toBe("NPR");
    });

    it("normalizes an explicit currency code to uppercase", async () => {
        stubAccounts(cashAccount, revenueAccount);

        await recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, currencyCode: "usd" });

        expect(createdEntry().currencyCode).toBe("USD");
    });

    it("rejects an invalid currency code", async () => {
        stubAccounts(cashAccount, revenueAccount);

        await expect(
            recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, currencyCode: "RUPEES" })
        ).rejects.toThrow("Currency code must be a 3-letter code");
    });

    it("rejects zero, negative, and sub-cent amounts", async () => {
        stubAccounts(cashAccount, revenueAccount);

        await expect(recordIncomeService(AGENCY_ID, USER_ID, { amount: 0 })).rejects.toThrow(
            "Amount must be a number greater than 0."
        );
        await expect(recordIncomeService(AGENCY_ID, USER_ID, { amount: -50 })).rejects.toThrow(
            "Amount must be a number greater than 0."
        );
        await expect(recordIncomeService(AGENCY_ID, USER_ID, { amount: 10.999 })).rejects.toThrow(
            "Amount cannot have more than 2 decimal places."
        );
        expect(db.journalEntry.create).not.toHaveBeenCalled();
    });

    it("verifies a linked booking belongs to the same agency (tenant isolation)", async () => {
        stubAccounts(cashAccount, revenueAccount);
        vi.mocked(db.booking.findFirst).mockResolvedValue(null as never);

        await expect(
            recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, bookingId: "someone_elses_booking" })
        ).rejects.toThrow("Booking not found for this agency.");

        expect(db.booking.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "someone_elses_booking", agencyId: AGENCY_ID },
            })
        );
        expect(db.journalEntry.create).not.toHaveBeenCalled();
    });

    it("links a valid booking and uses it in the default description", async () => {
        stubAccounts(cashAccount, revenueAccount);
        vi.mocked(db.booking.findFirst).mockResolvedValue({ id: "booking_1" } as never);

        await recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, bookingId: "booking_1" });

        const data = createdEntry();
        expect(data.bookingId).toBe("booking_1");
        expect(data.description).toContain("booking_1");
    });

    it("supports depositing to a different asset account (e.g. bank)", async () => {
        stubAccounts(cashAccount, bankAccount, revenueAccount);

        await recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, depositAccountCode: "1020" });

        expect(createdEntry().lines.create[0]).toEqual({ accountId: "acc_bank", debit: 100, credit: 0 });
    });

    it("rejects a non-REVENUE account on the credit side", async () => {
        stubAccounts(cashAccount, bankAccount, revenueAccount);

        await expect(
            recordIncomeService(AGENCY_ID, USER_ID, { amount: 100, revenueAccountCode: "1020" })
        ).rejects.toThrow("Revenue account must be a REVENUE account");
    });

    it("fails clearly when the chart of accounts is not seeded", async () => {
        stubAccounts(); // no accounts exist

        await expect(recordIncomeService(AGENCY_ID, USER_ID, { amount: 100 })).rejects.toThrow(
            "Account 1010 not found for this agency."
        );
    });
});

describe("recordExpenseService", () => {
    it("generates a balanced entry: Debit Expense, Credit Cash", async () => {
        stubAccounts(cashAccount, permitAccount);

        await recordExpenseService(AGENCY_ID, USER_ID, { amount: 250, category: "permits" });

        const data = createdEntry();
        expect(data.lines.create).toEqual([
            { accountId: "acc_permit", debit: 250, credit: 0 },
            { accountId: "acc_cash", debit: 0, credit: 250 },
        ]);
        expect(data.currencyCode).toBe("NPR");
    });

    it("maps every documented category to its seeded expense account", () => {
        expect(EXPENSE_CATEGORY_ACCOUNTS).toEqual({
            equipment: "5300",
            permits: "5200",
            transport: "5500",
            accommodation: "5600",
            staff: "5000",
            marketing: "5400",
        });
    });

    it("accepts category case-insensitively", async () => {
        stubAccounts(cashAccount, permitAccount);

        await recordExpenseService(AGENCY_ID, USER_ID, { amount: 10, category: "  Permits " });

        expect(db.journalEntry.create).toHaveBeenCalledTimes(1);
    });

    it("rejects an unknown category and lists the valid ones", async () => {
        await expect(
            recordExpenseService(AGENCY_ID, USER_ID, { amount: 10, category: "helicopter" })
        ).rejects.toThrow(
            "Invalid expense category. Valid categories: equipment, permits, transport, accommodation, staff, marketing."
        );
        expect(db.journalEntry.create).not.toHaveBeenCalled();
    });

    it("uses the category as the default description", async () => {
        stubAccounts(cashAccount, permitAccount);

        await recordExpenseService(AGENCY_ID, USER_ID, { amount: 10, category: "permits" });

        expect(createdEntry().description).toBe("permits expense");
    });
});

describe("getTransactionsService", () => {
    beforeEach(() => {
        vi.mocked(db.journalLine.count).mockResolvedValue(0 as never);
        vi.mocked(db.journalLine.findMany).mockResolvedValue([] as never);
    });

    it("always scopes the ledger to the agency", async () => {
        await getTransactionsService(AGENCY_ID, {});

        expect(findManyArgs().where.journalEntry.agencyId).toBe(AGENCY_ID);
    });

    it("filters by account code and date range", async () => {
        await getTransactionsService(AGENCY_ID, {
            accountCode: "1010",
            from: "2026-07-01",
            to: "2026-07-31",
        });

        const { where } = findManyArgs();
        expect(where.account).toEqual({ code: "1010" });
        expect(where.journalEntry.entryDate).toEqual({
            gte: new Date("2026-07-01"),
            lte: new Date("2026-07-31"),
        });
    });

    it("paginates with skip/take and returns pagination metadata", async () => {
        vi.mocked(db.journalLine.count).mockResolvedValue(45 as never);

        const result = await getTransactionsService(AGENCY_ID, { page: 2, limit: 10 });

        const args = findManyArgs();
        expect(args.skip).toBe(10);
        expect(args.take).toBe(10);
        expect(result.pagination).toEqual({ page: 2, limit: 10, total: 45, totalPages: 5 });
    });

    it("clamps a hostile limit to the maximum page size", async () => {
        await getTransactionsService(AGENCY_ID, { limit: 100000 });

        expect(findManyArgs().take).toBe(100);
    });

    it("rejects invalid dates", async () => {
        await expect(getTransactionsService(AGENCY_ID, { from: "not-a-date" })).rejects.toThrow(
            "Invalid 'from' date."
        );
    });

    it("flattens lines into ledger rows with entry context and currency", async () => {
        vi.mocked(db.journalLine.count).mockResolvedValue(1 as never);
        vi.mocked(db.journalLine.findMany).mockResolvedValue([
            {
                id: "line_1",
                debit: 100,
                credit: 0,
                account: { code: "1010", name: "Cash on Hand", type: "ASSET" },
                journalEntry: {
                    id: "entry_1",
                    entryDate: new Date("2026-07-19"),
                    description: "Booking payment received",
                    currencyCode: "USD",
                    bookingId: "booking_1",
                },
            },
        ] as never);

        const result = await getTransactionsService(AGENCY_ID, {});

        expect(result.transactions).toEqual([
            {
                id: "line_1",
                journalEntryId: "entry_1",
                date: new Date("2026-07-19"),
                description: "Booking payment received",
                currencyCode: "USD",
                bookingId: "booking_1",
                account: { code: "1010", name: "Cash on Hand", type: "ASSET" },
                debit: 100,
                credit: 0,
            },
        ]);
    });
});
