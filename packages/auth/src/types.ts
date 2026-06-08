export type RoleType = "PLATFORM" | "TENANT" | "TREKKER";

export type Role =
    | "SUPER_ADMIN"
    | "PLATFORM_ADMIN"
    | "PLATFORM_SUPPORT"
    | "AGENCY_ADMIN"
    | "AGENCY_MODERATOR"
    | "GUIDE"
    | "STAFF"
    | "TREKKER";


//  JWT payload shared across system
export type jwtPayload = {
    userId: string;
    roleType: RoleType;   // PLATFORM | TENANT | TREKKER
    role: Role;
    permissions?: string[];
    agencyId?: string;
};