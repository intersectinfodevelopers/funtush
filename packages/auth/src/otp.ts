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

// verify otp and delete after success
export const verifyOTP = async (
  email: string,
  otp: string
): Promise<boolean> => {
  const redis = await getRedis();

  const stored = await redis.get(`otp:${email.trim().toLowerCase()}`);

  if (!stored) return false;

  const valid = stored === otp;

  if (valid) {
    await redis.del(`otp:${email.trim().toLowerCase()}`);
  }

  return valid;
};