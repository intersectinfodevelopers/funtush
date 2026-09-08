import { Router } from "express";
import { GuidesController } from "../controllers/guides.controller.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = Router();

// All guide management is scoped to the authenticated agency. No checkAgencyStatus
// here — trial-tier agencies must be able to manage guides.
router.use("/agencies/me/guides", authenticateWithRefreshToken);

/**
 * @openapi
 * /agencies/me/guides:
 *   get:
 *     tags: [Guides]
 *     summary: List the agency's guides
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [all, available, on_trek, unavailable] } }
 *       - { name: search, in: query, schema: { type: string } }
 *       - { name: language, in: query, schema: { type: string } }
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *     responses:
 *       200: { description: Guides }
 *       401: { description: Unauthorized }
 *   post:
 *     tags: [Guides]
 *     summary: Create a guide
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation failed }
 *       403: { description: Guide limit reached for the plan }
 */
router
  .route("/agencies/me/guides")
  .get(GuidesController.list)
  .post(GuidesController.create);

/**
 * @openapi
 * /agencies/me/guides/{id}:
 *   get:
 *     tags: [Guides]
 *     summary: Get one guide (with certifications, upcoming assignments, total treks)
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Guide }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Guides]
 *     summary: Update a guide (certifications, if sent, replace the whole set)
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Guides]
 *     summary: Deactivate a guide (soft delete)
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses:
 *       204: { description: Deactivated }
 *       404: { description: Not found }
 */
router
  .route("/agencies/me/guides/:id")
  .get(GuidesController.getOne)
  .patch(GuidesController.update)
  .delete(GuidesController.remove);

export default router;
