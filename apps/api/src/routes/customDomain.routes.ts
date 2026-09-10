import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";
import { isPaidTier } from "../middleware/agencyAccess.middleware.js";
import {
  getDomainMapping,
  setCustomDomain,
  verifyCustomDomain,
  removeCustomDomain,
  CustomDomainError,
} from "../services/customDomain.service.js";

const router = Router();

router.use("/agencies/me/domain", authenticateWithRefreshToken, isPaidTier);

function agencyIdOf(req: Request): string | null {
  return req.agencyId ?? null;
}
function fail(res: Response, err: unknown) {
  if (err instanceof CustomDomainError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error("[customDomain]", err);
  return res
    .status(500)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /agencies/me/domain:
 *   get:
 *     tags: [Agency]
 *     summary: The agency's custom-domain mapping + DNS records to set
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: "Mapping or null" }, 403: { description: Paid tier only } }
 *   put:
 *     tags: [Agency]
 *     summary: Set / replace the custom domain (resets verification to PENDING)
 *     security: [{ refreshToken: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [domain], properties: { domain: { type: string } } } } }
 *     responses:
 *       200: { description: "Mapping with DNS instructions" }
 *       400: { description: Invalid / reserved domain }
 *       403: { description: Paid tier only }
 *       409: { description: Domain already claimed }
 *   delete:
 *     tags: [Agency]
 *     summary: Remove the custom domain
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: "{ removed }" } }
 * /agencies/me/domain/verify:
 *   post:
 *     tags: [Agency]
 *     summary: Run a live DNS check — VERIFIED on success, FAILED (with lastError) otherwise
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: "Updated mapping" }, 404: { description: No domain set } }
 */

router.get("/agencies/me/domain", async (req, res) => {
  const a = agencyIdOf(req);
  if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
  try {
    res.json({ success: true, data: await getDomainMapping(a) });
  } catch (e) {
    fail(res, e);
  }
});

router.put("/agencies/me/domain", async (req, res) => {
  const a = agencyIdOf(req);
  if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
  try {
    const { domain } = req.body ?? {};
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ success: false, message: "domain is required" });
    }
    res.json({ success: true, data: await setCustomDomain(a, domain) });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/agencies/me/domain/verify", async (req, res) => {
  const a = agencyIdOf(req);
  if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
  try {
    res.json({ success: true, data: await verifyCustomDomain(a) });
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/agencies/me/domain", async (req, res) => {
  const a = agencyIdOf(req);
  if (!a) return res.status(401).json({ success: false, message: "Unauthorized" });
  try {
    res.json({ success: true, data: await removeCustomDomain(a) });
  } catch (e) {
    fail(res, e);
  }
});

export default router;
