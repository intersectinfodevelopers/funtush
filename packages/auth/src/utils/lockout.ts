import { redis } from "./redis.js";

const ATTEMPT_KEY = (email: string) => `auth:attempts:${email}`;
const LOCK_KEY = (email: string) => `auth:lock:${email}`;

const MAX_ATTEMPTS = 5;
const LOCK_DURATION = 60 * 15; 

const normalize = (e: string) => e.toLowerCase().trim();

export async function isLocked(email: string): Promise<boolean> {
  email = normalize(email);
  const value = await redis.get(LOCK_KEY(email));
  console.log("[LOCK CHECK]", email, "locked:", value === "1");
  return value === "1";
}

export async function registerFailedAttempt(email: string): Promise<number> {
  email = normalize(email);

  const attemptKey = ATTEMPT_KEY(email);
  const lockKey = LOCK_KEY(email);

  const attempts = await redis.incr(attemptKey);

  if (attempts === 1) {
    await redis.expire(attemptKey, LOCK_DURATION);
  }

  console.log("[FAILED ATTEMPT]", email, "attempts:", attempts);

  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(lockKey, "1", "EX", LOCK_DURATION);
    await redis.del(attemptKey);
    console.log("[ACCOUNT LOCKED]", email);
  }

  return attempts;
}

export async function resetAttempts(email: string): Promise<void> {
  email = normalize(email);
  await redis.del(ATTEMPT_KEY(email));
  await redis.del(LOCK_KEY(email));
  console.log("[RESET ATTEMPTS]", email);
}