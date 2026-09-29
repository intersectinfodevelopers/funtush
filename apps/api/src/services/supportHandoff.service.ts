import crypto from "node:crypto";
import { redis } from "../lib/redis";
import { httpError } from "../utils/httpError";

/**
 * Support-session hand-off.
 *
 * When a platform admin opens an agency's real dashboard in a new tab, the tokens must reach that tab
 * without ever appearing in a URL (history, logs, Referer headers). Instead the admin app receives a
 * short-lived, single-use CODE; the new tab exchanges it once, over a POST body, for the tokens.
 *
 * Only a hash of the code is stored, the tokens live in Redis for 60 seconds, and redemption is an
 * atomic GETDEL — a second attempt (or a replay) gets nothing.
 */
const KEY = "support-handoff:";
const HANDOFF_TTL_SECONDS = 60;

export interface SupportHandoffPayload {
  accessToken: string;
  refreshToken: string;
  agencyId: string;
  agencyName: string;
  impersonatedEmail: string;
  expiresAt: string;
}

const hash = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

export async function createSupportHandoff(payload: SupportHandoffPayload): Promise<string> {
  const code = crypto.randomBytes(32).toString("hex");
  await redis.set(`${KEY}${hash(code)}`, JSON.stringify(payload), "EX", HANDOFF_TTL_SECONDS);
  return code;
}

export async function redeemSupportHandoff(code: unknown, ip: string): Promise<SupportHandoffPayload> {
  // Codes are 256-bit random, so guessing is hopeless — this only stops a client hammering the endpoint.
  const bucket = `${KEY}rl:${ip}`;
  const n = await redis.incr(bucket);
  if (n === 1) await redis.expire(bucket, 60);
  if (n > 30) throw httpError(429, "Too many attempts. Try again shortly.");

  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) throw httpError(400, "Invalid or expired support link");
  const raw = await redis.getdel(`${KEY}${hash(code)}`);
  if (!raw) throw httpError(400, "Invalid or expired support link");
  return JSON.parse(raw) as SupportHandoffPayload;
}
