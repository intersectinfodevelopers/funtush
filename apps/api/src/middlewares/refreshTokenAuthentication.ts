import { Request, Response, NextFunction } from "express";
import { db } from "@funtush/database";
import bcrypt from "bcrypt";

interface AuthenticatedRequest extends Request {
  agencyId?: string;
}

// Middleware to authenticate via refresh token
export const authenticateWithRefreshToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
                const user = await db.agencyUser.findUnique({
                    where: { id: t.userId },
                });

                if (!user) {
                    return res.status(401).json({ message: "User not found" });
                }

                // Attach only the user ID to the request
                req.agencyId = user.agencyId ?? undefined;

                return next();
            }
        }

        return res.status(401).json({ message: "Invalid refresh token" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
    }
};