export type RoleType =
    "platform" | "tenant" | "trekker";

export type platformRole = 
    "super_admin" | "platform_admin" | "platform_support";

export type tenantRole =
    "agency_admin" | "agency_moderator" | "guide"
    | string; // supports dynamic custom roles

export type Role = platformRole | tenantRole | "trekker";

export type jwtPayload = {
    userId: string;
    roleType: RoleType;
    role: Role;  
    permissions?: string[];  
    agencyId?: string; // Optional, only for tenant users
};