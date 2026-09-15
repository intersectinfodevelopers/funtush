import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the coupon routes (API-wide docs/test pass, Batch 3).
 * Service-mocked. `/bookings/inquiry/apply-coupon` is public — no auth.
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
}));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    req.agencyId = authState.agencyId;
    next();
  },
}));

const createCouponService = vi.fn();
const updateCouponService = vi.fn();
const getAgencyCouponsService = vi.fn();
const validateAndApplyCoupon = vi.fn();

vi.mock("src/services/coupon.service", () => ({
  createCouponService: (...a: unknown[]) => createCouponService(...a),
  updateCouponService: (...a: unknown[]) => updateCouponService(...a),
  getAgencyCouponsService: (...a: unknown[]) => getAgencyCouponsService(...a),
  validateAndApplyCoupon: (...a: unknown[]) => validateAndApplyCoupon(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: couponRoutes } = await import("./coupon.route");

  const app = express();
  app.use(express.json());
  app.use("/", couponRoutes);

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
  authState.agencyId = undefined;
  createCouponService.mockResolvedValue({ id: "cp1" });
  updateCouponService.mockResolvedValue({ id: "cp1" });
  getAgencyCouponsService.mockResolvedValue([{ id: "cp1" }]);
  validateAndApplyCoupon.mockResolvedValue({ discount: 10 });
});

function authed() {
  return { "x-refresh-token": "tok" };
}

describe("auth", () => {
  it("401s the agency-scoped endpoints without a token", async () => {
    expect((await fetch(`${baseUrl}/agencies/me/coupons`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/coupons`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/coupons/cp1`, { method: "PATCH" })).status).toBe(401);
  });

  it("does not require auth for apply-coupon (public)", async () => {
    const res = await fetch(`${baseUrl}/bookings/inquiry/apply-coupon`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(res.status).not.toBe(401);
  });
});

describe("authenticated calls", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("GET lists the agency's coupons", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/coupons`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getAgencyCouponsService).toHaveBeenCalledWith("agency-1");
  });

  it("POST creates a coupon", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/coupons`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ code: "SAVE10", percentOff: 10 }),
    });
    expect(res.status).toBe(201);
    expect(createCouponService).toHaveBeenCalledWith("agency-1", { code: "SAVE10", percentOff: 10 });
  });

  it("surfaces a service error as 400", async () => {
    createCouponService.mockRejectedValue(new Error("Coupon code already exists"));
    const res = await fetch(`${baseUrl}/agencies/me/coupons`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ code: "DUPE" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH updates a coupon", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/coupons/cp1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ percentOff: 15 }),
    });
    expect(res.status).toBe(200);
    expect(updateCouponService).toHaveBeenCalledWith("agency-1", "cp1", { percentOff: 15 });
  });
});

describe("PATCH /bookings/inquiry/apply-coupon", () => {
  it("applies a valid coupon code", async () => {
    const res = await fetch(`${baseUrl}/bookings/inquiry/apply-coupon`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "SAVE10", inquiryId: "inq-1" }),
    });
    expect(res.status).toBe(201);
    expect(validateAndApplyCoupon).toHaveBeenCalledWith({ code: "SAVE10", inquiryId: "inq-1" });
  });

  it("400s an invalid/expired code", async () => {
    validateAndApplyCoupon.mockRejectedValue(new Error("Coupon has expired"));
    const res = await fetch(`${baseUrl}/bookings/inquiry/apply-coupon`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "OLD" }),
    });
    expect(res.status).toBe(400);
  });
});
