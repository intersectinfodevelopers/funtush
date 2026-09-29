import type { Request, Response } from "express";
import { BranchError, deleteBranchService, assignGuideToBranchService, assignPackageToBranchService, assignStaffToBranchService, createBranchService, getBranchesService, getBranchReportService, getConsolidatedFinanceService, updateBranchService } from "src/services/branches.service";

export const createBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const branch = await createBranchService(
            agencyUserId,
            req.body
        );

        return res.status(201).json({
            success: true,
            data: branch,
        });

    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const updateBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const branchId = req.params.id as string;

        const branch = await updateBranchService(
            agencyUserId,
            branchId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: branch,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getAgencyBranches = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const branches = await getBranchesService(
            agencyUserId
        );

        return res.status(200).json({
            success: true,
            count: branches.length,
            data: branches,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};


export const assignStaffToBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const staffId = req.params.id as string;

        const result = await assignStaffToBranchService(
            agencyUserId,
            staffId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const assignGuideToBranch = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const guideId = req.params.id as string;

        const result = await assignGuideToBranchService(
            agencyUserId,
            guideId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const assignPackageBranches = async (
    req: Request,
    res: Response
) => {

    try {
        const agencyUserId = req.tenantId as string;
        const packageId = req.params.id as string;

        const result = await assignPackageToBranchService(
            agencyUserId,
            packageId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getBranchReportController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const branchId = req.params.id as string;

        const result = await getBranchReportService(
            agencyUserId,
            branchId
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getConsolidatedFinanceController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const result = await getConsolidatedFinanceService(
            agencyUserId
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const deleteBranch = async (req: Request, res: Response) => {
    try {
        await deleteBranchService(req.tenantId as string, req.params.id as string);
        return res.status(204).send();
    } catch (err) {
        return res.status(err instanceof BranchError ? err.status : 400).json({
            success: false,
            message: err instanceof Error ? err.message : "Something went wrong",
        });
    }
};
