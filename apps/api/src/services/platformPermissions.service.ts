import { prisma } from "@funtush/database";

/**
 * Checked fresh on every call (no caching) — same principle as agency
 * staff's `loadStaffAccess`: a permission just revoked by a SUPER_ADMIN must
 * bite on this user's very next request, not after some cache/TTL expires.
 */
export async function hasPlatformPermission(userId: string, key: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roleType: true, role: true, isActive: true, permissions: true },
  });
  if (!user || user.roleType !== "PLATFORM" || !user.isActive) return false;
  if (user.role === "SUPER_ADMIN" || user.role === "PLATFORM_ADMIN") return true;
  if (user.role !== "PLATFORM_SUPPORT") return false;
  return user.permissions.includes(key);
}
