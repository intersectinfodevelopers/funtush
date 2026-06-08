// RBAC permission constants. Reference these instead of bare strings so typos
// fail at compile time and the whole permission set lives in one place.

export const PERMISSIONS = {
  BOOKING_VIEW: "booking:view",
  BOOKING_CREATE: "booking:create",
  BOOKING_UPDATE: "booking:update",
  BOOKING_CANCEL: "booking:cancel",
  GUIDE_MANAGE: "guide:manage",
  FINANCE_VIEW: "finance:view",
  FINANCE_MANAGE: "finance:manage",
  AGENCY_MANAGE: "agency:manage",
  USER_MANAGE: "user:manage",
} as const;

/** Union of every permission string, e.g. "booking:view". */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
