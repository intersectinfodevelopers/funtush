// GET /bookings filters used by the agency dashboard's Bookings page:
// multi-status tabs, trekker search, departure-date range, stable paging.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("GET /bookings filters (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  const get = (qs = "", c = ctx) => request(app).get(`/bookings${qs}`).set("Authorization", `Bearer ${c.accessToken}`);

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    const seed = await seedPackage(ctx.agencyId);
    const otherSeed = await seedPackage(other.agencyId);

    const mk = (agencyId: string, s: typeof seed, name: string, email: string, status: string) =>
      db.booking.create({
        data: {
          agencyId, packageId: s.packageId, departureDateId: s.departureDateId, groupSize: 1, totalPrice: 100,
          trekkerName: name, trekkerEmail: email, trekkerPhone: "9800000000", status: status as never,
        },
      });
    await mk(ctx.agencyId, seed, "Alice Anderson", "alice@example.com", "INQUIRY");
    await mk(ctx.agencyId, seed, "Bob Brown", "bob@brown.test", "ALTERNATIVE_PROPOSED");
    await mk(ctx.agencyId, seed, "Carol Chen", "carol@example.com", "PAID");
    await mk(ctx.agencyId, seed, "Dan Davis", "dan@example.com", "CONFIRMED");
    await mk(other.agencyId, otherSeed, "Alice Other-Agency", "alice@other.test", "INQUIRY");
  });

  afterAll(async () => {
    for (const c of [ctx, other]) {
      if (!c) continue;
      await db.booking.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
  });

  const names = (r: { body: { data: { bookings: { trekkerName: string }[] } } }) => r.body.data.bookings.map((b) => b.trekkerName).sort();

  it("filters by several statuses at once (one dashboard tab = several API statuses)", async () => {
    const r = await get("?status=INQUIRY,ALTERNATIVE_PROPOSED");
    expect(r.status).toBe(200);
    expect(names(r)).toEqual(["Alice Anderson", "Bob Brown"]);
    expect(r.body.data.total).toBe(2);
  });

  it("still accepts a single status, case-insensitively", async () => {
    expect(names(await get("?status=paid"))).toEqual(["Carol Chen"]);
  });

  it("rejects an unknown status with 400 — including the non-existent 'PENDING' it used to let through as a 500", async () => {
    expect((await get("?status=NOPE")).status).toBe(400);
    expect((await get("?status=PENDING")).status).toBe(400);
    expect((await get("?status=INQUIRY,NOPE")).status).toBe(400);
  });

  it("searches trekker name or email, case-insensitively, within the agency only", async () => {
    expect(names(await get("?search=alice"))).toEqual(["Alice Anderson"]); // not the other agency's Alice
    expect(names(await get("?search=BROWN.TEST"))).toEqual(["Bob Brown"]);
    expect((await get("?search=zzz")).body.data.total).toBe(0);
  });

  it("filters by departure date range", async () => {
    const first = await db.booking.findFirstOrThrow({ where: { agencyId: ctx.agencyId }, select: { departureDate: { select: { startDate: true } } } });
    const dep = first.departureDate.startDate.toISOString().split("T")[0];
    expect((await get(`?from=${dep}&to=${dep}`)).body.data.total).toBe(4);
    expect((await get("?from=2000-01-01&to=2000-01-02")).body.data.total).toBe(0);
    expect((await get("?from=not-a-date")).status).toBe(400);
  });

  it("combines filters and pages with a stable total", async () => {
    const p1 = await get("?status=INQUIRY,ALTERNATIVE_PROPOSED,PAID,CONFIRMED&limit=3&page=1");
    const p2 = await get("?status=INQUIRY,ALTERNATIVE_PROPOSED,PAID,CONFIRMED&limit=3&page=2");
    expect(p1.body.data.total).toBe(4);
    expect(p1.body.data.bookings).toHaveLength(3);
    expect(p2.body.data.bookings).toHaveLength(1);
    const ids = [...p1.body.data.bookings, ...p2.body.data.bookings].map((b: { id: string }) => b.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("ignores operator-shaped query values instead of passing them to Prisma", async () => {
    const r = await get("?search[contains]=x&status[in]=PAID");
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(4); // both keys ignored → unfiltered
  });
});
