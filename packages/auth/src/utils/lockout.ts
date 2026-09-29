import { redis } from "./redis";

const ATTEMPT_KEY = (email: string) => `auth:attempts:${email}`;
const LOCK_KEY = (email: string) => `auth:lock:${email}`;

const MAX_ATTEMPTS = 5;
const LOCK_DURATION = 60 * 15; 

const normalize = (e: string) => e.toLowerCase().trim();

// Accounts are locked per (email, client IP), not per email alone. With an
// email-only lock, anyone could lock any user — including the super-admin — out
// for 15 minutes, repeatedly, just by submitting five wrong passwords for their
// address. Now the attacker only locks *themselves* out (their IP); the real
// owner logging in from elsewhere is unaffected. A much higher email-wide
// ceiling (across all IPs) still stops a distributed guessing attack.
const MAX_ATTEMPTS_ANY_IP = 25;
const pairId = (email: string, ip: string) => `${email}|${ip}`;

export async function isLocked(email: string, ip?: string): Promise<boolean> {
  email = normalize(email);
  const keys = [LOCK_KEY(email)];
  if (ip) keys.push(LOCK_KEY(pairId(email, ip)));
  const values = await Promise.all(keys.map((k) => redis.get(k)));
  return values.some((v) => v === "1");
}

async function bump(id: string, max: number): Promise<number> {
  const attempts = await redis.incr(ATTEMPT_KEY(id));
  if (attempts === 1) await redis.expire(ATTEMPT_KEY(id), LOCK_DURATION);
  if (attempts >= max) {
    await redis.set(LOCK_KEY(id), "1", "EX", LOCK_DURATION);
    await redis.del(ATTEMPT_KEY(id));
    console.log("[ACCOUNT LOCKED]", id);
  }
  return attempts;
}

export async function registerFailedAttempt(email: string, ip?: string): Promise<number> {
  email = normalize(email);
  if (!ip) return bump(email, MAX_ATTEMPTS); // legacy callers with no client IP
  const perIp = await bump(pairId(email, ip), MAX_ATTEMPTS);
  await bump(email, MAX_ATTEMPTS_ANY_IP);
  return perIp;
}

export async function resetAttempts(email: string, ip?: string): Promise<void> {
  email = normalize(email);
  if (ip) {
    await redis.del(ATTEMPT_KEY(pairId(email, ip)));
    await redis.del(LOCK_KEY(pairId(email, ip)));
  }
  await redis.del(ATTEMPT_KEY(email));
  if (!ip) await redis.del(LOCK_KEY(email));
}
