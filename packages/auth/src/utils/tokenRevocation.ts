import jwt from "jsonwebtoken";
import { redis } from "./redis";
import { hashToken } from "./hashToken";

const key = (token: string) => `revoked-rt:${hashToken(token)}`;

/**
 * A refresh token is a signed JWT valid for 7 days. Deleting its row from the
 * refresh_tokens table (logout / rotation) only stops it from being *exchanged*
 * at POST /auth/refresh — the JWT itself still verifies, and the agency API
 * accepts it directly in the `x-refresh-token` header. So a stolen token kept
 * full API access until it expired, even after the user logged out.
 *
 * Revoking records the token's hash in Redis for exactly its remaining lifetime,
 * and authenticateWithRefreshToken refuses anything on that list.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const ttl = decoded?.exp ? Math.max(1, decoded.exp - Math.floor(Date.now() / 1000)) : 7 * 24 * 60 * 60;
  await redis.set(key(token), "1", "EX", ttl);
}

/** Fails open if Redis is unreachable (availability over a revocation check; the JWT signature still applies). */
export async function isRefreshTokenRevoked(token: string): Promise<boolean> {
  try {
    return (await redis.exists(key(token))) === 1;
  } catch {
    return false;
  }
}

const userKey = (userId: string) => `revoked-user:${userId}`;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Invalidates every refresh token the user already holds — after a password
 * reset or break-glass recovery. Deleting the `refresh_tokens` rows is not
 * enough on its own: the agency API accepts the signed JWT directly, so a
 * thief's copy would keep working for up to 7 days. Records "nothing issued
 * before now is valid" for the token lifetime.
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await redis.set(userKey(userId), String(Math.floor(Date.now() / 1000)), "EX", REFRESH_TOKEN_MAX_AGE_SECONDS);
}

/** True when the token was issued before the user's last revoke-all. Fails open if Redis is down. */
export async function isUserSessionRevoked(userId: string, issuedAt: number | undefined): Promise<boolean> {
  try {
    const at = await redis.get(userKey(userId));
    if (!at) return false;
    // iat has 1s resolution: a token minted in the same second as the revoke is
    // treated as revoked, which errs on the safe side.
    return typeof issuedAt !== "number" || issuedAt <= Number(at);
  } catch {
    return false;
  }
}
