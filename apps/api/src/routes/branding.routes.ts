/**
 * ── Brand identity routes (White-label week · Day 1) ─────────────────────────
 *
 * Mounted at `/` in `src/index.ts` (not under a prefix) so the paths read
 * exactly as the task specifies them: `PATCH /agencies/me/branding`.
 *
 * Middleware order on the write is not arbitrary — each layer is cheaper than
 * the next and rejects requests the next one would waste work on:
 *
 *   1. `authenticateWithRefreshToken` — who is calling? Sets `req.agencyId`.
 *      Everything after this point depends on it.
 *   2. `checkAgencyStatus` — is the account allowed to write at all? A LOCKED
 *      agency is read-only (Backend Guide §6), and re-branding a site that is
 *      not being served is meaningless.
 *   3. `upload.fields(...)` — parse the multipart body. This has to come before
 *      validation, because until multer runs there *is* no `req.body` on a
 *      multipart request: the fields are still an unparsed stream.
 *   4. `validate(brandingUpdateSchema)` — is the body well-formed?
 *   5. the controller → the service, which applies the tier and image rules.
 *
 * Note there is deliberately **no `tierGate`** on this router. Branding is not a
 * paid feature — every tier, trial included, brands its site. What the tier
 * changes is *how freely* the colour may be chosen, and that is a per-field rule
 * the service enforces, not a whole-endpoint gate. Using `tierGate` here would
 * have meant returning 403 for the entire request when the only problem was one
 * field.
 */

import express from "express";
import { upload } from "@funtush/storage";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { brandingUpdateSchema } from "../validations/branding.validation";
import {
  getMyBranding,
  getMyBrandingOptions,
  patchMyBranding,
  getSiteBranding,
} from "../controllers/branding.controller";

const router = express.Router();

/**
 * `maxCount: 1` on both slots. A site has one logo and one favicon; accepting an
 * array and silently using `[0]` would let a client upload ten files, pay for
 * ten uploads, and see one applied.
 */
const brandImageUpload = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "favicon", maxCount: 1 },
]);

/**
 * @openapi
 * /agencies/me/branding:
 *   get: { tags: [Branding], summary: Get the agency's own branding, security: [{ refreshToken: [] }], responses: { 200: { description: Branding } } }
 *   patch: { tags: [Branding], summary: Update branding (colours, and optionally logo/favicon as multipart), security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /agencies/me/branding/options:
 *   get: { tags: [Branding], summary: Get the tier-gated branding options available to this agency, security: [{ refreshToken: [] }], responses: { 200: { description: Options } } }
 * /site/{slug}/branding:
 *   get: { tags: [Branding], summary: "Public: branding theme for an agency's published site", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Branding } } }
 */
router
  .route("/agencies/me/branding")
  .get(authenticateWithRefreshToken, getMyBranding)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    brandImageUpload,
    validate(brandingUpdateSchema),
    patchMyBranding,
  );

router.route("/agencies/me/branding/options").get(authenticateWithRefreshToken, getMyBrandingOptions);

/**
 * Public — no auth. This is the theme of a publicly visible website; requiring a
 * token to fetch it would mean an anonymous visitor's first paint has no colours.
 */
router.route("/site/:slug/branding").get(getSiteBranding);

export default router;
