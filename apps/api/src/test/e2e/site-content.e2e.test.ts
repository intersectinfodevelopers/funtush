// Public site content: only what the agency published, only its own, nothing internal.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("public site content (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let slug: string;
  let pkgId: string;
  let deptId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    const a = await db.agency.update({ where: { id: ctx.agencyId }, data: { publishedAt: new Date() }, select: { slug: true } });
    slug = a.slug;
    const s = await seedPackage(ctx.agencyId);
    pkgId = s.packageId;
    deptId = s.departureDateId;
    await db.trekPackage.create({ data: { agencyId: ctx.agencyId, title: "Draft Trek", slug: `draft-${slug}`, durationDays: 3, pricePerPerson: 10, difficulty: "EASY", maxGroupSize: 5, status: "DRAFT" } });
    await seedPackage(other.agencyId);

    await db.agencyDestination.createMany({ data: [
      { agencyId: ctx.agencyId, title: "Langtang", slug: "langtang", published: true },
      { agencyId: ctx.agencyId, title: "Secret", slug: "secret", published: false },
    ] });
    await db.blog.createMany({ data: [
      { agencyId: ctx.agencyId, title: "Live post", subtitle: "s", content: "<p>hi</p>", status: "PUBLISHED" },
      { agencyId: ctx.agencyId, title: "Draft post", subtitle: "s", content: "<p>no</p>", status: "DRAFT" },
    ] });
    await db.galleryPost.createMany({ data: [
      { agencyId: ctx.agencyId, title: "Pub", images: ["https://cdn.example.com/a.jpg"], status: "PUBLISHED" },
      { agencyId: ctx.agencyId, title: "Hidden", images: ["https://cdn.example.com/b.jpg"], status: "DRAFT" },
    ] });
    await db.video.createMany({ data: [
      { agencyId: ctx.agencyId, title: "On", youtubeUrl: "https://youtu.be/abcdefgh", status: "ACTIVE" },
      { agencyId: ctx.agencyId, title: "Off", youtubeUrl: "https://youtu.be/abcdefgi", status: "INACTIVE" },
    ] });
    const day = (n: number) => new Date(Date.now() + n * 86400000);
    await db.siteAd.createMany({ data: [
      { agencyId: ctx.agencyId, title: "Live ad", imageUrl: "https://cdn.example.com/ad.jpg", position: "homepage-top", status: "ACTIVE" },
      { agencyId: ctx.agencyId, title: "Expired ad", imageUrl: "https://cdn.example.com/ad2.jpg", position: "homepage-top", status: "ACTIVE", endDate: day(-5) },
      { agencyId: ctx.agencyId, title: "Paused ad", imageUrl: "https://cdn.example.com/ad3.jpg", position: "homepage-top", status: "PAUSED" },
    ] });
  });
  afterAll(async () => {
    await ctx?.cleanup();
    await other?.cleanup();
  });
  const get = (p: string) => request(app).get(`/site/${slug}${p}`);

  it("lists only published packages of this agency, with the next open departure", async () => {
    const r = await get("/packages");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toContain("public");
    const titles = r.body.data.map((p: { title: string }) => p.title);
    expect(titles.some((t: string) => t.startsWith("E2E Trek"))).toBe(true);
    expect(titles).not.toContain("Draft Trek");
    expect(r.body.data.length).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain("agencyId");
    expect(r.body.data[0].nextDeparture).toBeTruthy();
  });

  it("returns package detail by id or slug with open departures and seat counts", async () => {
    const r = await get(`/packages/${pkgId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.departures[0].id).toBe(deptId);
    expect(r.body.data.departures[0]).toHaveProperty("seatsLeft");
    expect((await get(`/packages/${r.body.data.slug}`)).status).toBe(200);
    expect((await get("/packages/draft-" + slug)).status).toBe(404);
    expect((await get("/packages/not-a-real-id")).status).toBe(404);
  });

  it("does not show the other agency's package under this site", async () => {
    const otherPkg = await db.trekPackage.findFirst({ where: { agencyId: other.agencyId }, select: { id: true } });
    expect((await get(`/packages/${otherPkg!.id}`)).status).toBe(404);
  });

  it("publishes only published destinations, posts, gallery and videos", async () => {
    expect((await get("/destinations")).body.data.map((x: { title: string }) => x.title)).toEqual(["Langtang"]);
    expect((await get("/destinations/secret")).status).toBe(404);
    const blogs = (await get("/blog")).body.data.filter((b: { title: string }) => b.title === "Live post");
    expect(blogs.map((b: { title: string }) => b.title)).toContain("Live post");
    expect(blogs[0]).not.toHaveProperty("content");
    expect((await get(`/blog/${blogs[0].id}`)).body.data.content).toBe("<p>hi</p>");
    const draft = await db.blog.findFirst({ where: { agencyId: ctx.agencyId, title: "Draft post" }, select: { id: true } });
    expect((await get(`/blog/${draft!.id}`)).status).toBe(404);
    expect((await get("/gallery")).body.data.map((g: { title: string }) => g.title)).toEqual(["Pub"]);
    expect((await get("/videos")).body.data.map((v: { title: string }) => v.title)).toEqual(["On"]);
  });

  it("re-sanitises legacy post HTML on the way out", async () => {
    const evil = await db.blog.create({ data: { agencyId: ctx.agencyId, title: "Legacy", subtitle: "s", content: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">x</a>', status: "PUBLISHED" } });
    const html = (await get(`/blog/${evil.id}`)).body.data.content as string;
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
  });

  it("shows only active ads inside their date window", async () => {
    const r = await get("/ads?position=homepage-top");
    expect(r.body.data.map((a: { title: string }) => a.title)).toEqual(["Live ad"]);
  });

  it("shows reviews with first names only and hides removed ones", async () => {
    const trekkerUser = await db.user.create({ data: { email: `rv-${slug}@example.com`, normalizedEmail: `rv-${slug}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" } });
    const trekker = await db.trekker.create({ data: { userId: trekkerUser.id, fullName: "Maya Rai Thapa", country: "NP" } });
    const mk = async (rating: number, text: string) => {
      const b = await db.booking.create({ data: { agencyId: ctx.agencyId, packageId: pkgId, departureDateId: deptId, groupSize: 1, totalPrice: 100, status: "COMPLETED", trekkerName: "Maya", trekkerEmail: `rv-${slug}@example.com`, trekkerPhone: "9800000000", trekkerId: trekker.id } as never });
      return db.review.create({ data: { bookingId: b.id, trekkerId: trekker.id, agencyId: ctx.agencyId, rating, text } });
    };
    await mk(5, "Amazing");
    const bad = await mk(1, "Spam");
    await db.reviewFlag.create({ data: { reviewId: bad.id, reason: "spam", flaggedBy: "x", status: "REMOVED" } as never });
    const r = await get("/reviews");
    expect(r.status).toBe(200);
    expect(r.body.data.count).toBe(1);
    expect(r.body.data.average).toBe(5);
    expect(r.body.data.reviews[0].author).toBe("Maya");
    expect(JSON.stringify(r.body)).not.toContain("Thapa");
    await db.review.deleteMany({ where: { agencyId: ctx.agencyId } });
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } });
    await db.trekker.delete({ where: { id: trekker.id } });
    await db.user.delete({ where: { id: trekkerUser.id } });
  });

  it("about shows only the fields the agency switched on", async () => {
    await db.agencyProfile.upsert({ where: { agencyId: ctx.agencyId }, update: { description: "We guide", descriptionShowOnWebsite: true, phone: ["9800000000"], phoneShowOnWebsite: false, email: ["a@b.com"], emailShowOnWebsite: true }, create: { agencyId: ctx.agencyId, description: "We guide", phone: ["9800000000"], phoneShowOnWebsite: false, email: ["a@b.com"] } });
    const r = await get("/about");
    expect(r.body.data.description).toBe("We guide");
    expect(r.body.data.phones).toEqual([]);
    expect(r.body.data.emails).toEqual(["a@b.com"]);
  });

  it("answers cross-origin requests for public site routes only, and never with credentials", async () => {
    const origin = "https://my-custom-domain.example";
    const pre = await request(app).options(`/site/${slug}/packages`).set("Origin", origin).set("Access-Control-Request-Method", "GET");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("*");
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    const inq = await request(app).options("/bookings/inquiry").set("Origin", origin).set("Access-Control-Request-Method", "POST");
    expect(inq.headers["access-control-allow-origin"]).toBe("*");
    // private routes stay closed to unknown origins
    const priv = await request(app).get("/agencies/me/analytics").set("Origin", origin).set("x-refresh-token", ctx.refreshToken);
    expect(priv.headers["access-control-allow-origin"]).toBeUndefined();
    const pre2 = await request(app).options("/agencies/me/analytics").set("Origin", origin).set("Access-Control-Request-Method", "GET");
    expect(pre2.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("is unavailable while unpublished or under construction, and 404 for an unknown site", async () => {
    await db.agency.update({ where: { id: other.agencyId }, data: { publishedAt: null } });
    const o = await db.agency.findUnique({ where: { id: other.agencyId }, select: { slug: true } });
    expect((await request(app).get(`/site/${o!.slug}/packages`)).status).toBe(503);
    expect((await request(app).get("/site/no-such-agency-xyz/packages")).status).toBe(404);
    await db.agency.update({ where: { id: ctx.agencyId }, data: { publishedAt: null } });
    expect((await get("/packages")).status).toBe(503);
    await db.agency.update({ where: { id: ctx.agencyId }, data: { publishedAt: new Date() } });
    expect((await get("/packages")).status).toBe(200);
  });
});
