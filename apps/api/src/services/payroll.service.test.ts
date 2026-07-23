import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    createPayrollService,
    markPayrollPaidService,
    getPayrollHistoryService,
    GUIDE_PAYROLL_ACCOUNT_CODE,
    STAFF_PAYROLL_ACCOUNT_CODE,
} from "./payroll.service";
import { db } from "@funtush/database";

// Same approach as finance.service.test.ts: mock the database so these tests
// verify the payroll LOGIC (which lines get generated, on which accounts, and
// which rows can be paid) rather than Postgres.
vi.mock("@funtush/database", () => {
    const mockDb = {
        account: { findFirst: vi.fn() },
        agencyStaff: { findFirst: vi.fn() },
        booking: { findFirst: vi.fn() },
        payroll: {
            create: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            updateMany: vi.fn(),
            count: vi.fn(),
            groupBy: vi.fn(),
        },
        journalEntry: { create: vi.fn() },
        $transaction: vi.fn(),
    };

    return { db: mockDb };
});

const AGENCY_ID = "agency_1";
const USER_ID = "agency_user_1";

const cashAccount = { id: "acc_cash", code: "1010", name: "Cash on Hand", type: "ASSET" };
const guidePayrollAccount = { id: "acc_guide_payroll", code: "5000", name: "Guide Payroll", type: "EXPENSE" };
const staffPayrollAccount = { id: "acc_staff_salaries", code: "5050", name: "Staff Salaries", type: "EXPENSE" };
const revenueAccount = { id: "acc_rev", code: "4000", name: "Trek Package Revenue", type: "REVENUE" };

const stubAccounts = (...accounts: (typeof cashAccount)[]) => {
    vi.mocked(db.account.findFirst).mockImplementation(((args: { where: { code: string } }) =>
        Promise.resolve(accounts.find((a) => a.code === args.where.code) ?? null)) as never);
};

// Prisma's generated arg types are too strict to destructure mock calls
// directly — read them back through these loose, test-friendly shapes.
interface CreatedPayroll {
    agencyId: string;
    guideId?: string;
    staffId?: string;
    amount: number;
    currencyCode: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    notes: string | null;
    createdBy?: string;
}

const createdPayroll = (): CreatedPayroll =>
    (vi.mocked(db.payroll.create).mock.calls[0][0] as unknown as { data: CreatedPayroll }).data;

interface CreatedEntry {
    agencyId: string;
    entryDate: Date;
    currencyCode: string;
    description: string;
    lines: { create: { accountId: string; debit: number; credit: number }[] };
}

const createdEntry = (): CreatedEntry =>
    (vi.mocked(db.journalEntry.create).mock.calls[0][0] as unknown as { data: CreatedEntry }).data;

// A DRAFT payroll row as Prisma would return it.
const draftPayroll = (overrides: Record<string, unknown> = {}) => ({
    id: "payroll_1",
    agencyId: AGENCY_ID,
    guideId: "guide_1",
    staffId: null,
    periodStart: new Date("2026-07-01"),
    periodEnd: new Date("2026-07-31"),
    amount: 45000,
    currencyCode: "NPR",
    status: "DRAFT",
    bookingId: null,
    notes: null,
    journalEntryId: null,
    paidAt: null,
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.payroll.create).mockImplementation(((args: { data: unknown }) =>
        Promise.resolve(args.data)) as never);

    vi.mocked(db.journalEntry.create).mockImplementation(((args: { data: { lines: unknown } }) =>
        Promise.resolve({ id: "entry_1", ...args.data })) as never);

    vi.mocked(db.payroll.updateMany).mockResolvedValue({ count: 1 } as never);

    // $transaction(callback) runs the callback against the same mock client.
    vi.mocked(db.$transaction).mockImplementation(((fn: (tx: typeof db) => unknown) =>
        Promise.resolve(fn(db))) as never);
});

