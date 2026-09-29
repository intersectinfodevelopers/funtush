// The package-builder fields, validation, volume discounts and unpublish.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";
import { discountedPricePerPerson, parseVolumeDiscounts } from "../../utils/validator";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

describe("volume discounts (pure)", () => {
  const tiers = [{ minPeople: 4, percentOff: 5 }, { minPeople: 8, percentOff: 12.5 }];
  it("applies the best tier the group qualifies for", () => {
    expect(discountedPricePerPerson(1000, tiers, 3)).toBe(1000);
    expect(discountedPricePerPerson(1000, tiers, 4)).toBe(950);
    expect(discountedPricePerPerson(1000, tiers, 12)).toBe(875);
    expect(discountedPricePerPerson(1000, [], 12)).toBe(1000);
    expect(discountedPricePerPerson(1000, null, 12)).toBe(1000);
  });
  it("rejects nonsense tiers", () => {
    expect(() => parseVolumeDiscounts([{ minPeople: 1, percentOff: 5 }])).toThrow();
    expect(() => parseVolumeDiscounts([{ minPeople: 4, percentOff: 95 }])).toThrow();
    expect(() => parseVolumeDiscounts([{ minPeople: 4, percentOff: 10 }, { minPeople: 6, percentOff: 5 }])).toThrow();
    expect(() => parseVolumeDiscounts([{ minPeople: 4, percentOff: 5 }, { minPeople: 4, percentOff: 9 }])).toThrow();
  });
});

