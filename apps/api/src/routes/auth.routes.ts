import express from "express";
import { sendOtpEmail } from "../utils/email";
import { adminLogin, agencyLogin, getMe, logoutService, refreshTokenService, registerTrekker, requireAuth, resendOtpService, trekkerLogin, verifyOtp } from "@funtush/auth";

import { validate } from "../middleware/validate";
import { loginSchema, registerSchema, verifyOtpSchema } from "../validations/auth.validation";
import { prisma } from "@funtush/database";
import { changePassword, requestPasswordReset, resetPassword } from "../services/passwordReset.service";
import { redeemSupportHandoff } from "../services/supportHandoff.service";
import { redeemBreakGlass } from "../services/breakGlass.service";

const router = express.Router();

// platform admin login
router.post("/admin/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await adminLogin(req.body.email, req.body.password, req.ip);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid credentials";
    const status = message.includes("temporarily blocked") ? 429 : 401;
    res.status(status).json({ message });
  }
});

// tenant(agency) user login
router.post("/agency/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await agencyLogin(req.body.email, req.body.password, req.ip);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid credentials";
    const status = message.includes("temporarily blocked") ? 429 : 401;
    res.status(status).json({ message });
  }
});

// trekker login
router.post("/trekker/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await trekkerLogin(req.body.email, req.body.password, req.ip);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid credentials";
    const status = message.includes("temporarily blocked") ? 429 : 401;
    res.status(status).json({ message });
  }
});

// trekker registration
// `registerSchema` existed but was never wired in — this endpoint accepted
// any password at all (no length/complexity check, no confirmPassword
// match) until this pass. No known caller (frontend or test) sends this
// body today, so requiring `confirmPassword` is safe to add now.
router.post("/register", validate(registerSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const { user, trekker } = await registerTrekker(email, password);
    // Email the verification code right away (best effort; "Send code again" is always available).
    void resendOtpService(user.email, sendOtpEmail).catch(() => undefined);

    // Never return the User row itself: it carries passwordHash. `userId` is the trekker id — that is
    // what /auth/verify-otp expects under that name.
    res.status(201).json({ success: true, userId: trekker.id, trekkerId: trekker.id, email: user.email });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      message: "Registration failed",
    });
  }
});

// OTP verification
// `verifyOtpSchema` existed but was never wired in either — same fix.
router.post("/verify-otp", validate(verifyOtpSchema), async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const result = await verifyOtp(userId, otp);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({
      message: "OTP verification failed",
    });
  }
});

// get /auth/me - get current user info
router.get("/me", requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: getMe(req.user!),
  });
});

// refresh token
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    const result = await refreshTokenService(refreshToken);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(401).json({
      message: "Invalid refresh token",
    });
  }
});

// logout
router.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    await logoutService(refreshToken);

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      message: "Logout failed",
    });
  }
});

// resend OTP
router.post("/trekker/resend-otp", async (req, res) => {
  try {
    const result = await resendOtpService(req.body?.email, sendOtpEmail);
    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    // Only the rate-limit message is meant for the client; anything else is an
    // internal failure and must not be echoed (it used to leak raw JS errors).
    if (message.startsWith("Too many OTP requests")) {
      res.status(429).json({ message });
      return;
    }
    console.error("[resend-otp]", error);
    res.status(500).json({ message: "Request failed" });
  }
});

// Forgot / reset password. Always the same 200 for /forgot-password, whether or
// not the account exists (see passwordReset.service.ts).
router.post("/forgot-password", async (req, res) => {
  res.json(await requestPasswordReset(req.body?.email, req.ip ?? "unknown"));
});

router.post("/reset-password", async (req, res) => {
  try {
    res.json(await resetPassword(req.body?.token, req.body?.password, req.ip ?? "unknown"));
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    if (status >= 500) console.error("[account-recovery] reset failed:", error);
    res.status(status).json({ message: status >= 500 ? "Request failed" : (error as Error).message });
  }
});

// Exchanges the one-time code from an admin's "View agency dashboard" click for the support-session
// tokens. Public by design (the new tab has no session yet); single use, 60 s, rate-limited.
router.post("/support-session/exchange", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await redeemSupportHandoff(req.body?.code, req.ip ?? "unknown"));
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    if (status >= 500) console.error("[support-session/exchange]", error);
    res.status(status).json({ message: status >= 500 ? "Request failed" : (error as Error).message });
  }
});

// Signed-in password change (agency/trekker/admin alike). Not available in a support session:
// an admin acting as an agency must not be able to lock the real owner out.
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const user = req.user as { userId: string; impersonatedBy?: string };
    if (user.impersonatedBy) return res.status(403).json({ message: "Not available during a support session" });
    res.json(await changePassword(user.userId, req.body?.currentPassword, req.body?.newPassword, req.ip ?? "unknown"));
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    if (status >= 500) console.error("[account-recovery] credential change failed:", error);
    res.status(status).json({ message: status >= 500 ? "Request failed" : (error as Error).message });
  }
});

// Redeem an admin-issued break-glass recovery code (see breakGlass.service.ts).
router.post("/break-glass/redeem", async (req, res) => {
  try {
    res.json(await redeemBreakGlass(req.body?.token, req.body?.password, req.ip ?? "unknown"));
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    if (status >= 500) console.error("[break-glass/redeem]", error);
    res.status(status).json({ message: status >= 500 ? "Request failed" : (error as Error).message });
  }
});

// Register FCM token for push notifications
router.post("/fcm-token", requireAuth, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: "fcmToken is required" });
    }

    await prisma.user.update({
      where: {
        id: req.user!.userId,
      },
       data: { fcmToken },
    });

    return res.status(200).json({ success: true, message: "FCM token registered" });
  } catch (_err) {
    return res.status(500).json({ success: false, message: "Failed to register FCM token" });
  }
});

export default router;