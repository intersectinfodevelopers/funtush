import { Request, Response } from 'express';
import { prisma } from "@funtush/database";
import { PERMISSION_KEYS, groupedPermissionCatalog } from "../config/permissionCatalog";

interface RoleWithPermissions {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    permissions: {
        permissionKey: string;
    }[];
}

/** The agency id is set by authenticateWithRefreshToken; never trust a header. */
function agencyIdOf(req: Request): string | null {
    return req.agencyId ?? null;
}

export const RolesController = {

    /** GET /agencies/me/roles/permissions — the canonical permission catalog,
     *  grouped by functional area, for the dashboard's permission matrix. */
    async listPermissionCatalog(_req: Request, res: Response): Promise<Response> {
        return res.status(200).json({ success: true, data: groupedPermissionCatalog() });
    },

    async createRole(req: Request, res: Response): Promise<Response> {
        try {
            const { name, description } = req.body;
            const agencyId = agencyIdOf(req);
            if (!agencyId) {
                return res.status(401).json({ success: false, error: "Unauthorized" });
            }

            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({
                    success: false,
                    error: "Validation Failed: Role name is required."
                });
            }

            const newRole = await prisma.role.create({
                data: {
                    agencyId,
                    name: name.trim(),
                    description: description ? description.trim() : null,
                }
            });

            return res.status(201).json({ success: true, data: newRole });
        } catch (error: unknown) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code: string }).code === 'P2002'
            ) {
                return res.status(409).json({
                    success: false,
                    error: "Conflict: A role with this name already exists within your agency."
                });
            }
            return res.status(500).json({ success: false, error: "Internal Server Error." });
        }
    },

    async updatePermissions(req: Request, res: Response): Promise<Response> {
        try {
            const roleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const agencyId = agencyIdOf(req);
            if (!agencyId) {
                return res.status(401).json({ success: false, error: "Unauthorized" });
            }
            const { permissionKeys } = req.body; // Expecting string[]

            if (!Array.isArray(permissionKeys)) {
                return res.status(400).json({
                    success: false,
                    error: "Validation Failed: permissionKeys must be an array of strings."
                });
            }

            // Reject anything outside the canonical catalog before we touch the DB —
            // the FK to permissions.key would otherwise surface as a 500.
            const unknown = [...new Set(permissionKeys as unknown[])].filter(
                (key) => typeof key !== "string" || !PERMISSION_KEYS.has(key),
            );
            if (unknown.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Validation Failed: unknown permission key(s): ${unknown.join(", ")}`,
                });
            }
            const uniqueKeys = [...new Set(permissionKeys as string[])];

            // Role must belong to the calling agency.
            const role = await prisma.role.findFirst({ where: { id: roleId, agencyId } });
            if (!role) {
                return res.status(404).json({ success: false, error: "Role not found." });
            }

            await prisma.$transaction([
                prisma.rolePermission.deleteMany({ where: { roleId } }),
                prisma.rolePermission.createMany({
                    data: uniqueKeys.map((key: string) => ({
                        roleId,
                        permissionKey: key
                    }))
                })
            ]);

            return res.status(200).json({ success: true, message: "Permissions synchronized." });
        } catch {
            return res.status(500).json({ success: false, error: "Internal Server Error." });
        }
    },

    async listRoles(req: Request, res: Response): Promise<Response> {
        try {
            const agencyId = agencyIdOf(req);
            if (!agencyId) {
                return res.status(401).json({ success: false, error: "Unauthorized" });
            }

            const roles = (await prisma.role.findMany({
                where: { agencyId },
                include: {
                    permissions: {
                        select: { permissionKey: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })) as unknown as RoleWithPermissions[];

            const formattedRoles = roles.map((role: RoleWithPermissions) => ({
                id: role.id,
                name: role.name,
                description: role.description,
                createdAt: role.createdAt,
                permissions: role.permissions.map((p: { permissionKey: string }) => p.permissionKey)
            }));

            return res.status(200).json({ success: true, data: formattedRoles });
        } catch {
            return res.status(500).json({ success: false, error: "Internal Server Error." });
        }
    },

    async deleteRole(req: Request, res: Response): Promise<Response> {
        try {
            const roleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const agencyId = agencyIdOf(req);
            if (!agencyId) {
                return res.status(401).json({ success: false, error: "Unauthorized" });
            }

            // Role must belong to the calling agency.
            const role = await prisma.role.findFirst({ where: { id: roleId, agencyId } });
            if (!role) {
                return res.status(404).json({ success: false, error: "Role not found." });
            }

            const activeStaffUsingRole = await prisma.agencyStaff.count({
                where: { roleId, isActive: true },
            });

            if (activeStaffUsingRole > 0) {
                return res.status(400).json({
                    success: false,
                    error: "Bad Request: Cannot delete role. Active staff members are assigned to it."
                });
            }

            await prisma.role.delete({ where: { id: roleId } });
            return res.status(204).send();
        } catch {
            return res.status(500).json({ success: false, error: "Internal Server Error." });
        }
    }
};
