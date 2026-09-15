// ─────────────────────────────────────────────────────────────────────────────
// Trekker registration + preferences — end-to-end (API-wide docs/test pass,
// Batch 6).
//
// Found and fixed along the way (see trekker.routes.ts / trekker.controller.ts
// / trekker.service.ts):
//   - `PATCH /trekker-preferences` had **no auth at all**, and read
//     `trekkerId` straight from the request body — any caller could
//     overwrite any other trekker's preferences (an IDOR). Fixed:
//     `requireAuth` + `requireRole(["TREKKER"])`, trekkerId resolved from
//     the session.
//   - `trekkerPreferenceService` could never once succeed — it looked up
//     `TrekkerPreference` by an `id` that was actually the whole request
//     body object (a guaranteed Prisma validation error), then wrote
//     snake_case keys (`preferred_destinations`, etc.) the schema doesn't
//     have (`preferredDestinations` is the real column). Fixed to `upsert`
//     on `TrekkerPreference.trekkerId` (already `@unique`) with the correct
//     column names.
//   - `registerTrekker`'s controller ignored `createTrekker`'s real
//     `.status` (409 for a duplicate email) and hardcoded 500 for every
//     failure. Fixed to read it, same as every other controller in this
//     pass that had the same bug.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Trekker registration + preferences (e2e)", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.trekkerPreference.deleteMany({ where: { trekker: { userId: id } } }).catch(() => {});
      await db.trekker.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("POST /create/trekker registers a new trekker", async () => {
    const email = `trekker-e2e-${Date.now()}@example.com`;
    const res = await request(app).post("/create/trekker").send({
      email,
      password: "Str0ngPassw0rd!",
      fullName: "Jamie Trekker",
      phone: "9800000001",
      country: "Nepal",
      emergency_contact_name: "Sam",
      emergency_contact_phone: "9800000002",
    });

    expect(res.status).toBe(201);
    const created = await db.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    if (created) createdUserIds.push(created.id);
  });

  it("POST /create/trekker rejects a duplicate email with 409", async () => {
    const email = `trekker-e2e-dupe-${Date.now()}@example.com`;
    const first = await request(app).post("/create/trekker").send({
      email,
      password: "Str0ngPassw0rd!",
      fullName: "First",
      phone: "9800000003",
      country: "Nepal",
      emergency_contact_name: "Sam",
      emergency_contact_phone: "9800000004",
    });
    const created = await db.user.findUnique({ where: { email } });
    if (created) createdUserIds.push(created.id);

    const second = await request(app).post("/create/trekker").send({
      email,
      password: "Str0ngPassw0rd!",
      fullName: "Second",
      phone: "9800000005",
      country: "Nepal",
      emergency_contact_name: "Sam",
      emergency_contact_phone: "9800000006",
    });
    expect(second.status).toBe(409);
    void first;
  });

  describe("PATCH /trekker-preferences", () => {
    let userId: string;
    let trekkerId: string;
    let accessToken: string;

    async function setUp() {
      const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const user = await db.user.create({
        data: { email: `trekker-prefs-${s}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
        select: { id: true },
      });
      userId = user.id;
      createdUserIds.push(userId);

      const trekker = await db.trekker.create({ data: { userId }, select: { id: true } });
      trekkerId = trekker.id;

      accessToken = generateAccessToken({ userId, roleType: "TREKKER", role: "TREKKER" });
    }

    it("401s without a token", async () => {
      const res = await request(app).patch("/trekker-preferences").send({ budget_range: "MID" });
      expect(res.status).toBe(401);
    });

    it("403s a non-TREKKER role", async () => {
      await setUp();
      const staffToken = generateAccessToken({ userId, roleType: "TENANT", role: "AGENCY_ADMIN" });
      const res = await request(app)
        .patch("/trekker-preferences")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ budget_range: "MID" });
      expect(res.status).toBe(403);
    });

    it("creates a preferences row on first save (the upsert's create branch)", async () => {
      await setUp();
      const res = await request(app)
        .patch("/trekker-preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ preferred_destinations: ["Everest", "Annapurna"], budget_range: "MID", group_size_preference: 4 });

      expect(res.status).toBe(200);

      const row = await db.trekkerPreference.findUnique({ where: { trekkerId } });
      expect(row?.budgetRange).toBe("MID");
      expect(row?.groupSizePreference).toBe(4);
      expect(row?.preferredDestinations).toEqual(["Everest", "Annapurna"]);
    });

    it("updates the same row on a second save (the upsert's update branch) without duplicating it", async () => {
      await setUp();
      await request(app)
        .patch("/trekker-preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ budget_range: "LOW" });

      const res = await request(app)
        .patch("/trekker-preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ budget_range: "HIGH" });
      expect(res.status).toBe(200);

      const rows = await db.trekkerPreference.findMany({ where: { trekkerId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].budgetRange).toBe("HIGH");
    });

    it("cannot be used to overwrite a different trekker's preferences (the IDOR this pass closed)", async () => {
      await setUp();
      // A second, unrelated trekker.
      const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const victim = await db.user.create({
        data: { email: `trekker-victim-${s}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
        select: { id: true },
      });
      createdUserIds.push(victim.id);
      const victimTrekker = await db.trekker.create({ data: { userId: victim.id }, select: { id: true } });
      await db.trekkerPreference.create({ data: { trekkerId: victimTrekker.id, budgetRange: "UNTOUCHED" } });

      // Even sending the victim's trekkerId explicitly in the body changes nothing —
      // the session's own trekker id is what's actually used.
      await request(app)
        .patch("/trekker-preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ trekkerId: victimTrekker.id, budget_range: "ATTACKER_VALUE" });

      const victimRow = await db.trekkerPreference.findUnique({ where: { trekkerId: victimTrekker.id } });
      expect(victimRow?.budgetRange).toBe("UNTOUCHED");
    });
  });
});
