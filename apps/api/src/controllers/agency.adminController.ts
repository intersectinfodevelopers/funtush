import type { Request, Response } from "express";
import { approveAgencyKYCService, rejectAgencyKYCService } from "../services/admin.service";

export const approveAgencyKYC = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.params?.id;

        if (Array.isArray(agencyId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid agency id",
            });
        }

        const result = await approveAgencyKYCService(
            agencyId
        );

        return res.status(200).json({
            status: "success",
            data: result,
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: error
        });
    }
};



export const rejectAgencyKYC = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.params.id;
        const { reason } = req.body;

        if (Array.isArray(agencyId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid agency id",
            });
        }

        if (!reason) {
            return res.status(400).json({
                status: "error",
                message: "Rejection reason is required",
            });
        }

        const result = await rejectAgencyKYCService(
            agencyId,
            reason
        );

        return res.status(200).json({
            status: "success",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            status: "error",
            message: error
        });
    }
};



