import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@funtush/database";
import { jwtPayload, isRefreshTokenRevoked, isUserSessionRevoked } from "@funtush/auth";
import { cacheGet } from "../services/redis.service";
import { loadStaffAccess, staffDecision } from "../services/staffAccess.service";
import { IMPERSONATION_ACTIVE_PREFIX } from "../services/adminAgency.service";

export const authenticateWithRefreshToken = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const refreshToken = req.headers["x-refresh-token"] as string;

        if (!refreshToken) {
            return res.status(401).json({
                message: "Refresh token is required",
            });
        }

        // Verify JWT refresh token
        let decoded: jwtPayload;

        try {
            decoded = jwt.verify(
                refreshToken,
                process.env.JWT_REFRESH_SECRET as string
            ) as jwtPayload;
        } catch {
            return res.status(401).json({
                message: "Invalid or expired refresh token",
            });
        }

        if (!decoded.userId) {
            return res.status(401).json({
                message: "Invalid refresh token",
            });
        }

        // A logged-out / rotated-out refresh token is still a validly SIGNED JWT
        // until it expires, so revocation has to be checked explicitly — otherwise
        // a stolen token keeps full API access for 7 days regardless of logout.
        // (Impersonation tokens aren't stored server-side; their session pointer
        // is checked further down.)
        if (!decoded.impersonatedBy && (await isRefreshTokenRevoked(refreshToken))) {
            return res.status(401).json({
                message: "Invalid or expired refresh token",
            });
        }

        // A password reset / break-glass recovery revokes everything issued
        // before it, for every token the user holds (not just one).
        if (!decoded.impersonatedBy && (await isUserSessionRevoked(decoded.userId, (decoded as { iat?: number }).iat))) {
            return res.status(401).json({
                message: "Invalid or expired refresh token",
            });
        }

        // Find the agency user
        const agencyUser = await db.agencyUser.findFirst({
            where: {
                userId: decoded.userId,
            },
            select: {
                id: true,
                userId: true,
                agencyId: true,
                role: true,
            },
        });

        if (!agencyUser) {
            return res.status(401).json({
                message: "Agency user not found",
            });
        }

        if (!agencyUser.agencyId) {
            return res.status(401).json({
                message: "Agency not linked",
            });
        }

        // An impersonation session (see adminAgency.service.ts::impersonateAgency)
        // can be revoked before its natural 1-hour expiry — the token itself
        // stays cryptographically valid, so revocation has to be checked here,
        // against the pointer impersonateAgency/revokeImpersonation maintain.
        if (decoded.impersonatedBy) {
            const active = await cacheGet<{ sessionId: string }>(
                `${IMPERSONATION_ACTIVE_PREFIX}${agencyUser.agencyId}`
            );
            if (!active || active.sessionId !== decoded.impersonationSessionId) {
                return res.status(401).json({
                    message: "This support session has ended.",
                });
            }
        }

        // Invited staff (anyone who is not the owner) get only what their role grants — decided per request,
        // default-deny (see staffAccess.service.ts). The owner is never checked.
        if (agencyUser.role !== "AGENCY_ADMIN") {
            const denied = staffDecision(await loadStaffAccess(agencyUser.id, agencyUser.agencyId), req.originalUrl.split("?")[0]);
            if (denied) return res.status(denied.status).json({ message: denied.message });
        }

        // Attach authenticated information
        req.tenantId = agencyUser.id;
        req.agencyId = agencyUser.agencyId;

        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            roleType: decoded.roleType,
            agencyId: agencyUser.agencyId,
            ...(decoded.impersonatedBy
                ? { impersonatedBy: decoded.impersonatedBy, impersonationSessionId: decoded.impersonationSessionId }
                : {}),
        };

        return next();

    } catch (error) {
        console.error("Refresh token authentication error:", error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
};







// import { Request, Response, NextFunction } from "express";
// import { db } from "@funtush/database";
// import bcrypt from "bcrypt";

// // Middleware to authenticate via refresh token -> from registration
// export const authenticateWithRefreshToken = async (req: Request, res: Response, next: NextFunction) => {
//     try {

//         console.log("Authentication middleware called");
//         console.log(req.headers["x-refresh-token"]);

//         const refreshToken = req.headers['x-refresh-token'] as string;

//         if (!refreshToken) {
//             return res.status(401).json({ message: "Refresh token is required" });
//         }

//         const tokens = await db.refreshToken.findMany();

//         for (const t of tokens) {
//             const isValid = await bcrypt.compare(
//                 refreshToken,
//                 t.tokenHash
//             );

//             if (isValid) {
//                 // Look up the user by userId from token

//                 const agencyUser = await db.agencyUser.findFirst({
//                     where: {
//                         userId: t.userId,
//                     },
//                 });
//                 console.log("Agency user:", agencyUser);

//                 if (!agencyUser) {
//                     return res.status(401).json({ message: "User not found" });
//                 }

//                 // Attach only the user ID to the request
//                 req.agencyId = agencyUser.agencyId ?? undefined;
//                 req.user = {
//                     userId: t.userId,
//                     role: "STAFF",
//                     roleType: "TENANT"
//                 };
//                 req.tenantId = agencyUser.id;

//                 if (!agencyUser.agencyId) {
//                     return res.status(401).json({ message: "Agency not linked" });
//                 }

//                 console.log("Setting agencyId:", agencyUser.agencyId);
//                 console.log("Calling next()");
                

//                 return next();
//             }
//         }

//         return res.status(401).json({ message: "Invalid refresh token" });
//     } catch (error) {
//         console.error(error);
//         return res.status(500).json({ message: "Internal server error" });
//     }
// };











