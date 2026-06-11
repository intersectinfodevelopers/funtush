import express from "express";
import {
  submitInquiryController,
  verifyInquiryOtpController,
} from "../controllers/booking.controller.js";

const router = express.Router();

// POST /bookings/inquiry
router.post("/inquiry", submitInquiryController);

// POST /bookings/inquiry/verify-otp
router.post("/inquiry/verify-otp", verifyInquiryOtpController);

export default router;

