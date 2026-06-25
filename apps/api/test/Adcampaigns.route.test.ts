import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ── Mock Prisma (same shim path the KYC test mocks) ──────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    adCampaign: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
  },
}));

// ── Mock ad platform adapter ─────────────────────────────────────────────────
vi.mock("../src/lib/adPlatforms", () => ({
  pushCampaignLive:      vi.fn(async () => ({ metaCampaignId: "meta_test", googleCampaignId: "ggl_test" })),
  pausePlatformCampaign: vi.fn(async () => {}),
  fetchCampaignMetrics:  vi.fn(async () => ({ impressions: 0, clicks: 0, spend: 0 })),
}));

// ── Mock emailQueue ──────────────────────────────────────────────────────────
const queueEmailMock = vi.fn().mockResolvedValue("email_id_123");
vi.mock("../src/lib/emailQueue", () => ({
  queueEmail: (...args: unknown[]) => queueEmailMock(...args),
}));

import adCampaignsRouter from "../src/routes/admin/adCampaigns.route";
import { prisma } from "../src/packages/database/prisma";

const app: Express = express();
app.use(express.json());
app.use("/admin/ad-campaigns", adCampaignsRouter);

beforeEach(() => vi.clearAllMocks());

describe("Ad campaign admin routes", () => {
  it("GET /pending returns pending campaigns with a total", async () => {
    vi.mocked(prisma.adCampaign.findMany).mockResolvedValue([{ id: "c1", status: "PENDING" }] as never);
    const res = await request(app).get("/admin/ad-campaigns/pending");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe("c1");
  });

  it("GET /active returns active campaigns with metrics", async () => {
    vi.mocked(prisma.adCampaign.findMany).mockResolvedValue(
      [{ id: "a1", status: "ACTIVE", impressions: 10, clicks: 2, spend: 5 }] as never
    );
    const res = await request(app).get("/admin/ad-campaigns/active");
    expect(res.status).toBe(200);
    expect(res.body.data[0].impressions).toBe(10);
  });

  it("PATCH /:id/approve pushes live, marks ACTIVE, emails the agency", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue({
      id: "c1", status: "PENDING", imageUrls: [], copyText: "x", targetingParams: {},
      agency: { email: "a@b.com" },
    } as never);
    vi.mocked(prisma.adCampaign.update).mockImplementation(
      (async ({ data }: { data: object }) => ({ id: "c1", ...data })) as never
    );
    const res = await request(app).patch("/admin/ad-campaigns/c1/approve");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.metaCampaignId).toBe("meta_test");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledOnce();
  });

  it("PATCH /:id/approve returns 404 when the campaign does not exist", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue(null);
    const res = await request(app).patch("/admin/ad-campaigns/nope/approve");
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/approve returns 409 when the campaign is not pending", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue(
      { id: "c1", status: "ACTIVE", agency: { email: "a@b.com" } } as never
    );
    const res = await request(app).patch("/admin/ad-campaigns/c1/approve");
    expect(res.status).toBe(409);
  });

  it("PATCH /:id/reject returns 400 when no reason is supplied", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue(
      { id: "c1", status: "PENDING", agency: { email: "a@b.com" } } as never
    );
    const res = await request(app).patch("/admin/ad-campaigns/c1/reject").send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/reject rejects with a reason and emails the agency", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue(
      { id: "c1", status: "PENDING", agency: { email: "a@b.com" } } as never
    );
    vi.mocked(prisma.adCampaign.update).mockImplementation(
      (async ({ data }: { data: object }) => ({ id: "c1", ...data })) as never
    );
    const res = await request(app).patch("/admin/ad-campaigns/c1/reject").send({ reason: "off-brand imagery" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");
    expect(res.body.data.rejectionReason).toBe("off-brand imagery");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledOnce();
  });

  it("PATCH /:id/pause pauses an active campaign", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue(
      { id: "a1", status: "ACTIVE", metaCampaignId: "meta_x", googleCampaignId: "ggl_x" } as never
    );
    vi.mocked(prisma.adCampaign.update).mockImplementation(
      (async ({ data }: { data: object }) => ({ id: "a1", ...data })) as never
    );
    const res = await request(app).patch("/admin/ad-campaigns/a1/pause");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAUSED");
  });

  it("PATCH /:id/pause returns 409 when the campaign is not active", async () => {
    vi.mocked(prisma.adCampaign.findUnique).mockResolvedValue({ id: "c1", status: "PENDING" } as never);
    const res = await request(app).patch("/admin/ad-campaigns/c1/pause");
    expect(res.status).toBe(409);
  });
});