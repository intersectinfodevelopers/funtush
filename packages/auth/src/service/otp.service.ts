import { prisma } from "@funtush/database";
import { verifyOTP } from "../otp";

export async function verifyOtp(userId: string, otp: string) {
  const db = prisma as typeof prisma & { trekker: any };

  const user = await db.trekker.findUnique({ where: { id: userId } });

  if (!user) {
    throw new Error("Invalid OTP");
  }

  const valid = await verifyOTP(user.email, otp);

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