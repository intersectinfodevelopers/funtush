// Destinations: field errors, the "what a live destination needs" rule, and the numbers on the list page.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("destination rules (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const post = (b: object) => request(app).post("/agencies/me/destinations").set(rt()).send(b);
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { await ctx?.cleanup(); });

  it("says which field is wrong", async () => {
    const cases: Array<[object, string]> = [
      [{ title: "" }, "title"], [{ title: "x".repeat(151) }, "title"], [{ title: "A", shortDescription: "x".repeat(301) }, "shortDescription"],
      [{ title: "A", activities: "trekking" }, "activities"], [{ title: "A", activities: ["x".repeat(41)] }, "activities"],
      [{ title: "A", durationMin: 10, durationMax: 5 }, "durationMin"], [{ title: "A", altitudeMin: 6000, altitudeMax: 100 }, "altitudeMin"],
      [{ title: "A", durationMax: 999 }, "durationMax"], [{ title: "A", featuredImage: "javascript:alert(1)" }, "featuredImage"],
    ];
    for (const [body, field] of cases) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(r.body.errors ?? {}), JSON.stringify(body)).toContain(field);
    }
  });

  it("a destination needs a short description and a featured image to go live — and keeps them while live", async () => {
    const no = await post({ title: "Half Done", published: true });
    expect(no.status).toBe(400);
    expect(no.body.errors.publish).toMatch(/short description.*featured image/);
    const draft = await post({ title: "Ready Soon", shortDescription: "Nice", featuredImage: "https://cdn.example.com/a.jpg" });
    expect(draft.status).toBe(201);
    const live = await request(app).patch(`/agencies/me/destinations/${draft.body.data.id}`).set(rt()).send({ published: true });
    expect(live.status).toBe(200);
    // a live one can't lose its image or description
    const strip = await request(app).patch(`/agencies/me/destinations/${draft.body.data.id}`).set(rt()).send({ featuredImage: null });
    expect(strip.status).toBe(400);
    expect(strip.body.errors.publish).toMatch(/featured image/);
    // unpublished, it can
    expect((await request(app).patch(`/agencies/me/destinations/${draft.body.data.id}`).set(rt()).send({ published: false, featuredImage: null })).status).toBe(200);
  });

  it("the list carries whole-agency stats (with distinct regions) and the category list", async () => {
    await post({ title: "One", region: "Khumbu" });
    await post({ title: "Two", region: "khumbu" }); // same region, different case
    await post({ title: "Three", region: "Mustang", featured: true });
    const r = await request(app).get("/agencies/me/destinations?limit=1").set(rt());
    expect(r.body.stats).toMatchObject({ total: r.body.total, featured: 1, regions: 2, totalBeforeMonth: 0 });
    expect(r.body.categories).toContain("Trekking");
    const filtered = await request(app).get("/agencies/me/destinations?search=Two&limit=1").set(rt());
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.stats.total).toBe(r.body.stats.total); // cards ignore the filters
  });
});