describe("createPayrollService", () => {
    const validPayload = {
        guideId: "guide_1",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        amount: 45000,
    };

    it("creates a DRAFT row and does NOT touch the ledger", async () => {
        await createPayrollService(AGENCY_ID, USER_ID, validPayload);

        const data = createdPayroll();
        expect(data.agencyId).toBe(AGENCY_ID);
        expect(data.guideId).toBe("guide_1");
        expect(data.status).toBe("DRAFT");
        expect(data.createdBy).toBe(USER_ID);

        // The whole point of DRAFT: no money has moved yet.
        expect(db.journalEntry.create).not.toHaveBeenCalled();
    });

    it("normalises the pay period to midnight UTC", async () => {
        await createPayrollService(AGENCY_ID, USER_ID, validPayload);

        const data = createdPayroll();
        expect(data.periodStart.toISOString()).toBe("2026-07-01T00:00:00.000Z");
        expect(data.periodEnd.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    });

    it("defaults the currency to NPR and uppercases an explicit one", async () => {
        await createPayrollService(AGENCY_ID, USER_ID, validPayload);
        expect(createdPayroll().currencyCode).toBe("NPR");

        vi.mocked(db.payroll.create).mockClear();
        await createPayrollService(AGENCY_ID, USER_ID, { ...validPayload, currencyCode: "usd" });
        expect(createdPayroll().currencyCode).toBe("USD");
    });

    it("requires exactly one payee", async () => {
        await expect(
            createPayrollService(AGENCY_ID, USER_ID, {
                periodStart: "2026-07-01",
                periodEnd: "2026-07-31",
                amount: 100,
            })
        ).rejects.toThrow("Either guideId or staffId is required.");

        await expect(
            createPayrollService(AGENCY_ID, USER_ID, {
                ...validPayload,
                staffId: "staff_1",
            })
        ).rejects.toThrow("Provide either guideId or staffId, not both.");

        expect(db.payroll.create).not.toHaveBeenCalled();
    });

    it("rejects zero, negative and sub-cent amounts", async () => {
        await expect(
            createPayrollService(AGENCY_ID, USER_ID, { ...validPayload, amount: 0 })
        ).rejects.toThrow("Amount must be a number greater than 0.");

        await expect(
            createPayrollService(AGENCY_ID, USER_ID, { ...validPayload, amount: -1 })
        ).rejects.toThrow("Amount must be a number greater than 0.");

        await expect(
            createPayrollService(AGENCY_ID, USER_ID, { ...validPayload, amount: 10.001 })
        ).rejects.toThrow("Amount cannot have more than 2 decimal places.");
    });

    it("rejects a period that runs backwards", async () => {
        await expect(
            createPayrollService(AGENCY_ID, USER_ID, {
                ...validPayload,
                periodStart: "2026-07-31",
                periodEnd: "2026-07-01",
            })
        ).rejects.toThrow("periodEnd cannot be before periodStart.");
    });

    it("verifies a staff member belongs to the same agency (tenant isolation)", async () => {
        vi.mocked(db.agencyStaff.findFirst).mockResolvedValue(null as never);

        await expect(
            createPayrollService(AGENCY_ID, USER_ID, {
                staffId: "someone_elses_staff",
                periodStart: "2026-07-01",
                periodEnd: "2026-07-31",
                amount: 100,
            })
        ).rejects.toThrow("Staff member not found for this agency.");

        expect(db.agencyStaff.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "someone_elses_staff", agencyId: AGENCY_ID },
            })
        );
        expect(db.payroll.create).not.toHaveBeenCalled();
    });

    it("verifies a linked booking belongs to the same agency", async () => {
        vi.mocked(db.booking.findFirst).mockResolvedValue(null as never);

        await expect(
            createPayrollService(AGENCY_ID, USER_ID, {
                ...validPayload,
                bookingId: "someone_elses_booking",
            })
        ).rejects.toThrow("Booking not found for this agency.");
    });
});

describe("markPayrollPaidService", () => {
    it("posts Debit Guide Payroll / Credit Cash for a guide", async () => {
        stubAccounts(cashAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);

        await markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1");

        const data = createdEntry();
        expect(data.lines.create).toEqual([
            { accountId: "acc_guide_payroll", debit: 45000, credit: 0 },
            { accountId: "acc_cash", debit: 0, credit: 45000 },
        ]);

        // Double-entry invariant: total debits === total credits.
        const debit = data.lines.create.reduce((s, l) => s + l.debit, 0);
        const credit = data.lines.create.reduce((s, l) => s + l.credit, 0);
        expect(debit).toBe(credit);
    });

    it("posts to Staff Salaries when the payee is staff, not a guide", async () => {
        stubAccounts(cashAccount, staffPayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(
            draftPayroll({ guideId: null, staffId: "staff_1", amount: 30000 }) as never
        );

        await markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1");

        expect(createdEntry().lines.create[0]).toEqual({
            accountId: "acc_staff_salaries",
            debit: 30000,
            credit: 0,
        });
    });

    it("keeps the two payroll expense accounts distinct", () => {
        expect(GUIDE_PAYROLL_ACCOUNT_CODE).toBe("5000");
        expect(STAFF_PAYROLL_ACCOUNT_CODE).toBe("5050");
    });

    it("flips the row to PAID and links the generated journal entry", async () => {
        stubAccounts(cashAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);

        await markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1");

        expect(db.payroll.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                // Optimistic lock: only a row that is still DRAFT can be paid.
                where: { id: "payroll_1", agencyId: AGENCY_ID, status: "DRAFT" },
                data: expect.objectContaining({
                    status: "PAID",
                    journalEntryId: "entry_1",
                }),
            })
        );
    });

    it("refuses to pay the same payroll twice", async () => {
        stubAccounts(cashAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(
            draftPayroll({ status: "PAID", journalEntryId: "entry_0" }) as never
        );

        await expect(markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1")).rejects.toThrow(
            "This payroll record is already marked as paid."
        );

        expect(db.journalEntry.create).not.toHaveBeenCalled();
    });

    it("aborts if another request paid the row concurrently", async () => {
        stubAccounts(cashAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);
        // updateMany matched nothing → someone else got there first.
        vi.mocked(db.payroll.updateMany).mockResolvedValue({ count: 0 } as never);

        await expect(markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1")).rejects.toThrow(
            "This payroll record is already marked as paid."
        );
    });

    it("never reads another tenant's payroll record", async () => {
        vi.mocked(db.payroll.findFirst).mockResolvedValue(null as never);

        await expect(markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_x")).rejects.toThrow(
            "Payroll record not found for this agency."
        );

        expect(db.payroll.findFirst).toHaveBeenCalledWith({
            where: { id: "payroll_x", agencyId: AGENCY_ID },
        });
    });

    it("can pay from the bank account instead of cash", async () => {
        const bankAccount = { id: "acc_bank", code: "1020", name: "Bank Account", type: "ASSET" };
        stubAccounts(bankAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);

        await markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1", {
            paymentAccountCode: "1020",
        });

        expect(createdEntry().lines.create[1]).toEqual({
            accountId: "acc_bank",
            debit: 0,
            credit: 45000,
        });
    });

    it("rejects a non-ASSET payment account", async () => {
        stubAccounts(revenueAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);

        await expect(
            markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1", {
                paymentAccountCode: "4000",
            })
        ).rejects.toThrow("Payment account must be an ASSET account");
    });

    it("fails clearly when the payroll account is not seeded", async () => {
        stubAccounts(cashAccount); // 5000 missing
        vi.mocked(db.payroll.findFirst).mockResolvedValue(draftPayroll() as never);

        await expect(markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1")).rejects.toThrow(
            "Account 5000 not found for this agency."
        );
    });

    it("carries the payroll's currency onto the journal entry", async () => {
        stubAccounts(cashAccount, guidePayrollAccount);
        vi.mocked(db.payroll.findFirst).mockResolvedValue(
            draftPayroll({ currencyCode: "USD" }) as never
        );

        await markPayrollPaidService(AGENCY_ID, USER_ID, "payroll_1");

        expect(createdEntry().currencyCode).toBe("USD");
    });
});

