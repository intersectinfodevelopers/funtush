import { prisma } from "@funtush/database";
import { verifyOTP } from "../otp.js";

export async function verifyOtp(userId: string, otp: string) {
  const db = prisma;

  const trekker = await prisma.trekker.findUnique({
    where: { id: userId },
    include: {
      user: true,
    },
  });

  if (!trekker || !trekker.user) {
    throw new Error("Invalid OTP");
  }

  const valid = await verifyOTP(trekker.user.email, otp);

  if (!valid) {
    throw new Error("Invalid OTP");
  }

  await db.trekker.update({
    where: { id: userId },
    data: {
      isEmailVerified: true,
    },
  });
}