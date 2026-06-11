import type { Request, Response } from "express";
import { submitInquiry, verifyInquiryOtp } from "../services/booking.service.js";

export const submitInquiryController = async (req: Request, res: Response) => {
  try {
    const result = await submitInquiry(req.body);
    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit inquiry";
    const status  = message.includes("full") || message.includes("available") ? 409 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const verifyInquiryOtpController = async (req: Request, res: Response) => {
  try {
    const { sessionToken, otp } = req.body;

    if (!sessionToken || !otp) {
      return res.status(400).json({ success: false, message: "sessionToken and otp are required" });
    }

    const result = await verifyInquiryOtp(sessionToken, otp);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OTP verification failed";
    const status  = message.includes("expired") || message.includes("Incorrect") ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

