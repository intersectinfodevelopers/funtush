import express from "express";
import { searchMarketplace } from "../controllers/marketplace.controller.js";

/**
 * Public marketplace routes (Week 3 · Day 2).
 *
 * No auth middleware: the marketplace is open to the public. The controller
 * still *optionally* reads a Bearer token to personalize results for logged-in
 * trekkers, but a request without one is perfectly valid.
 */
const router = express.Router();

// GET /marketplace/packages            → all published packages, ranked by visibility score
// GET /marketplace/packages?q=everest&difficulty=moderate&price_max=1500 → full-text + filters
router.get("/packages", searchMarketplace);

export default router;
