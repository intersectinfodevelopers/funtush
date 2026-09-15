import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";
import { createPackage, updatePackage, listPackages, publishPackage,
         duplicatePackage, archivePackage } from "../controllers/package.controller.js";
import { addItineraryDay, updateItineraryDay, deleteItineraryDay,
         reorderItinerary } from "../controllers/itinerary.controller.js";
import { addDepartureDate, updateDepartureDate,
         deleteDepartureDate } from "../controllers/departureDate.controller.js";
import { listPackageAddOns, createPackageAddOn, updatePackageAddOn,
         deletePackageAddOn } from "../controllers/packageAddOn.controller.js";

const router = express.Router();

router.route("/agencies/packages")
  .post(authenticateWithRefreshToken, createPackage)
  .get(authenticateWithRefreshToken, listPackages);

router.route("/agencies/packages/:id")
  .patch(authenticateWithRefreshToken, updatePackage)
  .delete(authenticateWithRefreshToken, archivePackage);

router.route("/agencies/packages/:id/publish")
  .post(authenticateWithRefreshToken, publishPackage);

/**
 * @openapi
 * /agencies/packages/{id}/duplicate:
 *   post: { tags: [Packages], summary: Duplicate a package (as a new DRAFT, no departure dates copied), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Duplicated }, 404: { description: Not found } } }
 */
router.route("/agencies/packages/:id/duplicate")
  .post(authenticateWithRefreshToken, duplicatePackage);

// ── Day 3: Itinerary Builder ─────────────────────────────────────────
// `/reorder` is declared BEFORE `/:day` so Express doesn't capture the literal
// string "reorder" as a day_number.
/**
 * @openapi
 * /agencies/packages/{id}/itinerary:
 *   post: { tags: [Packages], summary: Add an itinerary day, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Added } } }
 * /agencies/packages/{id}/itinerary/reorder:
 *   patch: { tags: [Packages], summary: Reorder itinerary days, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Reordered } } }
 * /agencies/packages/{id}/itinerary/{day}:
 *   put: { tags: [Packages], summary: Replace one itinerary day, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: day, in: path, required: true, schema: { type: integer } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Packages], summary: Delete one itinerary day, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: day, in: path, required: true, schema: { type: integer } }], responses: { 204: { description: Deleted } } }
 */
router.route("/agencies/packages/:id/itinerary")
  .post(authenticateWithRefreshToken, addItineraryDay);

router.route("/agencies/packages/:id/itinerary/reorder")
  .patch(authenticateWithRefreshToken, reorderItinerary);

router.route("/agencies/packages/:id/itinerary/:day")
  .put(authenticateWithRefreshToken, updateItineraryDay)
  .delete(authenticateWithRefreshToken, deleteItineraryDay);

/**
 * @openapi
 * /agencies/packages/{id}/dates:
 *   post: { tags: [Packages], summary: Add a departure date, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Added } } }
 * /agencies/packages/{id}/dates/{dateId}:
 *   patch: { tags: [Packages], summary: Update a departure date (capacity, status), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: dateId, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Packages], summary: Delete a departure date (blocked if it has bookings), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: dateId, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 409: { description: Has bookings } } }
 */
// ── Day 4: Departure Dates ───────────────────────────────────────────
router.route("/agencies/packages/:id/dates")
  .post(authenticateWithRefreshToken, addDepartureDate);

router.route("/agencies/packages/:id/dates/:dateId")
  .patch(authenticateWithRefreshToken, updateDepartureDate)
  .delete(authenticateWithRefreshToken, deleteDepartureDate);

// ── Phase 2: Package add-ons ─────────────────────────────────────────
/**
 * @openapi
 * /agencies/packages/{id}/addons:
 *   get:
 *     tags: [Packages]
 *     summary: List a package's add-ons
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Add-ons }, 404: { description: Package not found } }
 *   post:
 *     tags: [Packages]
 *     summary: Add an add-on to a package
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/packages/{id}/addons/{addOnId}:
 *   patch: { tags: [Packages], summary: Update an add-on, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: addOnId, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 *   delete: { tags: [Packages], summary: Delete an add-on (blocked if used by a booking), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }, { name: addOnId, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 409: { description: In use } } }
 */
router.route("/agencies/packages/:id/addons")
  .get(authenticateWithRefreshToken, listPackageAddOns)
  .post(authenticateWithRefreshToken, createPackageAddOn);

router.route("/agencies/packages/:id/addons/:addOnId")
  .patch(authenticateWithRefreshToken, updatePackageAddOn)
  .delete(authenticateWithRefreshToken, deletePackageAddOn);

export default router;
