import { Router } from "express";
import type { Request, Response } from "express";
import * as svc from "../services/siteAd.service.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = Router();
router.use("/agencies/me/advertisements", authenticateWithRefreshToken);

function agencyIdOf(req: Request): string | null {
  return req.agencyId ?? null;
}
function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.SiteAdError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}
function need(req: Request, res: Response): string | null {
  const a = agencyIdOf(req);
  if (!a) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return a;
}

/**
 * @openapi
 * /agencies/me/advertisements/positions:
 *   get:
 *     tags: [Site Ads]
 *     summary: List the known white-label site ad slots and how many active ads fill each
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Positions }, 401: { description: Unauthorized } }
 * /agencies/me/advertisements:
 *   get:
 *     tags: [Site Ads]
 *     summary: List the agency's site ads
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [all, active, paused] } }
 *       - { name: position, in: query, schema: { type: string } }
 *     responses: { 200: { description: Ads }, 401: { description: Unauthorized } }
 *   post:
 *     tags: [Site Ads]
 *     summary: Create a site ad
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/me/advertisements/{id}:
 *   get: { tags: [Site Ads], summary: Get a site ad, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 *   patch: { tags: [Site Ads], summary: Update a site ad (also pause/resume via status), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 *   delete: { tags: [Site Ads], summary: Delete a site ad, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 404: { description: Not found } } }
 */

// /positions must be registered before /:id.
router.get("/agencies/me/advertisements/positions", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.listPositions(a) });
  } catch (e) {
    fail(res, e);
  }
});

router
  .route("/agencies/me/advertisements")
  .get(async (req, res) => {
    const a = need(req, res);
    if (!a) return;
    const q = req.query as Record<string, string | undefined>;
    try {
      const result = await svc.listSiteAds(a, {
        status: q.status,
        position: q.position,
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      fail(res, e);
    }
  })
  .post(async (req, res) => {
    const a = need(req, res);
    if (!a) return;
    try {
      res.status(201).json({ success: true, data: await svc.createSiteAd(a, req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

router
  .route("/agencies/me/advertisements/:id")
  .get(async (req, res) => {
    const a = need(req, res);
    if (!a) return;
    try {
      res.json({ success: true, data: await svc.getSiteAd(a, paramId(req)) });
    } catch (e) {
      fail(res, e);
    }
  })
  .patch(async (req, res) => {
    const a = need(req, res);
    if (!a) return;
    try {
      res.json({ success: true, data: await svc.updateSiteAd(a, paramId(req), req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  })
  .delete(async (req, res) => {
    const a = need(req, res);
    if (!a) return;
    try {
      await svc.deleteSiteAd(a, paramId(req));
      res.status(204).send();
    } catch (e) {
      fail(res, e);
    }
  });

export default router;
