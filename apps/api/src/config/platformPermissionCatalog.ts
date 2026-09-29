/**
 * Fixed catalog of admin modules a PLATFORM_SUPPORT user can be granted
 * access to. Unlike agency staff (which build their own custom `Role`s via
 * the relational Permission/RolePermission tables — see
 * requireStaffPermission.middleware.ts), the set of platform admin modules
 * is fixed and small, so permissions live directly as a `String[]` on
 * `User` — no per-super-admin custom-role builder needed.
 *
 * SUPER_ADMIN and PLATFORM_ADMIN always have full access regardless of this
 * list — see `requirePlatformPermission.middleware.ts`.
 */
export interface PlatformPermissionDef {
  key: string;
  label: string;
  group: string;
}

export const PLATFORM_PERMISSION_CATALOG: PlatformPermissionDef[] = [
  { key: "agencies", label: "Agencies", group: "Overview" },
  { key: "analytics", label: "Analytics", group: "Overview" },

  { key: "kyc", label: "KYC Review", group: "Trust & Safety" },
  { key: "fraud", label: "Fraud & Safety", group: "Trust & Safety" },
  { key: "sos", label: "SOS Monitoring", group: "Trust & Safety" },
  { key: "safety_warnings", label: "Safety Warnings", group: "Trust & Safety" },
  { key: "reviews", label: "Flagged Reviews", group: "Trust & Safety" },

  { key: "ad_campaigns", label: "Ad Campaigns", group: "Growth" },
  { key: "tiers", label: "Subscription Tiers & Discount Codes", group: "Growth" },

  { key: "email_queue", label: "Email Queue", group: "Platform" },
  { key: "bugs", label: "Bug Triage", group: "Platform" },
  { key: "audit_logs", label: "Audit Log", group: "Platform" },
  { key: "settings", label: "Settings", group: "Platform" },
];

export const PLATFORM_PERMISSION_KEYS = new Set(PLATFORM_PERMISSION_CATALOG.map((p) => p.key));

export type PlatformPermissionKey = string;

export function groupedPlatformPermissionCatalog(): Array<{ group: string; permissions: PlatformPermissionDef[] }> {
  const groups: Array<{ group: string; permissions: PlatformPermissionDef[] }> = [];
  for (const perm of PLATFORM_PERMISSION_CATALOG) {
    let bucket = groups.find((g) => g.group === perm.group);
    if (!bucket) {
      bucket = { group: perm.group, permissions: [] };
      groups.push(bucket);
    }
    bucket.permissions.push(perm);
  }
  return groups;
}

export function isValidPlatformPermission(key: unknown): key is string {
  return typeof key === "string" && PLATFORM_PERMISSION_KEYS.has(key);
}
