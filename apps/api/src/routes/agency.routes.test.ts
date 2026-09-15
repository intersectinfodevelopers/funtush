import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for agency registration/profile/KYC/subscription-tiers
 * routes (API-wide docs/test pass — closing a gap where this file had
 * Swagger docs but zero test coverage anywhere).
 */

const { authState } = vi.hoisted(() => ({ authState: { valid: false, active: true } }));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.valid) return res.status(401).json({ success: false, message: "Unauthorized" });
    req.agencyId = "agency-1";
    next();
  },
}));

vi.mock("src/middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.active) return res.status(403).json({ success: false, message: "inactive" });
    next();
  },
}));

vi.mock("@funtush/storage", async () => {
  const actual = await vi.importActual<typeof import("@funtush/storage")>("@funtush/storage");
  return { ...actual, uploadFile: vi.fn().mockResolvedValue("https://cdn.example.com/doc.pdf") };
});

const createAgency = vi.fn();
const getSubscriptionTiers = vi.fn();
const updateAgencyProfileService = vi.fn();
const AgencyKYCService = vi.fn();
const KYCStatusService = vi.fn();
vi.mock("../services/agency.service", () => ({
  createAgency: (...a: unknown[]) => createAgency(...a),
  getSubscriptionTiers: (...a: unknown[]) => getSubscriptionTiers(...a),
  updateAgencyProfileService: (...a: unknown[]) => updateAgencyProfileService(...a),
  AgencyKYCService: (...a: unknown[]) => AgencyKYCService(...a),
  KYCStatusService: (...a: unknown[]) => KYCStatusService(...a),
  acceptBookingService: vi.fn(),
  agencySubscription: vi.fn(),
  getAgencyDashboardService: vi.fn(),
  publishPackageService: vi.fn(),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: agencyRoutes } = await import("./agency.routes");

  const app = express();
  app.use(express.json());
  app.use("/", agencyRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.valid = false;
  authState.active = true;
});

describe("POST /register/agency", () => {
  it("registers a new agency (no auth required)", async () => {
    createAgency.mockResolvedValue({ id: "agency-1", email: "a@example.com" });
    const res = await fetch(`${baseUrl}/register/agency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "x" }),
    });
    expect(res.status).toBe(201);
    expect(createAgency).toHaveBeenCalledWith({ email: "a@example.com", password: "x" });
  });

  it("500s when registration fails", async () => {
    createAgency.mockRejectedValue(new Error("Email already exists"));
    const res = await fetch(`${baseUrl}/register/agency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
  });
});

describe("GET /subscription-tiers", () => {
  it("returns tiers with no auth required", async () => {
    getSubscriptionTiers.mockResolvedValue([{ name: "FREE" }, { name: "MEDIUM" }]);
    const res = await fetch(`${baseUrl}/subscription-tiers`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(2);
  });
});

describe("GET /agencies/me/kyc", () => {
  it("401s without a session", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/kyc`);
    expect(res.status).toBe(401);
  });

  it("returns the agency's KYC status when authenticated", async () => {
    authState.valid = true;
    KYCStatusService.mockResolvedValue({ status: "PENDING" });
    const res = await fetch(`${baseUrl}/agencies/me/kyc`);
    expect(res.status).toBe(200);
    expect(KYCStatusService).toHaveBeenCalledWith("agency-1");
  });
});

describe("POST /agencies/me/kyc", () => {
  it("401s without a session", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/kyc`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("400s when no documents are attached", async () => {
    authState.valid = true;
    const res = await fetch(`${baseUrl}/agencies/me/kyc`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=----x" },
      body: "------x--\r\n",
    });
    expect(res.status).toBe(400);
  });

  it("400s when some but not all required documents are attached", async () => {
    authState.valid = true;
    const form = new FormData();
    form.append("business_registration", new Blob(["a"], { type: "application/pdf" }), "reg.pdf");
    const res = await fetch(`${baseUrl}/agencies/me/kyc`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(AgencyKYCService).not.toHaveBeenCalled();
  });

  it("uploads all 4 documents and submits KYC", async () => {
    authState.valid = true;
    AgencyKYCService.mockResolvedValue({ status: "PENDING" });
    const form = new FormData();
    form.append("business_registration", new Blob(["a"], { type: "application/pdf" }), "reg.pdf");
    form.append("pan_certificate", new Blob(["b"], { type: "application/pdf" }), "pan.pdf");
    form.append("tourism_license", new Blob(["c"], { type: "application/pdf" }), "license.pdf");
    form.append("bank_details", new Blob(["d"], { type: "application/pdf" }), "bank.pdf");

    const res = await fetch(`${baseUrl}/agencies/me/kyc`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(AgencyKYCService).toHaveBeenCalledWith("agency-1", {
      business_registration: "https://cdn.example.com/doc.pdf",
      pan_certificate: "https://cdn.example.com/doc.pdf",
      tourism_license: "https://cdn.example.com/doc.pdf",
      bank_details: "https://cdn.example.com/doc.pdf",
    });
  });
});

describe("PATCH /agencies/me/profile", () => {
  it("401s without a session", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s when the agency's subscription is inactive", async () => {
    authState.valid = true;
    authState.active = false;
    const res = await fetch(`${baseUrl}/agencies/me/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(403);
  });

  it("updates the profile when authenticated and active", async () => {
    authState.valid = true;
    updateAgencyProfileService.mockResolvedValue({ data: { name: "New Name" } });
    const res = await fetch(`${baseUrl}/agencies/me/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(200);
    expect(updateAgencyProfileService).toHaveBeenCalledWith({ name: "New Name" }, "agency-1");
  });
});
