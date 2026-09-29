import { getRedis } from "@funtush/shared";
import crypto from "crypto";

// generate a 6 digit OTP
export const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// store OTP in Redis with a TTL of 15 minutes
export const storeOTP = async (email: string, otp: string): Promise<void> => {
  const redis = await getRedis();

  await redis.set(`otp:${email.trim().toLowerCase()}`, otp, {
    EX: 60 * 15,
  });
};

const MAX_OTP_ATTEMPTS = 5;

// verify otp and delete after success. A 6-digit code has 1M values, so guesses
// are capped: after MAX_OTP_ATTEMPTS wrong tries the code is destroyed and a new
// one must be requested (which is itself rate limited).
export const verifyOTP = async (
  email: string,
  otp: string
): Promise<boolean> => {
  const redis = await getRedis();
  const normalized = email.trim().toLowerCase();

  const attempts = await redis.incr(`otp-attempts:${normalized}`);
  if (attempts === 1) await redis.expire(`otp-attempts:${normalized}`, 15 * 60);
  if (attempts > MAX_OTP_ATTEMPTS) {
    await redis.del(`otp:${normalized}`);
    return false;
  }

  const stored = await redis.get(`otp:${normalized}`);

  if (!stored) return false;

  const valid = stored === otp;

  if (valid) {
    await redis.del(`otp:${normalized}`);
    await redis.del(`otp-attempts:${normalized}`);
  }

  return valid;
};
