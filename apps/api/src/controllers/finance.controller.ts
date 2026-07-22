import type { Request, Response } from "express";
import {
    recordIncomeService,
    recordExpenseService,
    getTransactionsService,
} from "src/services/finance.service";

export const recordIncome = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
        // Set by the auth middleware — the AgencyUser making this entry.
        const agencyUserId = req.tenantId ?? undefined;

        const entry = await recordIncomeService(agencyId, agencyUserId, req.body);

        return res.status(201).json({
            success: true,
            data: entry,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const recordExpense = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
        const agencyUserId = req.tenantId ?? undefined;

        const entry = await recordExpenseService(agencyId, agencyUserId, req.body);

        return res.status(201).json({
            success: true,
            data: entry,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const getTransactions = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const result = await getTransactionsService(agencyId, {
            accountCode: req.query.accountCode as string | undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });

        return res.status(200).json({
            success: true,
            data: result.transactions,
            pagination: result.pagination,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};
