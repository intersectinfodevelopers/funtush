
export const checkAgencyStatus = (req: any, res: any, next: any) => {

    // From auth middleware
    const agency = req.agencyUser;

    if (agency.status === "LOCKED") {
        return res.status(403).json({
            success: false,
            message: "Account is locked. Please upgrade subscription for usage.",
        });
    }

    next();
};