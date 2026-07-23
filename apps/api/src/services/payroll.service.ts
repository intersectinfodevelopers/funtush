import { db } from "@funtush/database";
import type { PayrollStatus } from "@funtush/database";
import {
    CASH_ACCOUNT_CODE,
    getAccountOrThrow,
    validateAmount,
    validateCurrencyCode,
} from "./finance.service";

// ─────────────────────────────────────────────────────────────────────────────
// Payroll service (Day 3 — Guide & Staff Compensation)
//
// A payroll row is a *promise to pay*, not a payment. It is created as DRAFT
// and has zero effect on the ledger: nothing has left the bank yet, so nothing
// should show up in the accounts.
//
// Marking it PAID is the moment money actually moves, so that is the moment we
// write the double-entry journal entry:
//
//     Debit  Payroll Expense   (the cost of the work — an expense grew)
//     Credit Cash              (the money paid out — an asset shrank)
//
// Both halves are equal, so the entry balances and the Day 1 database trigger
// accepts it. Everything here is scoped by agencyId (Backend Guide §4/§18).
// ─────────────────────────────────────────────────────────────────────────────

// Payroll expense accounts from the seeded chart of accounts. Guides and
// office staff hit different accounts so the P&L can separate "cost of
// delivering treks" from "cost of running the office".
export const GUIDE_PAYROLL_ACCOUNT_CODE = "5000"; // Guide Payroll
export const STAFF_PAYROLL_ACCOUNT_CODE = "5050"; // Staff Salaries

export interface CreatePayrollPayload {
    // Exactly one of these must be provided.
    guideId?: string;
    staffId?: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
    currencyCode?: string;
    // Set when this is per-trek compensation rather than per-period.
    bookingId?: string;
    notes?: string;
}

export interface MarkPaidPayload {
    // Date the money actually left the account. Defaults to today.
    paymentDate?: string;
    // Pay from a different asset account, e.g. "1020" (Bank) instead of cash.
    paymentAccountCode?: string;
}

