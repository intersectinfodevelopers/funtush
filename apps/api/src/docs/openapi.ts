/**
 * OpenAPI / Swagger spec for the Funtush API.
 *
 * The base document below hand-describes the security schemes, shared schemas,
 * and the core agency-dashboard endpoints. `swagger-jsdoc` additionally scans
 * every route file for `@openapi` JSDoc blocks and merges them in, so the rest
 * of the surface can be documented incrementally without touching this file.
 * See src/docs/README.md for the annotation pattern.
 */
import swaggerJsdoc from "swagger-jsdoc";

const port = process.env.PORT ?? 4000;

const baseDefinition: swaggerJsdoc.Options["definition"] = {
  openapi: "3.0.3",
  info: {
    title: "Funtush API",
    version: "0.1.0",
    description:
      "Backend for the Funtush agency operating system + public marketplace. " +
      "Phase 0: core agency-dashboard endpoints are documented here; other " +
      "routes are mounted and functional but not yet fully described.",
  },
  servers: [
    { url: `http://localhost:${port}`, description: "Local" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token from POST /auth/*/login (Authorization: Bearer <token>).",
      },
      refreshToken: {
        type: "apiKey",
        in: "header",
        name: "x-refresh-token",
        description:
          "Refresh token issued at registration. Used by most /agencies/me/* routes " +
          "to resolve the acting agency.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
      SubscriptionTier: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", example: "SMALL" },
          maxStaff: { type: "integer" },
          maxGuides: { type: "integer" },
          monthlyPrice: { type: "number" },
          features: { type: "object", additionalProperties: true },
        },
      },
      GuideCertification: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          issuingBody: { type: "string", nullable: true },
          number: { type: "string" },
          expiry: { type: "string", format: "date", example: "2027-06-15" },
          document: { type: "string", nullable: true },
        },
      },
      Guide: {
        type: "object",
        properties: {
          id: { type: "string" },
          guideRef: { type: "string" },
          name: { type: "string" },
          email: { type: "string", nullable: true },
          phone: { type: "string" },
          sex: { type: "string", nullable: true },
          photo: { type: "string", nullable: true },
          bio: { type: "string", nullable: true },
          languages: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["available", "on_trek", "unavailable"] },
          rating: { type: "number", nullable: true },
          certifications: {
            type: "array",
            items: { $ref: "#/components/schemas/GuideCertification" },
          },
          totalTreks: { type: "integer", description: "Only on GET /agencies/me/guides/{id}" },
          upcomingAssignments: {
            type: "array",
            description: "Only on GET /agencies/me/guides/{id}",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string", nullable: true },
                date: { type: "string", format: "date-time", nullable: true },
                status: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: "Auth" },
    { name: "Agency" },
    { name: "Packages" },
    { name: "Guides" },
    { name: "Blog" },
    { name: "Media" },
    { name: "Destinations" },
    { name: "Site Ads" },
    { name: "Safety" },
    { name: "Bookings" },
    { name: "Customers" },
    { name: "Staff & Roles" },
    { name: "Finance" },
    { name: "Analytics" },
    { name: "Branches" },
    { name: "Coupons" },
    { name: "Widgets" },
    { name: "Reviews" },
    { name: "Marketplace" },
    { name: "Admin" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Agency"],
        summary: "Liveness + dependency check",
        responses: {
          "200": { description: "All dependencies OK" },
          "503": { description: "A dependency (Postgres/Redis) is down" },
        },
      },
    },
    "/auth/agency/login": {
      post: {
        tags: ["Auth"],
        summary: "Agency staff login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Access + refresh tokens" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Exchange a refresh token for a new access token",
        responses: { "200": { description: "New access token" }, "401": { description: "Invalid refresh token" } },
      },
    },
    "/subscription-tiers": {
      get: {
        tags: ["Agency"],
        summary: "List all subscription tiers",
        responses: {
          "200": {
            description: "Tiers",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/SubscriptionTier" } },
              },
            },
          },
        },
      },
    },
    "/register/agency": {
      post: {
        tags: ["Agency"],
        summary: "Register a new agency (creates the owner user + FREE-tier agency)",
        responses: { "201": { description: "Agency created" }, "409": { description: "Email already in use" } },
      },
    },
    "/agencies/me/dashboard": {
      get: {
        tags: ["Agency"],
        summary: "Dashboard summary for the acting agency",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Summary stats" }, "401": { description: "Unauthorized" } },
      },
    },
    "/agencies/me/profile": {
      patch: {
        tags: ["Agency"],
        summary: "Update the agency's public profile (logo, description, address, contacts, regions)",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Updated profile" }, "401": { description: "Unauthorized" } },
      },
    },
    "/agencies/me/domain": {
      patch: {
        tags: ["Agency"],
        summary: "Set the agency's custom domain (paid tiers only)",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Updated" }, "403": { description: "Tier does not allow custom domains" } },
      },
    },
    "/agencies/me/kyc": {
      get: {
        tags: ["Agency"],
        summary: "KYC submission status",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Status" } },
      },
      post: {
        tags: ["Agency"],
        summary: "Submit KYC documents (multipart)",
        security: [{ refreshToken: [] }],
        responses: { "201": { description: "Submitted" } },
      },
    },
    "/agencies/packages": {
      get: {
        tags: ["Packages"],
        summary: "List the agency's trek packages",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Packages" } },
      },
      post: {
        tags: ["Packages"],
        summary: "Create a trek package",
        security: [{ refreshToken: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/agencies/packages/{id}": {
      patch: {
        tags: ["Packages"],
        summary: "Update a package",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        tags: ["Packages"],
        summary: "Archive a package",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Archived" } },
      },
    },
    "/agencies/packages/{id}/publish": {
      post: {
        tags: ["Packages"],
        summary: "Publish a package to the marketplace",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Published" } },
      },
    },
    "/bookings": {
      get: {
        tags: ["Bookings"],
        summary: "List the agency's bookings (filterable by status)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Bookings" } },
      },
    },
    "/bookings/inquiry": {
      post: {
        tags: ["Bookings"],
        summary: "Public: submit a booking inquiry for a package",
        responses: { "202": { description: "Inquiry received, OTP sent" } },
      },
    },
    "/bookings/{id}/accept": {
      patch: {
        tags: ["Bookings"],
        summary: "Accept a booking inquiry",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Accepted" } },
      },
    },
    "/agencies/me/customers": {
      get: {
        tags: ["Customers"],
        summary: "List the agency's trekker customers",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Customers" } },
      },
    },
    "/agencies/me/staff": {
      get: {
        tags: ["Staff & Roles"],
        summary: "List agency staff",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Staff" } },
      },
      post: {
        tags: ["Staff & Roles"],
        summary: "Invite a staff member (creates user + temp password)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Invited" }, "409": { description: "Email already in use" } },
      },
    },
    "/agencies/me/roles": {
      get: {
        tags: ["Staff & Roles"],
        summary: "List the agency's custom roles",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Roles" } },
      },
      post: {
        tags: ["Staff & Roles"],
        summary: "Create a custom role",
        security: [{ refreshToken: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/agencies/me/finance/pnl": {
      get: {
        tags: ["Finance"],
        summary: "Profit & loss for a period",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "P&L" } },
      },
    },
    "/agencies/me/finance/payroll": {
      get: {
        tags: ["Finance"],
        summary: "List payroll runs",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Payroll" } },
      },
    },
    "/agencies/me/analytics": {
      get: {
        tags: ["Analytics"],
        summary: "Overview analytics (revenue, bookings, customers) for a period",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "period", in: "query", schema: { type: "string", enum: ["last_7_days", "last_30_days", "last_12_months", "custom"] } }],
        responses: { "200": { description: "Analytics" }, "403": { description: "Period requires a paid tier" } },
      },
    },
    "/agencies/me/reports/monthly": {
      get: {
        tags: ["Finance"],
        summary: "Download a monthly report (PDF or CSV)",
        security: [{ refreshToken: [] }],
        parameters: [
          { name: "month", in: "query", required: true, schema: { type: "string", example: "2026-03" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["pdf", "csv"] } },
        ],
        responses: { "200": { description: "Report file" } },
      },
    },
    "/agencies/me/branches": {
      get: {
        tags: ["Branches"],
        summary: "List the agency's branches",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Branches" } },
      },
    },
    "/marketplace/packages": {
      get: {
        tags: ["Marketplace"],
        summary: "Public: search published trek packages",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "destination", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Search results" } },
      },
    },
    "/marketplace/agencies": {
      get: {
        tags: ["Marketplace"],
        summary: "Public: list agencies in the directory",
        responses: { "200": { description: "Agencies" } },
      },
    },
    "/admin/dashboard": {
      get: {
        tags: ["Admin"],
        summary: "Platform dashboard stats",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Stats" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/agencies": {
      get: {
        tags: ["Admin"],
        summary: "List / filter all agencies",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Agencies" } },
      },
    },
    "/admin/kyc": {
      get: {
        tags: ["Admin"],
        summary: "KYC review queue",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Queue" } },
      },
    },
  },
};

export const openapiSpec = swaggerJsdoc({
  definition: baseDefinition,
  apis: ["src/routes/**/*.ts", "src/routes/**/*.js"],
});
