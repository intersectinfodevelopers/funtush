import { redis } from "./redis.js";

const ATTEMPT_KEY = (email: string) => `auth:attempts:${email}`;
const LOCK_KEY = (email: string) => `auth:lock:${email}`;

const MAX_ATTEMPTS = 5;
const LOCK_TIME = 60 * 15;

// check if the email is currently locked
export async function isLocked(email: string) {
    const locked = await redis.get(LOCK_KEY(email));
    return locked === "1";
}

// register failed login attemptand lock if max attempts exceeded
export async function registerFailedAttempt(email: string) {
    const key = ATTEMPT_KEY(email);

    const attempts = await redis.incr(key);

    // set expiry ONLY for attempts counter 
    if (attempts === 1) {
        await redis.expire(key, LOCK_TIME);
    }

    // lock the email if max attempts exceeded
    if (attempts >= MAX_ATTEMPTS) {
        await redis.set(LOCK_KEY(email), "1", "EX", LOCK_TIME);
    }

    return attempts;
}

// reset attempts after succesful login
export async function resetAttempts(email: string) {
    await redis.del(ATTEMPT_KEY(email));
    await redis.del(LOCK_KEY(email));
}