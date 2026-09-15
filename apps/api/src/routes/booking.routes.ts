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

/**
 * @openapi
 * /bookings/inquiry/verify-otp:
 *   post:
 *     tags: [Bookings]
 *     summary: Verify the OTP sent by POST /bookings/inquiry and create the real INQUIRY booking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [sessionToken, otp], properties: { sessionToken: { type: string }, otp: { type: string, minLength: 6, maxLength: 6 } } }
 *     responses:
 *       201: { description: Booking created }
 *       400: { description: sessionToken/otp missing, expired, or incorrect }
 */
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
/**
 * @openapi
 * /bookings/{id}:
 *   get: { tags: [Bookings], summary: Get one of the agency's bookings, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Booking }, 404: { description: Not found } } }
 * /bookings/{id}/reject:
 *   patch: { tags: [Bookings], summary: Reject an INQUIRY booking with a reason, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Rejected }, 400: { description: Reason required, or not in INQUIRY state } } }
 * /bookings/{id}/propose-date:
 *   patch: { tags: [Bookings], summary: Propose an alternative departure date for an INQUIRY booking, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 400: { description: proposedDate required, or not in INQUIRY state } } }
 * /bookings/{id}/confirm:
 *   patch: { tags: [Bookings], summary: Confirm a PAID booking, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Confirmed }, 400: { description: Not in PAID state } } }
 * /bookings/{id}/cancel:
 *   patch: { tags: [Bookings], summary: Cancel a booking (from PAYMENT_PENDING/PAID/CONFIRMED/ACTIVE) and release its slots, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Cancelled }, 400: { description: Reason required, or not in a cancellable state } } }
 * /bookings/{id}/assign-guide:
 *   patch: { tags: [Bookings], summary: Assign a guide to a booking, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Assigned }, 404: { description: Booking or guide not found } } }
 * /bookings/{id}/check-in:
 *   patch: { tags: [Bookings], summary: Check in a booking (trek start), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Checked in }, 400: { description: Not in a checkable-in state } } }
 * /bookings/{id}/check-out:
 *   patch: { tags: [Bookings], summary: Check out a booking (trek complete), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Checked out }, 400: { description: Not in a checkable-out state } } }
 */
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
