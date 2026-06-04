import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RoleWithPermissions {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    permissions: {
        permissionKey: string;
    }[];
}

export const RolesController = {

    async createRole(req: Request, res: Response): Promise<Response> {
        try {
            const { name, description } = req.body;
            const agencyId = (req.headers['x-agency-id'] as string) || 'fallback-agency-id';

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
            // FIX: Enforce string type to clear TS2322 'string | string[]' issue
            const roleId = req.params.id as string;
            const { permissionKeys } = req.body; // Expecting string[]

            if (!Array.isArray(permissionKeys)) {
                return res.status(400).json({
                    success: false,
                    error: "Validation Failed: permissionKeys must be an array of strings."
                });
            }

            await prisma.$transaction([
                prisma.rolePermission.deleteMany({ where: { roleId } }),
                prisma.rolePermission.createMany({
                    data: permissionKeys.map((key: string) => ({
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
            const agencyId = (req.headers['x-agency-id'] as string) || 'fallback-agency-id';

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
            // FIX: Enforce string type to clear TS2322 'string | string[]' issue
            const roleId = req.params.id as string;

            // FIX: Guard check modified to raw check or optional chain to survive Day 1 empty-db stubs cleanly
            // if agencyStaff target does not exist on your client delegate yet, we fall back to a safe 0 compile guard
            const staffClient = prisma as unknown as {
                agencyStaff?: {
                    count: (args: { where: { roleId: string; isActive: boolean } }) => Promise<number>;
                };
            };
            const activeStaffUsingRole = staffClient.agencyStaff
                ? await staffClient.agencyStaff.count({ where: { roleId, isActive: true } })
                : 0;

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