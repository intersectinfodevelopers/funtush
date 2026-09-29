// GET /agencies/packages/:id — one package with itinerary, departures, add-ons.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("GET /agencies/packages/:id (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let packageId: string;
  let otherPackageId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    packageId = (await seedPackage(ctx.agencyId)).packageId;
    otherPackageId = (await seedPackage(other.agencyId)).packageId;
    await db.trekItinerary.createMany({
      data: [
        { packageId, dayNumber: 2, location: "Namche" },
        { packageId, dayNumber: 1, location: "Lukla" },
      ],
    });
  });
  afterAll(async () => {
    await ctx?.cleanup();
    await other?.cleanup();
  });

  const get = (id: string, c = ctx) => request(app).get(`/agencies/packages/${id}`).set("x-refresh-token", c.refreshToken);

  it("requires a session", async () => {
    expect((await request(app).get(`/agencies/packages/${packageId}`)).status).toBe(401);
  });

  it("returns the package with itinerary (in day order), departures with seat counts and add-ons", async () => {
    const r = await get(packageId);
    expect(r.status).toBe(200);
    const p = r.body.data;
    expect(p.id).toBe(packageId);
    expect(p.itineraries.map((i: { location: string }) => i.location)).toEqual(["Lukla", "Namche"]);
    expect(p.departureDates.length).toBeGreaterThanOrEqual(1);
    expect(p.departureDates[0]).toHaveProperty("maxSlots");
    expect(p.departureDates[0]).toHaveProperty("bookedSlots");
    expect(Array.isArray(p.addOns)).toBe(true);
  });

  it("404s for another agency's package, exactly like a missing one", async () => {
    const foreign = await get(otherPackageId);
    const missing = await get("00000000-0000-0000-0000-000000000000");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it("list: title search, sort, tab counts and the next upcoming departure", async () => {
    const mk = (title: string, price: number, days: number, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") =>
      db.trekPackage.create({
        data: {
          agencyId: ctx.agencyId, title, slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          durationDays: days, pricePerPerson: price, difficulty: "EASY", maxGroupSize: 8, status,
        },
      });
    await mk("Zebra Cheap Trek", 100, 3, "DRAFT");
    await mk("Zebra Pricey Trek", 900, 20, "ARCHIVED");
    const get = (qs: string) => request(app).get(`/agencies/packages${qs}`).set("x-refresh-token", ctx.refreshToken);

    const found = await get("?search=zebra&sort=price_asc");
    expect(found.body.data.map((p: { title: string }) => p.title)).toEqual(["Zebra Cheap Trek", "Zebra Pricey Trek"]);
    expect((await get("?search=ZEBRA&sort=price_desc")).body.data[0].title).toBe("Zebra Pricey Trek");
    expect((await get("?search=zebra&sort=duration")).body.data[0].title).toBe("Zebra Cheap Trek");
    expect((await get("?search=nomatch")).body.meta.total).toBe(0);

    // counts ignore the filter and cover the whole agency
    const c = (await get("?search=zebra")).body.counts;
    expect(c.DRAFT).toBeGreaterThanOrEqual(1);
    expect(c.ARCHIVED).toBe(1);
    expect(c.PUBLISHED).toBeGreaterThanOrEqual(1); // the seeded package

    // the seeded package has an upcoming departure; the new ones have none
    const seeded = (await get("?limit=100")).body.data.find((p: { id: string }) => p.id === packageId);
    expect(seeded.nextDeparture).toMatchObject({ maxSlots: expect.any(Number), bookedSlots: expect.any(Number) });
    expect(found.body.data[0].nextDeparture).toBeNull();
  });

  it("the list rejects an unknown status with 400 (it used to 500 inside Prisma)", async () => {
    expect((await request(app).get("/agencies/packages?status=NOPE").set("x-refresh-token", ctx.refreshToken)).status).toBe(400);
    expect((await request(app).get("/agencies/packages?status=draft").set("x-refresh-token", ctx.refreshToken)).status).toBe(200);
  });
});

d("Destination media URLs (e2e)", () => {
  it("accepts http(s) media URLs and rejects javascript:/data:/junk", async () => {
    const c = await createAgencyContext();
    try {
      const post = (b: object) => request(app).post("/agencies/me/destinations").set("x-refresh-token", c.refreshToken).send(b);
      const ok = await post({ title: "Media OK", featuredImage: "https://cdn.example.com/a.png", gallery: ["https://cdn.example.com/b.png"] });
      expect(ok.status).toBe(201);
      for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "not a url", "ftp://x/y.png"]) {
        expect((await post({ title: "Bad " + bad.slice(0, 4), featuredImage: bad })).status).toBe(400);
        expect((await post({ title: "Bad G", gallery: [bad] })).status).toBe(400);
      }
      const id = ok.body.data.id;
      expect((await request(app).patch(`/agencies/me/destinations/${id}`).set("x-refresh-token", c.refreshToken).send({ featuredImage: "javascript:alert(1)" })).status).toBe(400);
    } finally {
      await db.agencyDestination.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
  }, 15_000);
});
