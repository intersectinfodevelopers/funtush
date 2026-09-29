import { prisma } from "@funtush/database";
import { hashPassword } from "@funtush/auth";
import { normalizeEmail } from "@funtush/shared";
import { sendPlatformStaffInviteEmail } from "../utils/email";
import { PLATFORM_PERMISSION_KEYS } from "../config/platformPermissionCatalog";

export class PlatformStaffError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Roles creatable/assignable through this API — SUPER_ADMIN is seed-only. */
const ASSIGNABLE_ROLES = ["PLATFORM_ADMIN", "PLATFORM_SUPPORT"] as const;
type AssignableRole = typeof ASSIGNABLE_ROLES[number];

function isAssignableRole(role: unknown): role is AssignableRole {
  return typeof role === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-8) + "A1!";
}

const staffSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  permissions: true,
  createdAt: true,
} as const;

/** Only meaningful for PLATFORM_SUPPORT — SUPER_ADMIN/PLATFORM_ADMIN always
 * have full access regardless of this list, so it's stored but ignored for
 * them (see requirePlatformPermission.middleware.ts). */
function parsePermissions(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new PlatformStaffError(400, "permissions must be an array of strings");
  const unknown = input.filter((k) => !PLATFORM_PERMISSION_KEYS.has(k));
  if (unknown.length > 0) {
    throw new PlatformStaffError(400, `Unknown permission key(s): ${unknown.join(", ")}`);
  }
  return [...new Set(input as string[])];
}

export async function listPlatformStaff() {
  return prisma.user.findMany({
    where: { roleType: "PLATFORM" },
    select: staffSelect,
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
  });
}

export async function createPlatformStaff(email: unknown, role: unknown, permissions: unknown) {
  if (typeof email !== "string" || !email.includes("@")) {
    throw new PlatformStaffError(400, "A valid email is required");
  }
  if (!isAssignableRole(role)) {
    throw new PlatformStaffError(400, `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
  }
  const cleanPermissions = parsePermissions(permissions);

  const cleanEmail = email.toLowerCase().trim();
  const normalizedEmail = normalizeEmail(cleanEmail);

  const existing = await prisma.user.findUnique({ where: { normalizedEmail } });
  if (existing) throw new PlatformStaffError(409, "Email already exists");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email: cleanEmail,
      normalizedEmail,
      passwordHash,
      role,
      roleType: "PLATFORM",
      permissions: role === "PLATFORM_SUPPORT" ? cleanPermissions : [],
    },
    select: staffSelect,
  });

  void Promise.resolve(sendPlatformStaffInviteEmail(cleanEmail, tempPassword, role)).catch(
    (mailErr) => console.error("[createPlatformStaff] invite email failed:", mailErr),
  );

  return user;
}

async function activeSuperAdminCount(excludingUserId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      roleType: "PLATFORM",
      role: "SUPER_ADMIN",
      isActive: true,
      ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
    },
  });
}

export async function updatePlatformStaffRole(
  actingUserId: string,
  targetId: string,
  role: unknown,
) {
  if (!isAssignableRole(role)) {
    throw new PlatformStaffError(400, `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
  }

  const target = await prisma.user.findFirst({ where: { id: targetId, roleType: "PLATFORM" } });
  if (!target) throw new PlatformStaffError(404, "Platform staff member not found");

  if (target.role === "SUPER_ADMIN") {
    // Demoting the only SUPER_ADMIN would leave the platform with no one
    // able to manage its own team — same "last admin standing" guard as
    // deactivation, below.
    if ((await activeSuperAdminCount(target.id)) === 0) {
      throw new PlatformStaffError(400, "Cannot change the role of the last remaining active SUPER_ADMIN");
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetId },
    // PLATFORM_ADMIN has full access regardless of `permissions`, so clear
    // it on promotion — keeps a demotion back to PLATFORM_SUPPORT later from
    // silently reviving whatever list happened to be there before.
    data: { role, permissions: role === "PLATFORM_ADMIN" ? [] : target.permissions },
    select: staffSelect,
  });

  void actingUserId; // logged by the route via writeAuditLog, not here
  return updated;
}

export async function updatePlatformStaffPermissions(targetId: string, permissions: unknown) {
  const target = await prisma.user.findFirst({ where: { id: targetId, roleType: "PLATFORM" } });
  if (!target) throw new PlatformStaffError(404, "Platform staff member not found");
  if (target.role !== "PLATFORM_SUPPORT") {
    throw new PlatformStaffError(400, "Only PLATFORM_SUPPORT accounts have selectable permissions — SUPER_ADMIN and PLATFORM_ADMIN already have full access");
  }
  const cleanPermissions = parsePermissions(permissions);
  return prisma.user.update({
    where: { id: targetId },
    data: { permissions: cleanPermissions },
    select: staffSelect,
  });
}

export async function setPlatformStaffActive(
  actingUserId: string,
  targetId: string,
  isActive: boolean,
) {
  if (targetId === actingUserId && !isActive) {
    throw new PlatformStaffError(400, "You cannot deactivate your own account");
  }

  const target = await prisma.user.findFirst({ where: { id: targetId, roleType: "PLATFORM" } });
  if (!target) throw new PlatformStaffError(404, "Platform staff member not found");

  if (!isActive && target.role === "SUPER_ADMIN" && target.isActive) {
    if ((await activeSuperAdminCount(target.id)) === 0) {
      throw new PlatformStaffError(400, "Cannot deactivate the last remaining active SUPER_ADMIN");
    }
  }

  return prisma.user.update({
    where: { id: targetId },
    data: { isActive },
    select: staffSelect,
  });
}

/**
 * Permanent — only allowed once already deactivated (same "deactivate first,
 * delete second" shape as `AgencyStaff`). Blocked if the account has real bug
 * triage history (an assigned BugReport, or a BugHint it wrote), the same
 * "don't destroy real history" rule tier discount codes already follow —
 * deleting the User row would otherwise violate those rows' FK constraint.
 */
export async function deletePlatformStaff(actingUserId: string, targetId: string) {
  if (targetId === actingUserId) {
    throw new PlatformStaffError(400, "You cannot delete your own account");
  }

  const target = await prisma.user.findFirst({ where: { id: targetId, roleType: "PLATFORM" } });
  if (!target) throw new PlatformStaffError(404, "Platform staff member not found");
  if (target.isActive) {
    throw new PlatformStaffError(400, "Deactivate this account before deleting it");
  }

  const [assignedBugs, bugHints] = await Promise.all([
    prisma.bugReport.count({ where: { assignedToId: targetId } }),
    prisma.bugHint.count({ where: { createdById: targetId } }),
  ]);
  if (assignedBugs > 0 || bugHints > 0) {
    throw new PlatformStaffError(400, "This account has real bug-triage history — keep it deactivated instead of deleting so that history stays intact");
  }

  await prisma.user.delete({ where: { id: targetId } });
}
