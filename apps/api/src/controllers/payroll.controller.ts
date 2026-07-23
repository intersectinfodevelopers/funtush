import type { Request, Response } from "express";
import {
    createPayrollService,
    markPayrollPaidService,
    getPayrollHistoryService,
} from "src/services/payroll.service";

// Controllers stay thin on purpose: pull the tenant + input off the request,
// hand it to the service, shape the response. All accounting rules live in the
// service so they can be unit-tested without an HTTP server.

export const createPayroll = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
        // Set by the auth middleware — the AgencyUser recording this payroll.
        const agencyUserId = req.tenantId ?? undefined;

        const payroll = await createPayrollService(agencyId, agencyUserId, req.body);

        return res.status(201).json({
            success: true,
            data: payroll,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};

export const markPayrollPaid = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
        const agencyUserId = req.tenantId ?? undefined;

        const result = await markPayrollPaidService(
            agencyId,
            agencyUserId,
            req.params.id as string,
            req.body ?? {}
        );

        return res.status(200).json({
            success: true,
            data: result.payroll,
            // The generated ledger entry is returned so the caller can see
            // exactly which debit and credit were posted.
            journalEntry: result.journalEntry,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";

        // A missing record is a 404, not a bad request.
        const status = message.includes("not found for this agency") ? 404 : 400;

        return res.status(status).json({
            success: false,
            message,
        });
    }
};

export const getPayrollHistory = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        const result = await getPayrollHistoryService(agencyId, {
            guideId: req.query.guideId as string | undefined,
            staffId: req.query.staffId as string | undefined,
            status: req.query.status as string | undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });

        return res.status(200).json({
            success: true,
            data: result.payroll,
            summary: result.summary,
            pagination: result.pagination,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};
