import type { Request, Response } from "express";
import { agencySubscription, createAgency, getSubscription, updateAgencyDomainService, updateAgencyProfileService } from "../services/agency.service";
import type { AgencyRequest, UpdateDomainBody } from "../types/auth-request";

export const registerAcency = async (req: Request, res: Response) => {
    try {
        const newAgency = await createAgency(req.body);
        res.status(201).json({
            status: "success",
            data: newAgency
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
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
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};

export const updateAgencySubscription = async (req: AgencyRequest, res: Response) => {
    try {
        const agencyId = req.agencyUser?.id;
        const { tier } = req.body;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await agencySubscription(agencyId, tier);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};


export const updateAgencyProfile = async (req: AgencyRequest, res: Response) => {

    try {
        const agencyId = req.agencyUser?.id;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const agency = req.body;

        const result = await updateAgencyProfileService(agency, agencyId);

        return res.status(200).json({
            success: true,
            data: result.data,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};


export const updateAgencyDomain = async (req: AgencyRequest, res: Response) => {
    try {
        const agencyId = req.agencyUser?.id;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const { domain }: UpdateDomainBody = req.body;

        if (!domain) {
            return res.status(400).json({
                success: false,
                message: "Domain is required",
            });
        }

        const result = await updateAgencyDomainService(agencyId, domain);

        return res.status(200).json({
            success: true,
            message: "Custom domain updated successfully",
            data: result,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};