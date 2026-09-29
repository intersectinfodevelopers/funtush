import type { Request, Response } from "express";
import {  assertKycSubmittable, acceptBookingService, AgencyKYCService, agencySubscription, createAgency, getAgencyDashboardService, getSubscriptionTiers, KYCStatusService, publishPackageService, updateAgencyProfileService, getAgencyProfileService, verifyAgencyRegistrationOtp } from "../services/agency.service";
import { uploadFile } from "@funtush/storage";

/**
 * `catch (err) { ... message: err }` used to be this file's error shape
 * throughout — passing the raw Error object straight into `res.json()`.
 * `JSON.stringify` on an `Error` produces `{}` (message/stack aren't
 * enumerable own properties), so every failure here silently became
 * `{ "message": {} }` on the wire — no clue what actually went wrong. This
 * pulls the real message out, and forwards a thrown error's own `.status`
 * (e.g. "Email already exists" → 409) instead of flattening every failure
 * to a 500.
 */
function errorResponse(err: unknown, fallback: string): { status: number; message: string } {
    const status = typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    const message = err instanceof Error ? err.message : fallback;
    return { status, message };
}

export const registerAgency = async (req: Request, res: Response) => {
    try {
        const newAgency = await createAgency(req.body);
        // 202: OTP sent, registration not complete yet (phone-OTP toggle is on
        // via PATCH /admin/settings). 201: the existing "created immediately"
        // behavior, unchanged when the toggle is off.
        const status = "otpRequired" in newAgency && newAgency.otpRequired ? 202 : 201;
        res.status(status).json({
            status: "success",
            data: newAgency,
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to register agency");
        res.status(status).json({ status: "error", message });
    }
};

export const verifyAgencyRegistrationOtpController = async (req: Request, res: Response) => {
    try {
        const { sessionToken, otp } = req.body ?? {};
        if (typeof sessionToken !== "string" || typeof otp !== "string" || !sessionToken || !otp) {
            res.status(400).json({ status: "error", message: "sessionToken and otp are required" });
            return;
        }
        const result = await verifyAgencyRegistrationOtp(sessionToken, otp);
        res.status(201).json({ status: "success", data: result });
    } catch (err) {
        const message = err instanceof Error ? err.message : "OTP verification failed";
        const status = typeof (err as { status?: number })?.status === "number"
            ? (err as { status: number }).status
            : message.includes("expired") || message.includes("Incorrect")
                ? 400
                : 500;
        res.status(status).json({ status: "error", message });
    }
};

export const SubscriptionTiers = async (req: Request, res: Response) => {
    try {
        const tiers = await getSubscriptionTiers();
        res.status(200).json({
            status: "success",
            data: tiers
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to load subscription tiers");
        res.status(status).json({ status: "error", message });
    }
};

export const getAgencyDashboard = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;

        if (!agencyId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const dashboard = await getAgencyDashboardService(agencyId);

        return res.status(200).json({
            success: true,
            data: dashboard,
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to load agency dashboard");
        return res.status(status).json({ success: false, message });
    }
};

export const acceptBooking = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;
        // const bookingId = req.params.bookingId;

        // if (!bookingId || Array.isArray(bookingId)) {
        //     throw new Error("Invalid bookingId");
        // }

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await acceptBookingService(
            agencyId,
            // bookingId
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to accept booking");
        return res.status(status).json({ success: false, message });
    }
};


export const publishPackage = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;
        // const packageId = req.params.packageId;

        // if (!packageId || Array.isArray(packageId)) {
        //     throw new Error("Invalid packageId");
        // }

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await publishPackageService(
            agencyId,
            // packageId
        );

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to publish package");
        return res.status(status).json({ success: false, message });
    }
};


export const updateAgencySubscription = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
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
        const { status, message } = errorResponse(err, "Failed to update subscription");
        res.status(status).json({ status: "error", message });
    }
};


export const getAgencyProfile = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;
        if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
        return res.status(200).json({ success: true, data: await getAgencyProfileService(agencyId) });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to load agency profile");
        res.status(status).json({ success: false, message });
    }
};

export const updateAgencyProfile = async (req: Request, res: Response) => {

    try {
        const agencyId = req.agencyId as string;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await updateAgencyProfileService(req.body, agencyId);

        return res.status(200).json({
            success: true,
            data: result.data,
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to update agency profile");
        res.status(status).json({ success: false, status: "error", message });
    }
};


export const agencyKYCSubmission = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

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

        await assertKycSubmittable(agencyId);

        /** FOR SIMULTANEOUS UPLOAD OF FILES */
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
        const { status, message } = errorResponse(err, "Failed to submit KYC documents");
        res.status(status).json({ status: "error", message });
    }

};



export const agencyKYCStatus = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId as string;

        if (!agencyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const result = await KYCStatusService(agencyId);

        res.status(200).json({
            status: "success",
            data: result
        });
    } catch (err) {
        const { status, message } = errorResponse(err, "Failed to load KYC status");
        res.status(status).json({ status: "error", message });
    }
};