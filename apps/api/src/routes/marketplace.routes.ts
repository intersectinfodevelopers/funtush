import express from "express";
import {
  searchMarketplace,
  recordMarketplaceClick, 
  getAgencies,
  getAgency,
  getDestinations,
  getDestination,
  featured,
  trending,
  seasonal,
} from "../controllers/marketplace.controller.js";

const router = express.Router();

// GET /marketplace/packages            → all published packages, ranked by visibility score
// GET /marketplace/packages?q=everest&difficulty=moderate&price_max=1500 → full-text + filters
// NEW: impressions recorded on response
router.get("/packages", searchMarketplace);

// POST /marketplace/click { agencyId, destination, searchQuery? }
router.post("/click", recordMarketplaceClick);

// GET /marketplace/agencies            → all agencies with tier, rating, top destination tags
// GET /marketplace/agencies/:slug      → public agency profile (packages, reviews, badges)
router.get("/agencies", getAgencies);
router.get("/agencies/:slug", getAgency);

// GET /marketplace/destinations        → all master destinations with package count
// GET /marketplace/destinations/:slug  → master destination page (agencies operating there)
router.get("/destinations", getDestinations);
router.get("/destinations/:slug", getDestination);

// GET /marketplace/featured   → Sponsored (Large-tier boosted) + highest-rated + most-booked-this-month
// GET /marketplace/trending   → packages with the most inquiries in the last 7 days
// GET /marketplace/seasonal   → packages whose destination's best season matches the current month
router.get("/featured", featured);
router.get("/trending", trending);
router.get("/seasonal", seasonal);

export default router;