import { Router } from 'express';
import { RolesController } from '../controllers/roles.controller';
import { authenticateWithRefreshToken } from '../middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from '../middleware/agencyAccess.middleware';

const router = Router();

// All role management is scoped to the authenticated agency.
router.use('/agencies/me/roles', authenticateWithRefreshToken, checkAgencyStatus);

/**
 * @openapi
 * /agencies/me/roles:
 *   get: { tags: [Staff & Roles], summary: List the agency's custom roles, security: [{ refreshToken: [] }], responses: { 200: { description: Roles }, 401: { description: Unauthorized } } }
 *   post: { tags: [Staff & Roles], summary: Create a custom role, security: [{ refreshToken: [] }], responses: { 201: { description: Created }, 409: { description: Name already exists } } }
 * /agencies/me/roles/permissions:
 *   get:
 *     tags: [Staff & Roles]
 *     summary: The canonical permission catalog, grouped by functional area
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: "Array of { group, permissions: [{ key, label, description, group }] }" }
 *       401: { description: Unauthorized }
 * /agencies/me/roles/{id}/permissions:
 *   patch:
 *     tags: [Staff & Roles]
 *     summary: Replace a role's permission set (send the whole array)
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [permissionKeys], properties: { permissionKeys: { type: array, items: { type: string } } } } } }
 *     responses: { 200: { description: Synchronized }, 400: { description: Unknown permission key }, 404: { description: Role not found } }
 * /agencies/me/roles/{id}:
 *   delete:
 *     tags: [Staff & Roles]
 *     summary: Delete a role (blocked while active staff are assigned to it)
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 204: { description: Deleted }, 400: { description: Role still in use }, 404: { description: Not found } }
 */

// Registered before any `/:id` route so "permissions" isn't read as a role id.
router.get('/agencies/me/roles/permissions', RolesController.listPermissionCatalog);

router.post('/agencies/me/roles', RolesController.createRole);
router.get('/agencies/me/roles', RolesController.listRoles);
router.patch('/agencies/me/roles/:id/permissions', RolesController.updatePermissions);
router.delete('/agencies/me/roles/:id', RolesController.deleteRole);

export default router;
