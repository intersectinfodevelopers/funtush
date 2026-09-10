import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

const { svc } = vi.hoisted(() => ({
  svc: {
    getDomainMapping: vi.fn(),
    setCustomDomain: vi.fn(),
    verifyCustomDomain: vi.fn(),
    removeCustomDomain: vi.fn(),
  },
}));
class CustomDomainError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("../src/services/customDomain.service", () => ({ ...svc, CustomDomainError }));
vi.mock("../src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { agencyId?: string }).agencyId = "agency_1";
    next();
  },
}));
vi.mock("../src/middleware/agencyAccess.middleware", () => ({
  isPaidTier: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const router = (await import("../src/routes/customDomain.routes")).default;
const app: Express = express();
app.use(express.json());
app.use("/", router);

describe("custom-domain routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /agencies/me/domain returns the mapping", async () => {
    svc.getDomainMapping.mockResolvedValue({ domain: "x.com", status: "PENDING" });
    const res = await request(app).get("/agencies/me/domain");
    expect(res.status).toBe(200);
    expect(res.body.data.domain).toBe("x.com");
    expect(svc.getDomainMapping).toHaveBeenCalledWith("agency_1");
  });

  it("PUT /agencies/me/domain 400 without a domain", async () => {
    const res = await request(app).put("/agencies/me/domain").send({});
    expect(res.status).toBe(400);
    expect(svc.setCustomDomain).not.toHaveBeenCalled();
  });

  it("PUT /agencies/me/domain sets it", async () => {
    svc.setCustomDomain.mockResolvedValue({ domain: "book.acme.com", status: "PENDING" });
    const res = await request(app).put("/agencies/me/domain").send({ domain: "book.acme.com" });
    expect(res.status).toBe(200);
    expect(svc.setCustomDomain).toHaveBeenCalledWith("agency_1", "book.acme.com");
  });

  it("PUT surfaces a 409 conflict", async () => {
    svc.setCustomDomain.mockRejectedValue(new CustomDomainError(409, "claimed"));
    const res = await request(app).put("/agencies/me/domain").send({ domain: "taken.com" });
    expect(res.status).toBe(409);
  });

  it("POST /agencies/me/domain/verify runs verification", async () => {
    svc.verifyCustomDomain.mockResolvedValue({ status: "VERIFIED" });
    const res = await request(app).post("/agencies/me/domain/verify");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("VERIFIED");
  });

  it("POST verify → 404 when no domain is set", async () => {
    svc.verifyCustomDomain.mockRejectedValue(new CustomDomainError(404, "no domain"));
    const res = await request(app).post("/agencies/me/domain/verify");
    expect(res.status).toBe(404);
  });

  it("DELETE /agencies/me/domain removes it", async () => {
    svc.removeCustomDomain.mockResolvedValue({ removed: true });
    const res = await request(app).delete("/agencies/me/domain");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: true });
  });
});
