import type { Request, Response } from "express";
import { agencySubscription, createAgency, getSubscription } from "../services/agency.service";

export const registerAcency = async (req: Request, res: Response) => {
    try {
        const newAgency = await createAgency(req.body);
        res.status(201).json({
            status: "success",
            data: newAgency
        });
    } catch (err: any) {
        res.status(err.status || 500).json({
            status: "error",
            message: err.message
        });
    }
};

export const getSubscriptionTiers = async (req: Request, res: Response) => {
    try {
        const tiers = await getSubscription();
        res.status(200).json({
            status: "success",
            data: tiers
        });
    } catch (err: any) {
        res.status(err.status || 500).json({
            status: "error",
            message: err.message
        });
    }
};

export const updateAgencySubscription = async (req: any, res: Response) => {
    try {
        const agencyId = req.agencyUser.id;
        const { tier } = req.body;

        const result = await agencySubscription(agencyId, tier);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err: unknown) {
        const error = err as { status?: number; message?: string };
        res.status(error.status ?? 500).json({
            status: "error",
            message: error.message ?? "Internal Server Error"
        });
    }
};