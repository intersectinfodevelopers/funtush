import type { Request, Response } from "express";
import {
  submitInquiry,
  verifyInquiryOtp,
  getAgencyBookings,
  acceptBooking,
  rejectBooking,
  proposeAlternativeDate,
  confirmBooking,
  cancelBooking,
  getBookingById,
  assignGuide,
  checkInBooking,
  checkOutBooking,
  createManualBooking,
} from "../services/booking.service";

function bookingErrStatus(err: unknown): number {
  const withStatus = err as { status?: number };
  if (typeof withStatus.status === "number") return withStatus.status;
  const message = err instanceof Error ? err.message : "";
  if (message.includes("Unauthorized")) return 403;
  if (message.includes("not found")) return 404;
  return 400;
}

export const submitInquiryController = async (req: Request, res: Response) => {
  try {
    const result = await submitInquiry(req.body);
    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit inquiry";
    const status = message.includes("full") || message.includes("available") ? 409 : 400;
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
    const status = message.includes("expired") || message.includes("Incorrect") ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

export const createBookingController = async (req: Request, res: Response) => {
  try {
    const result = await createManualBooking(req.user!.agencyId!, req.body ?? {});
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create booking";
    return res.status(bookingErrStatus(err)).json({ success: false, message });
  }
};

export const getAgencyBookingsController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const page = typeof req.query.page === "string" ? parseInt(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit) : 20;
    
    const result = await getAgencyBookings(agencyId, status, page, limit);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch bookings";
    // A validation error carries an explicit status; anything else is a 500.
    const status = typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 500;
    return res.status(status).json({ success: false, message });
  }
};

export const acceptBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = await acceptBooking(id, req.user!.agencyId!);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to accept booking";
    const status = message.includes("Unauthorized") ? 403
      : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const rejectBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { reason } = req.body;
    const result = await rejectBooking(id, req.user!.agencyId!, reason);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reject booking";
    const status = message.includes("Unauthorized") ? 403
      : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const proposeDateController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { proposedDate } = req.body;
    const result = await proposeAlternativeDate(id, req.user!.agencyId!, proposedDate);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to propose date";
    const status = message.includes("Unauthorized") ? 403
      : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const confirmBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = await confirmBooking(id, req.user!.agencyId!);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to confirm booking";
    const status = message.includes("Unauthorized") ? 403 : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const cancelBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { reason } = req.body;
    const result = await cancelBooking(id, req.user!.agencyId!, reason);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel booking";
    const status = message.includes("Unauthorized") ? 403 : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const getBookingByIdController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = await getBookingById(id, req.user!.agencyId!);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch booking";
    const status = message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const assignGuideController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { guideRef } = req.body;
    const result = await assignGuide(id, req.user!.agencyId!, guideRef);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to assign guide";
    const status = message.includes("Unauthorized") ? 403 : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const checkInBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = await checkInBooking(id, req.user!.agencyId!);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check in booking";
    const status = message.includes("Unauthorized") ? 403 : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const checkOutBookingController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = await checkOutBooking(id, req.user!.agencyId!);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check out booking";
    const status = message.includes("Unauthorized") ? 403 : message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};
