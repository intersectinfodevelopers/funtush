import { redis } from "./redis.js";

const OTP_KEY = (email: string) => `auth:otp_resend:${email}`;

const MAX_REQUESTS = 3;
const WINDOW_SECONDS = 60 * 60;

export async function checkOtpRateLimit(email: string) {
  const key = OTP_KEY(email);

  const current = await redis.incr(key);

  // first request → set expiry
  if (current === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  if (current > MAX_REQUESTS) {
    const ttl = await redis.ttl(key);

    return {
      allowed: false,
      retryAfter: ttl,
    };
  }

  return {
    allowed: true,
    remaining: MAX_REQUESTS - current,
  };
}

export async function resetOtpRateLimit(email: string) {
  await redis.del(OTP_KEY(email));
}