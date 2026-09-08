// ─────────────────────────────────────────────────────────────────────────────
// Canonical agency RBAC permission catalog.
//
// The agency dashboard (funtush-frontend) gates access by *functional area* with
// lowercase section keys ("packages", "bookings", ...). Those keys are the
// `Permission.key` values a `Role` can be granted (RolePermission.permissionKey
// is an FK to Permission.key). This file is the single source of truth the API
// validates against; it is kept in sync with:
//   - packages/database/prisma/seed.ts  (fresh DBs)
//   - packages/database/prisma/migrations/20260909190000_seed_permission_catalog
//
// Concept §5 groups these areas; `group` here mirrors that grouping so the
// dashboard can render a sectioned permission matrix.
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  { key: "packages", label: "Packages", description: "Create and manage trek packages, itineraries and departure dates", group: "Operations" },
  { key: "bookings", label: "Bookings", description: "Review, approve and manage bookings and guide assignments", group: "Operations" },
  { key: "guides", label: "Guides", description: "Manage guides, certifications and availability", group: "Operations" },
  { key: "customers", label: "Customers", description: "View customer profiles, history and notes", group: "Customers & Marketing" },
  { key: "blog", label: "Blog", description: "Write and publish blog posts, categories and media", group: "Customers & Marketing" },
  { key: "reviews", label: "Reviews", description: "Respond to and moderate customer reviews", group: "Customers & Marketing" },
  { key: "finance", label: "Finance", description: "View finance dashboards, invoices and payouts", group: "Business" },
  { key: "analytics", label: "Analytics", description: "View analytics and performance reports", group: "Business" },
  { key: "staff", label: "Staff", description: "Invite staff, manage roles and permissions", group: "Administration" },
  { key: "settings", label: "Settings", description: "Edit agency profile, branding, widgets and site settings", group: "Administration" },
];

/** Fast membership check for validating role permission payloads. */
export const PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.map((p) => p.key),
);

/** The catalog reshaped as `[{ group, permissions: [...] }]` for the dashboard. */
export function groupedPermissionCatalog(): {
  group: string;
  permissions: PermissionDef[];
}[] {
  const order: string[] = [];
  const byGroup = new Map<string, PermissionDef[]>();
  for (const perm of PERMISSION_CATALOG) {
    if (!byGroup.has(perm.group)) {
      byGroup.set(perm.group, []);
      order.push(perm.group);
    }
    byGroup.get(perm.group)!.push(perm);
  }
  return order.map((group) => ({ group, permissions: byGroup.get(group)! }));
}
