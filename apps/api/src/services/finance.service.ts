import { db } from "@funtush/database";

// ─────────────────────────────────────────────────────────────────────────────
// Finance service (Day 2 — Revenue & Expense Recording)
//
// Every income/expense call auto-generates one balanced double-entry journal
// entry (two lines, debit total = credit total). The database's deferred
// balance trigger (Day 1 migration) is the last line of defense; this service
// is responsible for producing entries that are correct in the first place.
// All account lookups are scoped by agencyId — tenant isolation, Backend
// Guide §4/§18.
// ─────────────────────────────────────────────────────────────────────────────

// Account codes from the default chart of accounts (accounting.seed.ts).
const CASH_ACCOUNT_CODE = "1010"; // Cash on Hand — default money in/out account
const DEFAULT_REVENUE_ACCOUNT_CODE = "4000"; // Trek Package Revenue

// Expense category (API surface) → expense account code in the seeded chart.
export const EXPENSE_CATEGORY_ACCOUNTS: Record<string, string> = {
    equipment: "5300", // Equipment Purchase & Maintenance
    permits: "5200", // Permit Fees
    transport: "5500", // Transportation
    accommodation: "5600", // Accommodation & Meals
    staff: "5000", // Guide Payroll
    marketing: "5400", // Marketing & Advertising
};

export interface IncomePayload {
    amount: number;
    currencyCode?: string;
    entryDate?: string;
    description?: string;
    bookingId?: string;
    // Optional overrides, e.g. deposit to "1020" (Bank) instead of cash, or
    // credit "4100" (Add-on Revenue) instead of package revenue.
    depositAccountCode?: string;
    revenueAccountCode?: string;
}

export interface ExpensePayload {
    amount: number;
    category: string;
    currencyCode?: string;
    entryDate?: string;
    description?: string;
    // Optional override, e.g. paid from "1020" (Bank) instead of cash.
    paymentAccountCode?: string;
}

export interface TransactionQuery {
    accountCode?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

// ── shared validation helpers ────────────────────────────────────────────────

const validateAmount = (amount: unknown): number => {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Amount must be a number greater than 0.");
    }

    // Ledger columns are DECIMAL(12,2) — reject sub-cent amounts instead of
    // silently rounding money.
    if (Math.round(value * 100) !== value * 100) {
        throw new Error("Amount cannot have more than 2 decimal places.");
    }

    return value;
};

// Multi-currency (Day 2): every transaction stores an ISO-4217 style 3-letter
// currency code alongside its amount. Defaults to NPR (Nepali Rupee).
const validateCurrencyCode = (currencyCode?: string): string => {
    if (currencyCode === undefined || currencyCode === null || currencyCode === "") {
        return "NPR";
    }

    const code = String(currencyCode).trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(code)) {
        throw new Error("Currency code must be a 3-letter code (e.g. NPR, USD, EUR).");
    }

    return code;
};

const validateEntryDate = (entryDate?: string): Date => {
    if (!entryDate) {
        return new Date();
    }

    const date = new Date(entryDate);

    if (isNaN(date.getTime())) {
        throw new Error("Invalid entry date.");
    }

    return date;
};

// Look up an account by its chart code, scoped to the agency. Every lookup
// goes through here so no journal line can ever point at another tenant's
// account.
const getAccountOrThrow = async (agencyId: string, code: string) => {
    const account = await db.account.findFirst({
        where: {
            agencyId,
            code,
            isActive: true,
        },
    });

    if (!account) {
        throw new Error(
            `Account ${code} not found for this agency. Seed the chart of accounts first (pnpm db:seed:accounting).`
        );
    }

    return account;
};

// ── POST /agencies/me/finance/income ─────────────────────────────────────────

// Records a booking payment received. Double entry: money came in (Debit
// Cash — an asset grew) and it was earned (Credit Revenue).
export const recordIncomeService = async (
    agencyId: string,
    agencyUserId: string | undefined,
    data: IncomePayload
) => {
    const amount = validateAmount(data.amount);
    const currencyCode = validateCurrencyCode(data.currencyCode);
    const entryDate = validateEntryDate(data.entryDate);

    // If the income is tied to a booking, the booking must belong to this
    // agency — never allow cross-tenant references.
    if (data.bookingId) {
        const booking = await db.booking.findFirst({
            where: {
                id: data.bookingId,
                agencyId,
            },
            select: { id: true },
        });

        if (!booking) {
            throw new Error("Booking not found for this agency.");
        }
    }

    const depositAccount = await getAccountOrThrow(
        agencyId,
        data.depositAccountCode ?? CASH_ACCOUNT_CODE
    );
    const revenueAccount = await getAccountOrThrow(
        agencyId,
        data.revenueAccountCode ?? DEFAULT_REVENUE_ACCOUNT_CODE
    );

    if (depositAccount.type !== "ASSET") {
        throw new Error("Deposit account must be an ASSET account (e.g. 1010 Cash, 1020 Bank).");
    }

    if (revenueAccount.type !== "REVENUE") {
        throw new Error("Revenue account must be a REVENUE account (e.g. 4000 Trek Package Revenue).");
    }

    const description =
        data.description?.trim() ||
        (data.bookingId
            ? `Booking payment received (booking ${data.bookingId})`
            : "Booking payment received");

    // Nested create = entry + both lines in ONE database transaction, so the
    // deferred balance trigger sees a balanced entry at commit.
    return await db.journalEntry.create({
        data: {
            agencyId,
            entryDate,
            description,
            currencyCode,
            bookingId: data.bookingId,
            createdBy: agencyUserId,
            lines: {
                create: [
                    { accountId: depositAccount.id, debit: amount, credit: 0 },
                    { accountId: revenueAccount.id, debit: 0, credit: amount },
                ],
            },
        },
        include: {
            lines: {
                include: {
                    account: {
                        select: { code: true, name: true, type: true },
                    },
                },
            },
        },
    });
};

