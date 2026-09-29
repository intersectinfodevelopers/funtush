import { Router } from "express";
import type { Request, Response } from "express";
import { requireSiteLive } from "../middleware/siteLive.middleware";
import * as svc from "../services/siteContent.service";

/**
 * @openapi
 * /site/{slug}/packages:
 *   get: { tags: [Site], summary: "Public: an agency site's published packages", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: search, in: query, schema: { type: string } }], responses: { 200: { description: Packages }, 404: { description: Site not found }, 503: { description: Under construction } } }
 * /site/{slug}/packages/{id}:
 *   get: { tags: [Site], summary: "Public: one published package (itinerary, open departures, add-ons); id or slug", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Package }, 404: { description: Not found } } }
 * /site/{slug}/destinations:
 *   get: { tags: [Site], summary: "Public: published destinations", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Destinations } } }
 * /site/{slug}/destinations/{destination}:
 *   get: { tags: [Site], summary: "Public: one published destination by slug", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: destination, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Destination }, 404: { description: Not found } } }
 * /site/{slug}/blog:
 *   get: { tags: [Site], summary: "Public: published blog posts", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Posts } } }
 * /site/{slug}/blog/{id}:
 *   get: { tags: [Site], summary: "Public: one published post (sanitised HTML content)", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Post }, 404: { description: Not found } } }
 * /site/{slug}/blog/{id}/view:
 *   post: { tags: [Site], summary: "Public: count one view of a published post (deduped per visitor for 30 min)", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Recorded }, 404: { description: Not found } } }
 * /site/{slug}/gallery:
 *   get: { tags: [Site], summary: "Public: published gallery posts", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Gallery } } }
 * /site/{slug}/videos:
 *   get: { tags: [Site], summary: "Public: active videos", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Videos } } }
 * /site/{slug}/reviews:
 *   get: { tags: [Site], summary: "Public: reviews (first names only) with the average rating", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Reviews } } }
 * /site/{slug}/about:
 *   get: { tags: [Site], summary: "Public: about/contact details the agency chose to show", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: About } } }
 * /site/{slug}/ads:
 *   get: { tags: [Site], summary: "Public: active ads in their date window, optionally for one position", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }, { name: position, in: query, schema: { type: string } }], responses: { 200: { description: Ads } } }
 */
const router = Router();

/** Short public cache: an agency editing its site sees the change within a minute. */
const PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300";

function param(req: Request, k: string): string {
  const v = req.params[k];
  return Array.isArray(v) ? v[0] : (v ?? "");
}

function handler(load: (agencyId: string, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const agency = await svc.agencyIdForSlug(param(req, "slug"));
      const data = await load(agency.id, req);
      res.setHeader("Cache-Control", PUBLIC_CACHE);
      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof svc.SiteContentError) return void res.status(err.status).json({ success: false, message: err.message });
      console.error("[site content]", err);
      res.status(500).json({ success: false, message: "Failed to load" });
    }
  };
}

const q = (req: Request) => req.query as Record<string, unknown>;

router.get("/site/:slug/packages", requireSiteLive, handler((id, req) => svc.listSitePackages(id, q(req))));
router.get("/site/:slug/packages/:id", requireSiteLive, handler((id, req) => svc.getSitePackage(id, param(req, "id"))));
router.get("/site/:slug/destinations", requireSiteLive, handler((id, req) => svc.listSiteDestinations(id, q(req))));
router.post("/site/:slug/destinations/:destination/view", requireSiteLive, async (req, res) => {
  try {
    const agency = await svc.agencyIdForSlug(param(req, "slug"));
    res.json({ success: true, data: await svc.recordDestinationView(agency.id, param(req, "destination"), req.ip ?? "anon") });
  } catch (err) {
    if (err instanceof svc.SiteContentError) return void res.status(err.status).json({ success: false, message: err.message });
    console.error("[site content]", err);
    res.status(500).json({ success: false, message: "Failed to record view" });
  }
});
router.get("/site/:slug/destinations/:destination", requireSiteLive, handler((id, req) => svc.getSiteDestination(id, param(req, "destination"))));
router.get("/site/:slug/blog", requireSiteLive, handler((id, req) => svc.listSiteBlogs(id, q(req))));
router.get("/site/:slug/blog/:id", requireSiteLive, handler((id, req) => svc.getSiteBlog(id, param(req, "id"))));
router.post("/site/:slug/blog/:id/view", requireSiteLive, async (req, res) => {
  try {
    const agency = await svc.agencyIdForSlug(param(req, "slug"));
    res.json({ success: true, data: await svc.recordBlogView(agency.id, param(req, "id"), req.ip ?? "anon") });
  } catch (err) {
    if (err instanceof svc.SiteContentError) return void res.status(err.status).json({ success: false, message: err.message });
    console.error("[site content]", err);
    res.status(500).json({ success: false, message: "Failed to record view" });
  }
});
router.get("/site/:slug/gallery", requireSiteLive, handler((id) => svc.listSiteGallery(id)));
router.get("/site/:slug/videos", requireSiteLive, handler((id) => svc.listSiteVideos(id)));
router.get("/site/:slug/reviews", requireSiteLive, handler((id, req) => svc.listSiteReviews(id, q(req))));
router.get("/site/:slug/about", requireSiteLive, handler((id) => svc.getSiteAbout(id)));
router.get("/site/:slug/ads", requireSiteLive, handler((id, req) => svc.listSiteAds(id, q(req).position)));

export default router;
