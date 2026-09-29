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
    /// Present only on a token minted by apps/api's impersonateAgency —
    /// every other login flow leaves these undefined. userId/role/agencyId
    /// above already identify the agency's own user being acted as;
    /// these two identify who is really driving the session.
    impersonatedBy?: string;
    impersonationSessionId?: string;
};