// ── POST /agencies/me/finance/expenses ───────────────────────────────────────

// Records a categorized expense. Double entry: cost was incurred (Debit
// Expense) and money went out (Credit Cash — an asset shrank).
export const recordExpenseService = async (
    agencyId: string,
    agencyUserId: string | undefined,
    data: ExpensePayload
) => {
    const amount = validateAmount(data.amount);
    const currencyCode = validateCurrencyCode(data.currencyCode);
    const entryDate = validateEntryDate(data.entryDate);

    const category = String(data.category ?? "").trim().toLowerCase();
    const expenseAccountCode = EXPENSE_CATEGORY_ACCOUNTS[category];

    if (!expenseAccountCode) {
        throw new Error(
            `Invalid expense category. Valid categories: ${Object.keys(EXPENSE_CATEGORY_ACCOUNTS).join(", ")}.`
        );
    }

    const expenseAccount = await getAccountOrThrow(agencyId, expenseAccountCode);
    const paymentAccount = await getAccountOrThrow(
        agencyId,
        data.paymentAccountCode ?? CASH_ACCOUNT_CODE
    );

    if (paymentAccount.type !== "ASSET") {
        throw new Error("Payment account must be an ASSET account (e.g. 1010 Cash, 1020 Bank).");
    }

    const description = data.description?.trim() || `${category} expense`;

    return await db.journalEntry.create({
        data: {
            agencyId,
            entryDate,
            description,
            currencyCode,
            createdBy: agencyUserId,
            lines: {
                create: [
                    { accountId: expenseAccount.id, debit: amount, credit: 0 },
                    { accountId: paymentAccount.id, debit: 0, credit: amount },
                ],
            },
        },
        include: {
            lines: {
                include: {
                    account: {
                        select: { code: true, name: true, type: true },
                    },
                },
            },
        },
    });
};

// ── GET /agencies/me/finance/transactions ────────────────────────────────────

// Paginated ledger: one row per journal LINE (that's what a ledger is — every
// debit/credit movement), filterable by account code and entry-date range.
export const getTransactionsService = async (
    agencyId: string,
    query: TransactionQuery
) => {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(
        MAX_PAGE_LIMIT,
        Math.max(1, Math.floor(Number(query.limit) || DEFAULT_PAGE_LIMIT))
    );

    const entryDateFilter: { gte?: Date; lte?: Date } = {};

    if (query.from) {
        const from = new Date(query.from);
        if (isNaN(from.getTime())) {
            throw new Error("Invalid 'from' date.");
        }
        entryDateFilter.gte = from;
    }

    if (query.to) {
        const to = new Date(query.to);
        if (isNaN(to.getTime())) {
            throw new Error("Invalid 'to' date.");
        }
        entryDateFilter.lte = to;
    }

    // Tenant isolation lives on the parent entry: every line belongs to a
    // journal entry, and the entry filter pins agencyId.
    const where = {
        journalEntry: {
            agencyId,
            ...(Object.keys(entryDateFilter).length > 0
                ? { entryDate: entryDateFilter }
                : {}),
        },
        ...(query.accountCode ? { account: { code: String(query.accountCode) } } : {}),
    };

    const [total, lines] = await Promise.all([
        db.journalLine.count({ where }),
        db.journalLine.findMany({
            where,
            include: {
                account: {
                    select: { code: true, name: true, type: true },
                },
                journalEntry: {
                    select: {
                        id: true,
                        entryDate: true,
                        description: true,
                        currencyCode: true,
                        bookingId: true,
                    },
                },
            },
            orderBy: [
                { journalEntry: { entryDate: "desc" } },
                { journalEntry: { createdAt: "desc" } },
            ],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        transactions: lines.map((line) => ({
            id: line.id,
            journalEntryId: line.journalEntry.id,
            date: line.journalEntry.entryDate,
            description: line.journalEntry.description,
            currencyCode: line.journalEntry.currencyCode,
            bookingId: line.journalEntry.bookingId,
            account: line.account,
            debit: line.debit,
            credit: line.credit,
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};
