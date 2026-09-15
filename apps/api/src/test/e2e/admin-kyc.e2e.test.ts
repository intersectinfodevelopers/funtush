// ─────────────────────────────────────────────────────────────────────────────
// Admin KYC review + email queue — end-to-end (API-wide docs/test pass,
// Batch 1). Both route files sit on `kyc.service.ts`. Skips cleanly when the
// docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

d("Admin KYC review (e2e)", () => {
  let ctx: E2EContext;
  let submissionId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const submission = await db.kycSubmission.create({
      data: { agencyId: ctx.agencyId },
      select: { id: true },
    });
    submissionId = submission.id;
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  it("is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/kyc");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /admin/kyc lists SUBMITTED submissions, oldest first", async () => {
    const res = await request(app).get("/admin/kyc").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s: { id: string }) => s.id === submissionId)).toBe(true);
  });

  it("GET /admin/kyc/:id returns the submission with agency + documents", async () => {
    const res = await request(app).get(`/admin/kyc/${submissionId}`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(submissionId);
    expect(res.body.agency.id).toBe(ctx.agencyId);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  it("GET /admin/kyc/:id 404s for an unknown id", async () => {
    const res = await request(app).get("/admin/kyc/does-not-exist").set(adminHeaders);
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/reject requires a reason", async () => {
    const res = await request(app).patch(`/admin/kyc/${submissionId}/reject`).set(adminHeaders).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/approve approves the submission; a second approve 409s", async () => {
    const res = await request(app).patch(`/admin/kyc/${submissionId}/approve`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");

    const again = await request(app).patch(`/admin/kyc/${submissionId}/approve`).set(adminHeaders);
    expect(again.status).toBe(409);
  });

  it("PATCH /:id/reject 409s once the submission is no longer SUBMITTED", async () => {
    const res = await request(app)
      .patch(`/admin/kyc/${submissionId}/reject`)
      .set(adminHeaders)
      .send({ reason: "Too late, already approved" });
    expect(res.status).toBe(409);
  });

  it("PATCH /:id/approve 404s for an unknown id", async () => {
    const res = await request(app).patch("/admin/kyc/does-not-exist/approve").set(adminHeaders);
    expect(res.status).toBe(404);
  });
});

d("Admin email queue (e2e)", () => {
  it("is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/email-queue");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /admin/email-queue returns a grouped summary", async () => {
    const res = await request(app).get("/admin/email-queue").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty("pending");
    expect(res.body.summary).toHaveProperty("sent");
    expect(res.body.summary).toHaveProperty("failed");
    expect(res.body.summary.total).toBe(res.body.data.length);
  });

  it("GET /admin/email-queue?status=sent filters by status", async () => {
    const res = await request(app).get("/admin/email-queue").query({ status: "sent" }).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { status: string }) => e.status === "sent")).toBe(true);
  });

  it("GET /admin/email-queue?status=bogus rejects an unknown status with 400", async () => {
    const res = await request(app).get("/admin/email-queue").query({ status: "bogus" }).set(adminHeaders);
    expect(res.status).toBe(400);
  });
});
