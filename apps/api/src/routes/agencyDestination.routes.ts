import { Router } from "express";
import type { Request, Response } from "express";
import * as svc from "../services/agencyDestination.service.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = Router();
router.use("/agencies/me/destinations", authenticateWithRefreshToken);

function agencyIdOf(req: Request): string | null {
  return req.agencyId ?? null;
}
function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.AgencyDestinationError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /agencies/me/destinations:
 *   get:
 *     tags: [Destinations]
 *     summary: List the agency's curated destination pages
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: published, in: query, schema: { type: string, enum: ["true", "false"] } }
 *       - { name: featured, in: query, schema: { type: string, enum: ["true"] } }
 *       - { name: category, in: query, schema: { type: string } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses: { 200: { description: Destinations }, 401: { description: Unauthorized } }
 *   post:
 *     tags: [Destinations]
 *     summary: Create a destination page
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/me/destinations/{id}:
 *   get: { tags: [Destinations], summary: Get a destination, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 *   patch: { tags: [Destinations], summary: Update a destination (also toggles published/featured), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 *   delete: { tags: [Destinations], summary: Delete a destination, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 404: { description: Not found } } }
 */
router
  .route("/agencies/me/destinations")
  .get(async (req, res) => {
    const a = agencyIdOf(req);
    if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
    const q = req.query as Record<string, string | undefined>;
    try {
      const result = await svc.listDestinations(a, {
        published: q.published,
        featured: q.featured,
        category: q.category,
        search: q.search,
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      fail(res, e);
    }
  })
  .post(async (req, res) => {
    const a = agencyIdOf(req);
    if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      res.status(201).json({ success: true, data: await svc.createDestination(a, req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

router
  .route("/agencies/me/destinations/:id")
  .get(async (req, res) => {
    const a = agencyIdOf(req);
    if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      res.json({ success: true, data: await svc.getDestination(a, paramId(req)) });
    } catch (e) {
      fail(res, e);
    }
  })
  .patch(async (req, res) => {
    const a = agencyIdOf(req);
    if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      res.json({ success: true, data: await svc.updateDestination(a, paramId(req), req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  })
  .delete(async (req, res) => {
    const a = agencyIdOf(req);
    if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
      await svc.deleteDestination(a, paramId(req));
      res.status(204).send();
    } catch (e) {
      fail(res, e);
    }
  });

export default router;
