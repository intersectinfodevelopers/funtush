import { Router } from "express";
import type { Request, Response } from "express";
import * as svc from "../services/safety.service.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = Router();
router.use("/agencies/me/safety", authenticateWithRefreshToken);

function agencyIdOf(req: Request): string | null {
  return req.agencyId ?? null;
}
function actorOf(req: Request): string {
  return req.tenantId ?? req.agencyId ?? "agency";
}
function pid(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function need(req: Request, res: Response): string | null {
  const a = agencyIdOf(req);
  if (!a) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return a;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.SafetyError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /agencies/me/safety/incidents/active:
 *   get:
 *     tags: [Safety]
 *     summary: Live feed of this agency's ACTIVE / ACKNOWLEDGED SOS incidents
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Active incidents + overdue count }, 401: { description: Unauthorized } }
 * /agencies/me/safety/incidents:
 *   get:
 *     tags: [Safety]
 *     summary: Resolved/cancelled incident history for this agency
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: limit, in: query, schema: { type: integer } }]
 *     responses: { 200: { description: History } }
 * /agencies/me/safety/incidents/{id}:
 *   get: { tags: [Safety], summary: One incident (with timeline + notes), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 * /agencies/me/safety/incidents/{id}/acknowledge:
 *   patch: { tags: [Safety], summary: Acknowledge an ACTIVE incident (stops the SLA timer), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Acknowledged }, 409: { description: Not ACTIVE } } }
 * /agencies/me/safety/incidents/{id}/resolve:
 *   patch:
 *     tags: [Safety]
 *     summary: Resolve an incident with a resolution note
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [resolution], properties: { resolution: { type: string } } } } } }
 *     responses: { 200: { description: Resolved }, 400: { description: resolution required }, 409: { description: Already closed } }
 * /agencies/me/safety/incidents/{id}/notes:
 *   post: { tags: [Safety], summary: Add a note to an incident, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Added } } }
 * /agencies/me/safety/incidents/{id}/export:
 *   get: { tags: [Safety], summary: Structured incident export (law-enforcement format), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Export document } } }
 */

router.get("/agencies/me/safety/incidents/active", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.getActiveIncidents(a) });
  } catch (e) {
    fail(res, e);
  }
});

router.get("/agencies/me/safety/incidents", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
  try {
    res.json({ success: true, data: await svc.getIncidentHistory(a, limit) });
  } catch (e) {
    fail(res, e);
  }
});

router.get("/agencies/me/safety/incidents/:id/export", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.exportIncidentForAgency(a, pid(req)) });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/agencies/me/safety/incidents/:id/acknowledge", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.acknowledgeIncident(a, pid(req), actorOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/agencies/me/safety/incidents/:id/resolve", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({
      success: true,
      data: await svc.resolveIncident(a, pid(req), String(req.body?.resolution ?? ""), actorOf(req)),
    });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/agencies/me/safety/incidents/:id/notes", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res
      .status(201)
      .json({ success: true, data: await svc.addIncidentNote(a, pid(req), String(req.body?.note ?? ""), actorOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});

router.get("/agencies/me/safety/incidents/:id", async (req, res) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.getIncident(a, pid(req)) });
  } catch (e) {
    fail(res, e);
  }
});

export default router;
