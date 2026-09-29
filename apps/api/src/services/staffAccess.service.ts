import { db } from "@funtush/database";
import { PERMISSION_KEYS } from "../config/permissionCatalog";

/**
 * What an invited STAFF member may reach. The agency owner (AGENCY_ADMIN) is never checked here.
 *
 * Every agency route is mapped to ONE permission key from the role catalog, or marked "admin" (owner only), or
 * "any" (needed just to render the dashboard). A route that is not listed is DENIED for staff — a new route can
 * never silently become reachable by staff just because nobody thought about it.
 */
export type Need = string | "any" | "admin";

const R = (re: RegExp, need: Need): [RegExp, Need] => [re, need];

const RULES: [RegExp, Need][] = [
  R(/^\/agencies\/me\/(dashboard|access)(\/|$)/, "any"),
  // Team management: the `staff` permission (with escalation limits enforced by staffDelegationGuard).
  R(/^\/agencies\/me\/(staff|roles)(\/|$)/, "staff"),
  // Owner-only: money movement, credentials, publishing/domain.
  R(/^\/agencies\/me\/(payment-methods|api-keys|kyc|domain|publish|unpublish|ad-campaigns)(\/|$)/, "admin"),
  R(/^\/(billing|admin)(\/|$)/, "admin"),
  // Functional areas -> the permission keys a Role can be granted.
  R(/^\/agencies\/(packages|me\/destinations|me\/coupons|me\/package-activity)(\/|$)|^\/packages\//, "packages"),
  R(/^\/agencies\/me\/guides(\/|$)|^\/guides\//, "guides"),
  R(/^\/agencies\/me\/customers(\/|$)|^\/customers\//, "customers"),
  R(/^\/agencies\/me\/(blogs|categories|gallery|videos|advertisements)(\/|$)/, "blog"),
  R(/^\/reviews(\/|$)/, "reviews"),
  R(/^\/agencies\/me\/finance(\/|$)/, "finance"),
  R(/^\/agencies\/me\/(analytics|reports)(\/|$)/, "analytics"),
  R(/^\/agencies\/me\/(safety)(\/|$)|^\/bookings(\/|$)/, "bookings"),
  R(/^\/agencies\/me\/(branches|profile|branding|seo|navigation|social-links|site-config|site-page|email-settings|notification-preferences|widgets|bugs)(\/|$)/, "settings"),
];

/** The permission a request to `path` needs; `admin` when nothing matches (default deny). */
export function requiredPermission(path: string): Need {
  for (const [re, need] of RULES) if (re.test(path)) return need;
  return "admin";
}

export interface StaffAccess {
  active: boolean;
  permissions: Set<string>;
}

/** The staff member's CURRENT access, read fresh on every request so a removal or role change bites at once. */
export async function loadStaffAccess(agencyUserId: string, agencyId: string): Promise<StaffAccess> {
  const staff = await db.agencyStaff.findFirst({
    where: { userId: agencyUserId, agencyId },
    select: { isActive: true, role: { select: { permissions: { select: { permissionKey: true } } } } },
  });
  if (!staff || !staff.isActive) return { active: false, permissions: new Set() };
  return { active: true, permissions: new Set((staff.role?.permissions ?? []).map((p) => p.permissionKey).filter((k) => PERMISSION_KEYS.has(k))) };
}

/** null = allowed; otherwise the HTTP status + message to refuse with. */
export function staffDecision(access: StaffAccess, path: string): { status: number; message: string } | null {
  if (!access.active) return { status: 401, message: "Your access to this agency has been removed." };
  const need = requiredPermission(path);
  if (need === "any") return null;
  if (need === "admin" || !access.permissions.has(need)) return { status: 403, message: "You don't have permission to do that. Ask your agency admin." };
  return null;
}
