// Agency profile: GET returns safe fields, PATCH validates and never leaks secrets.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("agency profile (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const get = () => request(app).get("/agencies/me/profile").set("x-refresh-token", ctx.refreshToken);
  const patch = (b: object) => request(app).patch("/agencies/me/profile").set("x-refresh-token", ctx.refreshToken).send(b);

  it("returns defaults before any profile exists", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.data.phone).toEqual([]);
    expect(r.body.data.descriptionShowOnWebsite).toBe(true);
  });

  it("returns empty lists when the profile row exists but has no contact data", async () => {
    await db.agencyProfile.upsert({ where: { agencyId: ctx.agencyId }, update: { whatsappEnabled: false }, create: { agencyId: ctx.agencyId } });
    const r = await get();
    expect(r.body.data.phone).toEqual([]);
    expect(r.body.data.email).toEqual([]);
    expect(r.body.data.regions).toEqual([]);
  });

  it("saves valid fields and returns only safe columns (no tokens)", async () => {
    await db.agencyProfile.upsert({ where: { agencyId: ctx.agencyId }, update: { instagramAccessToken: "SECRET" }, create: { agencyId: ctx.agencyId, instagramAccessToken: "SECRET" } });
    const r = await patch({ description: "Guided treks", phone: ["+977 9800000000"], email: ["hi@example.com"], regions: ["Everest"], phoneShowOnWebsite: false });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    expect(r.body.data.phone).toEqual(["+977 9800000000"]);
    const g = await get();
    expect(g.body.data.regions).toEqual(["Everest"]);
    expect(g.body.data.phoneShowOnWebsite).toBe(false);
    expect(JSON.stringify(g.body)).not.toContain("SECRET");
  });

  it("rejects unknown keys, bad values and bad URLs with 400", async () => {
    for (const b of [{ whatsappEnabled: true }, { agencyId: "x" }, { phone: ["abc"] }, { email: ["nope"] }, { description: "<b>x</b>" }, { logo: "javascript:alert(1)" }, { phoneShowOnWebsite: "yes" }, { regions: "Everest" }, { phone: ["+977 9800000000", "1", "2", "3", "4", "5"] }]) {
      expect((await patch(b)).status, JSON.stringify(b)).toBe(400);
    }
  });

  it("clears the logo with null", async () => {
    expect((await patch({ logo: "https://cdn.example.com/l.png" })).body.data.logo).toBe("https://cdn.example.com/l.png");
    expect((await patch({ logo: null })).body.data.logo).toBeNull();
  });
});