export interface PayrollQuery {
    guideId?: string;
    staffId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

// ── validation helpers ───────────────────────────────────────────────────────

// A pay period is a plain calendar day range, so we normalise to midnight UTC.
// Without this, "2026-07-01" typed in Kathmandu (UTC+5:45) could be stored as
// 30 June and land in the wrong month's P&L.
const validatePeriodDate = (value: unknown, field: string): Date => {
    if (value === undefined || value === null || value === "") {
        throw new Error(`${field} is required (YYYY-MM-DD).`);
    }

    const date = new Date(String(value));

    if (isNaN(date.getTime())) {
        throw new Error(`Invalid ${field}. Use YYYY-MM-DD.`);
    }

    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

// Decide who is being paid. Exactly one payee — the same rule the database
// CHECK constraint enforces, checked here first so the user gets a readable
// error instead of a Postgres constraint violation.
const resolvePayee = (data: CreatePayrollPayload) => {
    const guideId = data.guideId?.trim() || undefined;
    const staffId = data.staffId?.trim() || undefined;

    if (guideId && staffId) {
        throw new Error("Provide either guideId or staffId, not both.");
    }

    if (!guideId && !staffId) {
        throw new Error("Either guideId or staffId is required.");
    }

    return { guideId, staffId };
};

// ── POST /agencies/me/finance/payroll ────────────────────────────────────────

// Records what an agency owes a guide or staff member. Creates a DRAFT row —
// deliberately no journal entry yet, because no money has moved.
export const createPayrollService = async (
    agencyId: string,
    agencyUserId: string | undefined,
    data: CreatePayrollPayload
) => {
    const { guideId, staffId } = resolvePayee(data);
    const amount = validateAmount(data.amount);
    const currencyCode = validateCurrencyCode(data.currencyCode);
    const periodStart = validatePeriodDate(data.periodStart, "periodStart");
    const periodEnd = validatePeriodDate(data.periodEnd, "periodEnd");

    if (periodEnd < periodStart) {
        throw new Error("periodEnd cannot be before periodStart.");
    }

    // Tenant isolation: a staff member from another agency can never be paid
    // out of this agency's ledger.
    if (staffId) {
        const staff = await db.agencyStaff.findFirst({
            where: { id: staffId, agencyId },
            select: { id: true },
        });

        if (!staff) {
            throw new Error("Staff member not found for this agency.");
        }
    }

    // Same check for the booking, when compensation is per trek.
    if (data.bookingId) {
        const booking = await db.booking.findFirst({
            where: { id: data.bookingId, agencyId },
            select: { id: true },
        });

        if (!booking) {
            throw new Error("Booking not found for this agency.");
        }
    }

    return await db.payroll.create({
        data: {
            agencyId,
            guideId,
            staffId,
            periodStart,
            periodEnd,
            amount,
            currencyCode,
            status: "DRAFT",
            bookingId: data.bookingId,
            notes: data.notes?.trim() || null,
            createdBy: agencyUserId,
        },
    });
};

// ── PATCH /agencies/me/finance/payroll/:id/mark-paid ─────────────────────────

// Pays a DRAFT payroll row: writes the journal entry and flips the row to PAID.
// Both happen inside ONE database transaction, so it is impossible to end up
// with a paid row that has no ledger entry, or a ledger entry for a row that
// never got marked paid.
export const markPayrollPaidService = async (
    agencyId: string,
    agencyUserId: string | undefined,
    payrollId: string,
    data: MarkPaidPayload = {}
) => {
    // findFirst with agencyId, not findUnique by id — an id from another
    // tenant must read as "not found", never as someone else's row.
    const payroll = await db.payroll.findFirst({
        where: { id: payrollId, agencyId },
    });

    if (!payroll) {
        throw new Error("Payroll record not found for this agency.");
    }

    // Idempotency guard: paying twice would double-count the expense.
    if (payroll.status === "PAID") {
        throw new Error("This payroll record is already marked as paid.");
    }

    const paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

    if (isNaN(paymentDate.getTime())) {
        throw new Error("Invalid payment date.");
    }

    // Guides and staff are expensed to different accounts.
    const expenseAccountCode = payroll.guideId
        ? GUIDE_PAYROLL_ACCOUNT_CODE
        : STAFF_PAYROLL_ACCOUNT_CODE;

    // Decimal → number for the ledger lines. The column is DECIMAL(12,2) and
    // the amount was validated to 2 decimal places on creation, so this is
    // exact.
    const amount = Number(payroll.amount);

    return await db.$transaction(async (tx) => {
        const expenseAccount = await getAccountOrThrow(agencyId, expenseAccountCode, tx);
        const paymentAccount = await getAccountOrThrow(
            agencyId,
            data.paymentAccountCode ?? CASH_ACCOUNT_CODE,
            tx
        );

        if (paymentAccount.type !== "ASSET") {
            throw new Error(
                "Payment account must be an ASSET account (e.g. 1010 Cash, 1020 Bank)."
            );
        }

        const payeeLabel = payroll.guideId
            ? `guide ${payroll.guideId}`
            : `staff ${payroll.staffId}`;

        const entry = await tx.journalEntry.create({
            data: {
                agencyId,
                entryDate: paymentDate,
                description: `Payroll paid to ${payeeLabel} (${payroll.periodStart
                    .toISOString()
                    .slice(0, 10)} → ${payroll.periodEnd.toISOString().slice(0, 10)})`,
                currencyCode: payroll.currencyCode,
                bookingId: payroll.bookingId,
                createdBy: agencyUserId,
                lines: {
                    create: [
                        // Debit the expense: the work cost us this much.
                        { accountId: expenseAccount.id, debit: amount, credit: 0 },
                        // Credit the asset: that much cash left the agency.
                        { accountId: paymentAccount.id, debit: 0, credit: amount },
                    ],
                },
            },
            include: {
                lines: {
                    include: { account: { select: { code: true, name: true, type: true } } },
                },
            },
        });

        // updateMany with agencyId + status DRAFT is an optimistic lock: if a
        // second request paid this row a millisecond ago, count is 0 and we
        // abort, rolling the journal entry back with the transaction.
        const updated = await tx.payroll.updateMany({
            where: { id: payrollId, agencyId, status: "DRAFT" },
            data: {
                status: "PAID",
                paidAt: paymentDate,
                journalEntryId: entry.id,
            },
        });

        if (updated.count !== 1) {
            throw new Error("This payroll record is already marked as paid.");
        }

        const fresh = await tx.payroll.findFirst({ where: { id: payrollId, agencyId } });

        return { payroll: fresh, journalEntry: entry };
    });
};

// ── GET /agencies/me/finance/payroll ─────────────────────────────────────────

// Payroll history, filterable per guide/staff member, status and pay period.
export const getPayrollHistoryService = async (agencyId: string, query: PayrollQuery) => {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(
        MAX_PAGE_LIMIT,
        Math.max(1, Math.floor(Number(query.limit) || DEFAULT_PAGE_LIMIT))
    );

    let status: PayrollStatus | undefined;

    if (query.status) {
        const value = String(query.status).trim().toUpperCase();

        if (value !== "DRAFT" && value !== "PAID") {
            throw new Error("Invalid status. Use DRAFT or PAID.");
        }

        status = value;
    }

    // Overlap filter: return any pay period that intersects [from, to], not
    // only periods fully inside it. A month-long period should still show up
    // when you ask for one week of it.
    const periodFilters: { periodEnd?: { gte: Date }; periodStart?: { lte: Date } } = {};

    if (query.from) {
        const from = new Date(query.from);
        if (isNaN(from.getTime())) {
            throw new Error("Invalid 'from' date.");
        }
        periodFilters.periodEnd = { gte: from };
    }

    if (query.to) {
        const to = new Date(query.to);
        if (isNaN(to.getTime())) {
            throw new Error("Invalid 'to' date.");
        }
        periodFilters.periodStart = { lte: to };
    }

    const where = {
        agencyId,
        ...(query.guideId ? { guideId: String(query.guideId) } : {}),
        ...(query.staffId ? { staffId: String(query.staffId) } : {}),
        ...(status ? { status } : {}),
        ...periodFilters,
    };

    const [total, records, totals] = await Promise.all([
        db.payroll.count({ where }),
        db.payroll.findMany({
            where,
            orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
        }),
        // Summary over the WHOLE filtered set, not just the current page —
        // "how much do I still owe?" is the question this screen exists for.
        db.payroll.groupBy({
            by: ["status"],
            where,
            _sum: { amount: true },
        }),
    ]);

    const sumFor = (value: PayrollStatus) =>
        Number(totals.find((t) => t.status === value)?._sum.amount ?? 0);

    return {
        payroll: records,
        summary: {
            draftTotal: sumFor("DRAFT"),
            paidTotal: sumFor("PAID"),
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};
