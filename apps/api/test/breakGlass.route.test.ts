import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

const { svc } = vi.hoisted(() => ({
  svc: {
    issueBreakGlass: vi.fn(),
    listBreakGlass: vi.fn(),
    revokeBreakGlass: vi.fn(),
    getAgencyBreakGlassHistory: vi.fn(),
  },
}));

class BreakGlassError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("../src/services/breakGlass.service", () => ({ ...svc, BreakGlassError }));
vi.mock("../src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { agencyId?: string }).agencyId = "agency_1";
    next();
  },
}));

const adminRouter = (await import("../src/routes/admin/breakGlass.route")).default;
const agencyRouter = (await import("../src/routes/breakGlass.routes")).default;

const app: Express = express();
app.use(express.json());
app.use("/admin/break-glass", adminRouter);
app.use("/", agencyRouter);

describe("break-glass routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /admin/break-glass 400 without agencyId", async () => {
    const res = await request(app).post("/admin/break-glass").send({ reason: "x" });
    expect(res.status).toBe(400);
    expect(svc.issueBreakGlass).not.toHaveBeenCalled();
  });

  it("POST /admin/break-glass issues a token", async () => {
    svc.issueBreakGlass.mockResolvedValue({
      token: "raw",
      expiresAt: new Date(),
      breakGlass: { id: "bg1", status: "ACTIVE" },
    });
    const res = await request(app)
      .post("/admin/break-glass")
      .set("x-forwarded-for", "9.9.9.9")
      .send({ agencyId: "agency_1", reason: "triage", ttlSeconds: 600 });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe("raw");
    expect(svc.issueBreakGlass).toHaveBeenCalledWith(
      "agency_1",
      expect.objectContaining({ issuedByIp: "9.9.9.9", reason: "triage", ttlSeconds: 600 }),
    );
  });

  it("POST /admin/break-glass 404 for unknown agency", async () => {
    svc.issueBreakGlass.mockRejectedValue(new BreakGlassError(404, "Agency not found"));
    const res = await request(app).post("/admin/break-glass").send({ agencyId: "nope" });
    expect(res.status).toBe(404);
  });

  it("GET /admin/break-glass passes filters", async () => {
    svc.listBreakGlass.mockResolvedValue([]);
    const res = await request(app).get("/admin/break-glass?agencyId=agency_1&active=true");
    expect(res.status).toBe(200);
    expect(svc.listBreakGlass).toHaveBeenCalledWith({ agencyId: "agency_1", activeOnly: true });
  });

  it("PATCH /admin/break-glass/:id/revoke → 409 when already revoked", async () => {
    svc.revokeBreakGlass.mockRejectedValue(new BreakGlassError(409, "already revoked"));
    const res = await request(app).patch("/admin/break-glass/bg1/revoke");
    expect(res.status).toBe(409);
  });

  it("GET /agencies/me/break-glass returns the redacted history", async () => {
    svc.getAgencyBreakGlassHistory.mockResolvedValue([
      { id: "bg1", reason: "triage", issuedAt: new Date(), expiresAt: new Date(), usedAt: null, revokedAt: null, status: "ACTIVE" },
    ]);
    const res = await request(app).get("/agencies/me/break-glass");
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("bg1");
    expect(svc.getAgencyBreakGlassHistory).toHaveBeenCalledWith("agency_1");
  });
});
