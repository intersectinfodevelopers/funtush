// Site ads: only http(s) media/links, known positions, sane dates.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("site ads (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const ad = (o: object = {}) => ({ title: "Winter sale", image: "https://cdn.example.com/a.jpg", position: "top-ads", ...o });
  const post = (b: object) => request(app).post("/agencies/me/advertisements").set("x-refresh-token", ctx.refreshToken).send(b);
  const patch = (id: string, b: object) => request(app).patch(`/agencies/me/advertisements/${id}`).set("x-refresh-token", ctx.refreshToken).send(b);

  it("creates a valid ad", async () => {
    const r = await post(ad({ linkUrl: "https://example.com/deal", startDate: "2030-01-01", endDate: "2030-02-01" }));
    expect(r.status).toBe(201);
    expect(r.body.data.linkUrl).toBe("https://example.com/deal");
  });

  it("accepts a site-relative link but not a protocol-relative one", async () => {
    expect((await post(ad({ linkUrl: "/packages/everest" }))).status).toBe(201);
    expect((await post(ad({ linkUrl: "/\\evil.example" }))).status).toBe(400);
  });

  it("rejects javascript:/data: links and images", async () => {
    for (const b of [ad({ linkUrl: "javascript:alert(1)" }), ad({ image: "javascript:alert(1)" }), ad({ image: "data:text/html,x" }), ad({ linkUrl: "//evil.example" })]) {
      expect((await post(b)).status, JSON.stringify(b)).toBe(400);
    }
  });

  it("rejects unknown positions, bad dates, reversed ranges and bad order", async () => {
    for (const b of [ad({ position: "everywhere" }), ad({ position: "" }), ad({ startDate: "not-a-date" }), ad({ startDate: "2030-05-01", endDate: "2030-04-01" }), ad({ order: -1 }), ad({ title: 5 })]) {
      expect((await post(b)).status, JSON.stringify(b)).toBe(400);
    }
  });

  it("validates updates against the stored dates and never stores a bad link", async () => {
    const created = (await post(ad({ startDate: "2030-01-01", endDate: "2030-02-01" }))).body.data;
    expect((await patch(created.id, { endDate: "2029-12-01" })).status).toBe(400);
    expect((await patch(created.id, { linkUrl: "javascript:1" })).status).toBe(400);
    expect((await patch(created.id, { linkUrl: null, status: "paused" })).status).toBe(200);
  });
});
