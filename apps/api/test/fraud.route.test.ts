import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// vi.mock is hoisted to the top, so the objects its factories reference must be
// created with vi.hoisted (also hoisted) � otherwise they''re not initialized yet.
const { mockPrisma, queueEmailMock } = vi.hoisted(() => ({
  mockPrisma: {
    fraudFlag: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    agency:         { update: vi.fn(), findMany: vi.fn() },
    blocklistEntry: { createMany: vi.fn() },
    $transaction:   vi.fn(),
  },
  queueEmailMock: vi.fn().mockResolvedValue("email_id_123"),
}));

vi.mock("../src/packages/database/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../src/lib/emailQueue", () => ({
  queueEmail: (...args: unknown[]) => queueEmailMock(...args),
}));

import fraudRouter from "../src/routes/admin/fraud.route.js";

const app: Express = express();
app.use(express.json());
app.use("/admin/fraud", fraudRouter);

const PENDING_FLAG = {
  id:              "flag_001",
  agencyId:        "agency_xyz",
  signal:          "RED",
  status:          "PENDING",
  flagsTriggered:  ["DUPLICATE_FINGERPRINT", "DISPOSABLE_EMAIL"],
  evidenceSummary: "Same device fingerprint as 3 banned accounts",
  fingerprint:     "fp_abc123",
  ip:              "203.0.113.7",
  email:           "spam@temp.com",
  createdAt:       new Date("2024-01-15"),
  agency: { id: "agency_xyz", name: "XYZ Adventures", email: "admin@xyz.com", createdAt: new Date("2024-01-01") },
};

describe("Fraud queue admin routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /queue returns flagged accounts sorted by signal strength", async () => {
    vi.mocked(mockPrisma.fraudFlag.findMany).mockResolvedValue([
      { ...PENDING_FLAG, id: "y1", signal: "YELLOW" },
      { ...PENDING_FLAG, id: "r1", signal: "RED" },
      { ...PENDING_FLAG, id: "o1", signal: "ORANGE" },
    ] as never);

    const res = await request(app).get("/admin/fraud/queue");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data.map((f: { signal: string }) => f.signal)).toEqual(["RED", "ORANGE", "YELLOW"]);
  });

  it("PATCH /:id/confirm bans the account and blocklists it", async () => {
    vi.mocked(mockPrisma.fraudFlag.findUnique).mockResolvedValue(PENDING_FLAG as never);
    vi.mocked(mockPrisma.$transaction).mockResolvedValue([
      { id: "flag_001", status: "CONFIRMED" },
      { id: "agency_xyz", status: "BANNED" },
      { count: 3 },
    ] as never);

    const res = await request(app)
      .patch("/admin/fraud/flag_001/confirm")
      .send({ reason: "Confirmed duplicate-account fraud" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  it("PATCH /:id/confirm returns 404 when the flag does not exist", async () => {
    vi.mocked(mockPrisma.fraudFlag.findUnique).mockResolvedValue(null);
    const res = await request(app).patch("/admin/fraud/nope/confirm").send({});
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/confirm returns 409 when the flag is already resolved", async () => {
    vi.mocked(mockPrisma.fraudFlag.findUnique).mockResolvedValue({ ...PENDING_FLAG, status: "CONFIRMED" } as never);
    const res = await request(app).patch("/admin/fraud/flag_001/confirm").send({});
    expect(res.status).toBe(409);
  });

  it("PATCH /:id/dismiss clears the flag, resets risk, and emails the agency", async () => {
    vi.mocked(mockPrisma.fraudFlag.findUnique).mockResolvedValue(PENDING_FLAG as never);
    vi.mocked(mockPrisma.$transaction).mockResolvedValue([
      { id: "flag_001", status: "DISMISSED" },
      { id: "agency_xyz", riskScore: 0 },
    ] as never);

    const res = await request(app).patch("/admin/fraud/flag_001/dismiss");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DISMISSED");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledOnce();
  });

  it("PATCH /:id/dismiss returns 404 when the flag does not exist", async () => {
    vi.mocked(mockPrisma.fraudFlag.findUnique).mockResolvedValue(null);
    const res = await request(app).patch("/admin/fraud/nope/dismiss");
    expect(res.status).toBe(404);
  });

  it("GET /ban-registry returns banned accounts with reasons", async () => {
    vi.mocked(mockPrisma.agency.findMany).mockResolvedValue([
      { id: "agency_xyz", name: "XYZ Adventures", email: "admin@xyz.com", bannedAt: new Date(), banReason: "Confirmed fraud" },
    ] as never);

    const res = await request(app).get("/admin/fraud/ban-registry");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].banReason).toBe("Confirmed fraud");
  });
});
