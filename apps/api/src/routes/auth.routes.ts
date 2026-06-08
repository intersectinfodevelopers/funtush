import express from "express";
import { adminLogin, agencyLogin, getMe, logoutService, refreshTokenService, registerTrekker, requireAuth, resendOtpService, trekkerLogin, verifyOtp } from "@funtush/auth";

import { validate } from "../middlewares/validate.js";
import { loginSchema } from "../validations/auth.validation.js";

const router = express.Router();

// platform admin login
router.post("/admin/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await adminLogin(req.body.email, req.body.password);
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
    const result = await agencyLogin(req.body.email, req.body.password);
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
    const result = await trekkerLogin(req.body.email, req.body.password);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid credentials";
    const status = message.includes("temporarily blocked") ? 429 : 401;
    res.status(status).json({ message });
  }
});

// trekker registration
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await registerTrekker(email, password);

    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({
      message: "Registration failed",
    });
  }
});

// OTP verification
router.post("/verify-otp", async (req, res) => {
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
    user: getMe(req.user),
  });
});

export default router;

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
    const { email } = req.body;

    const result = await resendOtpService(email);

    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    res.status(500).json({
      message: "Request failed",
      error: message,
    });
  }
});