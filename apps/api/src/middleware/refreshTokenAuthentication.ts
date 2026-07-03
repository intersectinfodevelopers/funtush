import { Request, Response, NextFunction } from "express";
import { db } from "@funtush/database";
import bcrypt from "bcrypt";

// Middleware to authenticate via refresh token -> from registration
export const authenticateWithRefreshToken = async (req: Request, res: Response, next: NextFunction) => {
    try {

        const refreshToken = req.headers['x-refresh-token'] as string;

        if (!refreshToken) {
            return res.status(401).json({ message: "Refresh token is required" });
        }

        const tokens = await db.refreshToken.findMany();

        for (const t of tokens) {
            const isValid = await bcrypt.compare(
                refreshToken,
                t.tokenHash
            );

            if (isValid) {
                // Look up the user by userId from token
                const agencyUser = await db.agencyUser.findFirst({
                    where: {
                        userId: t.userId,
                    },
                });

                if (!agencyUser) {
                    return res.status(401).json({ message: "User not found" });
                }

                // Attach only the user ID to the request
                req.agencyId = agencyUser.agencyId ?? undefined;
                // req.user = {
                //     userId: t.userId,
                //     role: "STAFF",
                //     roleType: "TENANT"
                // };
                req.tenantId = agencyUser.id;

                if (!agencyUser.agencyId) {
                    return res.status(401).json({ message: "Agency not linked" });
                }

                return next();
            }
        }

        return res.status(401).json({ message: "Invalid refresh token" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
    }
};