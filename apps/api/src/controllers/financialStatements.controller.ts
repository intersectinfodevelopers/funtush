import type { Request, Response } from "express";
import {
    getProfitAndLossService,
    getBalanceSheetService,
    getCashFlowService,
    getTaxSummaryService,
} from "src/services/financialStatements.service";

// All four statements are read-only reports over the same journal lines, so
// they share one error shape. Bad input (a malformed period, an unseeded chart
// of accounts) is a 400 — the caller can fix it and retry.

export const getProfitAndLoss = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const report = await getProfitAndLossService(
            agencyId,
            req.query.period as string | undefined
        );

        return res.status(200).json({ success: true, data: report });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const report = await getBalanceSheetService(
            agencyId,
            req.query.date as string | undefined
        );

        return res.status(200).json({ success: true, data: report });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const getCashFlow = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const report = await getCashFlowService(
            agencyId,
            req.query.period as string | undefined
        );

        return res.status(200).json({ success: true, data: report });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const getTaxSummary = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const report = await getTaxSummaryService(
            agencyId,
            req.query.period as string | undefined,
            req.query.vatRate === undefined ? undefined : Number(req.query.vatRate)
        );

        return res.status(200).json({ success: true, data: report });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};
