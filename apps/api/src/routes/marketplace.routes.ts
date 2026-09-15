import express from "express";
import {
  searchMarketplace,
  recordMarketplaceClick,
  getAgencies,
  compareMarketplaceAgencies,
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

/**
 * @openapi
 * /marketplace/click:
 *   post:
 *     tags: [Marketplace]
 *     summary: Record a marketplace click (agency profile view, inquiry form open, etc.)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [agencyId, destination], properties: { agencyId: { type: string }, destination: { type: string }, searchQuery: { type: string } } }
 *     responses: { 200: { description: Recorded }, 400: { description: agencyId/destination required } }
 */
// POST /marketplace/click { agencyId, destination, searchQuery? }
router.post("/click", recordMarketplaceClick);

// GET /marketplace/agencies                    → KYC-verified agencies, composite-ranked;
//                                                 personalised (trekkedWith + yourHistory) with a trekker token
// GET /marketplace/agencies/compare?slugs=a,b,c → side-by-side data for 2-4 agencies
// GET /marketplace/agencies/:slug              → public agency profile (packages, reviews, badges)
router.get("/agencies", getAgencies);
/**
 * @openapi
 * /marketplace/agencies/compare:
 *   get:
 *     tags: [Marketplace]
 *     summary: Side-by-side data for 2-4 agencies
 *     parameters: [{ name: slugs, in: query, required: true, schema: { type: string }, description: "Comma-separated agency slugs" }]
 *     responses: { 200: { description: Comparison data }, 400: { description: slugs required (2-4 agencies) } }
 */
router.get("/agencies/compare", compareMarketplaceAgencies); // before :slug
/**
 * @openapi
 * /marketplace/agencies/{slug}:
 *   get: { tags: [Marketplace], summary: Public agency profile (packages, reviews, badges), parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Profile }, 404: { description: Not found } } }
 */
router.get("/agencies/:slug", getAgency);

/**
 * @openapi
 * /marketplace/destinations:
 *   get: { tags: [Marketplace], summary: All master destinations with package counts, responses: { 200: { description: Destinations } } }
 * /marketplace/destinations/{slug}:
 *   get: { tags: [Marketplace], summary: A master destination page (agencies operating there), parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Destination }, 404: { description: Not found } } }
 * /marketplace/featured:
 *   get: { tags: [Marketplace], summary: "Sponsored (Large-tier boosted) + highest-rated + most-booked-this-month packages", responses: { 200: { description: Featured } } }
 * /marketplace/trending:
 *   get: { tags: [Marketplace], summary: Packages with the most inquiries in the last 7 days, responses: { 200: { description: Trending } } }
 * /marketplace/seasonal:
 *   get: { tags: [Marketplace], summary: Packages whose destination's best season matches the current month, responses: { 200: { description: Seasonal } } }
 */
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