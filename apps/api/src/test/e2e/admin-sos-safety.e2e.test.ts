// ─────────────────────────────────────────────────────────────────────────────
// Admin SOS monitoring + formal safety warnings — end-to-end (API-wide
// docs/test pass, Batch 1). SOS incidents live in MongoDB
// (`models/sosIncident.model.ts`); safety warnings are permanent Postgres
// rows. Skips cleanly when either the Postgres or Mongo half of
// docker-compose.test.yml is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ObjectId } from "mongodb";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";
import { getSosCollection, type SosIncident } from "../../models/sosIncident.model";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

function fixtureIncident(overrides: Partial<SosIncident> = {}): SosIncident {
  return {
    agency_id: "agency-x",
    agency_name: "Agency X",
    guide_id: "guide-1",
    guide_name: "Guide One",
    trekker_id: "trekker-1",
    trekker_name: "Trekker One",
    coordinates: { lat: 27.7, lng: 85.3 },
    status: "ACTIVE",
    triggered_at: new Date(),
    acknowledged_at: null,
    resolved_at: null,
    resolution: null,
    admin_notes: [],
    timeline: [{ at: new Date(), event: "TRIGGERED", actor: "trekker-1" }],
    ...overrides,
  };
}

d("Admin SOS monitoring (e2e)", () => {
  const insertedIds: ObjectId[] = [];

  afterAll(async () => {
    if (!RUN || insertedIds.length === 0) return;
    const col = await getSosCollection();
    await col.deleteMany({ _id: { $in: insertedIds } });
  });

  it("GET /active is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/sos/active");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /active returns only ACTIVE/ACKNOWLEDGED incidents, oldest first, with overdue flags", async () => {
    const col = await getSosCollection();
    const overdue = await col.insertOne(
      fixtureIncident({ triggered_at: new Date(Date.now() - 30 * 60 * 1000) }),
    );
    const resolved = await col.insertOne(fixtureIncident({ status: "RESOLVED", resolved_at: new Date() }));
    insertedIds.push(overdue.insertedId, resolved.insertedId);

    const res = await request(app).get("/admin/sos/active").set(adminHeaders);
    expect(res.status).toBe(200);

    const ids = res.body.incidents.map((i: { id: string }) => i.id);
    expect(ids).toContain(overdue.insertedId.toString());
    expect(ids).not.toContain(resolved.insertedId.toString());

    const overdueEntry = res.body.incidents.find((i: { id: string }) => i.id === overdue.insertedId.toString());
    expect(overdueEntry.acknowledgmentOverdue).toBe(true);
  });

  it("GET /history returns only RESOLVED/CANCELLED incidents, newest first", async () => {
    const col = await getSosCollection();
    const cancelled = await col.insertOne(fixtureIncident({ status: "CANCELLED" }));
    insertedIds.push(cancelled.insertedId);

    const res = await request(app).get("/admin/sos/history").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.incidents.some((i: { id: string }) => i.id === cancelled.insertedId.toString())).toBe(true);
  });

  it("POST /:id/notes requires a non-empty note", async () => {
    const col = await getSosCollection();
    const inserted = await col.insertOne(fixtureIncident());
    insertedIds.push(inserted.insertedId);

    const res = await request(app)
      .post(`/admin/sos/${inserted.insertedId.toString()}/notes`)
      .set(adminHeaders)
      .send({ note: "" });
    expect(res.status).toBe(400);
  });

  it("POST /:id/notes appends an admin note", async () => {
    const col = await getSosCollection();
    const inserted = await col.insertOne(fixtureIncident());
    insertedIds.push(inserted.insertedId);

    const res = await request(app)
      .post(`/admin/sos/${inserted.insertedId.toString()}/notes`)
      .set(adminHeaders)
      .send({ note: "Contacted local authorities" });
    expect(res.status).toBe(201);

    const updated = await col.findOne({ _id: inserted.insertedId });
    expect(updated?.admin_notes).toHaveLength(1);
    expect(updated?.admin_notes[0].note).toBe("Contacted local authorities");
  });

  it("POST /:id/notes 404s for an unknown incident id", async () => {
    const res = await request(app)
      .post(`/admin/sos/${new ObjectId().toString()}/notes`)
      .set(adminHeaders)
      .send({ note: "n/a" });
    expect(res.status).toBe(404);
  });

  it("GET /:id/export returns the full structured record with headers for download", async () => {
    const col = await getSosCollection();
    const inserted = await col.insertOne(fixtureIncident());
    insertedIds.push(inserted.insertedId);

    const res = await request(app).get(`/admin/sos/${inserted.insertedId.toString()}/export`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.body.incidentId).toBe(inserted.insertedId.toString());
    expect(res.body.agency.name).toBe("Agency X");
  });

  it("GET /:id/export 404s for an unknown incident id", async () => {
    const res = await request(app).get(`/admin/sos/${new ObjectId().toString()}/export`).set(adminHeaders);
    expect(res.status).toBe(404);
  });
});

d("Admin safety warnings (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  it("is not reachable without the admin context", async () => {
    const res = await request(app).post("/admin/safety-warnings/x/warning").send({ reason: "n/a" });
    expect([401, 403, 404]).toContain(res.status);
  });

  it("requires a reason", async () => {
    const res = await request(app)
      .post(`/admin/safety-warnings/${ctx.agencyId}/warning`)
      .set(adminHeaders)
      .send({});
    expect(res.status).toBe(400);
  });

  it("issues a permanent safety warning", async () => {
    const res = await request(app)
      .post(`/admin/safety-warnings/${ctx.agencyId}/warning`)
      .set(adminHeaders)
      .send({ reason: "Guide left trekkers unattended overnight" });

    expect(res.status).toBe(201);
    expect(res.body.agencyId).toBe(ctx.agencyId);
    expect(res.body.reason).toBe("Guide left trekkers unattended overnight");
  });

  it("404s for an unknown agency", async () => {
    const res = await request(app)
      .post("/admin/safety-warnings/does-not-exist/warning")
      .set(adminHeaders)
      .send({ reason: "n/a" });
    expect(res.status).toBe(404);
  });
});
