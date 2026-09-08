import { Router } from "express";
import { assignGuideToBranch, assignPackageBranches, assignStaffToBranch, createBranch, getAgencyBranches, getBranchReportController, getConsolidatedFinanceController, updateBranch } from "src/controllers/branches.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

/**
 * @openapi
 * /agencies/me/branches:
 *   get: { tags: [Branches], summary: List the agency's branches, security: [{ refreshToken: [] }], responses: { 200: { description: Branches }, 401: { description: Unauthorized } } }
 *   post: { tags: [Branches], summary: Create a branch, security: [{ refreshToken: [] }], responses: { 201: { description: Created } } }
 * /agencies/me/branches/{id}:
 *   patch: { tags: [Branches], summary: Update a branch, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 * /agencies/me/branches/{id}/report:
 *   get: { tags: [Branches], summary: Per-branch operations + finance report, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Report } } }
 * /guides/{id}/branch:
 *   patch: { tags: [Branches], summary: Assign a guide to a branch, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Assigned } } }
 * /packages/{id}/branches:
 *   patch: { tags: [Branches], summary: Set which branches sell a package, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 */
router.route('/agencies/me/branches')
    .get(authenticateWithRefreshToken, getAgencyBranches)
    .post(authenticateWithRefreshToken, createBranch);

router.route('/agencies/me/branches/:id')
    .patch(authenticateWithRefreshToken, updateBranch);

router.route('/agencies/me/staff/:id/branch')
    .patch(authenticateWithRefreshToken, assignStaffToBranch);

router.route('/guides/:id/branch')
    .patch(authenticateWithRefreshToken, assignGuideToBranch);

router.route('/packages/:id/branches')
    .patch(authenticateWithRefreshToken, assignPackageBranches);

router.route('/agencies/me/branches/:id/report')
    .get(authenticateWithRefreshToken, getBranchReportController);

router.route('/agencies/me/finance/consolidated')
    .get(authenticateWithRefreshToken, getConsolidatedFinanceController);

export default router;