import express from "express";
import { adminLogin, agencyLogin, registerTrekker, trekkerLogin, verifyOtp } from "@funtush/auth";

import { validate } from "../middlewares/validate";
import { loginSchema } from "../validations/auth.validation";

const router = express.Router();

// platform admin login
router.post("/admin/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await adminLogin(req.body.email, req.body.password);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Invalid credentials" });
  }
});


// tenant(agency) user login
router.post("/agency/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await agencyLogin(req.body.email, req.body.password);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Invalid credentials" });
  }
});


// trekker login
router.post("/trekker/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await trekkerLogin(req.body.email, req.body.password);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Invalid credentials" });
  }
});


// trekker registration
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await registerTrekker(email, password);

    res.status(201).json(result);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({
      message: error.message || "Registration failed",
    });
  }
});


// OTP verification
router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const result = await verifyOtp(userId, otp);

    res.json(result);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({
      message: error.message || "OTP verification failed",
    });
  }
});

export default router;