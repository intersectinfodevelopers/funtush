import { Router } from 'express';
import { RolesController } from '../controllers/roles.controller.js';

const router = Router();

router.post('/agencies/me/roles', RolesController.createRole);
router.get('/agencies/me/roles', RolesController.listRoles);
router.patch('/agencies/me/roles/:id/permissions', RolesController.updatePermissions);
router.delete('/agencies/me/roles/:id', RolesController.deleteRole);

export default router;