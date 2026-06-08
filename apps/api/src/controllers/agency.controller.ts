import type { Request, Response } from "express";
import { AgencyKYCService, agencySubscription, createAgency, getSubscription, updateAgencyDomainService, updateAgencyProfileService } from "../services/agency.service";
import type { AgencyRequest, UpdateDomainBody } from "../types/auth-request";
import { uploadFile } from "@funtush/storage";

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


export const agencyKYCSubmission = async (req: AgencyRequest, res: Response) => {
    try {
        const agencyId = req.agencyUser?.id;

        if (!agencyId) {
            return res.status(401).json({
                status: "error",
                message: "Unauthorized",
            });
        }

        const files = req.files as {
            [fieldname: string]: Express.Multer.File[];
        };

        if (!files || Object.keys(files).length === 0) {
            return res.status(400).json({
                status: "error",
                message: "Documents are required",
            });
        }

        const {
            business_registration,
            pan_certificate,
            tourism_license,
            bank_details,
        } = files;

        const businessRegistration = business_registration?.[0];
        const panCertificate = pan_certificate?.[0];
        const tourismLicense = tourism_license?.[0];
        const bankDetails = bank_details?.[0];

        if (
            !businessRegistration ||
            !panCertificate ||
            !tourismLicense ||
            !bankDetails
        ) {
            return res.status(400).json({
                status: "error",
                message:
                    "business_registration, pan_certificate, tourism_license and bank_details are all required",
            });
        }

        /** FOR SIMULTANEOUS UPLOAD OF FILES*/
        const [
            businessRegistrationUrl,
            panCertificateUrl,
            tourismLicenseUrl,
            bankDetailsUrl,
        ] = await Promise.all([
            uploadFile(businessRegistration),
            uploadFile(panCertificate),
            uploadFile(tourismLicense),
            uploadFile(bankDetails),
        ]);

        const result = await AgencyKYCService(agencyId, {
            business_registration: businessRegistrationUrl,
            pan_certificate: panCertificateUrl,
            tourism_license: tourismLicenseUrl,
            bank_details: bankDetailsUrl,
        });

        return res.status(200).json({
            status: "success",
            data: result,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }

};
