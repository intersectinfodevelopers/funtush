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
        summary: "Exchange a refresh token for a new access + refresh token pair (single use — the old refresh token is consumed)",
        responses: { "200": { description: "New token pair" }, "401": { description: "Invalid or already-used refresh token" } },
      },
    },
    "/auth/admin/login": {
      post: {
        tags: ["Auth"],
        summary: "Platform (super-admin) login — locks for 15 min after 5 failed attempts",
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
          "401": { description: "Invalid credentials or not a super admin" },
          "429": { description: "Account temporarily locked" },
        },
      },
    },
    "/auth/trekker/login": {
      post: {
        tags: ["Auth"],
        summary: "Trekker login",
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
        responses: { "200": { description: "Access + refresh tokens" }, "401": { description: "Invalid credentials" } },
      },
    },
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new trekker account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "confirmPassword"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password", description: "Min 8 chars, upper+lower+digit" },
                  confirmPassword: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Registered" }, "400": { description: "Invalid input or email already exists" } },
      },
    },
    "/auth/verify-otp": {
      post: {
        tags: ["Auth"],
        summary: "Verify a trekker's registration OTP (marks the trekker's email verified)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["userId", "otp"],
                properties: {
                  userId: { type: "string", description: "The trekker id (not the user id), despite the field name" },
                  otp: { type: "string", minLength: 6, maxLength: 6 },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Verified" }, "400": { description: "Invalid or expired OTP" } },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "The authenticated caller's identity (role, roleType, agencyId, permissions)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Identity" }, "401": { description: "Unauthorized" } },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Invalidate a refresh token",
        responses: { "200": { description: "Logged out" }, "400": { description: "Logout failed" } },
      },
    },
    "/auth/trekker/resend-otp": {
      post: {
        tags: ["Auth"],
        summary: "Resend a trekker's registration OTP (max 3 per hour per email)",
        responses: { "200": { description: "Sent" }, "500": { description: "Unknown email or rate-limited" } },
      },
    },
    "/auth/fcm-token": {
      post: {
        tags: ["Auth"],
        summary: "Register a device's FCM push-notification token for the authenticated user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Registered" }, "400": { description: "fcmToken is required" } },
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
      get: {
        tags: ["Agency"],
        summary: "Subdomain, custom domain, verification status, and publish state",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Domain settings" }, "401": { description: "Unauthorized" } },
      },
      patch: {
        tags: ["Agency"],
        summary: "Connect (or replace) the agency's custom domain (paid tiers only)",
        security: [{ refreshToken: [] }],
        responses: {
          "200": { description: "Connected — returns DNS instructions to verify" },
          "400": { description: "Not a well-formed domain" },
          "403": { description: "Tier does not allow custom domains" },
        },
      },
      delete: {
        tags: ["Agency"],
        summary: "Disconnect the agency's custom domain (paid tiers only)",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Disconnected" }, "403": { description: "Tier does not allow custom domains" } },
      },
    },
    "/agencies/me/domain/verify": {
      post: {
        tags: ["Agency"],
        summary: "Re-check DNS ownership of the connected custom domain right now (paid tiers only)",
        security: [{ refreshToken: [] }],
        responses: {
          "200": { description: "Verification result" },
          "400": { description: "No domain connected yet" },
          "403": { description: "Tier does not allow custom domains" },
        },
      },
    },
    "/agencies/me/publish": {
      post: {
        tags: ["Agency"],
        summary: "Publish the agency's site (every tier, including FREE)",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Published" }, "401": { description: "Unauthorized" } },
      },
    },
    "/agencies/me/unpublish": {
      post: {
        tags: ["Agency"],
        summary: "Unpublish the agency's site (every tier, including FREE)",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Unpublished" }, "401": { description: "Unauthorized" } },
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
        summary: "List / filter all agencies (search, tier, status, join date, pagination)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Agencies" } },
      },
    },
    "/admin/agencies/{id}": {
      get: {
        tags: ["Admin"],
        summary: "Full agency profile — booking/staff summary, KYC status",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Profile" }, "404": { description: "Not found" } },
      },
    },
    "/admin/agencies/{id}/tier": {
      patch: {
        tags: ["Admin"],
        summary: "Change an agency's subscription tier immediately",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" }, "500": { description: "Unknown tier name" } },
      },
    },
    "/admin/agencies/{id}/status": {
      patch: {
        tags: ["Admin"],
        summary: "Set an agency's status to ACTIVE, SUSPENDED, or LOCKED (reason required, audit-logged)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" }, "400": { description: "Missing status/reason" } },
      },
    },
    "/admin/agencies/{id}/visibility": {
      patch: {
        tags: ["Admin"],
        summary: "Set a marketplace-visibility priority override (super-admin only — platform-admin JWT required, not just IP-whitelisted admin context)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Updated, visibility score recomputed" },
          "400": { description: "admin_override must be a non-negative integer" },
          "401": { description: "No platform-admin bearer token" },
          "403": { description: "Not a super admin" },
        },
      },
    },
    "/admin/agencies/{id}/impersonate": {
      post: {
        tags: ["Admin"],
        summary: "Issue a short-lived (15 min) impersonation token for support",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Token issued" }, "404": { description: "Agency not found" } },
      },
    },
    "/admin/ad-campaigns/pending": {
      get: {
        tags: ["Admin"],
        summary: "Queue of ad campaigns awaiting approval (Large-tier agencies)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Pending campaigns" } },
      },
    },
    "/admin/ad-campaigns/active": {
      get: {
        tags: ["Admin"],
        summary: "Running ad campaigns with impressions/clicks/spend",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Active campaigns" } },
      },
    },
    "/admin/ad-campaigns/{id}/approve": {
      patch: {
        tags: ["Admin"],
        summary: "Approve and push a campaign live via the ad platform (platform-admin JWT required)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Live" }, "401": { description: "No platform-admin token" } },
      },
    },
    "/admin/ad-campaigns/{id}/reject": {
      patch: {
        tags: ["Admin"],
        summary: "Reject a pending campaign with a reason (platform-admin JWT required)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Rejected" }, "409": { description: "Already resolved" } },
      },
    },
    "/admin/ad-campaigns/{id}/pause": {
      patch: {
        tags: ["Admin"],
        summary: "Pause a running campaign immediately (platform-admin JWT required)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Paused" }, "401": { description: "No platform-admin token" } },
      },
    },
    "/admin/fraud/queue": {
      get: {
        tags: ["Admin"],
        summary: "Pending fraud flags, strongest signal first",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Queue" } },
      },
    },
    "/admin/fraud/ban-registry": {
      get: {
        tags: ["Admin"],
        summary: "Every permanently banned account",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Registry" } },
      },
    },
    "/admin/fraud/{id}/confirm": {
      patch: {
        tags: ["Admin"],
        summary: "Confirm a fraud flag — bans the account and blocklists its fingerprint/IP/email",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Confirmed" }, "409": { description: "Already resolved" } },
      },
    },
    "/admin/fraud/{id}/dismiss": {
      patch: {
        tags: ["Admin"],
        summary: "Dismiss a fraud flag — clears it and resets the account's risk score",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Dismissed" }, "409": { description: "Already resolved" } },
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
    "/admin/kyc/{id}": {
      get: {
        tags: ["Admin"],
        summary: "One KYC submission with agency and document details",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Submission" }, "404": { description: "Not found" } },
      },
    },
    "/admin/kyc/{id}/approve": {
      patch: {
        tags: ["Admin"],
        summary: "Approve a KYC submission",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Approved" }, "409": { description: "Already reviewed" } },
      },
    },
    "/admin/kyc/{id}/reject": {
      patch: {
        tags: ["Admin"],
        summary: "Reject a KYC submission with a reason",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Rejected" }, "400": { description: "Reason required" } },
      },
    },
    "/admin/email-queue": {
      get: {
        tags: ["Admin"],
        summary: "Outgoing email queue, grouped by status (pending/sent/failed)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Queue" }, "400": { description: "Invalid status filter" } },
      },
    },
    "/admin/analytics": {
      get: {
        tags: ["Admin"],
        summary: "Platform-wide overview — bookings, revenue by tier, top destinations",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Overview" } },
      },
    },
    "/admin/analytics/agencies": {
      get: {
        tags: ["Admin"],
        summary: "Top performing agencies by bookings, revenue, retention",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Performance" } },
      },
    },
    "/admin/analytics/marketplace": {
      get: {
        tags: ["Admin"],
        summary: "Most searched destinations, popular filters, conversion funnel",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Marketplace analytics" } },
      },
    },
    "/admin/analytics/tiers": {
      get: {
        tags: ["Admin"],
        summary: "Trial-to-paid conversion rate and churn rate per tier",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Tier analytics" } },
      },
    },
    "/admin/safety-warnings/{id}/warning": {
      post: {
        tags: ["Admin"],
        summary: "Issue a formal, permanent safety warning against an agency",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Warning issued" }, "404": { description: "Agency not found" } },
      },
    },
    "/admin/sos/active": {
      get: {
        tags: ["Admin"],
        summary: "Live feed of active/acknowledged SOS incidents, with acknowledgment-overdue flags",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Active incidents" } },
      },
    },
    "/admin/sos/history": {
      get: {
        tags: ["Admin"],
        summary: "Past (resolved/cancelled) SOS incidents",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "History" } },
      },
    },
    "/admin/sos/{id}/notes": {
      post: {
        tags: ["Admin"],
        summary: "Add an admin observation note to an SOS incident",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Note added" }, "404": { description: "Incident not found" } },
      },
    },
    "/admin/sos/{id}/export": {
      get: {
        tags: ["Admin"],
        summary: "Structured law-enforcement export of a full incident record",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Export" }, "404": { description: "Incident not found" } },
      },
    },
  },
};

export const openapiSpec = swaggerJsdoc({
  definition: baseDefinition,
  apis: ["src/routes/**/*.ts", "src/routes/**/*.js"],
});
