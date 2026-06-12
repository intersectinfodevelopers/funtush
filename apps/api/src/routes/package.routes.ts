import express from "express";
import { authenticateWithRefreshToken } from "../middlewares/refreshTokenAuthentication.js";
import { createPackage, updatePackage, listPackages, publishPackage,
         duplicatePackage, archivePackage } from "../controllers/package.controller.js";
import { addItineraryDay, updateItineraryDay, deleteItineraryDay,
         reorderItinerary } from "../controllers/itinerary.controller.js";

const router = express.Router();

router.route("/agencies/packages")
  .post(authenticateWithRefreshToken, createPackage)
  .get(authenticateWithRefreshToken, listPackages);

router.route("/agencies/packages/:id")
  .patch(authenticateWithRefreshToken, updatePackage)
  .delete(authenticateWithRefreshToken, archivePackage);

router.route("/agencies/packages/:id/publish")
  .post(authenticateWithRefreshToken, publishPackage);

router.route("/agencies/packages/:id/duplicate")
  .post(authenticateWithRefreshToken, duplicatePackage);

// ── Day 3: Itinerary Builder ─────────────────────────────────────────
// `/reorder` is declared BEFORE `/:day` so Express doesn't capture the literal
// string "reorder" as a day_number.
router.route("/agencies/packages/:id/itinerary")
  .post(authenticateWithRefreshToken, addItineraryDay);

router.route("/agencies/packages/:id/itinerary/reorder")
  .patch(authenticateWithRefreshToken, reorderItinerary);

router.route("/agencies/packages/:id/itinerary/:day")
  .put(authenticateWithRefreshToken, updateItineraryDay)
  .delete(authenticateWithRefreshToken, deleteItineraryDay);

export default router;
