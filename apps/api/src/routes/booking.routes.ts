import express from "express";
import {
  submitInquiryController,
  verifyInquiryOtpController,
  getAgencyBookingsController,
  acceptBookingController,
  rejectBookingController,
  proposeDateController,
  confirmBookingController,
  cancelBookingController,
  getBookingByIdController,
  assignGuideController,
  checkInBookingController,
  checkOutBookingController,
  createBookingController,
} from "../controllers/booking.controller";
import { requireAuth, requireRole } from "@funtush/auth";

const router = express.Router();

// Public — trekker inquiry

// /bookings/inquiry
router.post("/inquiry", submitInquiryController);
// /bookings/inquiry/verify-otp
router.post("/inquiry/verify-otp", verifyInquiryOtpController);

// Agency — protected

/**
 * @openapi
 * /bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: "Agency: create a booking manually (phone / walk-in — bypasses OTP)"
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId, groupSize, trekkerName, trekkerEmail, trekkerPhone]
 *             properties:
 *               packageId: { type: string }
 *               departureDateId: { type: string }
 *               departureDate: { type: string, format: date, description: "Alternative to departureDateId" }
 *               groupSize: { type: integer, minimum: 1 }
 *               trekkerName: { type: string }
 *               trekkerEmail: { type: string }
 *               trekkerPhone: { type: string }
 *               trekkerCountry: { type: string }
 *               trekkerId: { type: string }
 *               specialRequests: { type: string }
 *               guideRef: { type: string, nullable: true }
 *               totalPrice: { type: number, description: "Override; otherwise computed" }
 *               status: { type: string, enum: [INQUIRY, CONFIRMED], default: CONFIRMED }
 *               addOns:
 *                 type: array
 *                 items: { type: object, properties: { addOnId: { type: string }, quantity: { type: integer } } }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation failed }
 *       404: { description: Package not found }
 *       409: { description: Departure full }
 */

// /agencies/me/bookings
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), createBookingController);
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), getAgencyBookingsController);
// /agencies/me/bookings/:id
router.get("/:id", requireAuth, requireRole(["AGENCY_ADMIN"]), getBookingByIdController);
// /agencies/me/bookings/:id/accept
router.patch("/:id/accept", requireAuth, requireRole(["AGENCY_ADMIN"]), acceptBookingController);
// /agencies/me/bookings/:id/reject
router.patch("/:id/reject", requireAuth, requireRole(["AGENCY_ADMIN"]), rejectBookingController);
// /agencies/me/bookings/:id/propose-date
router.patch("/:id/propose-date", requireAuth, requireRole(["AGENCY_ADMIN"]), proposeDateController);
// /agencies/me/bookings/:id/confirm
router.patch("/:id/confirm", requireAuth, requireRole(["AGENCY_ADMIN"]), confirmBookingController);
// /agencies/me/bookings/:id/cancel
router.patch("/:id/cancel", requireAuth, requireRole(["AGENCY_ADMIN"]), cancelBookingController);
// /agencies/me/bookings/:id/assign-guide
router.patch("/:id/assign-guide", requireAuth, requireRole(["AGENCY_ADMIN"]), assignGuideController);
// /agencies/me/bookings/:id/check-in
router.patch("/:id/check-in", requireAuth, requireRole(["AGENCY_ADMIN"]), checkInBookingController);
// /agencies/me/bookings/:id/check-out
router.patch("/:id/check-out", requireAuth, requireRole(["AGENCY_ADMIN"]), checkOutBookingController);

export default router;