d("package builder fields (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { await ctx?.cleanup(); });

  const base = { title: "Builder Trek", durationDays: 9, pricePerPerson: 1200, difficulty: "MODERATE", maxGroupSize: 12 };

  it("creates with every builder field and returns them", async () => {
    const r = await request(app).post("/agencies/packages").set(rt()).send({
      ...base, destination: "Manaslu", category: "Trekking", minDurationDays: 8, maxDurationDays: 10, altitudeMinM: 700, altitudeMaxM: 5160,
      region: "Gorkha", bestTimeToVisit: "Mar–May", activities: ["trekking", "camping", "trekking"], routes: ["Larkya La"],
      shortSummary: "A remote circuit.", currency: "USD", isFeatured: true, volumeDiscounts: [{ minPeople: 6, percentOff: 10 }], photos: [],
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ destination: "Manaslu", category: "Trekking", altitudeMaxM: 5160, currency: "USD", isFeatured: true, activities: ["trekking", "camping"], volumeDiscounts: [{ minPeople: 6, percentOff: 10 }] });
  });

  it("refuses bad values", async () => {
    for (const bad of [{ category: "Space Tourism" }, { currency: "XYZ" }, { minDurationDays: 12, maxDurationDays: 5 }, { altitudeMinM: 6000, altitudeMaxM: 100 }, { activities: "trekking" }, { isFeatured: "yes" }, { shortSummary: "x".repeat(400) }, { volumeDiscounts: [{ minPeople: 1, percentOff: 5 }] }, { photos: Array(6).fill("https://x.test/a.png") }]) {
      const r = await request(app).post("/agencies/packages").set(rt()).send({ ...base, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("says which field is wrong, in plain words", async () => {
    const r = await request(app).post("/agencies/packages").set(rt()).send({ ...base, title: "" });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual({ title: "Title is required." });
    const c = await request(app).post("/agencies/packages").set(rt()).send({ ...base, category: "Space Tourism" });
    expect(c.body.errors.category).toMatch(/category/i);
    const price = await request(app).post("/agencies/packages").set(rt()).send({ ...base, pricePerPerson: undefined });
    expect(price.body.errors.pricePerPerson).toMatch(/Price is required/);
    const pub = await request(app).post("/agencies/packages").set(rt()).send(base);
    const cant = await request(app).post(`/agencies/packages/${pub.body.data.id}/publish`).set(rt());
    expect(cant.status).toBe(400);
    expect(cant.body.errors.publish).toMatch(/can't be published yet.*itinerary/);
    expect(cant.body.errors.publish).toMatch(/at least one photo/);
    // a published package can't lose its last photo
    const live = await db.trekPackage.create({ data: { agencyId: ctx.agencyId, title: "Photo Live", slug: `photo-live-${Date.now()}`, durationDays: 3, pricePerPerson: 10, difficulty: "EASY", maxGroupSize: 4, status: "PUBLISHED", photos: ["https://x.test/a.png"] } });
    const strip = await request(app).patch(`/agencies/packages/${live.id}`).set(rt()).send({ photos: [] });
    expect(strip.status).toBe(400);
    expect(strip.body.errors.photos).toMatch(/at least one photo/);
    const list = await request(app).get("/agencies/packages").set(rt());
    expect(typeof list.body.totalBeforeMonth).toBe("number");
  });

  it("partial update changes only what's sent; fields can be cleared", async () => {
    const c = await request(app).post("/agencies/packages").set(rt()).send({ ...base, region: "Mustang", category: "Trekking" });
    const id = c.body.data.id;
    const u = await request(app).patch(`/agencies/packages/${id}`).set(rt()).send({ region: null, isFeatured: true });
    expect(u.status).toBe(200);
    expect(u.body.data.region).toBeNull();
    expect(u.body.data.category).toBe("Trekking");
    expect(u.body.data.isFeatured).toBe(true);
  });

  it("unpublish takes a published package back to draft; drafts can't be unpublished", async () => {
    const p = await db.trekPackage.create({ data: { agencyId: ctx.agencyId, title: "Live", slug: `live-${Date.now()}`, durationDays: 3, pricePerPerson: 10, difficulty: "EASY", maxGroupSize: 4, status: "PUBLISHED" } });
    expect((await request(app).post(`/agencies/packages/${p.id}/unpublish`).set(rt())).status).toBe(200);
    expect((await db.trekPackage.findUnique({ where: { id: p.id } }))?.status).toBe("DRAFT");
    expect((await request(app).post(`/agencies/packages/${p.id}/unpublish`).set(rt())).status).toBe(409);
  });

  it("a package has ONE departure date; once it has passed the package is archived automatically", async () => {
    const mk = (title: string, status: "DRAFT" | "PUBLISHED") => db.trekPackage.create({ data: { agencyId: ctx.agencyId, title, slug: `${title.replace(/\W+/g, "-")}-${Date.now()}`, durationDays: 3, pricePerPerson: 10, difficulty: "EASY", maxGroupSize: 4, status } });
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    // one date only, through the API
    const one = await mk("One Date Trek", "DRAFT");
    const future = day(20).toISOString().slice(0, 10);
    expect((await request(app).post(`/agencies/packages/${one.id}/dates`).set(rt()).send({ startDate: future, maxSlots: 5 })).status).toBe(201);
    const second = await request(app).post(`/agencies/packages/${one.id}/dates`).set(rt()).send({ startDate: day(30).toISOString().slice(0, 10), maxSlots: 5 });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already has its departure date/);

    // finished / still running / never scheduled
    const done = await mk("Finished Trek", "PUBLISHED");
    await db.trekDepartureDate.create({ data: { packageId: done.id, startDate: day(-3), maxSlots: 5, bookedSlots: 0, status: "AVAILABLE" } });
    const live = await mk("Upcoming Trek", "PUBLISHED");
    await db.trekDepartureDate.create({ data: { packageId: live.id, startDate: day(5), maxSlots: 5, bookedSlots: 0, status: "AVAILABLE" } });
    const none = await mk("Unscheduled Trek", "DRAFT");
    await request(app).get("/agencies/packages").set(rt()); // the agency's list applies the rule immediately
    const st = async (id: string) => (await db.trekPackage.findUnique({ where: { id } }))?.status;
    expect(await st(done.id)).toBe("ARCHIVED");
    expect(await st(live.id)).toBe("PUBLISHED");
    expect(await st(none.id)).toBe("DRAFT");
    const act = await db.packageActivity.findFirst({ where: { packageId: done.id, action: "ARCHIVED" } });
    expect(act?.actorRole).toBe("SYSTEM");
    expect(act?.summary).toMatch(/departure date has passed/);
    // the hourly job does the same for every agency and is idempotent
    const { archiveCompletedPackages } = await import("../../services/package.service");
    expect(await archiveCompletedPackages()).toBeGreaterThanOrEqual(0);
    expect(await archiveCompletedPackages(ctx.agencyId)).toBe(0);
  });

  it("restore: archived → draft, but not while its departure date is in the past", async () => {
    const mk = (title: string) => db.trekPackage.create({ data: { agencyId: ctx.agencyId, title, slug: `${title.replace(/\W+/g, "-")}-${Date.now()}`, durationDays: 3, pricePerPerson: 10, difficulty: "EASY", maxGroupSize: 4, status: "ARCHIVED" } });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    const ok = await mk("Restorable");
    await db.trekDepartureDate.create({ data: { packageId: ok.id, startDate: day(10), maxSlots: 4, bookedSlots: 0, status: "AVAILABLE" } });
    expect((await request(app).post(`/agencies/packages/${ok.id}/restore`).set(rt())).status).toBe(200);
    expect((await db.trekPackage.findUnique({ where: { id: ok.id } }))?.status).toBe("DRAFT");
    expect((await request(app).post(`/agencies/packages/${ok.id}/restore`).set(rt())).status).toBe(409); // already a draft
    const past = await mk("Too Late");
    await db.trekDepartureDate.create({ data: { packageId: past.id, startDate: day(-5), maxSlots: 4, bookedSlots: 0, status: "AVAILABLE" } });
    const r = await request(app).post(`/agencies/packages/${past.id}/restore`).set(rt());
    expect(r.status).toBe(400);
    expect(r.body.errors.restore).toMatch(/set a new departure date/);
    // move the date, then it restores
    const dep = await db.trekDepartureDate.findFirst({ where: { packageId: past.id } });
    await request(app).patch(`/agencies/packages/${past.id}/dates/${dep!.id}`).set(rt()).send({ startDate: day(20).toISOString().slice(0, 10) });
    expect((await request(app).post(`/agencies/packages/${past.id}/restore`).set(rt())).status).toBe(200);
  });

  it("duplicate keeps the builder fields but not 'featured'", async () => {
    const c = await request(app).post("/agencies/packages").set(rt()).send({ ...base, destination: "Annapurna", isFeatured: true, volumeDiscounts: [{ minPeople: 4, percentOff: 5 }] });
    const dup = await request(app).post(`/agencies/packages/${c.body.data.id}/duplicate`).set(rt());
    expect(dup.status).toBe(201);
    expect(dup.body.data).toMatchObject({ destination: "Annapurna", isFeatured: false, volumeDiscounts: [{ minPeople: 4, percentOff: 5 }] });
  });
});