describe("getPayrollHistoryService", () => {
    beforeEach(() => {
        vi.mocked(db.payroll.count).mockResolvedValue(0 as never);
        vi.mocked(db.payroll.findMany).mockResolvedValue([] as never);
        vi.mocked(db.payroll.groupBy).mockResolvedValue([] as never);
    });

    const findManyWhere = () =>
        (vi.mocked(db.payroll.findMany).mock.calls[0][0] as unknown as {
            where: Record<string, unknown>;
            skip: number;
            take: number;
        });

    it("always scopes the history to the agency", async () => {
        await getPayrollHistoryService(AGENCY_ID, {});

        expect(findManyWhere().where.agencyId).toBe(AGENCY_ID);
    });

    it("filters by guide, staff and status", async () => {
        await getPayrollHistoryService(AGENCY_ID, {
            guideId: "guide_1",
            staffId: "staff_1",
            status: "paid",
        });

        const { where } = findManyWhere();
        expect(where.guideId).toBe("guide_1");
        expect(where.staffId).toBe("staff_1");
        // Status is normalised to the enum's uppercase form.
        expect(where.status).toBe("PAID");
    });

    it("rejects an unknown status", async () => {
        await expect(
            getPayrollHistoryService(AGENCY_ID, { status: "PENDING" })
        ).rejects.toThrow("Invalid status. Use DRAFT or PAID.");
    });

    it("matches pay periods that OVERLAP the date filter", async () => {
        await getPayrollHistoryService(AGENCY_ID, { from: "2026-07-10", to: "2026-07-20" });

        const { where } = findManyWhere();
        // A July 1–31 period overlaps 10–20 July, so it must be returned:
        // period ends on/after `from` AND starts on/before `to`.
        expect(where.periodEnd).toEqual({ gte: new Date("2026-07-10") });
        expect(where.periodStart).toEqual({ lte: new Date("2026-07-20") });
    });

    it("paginates and clamps a hostile limit", async () => {
        vi.mocked(db.payroll.count).mockResolvedValue(45 as never);

        const result = await getPayrollHistoryService(AGENCY_ID, { page: 2, limit: 10 });

        expect(findManyWhere().skip).toBe(10);
        expect(findManyWhere().take).toBe(10);
        expect(result.pagination).toEqual({ page: 2, limit: 10, total: 45, totalPages: 5 });

        vi.mocked(db.payroll.findMany).mockClear();
        await getPayrollHistoryService(AGENCY_ID, { limit: 100000 });
        expect(findManyWhere().take).toBe(100);
    });

    it("summarises outstanding vs paid across the whole filtered set", async () => {
        vi.mocked(db.payroll.groupBy).mockResolvedValue([
            { status: "DRAFT", _sum: { amount: 75000 } },
            { status: "PAID", _sum: { amount: 120000 } },
        ] as never);

        const result = await getPayrollHistoryService(AGENCY_ID, {});

        expect(result.summary).toEqual({ draftTotal: 75000, paidTotal: 120000 });
    });
});
