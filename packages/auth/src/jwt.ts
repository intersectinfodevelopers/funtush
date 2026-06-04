import jwt from "jsonwebtoken";
import type { jwtPayload } from "./types";

const resolveSecret = (
  secret: string | undefined,
  envName: string
): string => {
  if (secret) {
    return secret;
  }

  const envSecret = process.env[envName];

  if (!envSecret) {
    throw new Error(`Missing JWT secret: ${envName}`);
  }

  return envSecret;
};

// generate access token with 15 minutes expiry
export const generateAccessToken = (
  payload: jwtPayload,
  secret?: string
): string => {
  return jwt.sign(payload, resolveSecret(secret, "JWT_ACCESS_SECRET"), {
    expiresIn: "15m",
  });
};

// generate refresh token with 7 days expiry
export const generateRefreshToken = (
  userId: string,
  secret?: string
): string => {
  return jwt.sign(
    { userId },
    resolveSecret(secret, "JWT_REFRESH_SECRET"),
    {
      expiresIn: "7d",
    }
  );
};

// verify access token and return the payload
export const verifyAccessToken = (
  token: string,
  secret?: string
): jwtPayload => {
  try {
    const decoded = jwt.verify(
      token,
      resolveSecret(secret, "JWT_ACCESS_SECRET")
    ) as jwt.JwtPayload;

    const payload = decoded as jwtPayload;

    // Ensure it's an object
    if (!decoded || typeof decoded === "string") {
      throw new Error("Invalid token structure");
    }

    // Validation of required fields
    if (!payload.userId || !payload.roleType || !payload.role) {
      throw new Error("Invalid token payload");
    }

    return payload as jwtPayload;
  } catch (error: any) {
    //error handling for expired and invalid tokens
    if (error?.name === "TokenExpiredError") {
      throw new Error("Token expired");
    }

    if (error?.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    }

    throw new Error("Authentication failed");
  }
};