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
    { url: "/", description: "Same origin as these docs" },
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
    { name: "Meta" },
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
    "/docs.json": {
      get: {
        tags: ["Meta"],
        summary: "This OpenAPI spec, as raw JSON",
        description: "Same document /docs (Swagger UI) renders. Disabled in production unless ENABLE_DOCS=true.",
        responses: { "200": { description: "The OpenAPI 3.0 document" } },
      },
    },
    "/metrics": {
      get: {
        tags: ["Meta"],
        summary: "Prometheus scrape target",
        description: "Request rate, latency, and error-rate histograms labeled by method + route pattern, plus default Node.js process metrics. Not disabled in production (a scraper needs it there) — restrict access at the reverse-proxy/network layer instead.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "text/plain; version=0.0.4 Prometheus exposition format" }, "401": { description: "METRICS_TOKEN is set and the bearer token is missing/wrong" }, "404": { description: "Production with no METRICS_TOKEN configured" } },
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
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Email a password-reset link. Always the same 200, whether or not the account exists",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } },
        },
        responses: { "200": { description: "Accepted (no account enumeration)" } },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Set a new password with the token from the reset email",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "Password updated" },
          "400": { description: "Invalid/expired token, or weak password" },
          "429": { description: "Too many attempts" },
        },
      },
    },
    "/auth/change-password": {
      post: {
        tags: ["Auth"],
        summary: "Signed-in password change (any user type). Not available during an admin support session",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: { currentPassword: { type: "string" }, newPassword: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password updated — sign in again" },
          "400": { description: "Wrong current password, or weak new password" },
          "401": { description: "Unauthorized" },
          "403": { description: "Not available during a support session" },
        },
      },
    },
    "/auth/support-session/exchange": {
      post: {
        tags: ["Auth"],
        summary: "Exchange the one-time code from an admin's \"View agency dashboard\" click for support-session tokens",
        description: "Public by design (the new tab has no session yet). Single use, valid 60 s, rate-limited. Response is Cache-Control: no-store.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Support-session tokens" },
          "400": { description: "Invalid, expired, or already-used code" },
          "429": { description: "Too many attempts" },
        },
      },
    },
    "/auth/break-glass/redeem": {
      post: {
        tags: ["Auth"],
        summary: "Redeem an admin-issued break-glass recovery code and set a new password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "Password updated" },
          "400": { description: "Invalid/expired/used code, or weak password" },
        },
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
    "/agencies/me/access": {
      get: {
        tags: ["Agency"],
        summary: "What the signed-in agency user may see: the owner gets every permission, staff get their role's",
        security: [{ refreshToken: [] }],
        responses: {
          "200": { description: "{ role: AGENCY_ADMIN | STAFF, admin, permissions[] }" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/agencies/me/profile": {
      get: {
        tags: ["Agency"],
        summary: "The agency's public profile",
        security: [{ refreshToken: [] }],
        responses: { "200": { description: "Profile" }, "401": { description: "Unauthorized" } },
      },
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
        summary: "List the agency's trek packages (paginated, newest first)",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "destination", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", description: "Page size, clamped to 1-100. Non-numeric values fall back to the default (50).", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
        responses: { "200": { description: "{ success, data: Package[], meta: { total, page, limit, pages } }" } },
      },
      post: {
        tags: ["Packages"],
        summary: "Create a trek package",
        security: [{ refreshToken: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/agencies/packages/{id}": {
      get: {
        tags: ["Packages"],
        summary: "Get one package with its itinerary, departure dates (with seat counts), add-ons and destinations",
        security: [{ refreshToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "The package" }, "404": { description: "Not found (or another agency's)" } },
      },
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
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", description: "Page size, clamped to 1-100. Non-numeric values fall back to the default (20).", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }],
        responses: { "200": { description: "{ success, data: { bookings, total, page, limit } }" } },
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
        parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", description: "Page size, clamped to 1-100. Non-numeric values fall back to the default (20).", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, { name: "search", in: "query", schema: { type: "string" } }, { name: "customerType", in: "query", schema: { type: "string", enum: ["repeat", "new"] } }, { name: "destination", in: "query", schema: { type: "string" } }, { name: "bookingStatus", in: "query", schema: { type: "string" } }, { name: "sortBy", in: "query", schema: { type: "string", enum: ["lastBookingDate", "totalBookings", "totalSpending"] } }, { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }],
        responses: { "200": { description: "{ success, result: { data: Customer[], meta: { page, limit, total, totalPages } } }" } },
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
        summary: "Start a real, working 1-hour agency session as the agency's primary AGENCY_ADMIN user, for support",
        description:
          "Returns a real accessToken/refreshToken pair (same shape as /auth/agency/login), signed for the agency's own primary AGENCY_ADMIN — not the calling admin. Send the returned refreshToken as x-refresh-token to any agency-dashboard route to use it. Deliberately not persisted server-side, so POST /auth/refresh cannot extend it past the 1-hour window. A reason is required — it's recorded on the AGENCY_IMPERSONATED audit entry and emailed to the agency as a support-access notification. Every mutating request made with the issued tokens is separately audit-logged (IMPERSONATION_ACTION). Requires a platform super-admin JWT (Authorization: Bearer) in addition to the IP-whitelisted admin context. Can be ended early with DELETE on this same path.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["reason"],
                properties: { reason: { type: "string", description: "Why this session is needed — required, audit-logged, and emailed to the agency" } },
              },
            },
          },
        },
        responses: {
          "201": { description: "Session started — { accessToken, refreshToken, expiresAt, ttlSeconds, agencyId, agencyName, impersonatedUserId, impersonatedEmail, sessionId }" },
          "400": { description: "reason is required" },
          "403": { description: "Agency is banned" },
          "404": { description: "Agency not found, or has no AGENCY_ADMIN user" },
        },
      },
      delete: {
        tags: ["Admin"],
        summary: "End the agency's active support session before its natural 1-hour expiry",
        description:
          "Impersonation tokens are stateless JWTs that can't be recalled once issued, so this deletes the Redis pointer authenticateWithRefreshToken / checkImpersonationActive check on every request one of those tokens makes — the tokens still decode fine afterward, but every request they make 401s with 'This support session has ended.' Works even from a session that didn't start the impersonation (e.g. to confirm nothing is left running). Audit-logged as AGENCY_IMPERSONATION_REVOKED.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "{ revoked: true } — a no-op if no session was active" },
          "401": { description: "No platform-admin bearer token" },
          "403": { description: "Not a super admin" },
        },
      },
    },
    "/admin/agencies/{id}/break-glass": {
      post: {
        tags: ["Admin"],
        summary: "Issue a single-use recovery code for an agency owner who can't use \"Forgot password\"",
        description:
          "The code is returned ONCE, for the admin to hand to the verified owner out-of-band; the owner redeems it at POST /auth/break-glass/redeem. Requires a platform super-admin JWT plus the IP-whitelisted admin context. A reason is mandatory and audit-logged. Response is Cache-Control: no-store.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } },
        },
        responses: {
          "201": { description: "Code issued (shown once)" },
          "400": { description: "reason is required" },
          "403": { description: "Not a super admin, or the agency is banned" },
          "404": { description: "Agency not found, or has no AGENCY_ADMIN user" },
        },
      },
      delete: {
        tags: ["Admin"],
        summary: "Revoke any outstanding break-glass code for the agency",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Revoked" }, "403": { description: "Not a super admin" } },
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
