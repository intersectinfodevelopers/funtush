// "Who did what" on packages + list search/sort.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("package activity + list search/sort (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const base = { durationDays: 4, pricePerPerson: 100, difficulty: "EASY", maxGroupSize: 6 };
  // the activity writes happen just after the response is sent
  const settle = () => new Promise((r) => setTimeout(r, 400));
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { await db.packageActivity.deleteMany({ where: { agencyId: ctx?.agencyId } }); await ctx?.cleanup(); });

  it("records create, edit (bursts merge), publish, unpublish, delete and duplicate with the actor", async () => {
    const c = await request(app).post("/agencies/packages").set(rt()).send({ ...base, title: "Activity Trek", description: "x" });
    const id = c.body.data.id;
    await request(app).patch(`/agencies/packages/${id}`).set(rt()).send({ pricePerPerson: 150 });
    await request(app).patch(`/agencies/packages/${id}`).set(rt()).send({ title: "Activity Trek 2", region: "Mustang" });
    await request(app).post(`/agencies/packages/${id}/itinerary`).set(rt()).send({ dayNumber: 1, location: "A" });
    await request(app).post(`/agencies/packages/${id}/duplicate`).set(rt());
    await request(app).delete(`/agencies/packages/${id}`).set(rt());
    await request(app).delete(`/agencies/packages/${id}?permanent=true`).set(rt());
    await settle();

    const feed = await request(app).get(`/agencies/packages/${id}/activity`).set(rt());
    expect(feed.status).toBe(200);
    const actions = feed.body.data.map((a: { action: string }) => a.action).sort();
    expect(actions).toEqual(["ARCHIVED", "CREATED", "DELETED", "UPDATED"]); // one merged UPDATED, not four
    const upd = feed.body.data.find((a: { action: string }) => a.action === "UPDATED");
    expect(upd.summary).toMatch(/price/);
    expect(upd.summary).toMatch(/title/);
    expect(upd.summary).toMatch(/itinerary/);
    expect(feed.body.data.every((a: { actorEmail: string; actorRole: string }) => a.actorRole === "OWNER" && a.actorEmail)).toBe(true);
    // the permanently deleted package keeps its title in history
    expect(feed.body.data.find((a: { action: string }) => a.action === "DELETED").packageTitle).toBe("Activity Trek 2");

    const all = await request(app).get("/agencies/me/package-activity").set(rt());
    expect(all.body.data.some((a: { action: string }) => a.action === "DUPLICATED")).toBe(true);
    // "others only" hides the caller's own actions
    const others = await request(app).get("/agencies/me/package-activity?others=true").set(rt());
    expect(others.body.data).toHaveLength(0);
  });

  it("failed calls are not logged", async () => {
    const before = await db.packageActivity.count({ where: { agencyId: ctx.agencyId } });
    await request(app).post("/agencies/packages").set(rt()).send({ title: "" });
    await request(app).patch("/agencies/packages/does-not-exist").set(rt()).send({ title: "x" });
    await settle();
    expect(await db.packageActivity.count({ where: { agencyId: ctx.agencyId } })).toBe(before);
  });

  it("list search covers title/destination/region/category; sort options order properly", async () => {
    const mk = (title: string, extra: object, price: number, days: number) => request(app).post("/agencies/packages").set(rt()).send({ ...base, title, pricePerPerson: price, durationDays: days, ...extra });
    await mk("Bravo Trek", { destination: "Langtang" }, 300, 5);
    await mk("Alpha Trek", { region: "Mustang" }, 100, 9);
    await mk("Charlie Trek", { category: "Pilgrimage" }, 200, 2);
    const titles = async (q: string) => (await request(app).get(`/agencies/packages?${q}`).set(rt())).body.data.map((p: { title: string }) => p.title).filter((t: string) => /^(Alpha|Bravo|Charlie) Trek$/.test(t));
    expect(await titles("search=langtang")).toEqual(["Bravo Trek"]);
    expect(await titles("search=mustang")).toEqual(expect.arrayContaining(["Alpha Trek"])); // (the duplicate of the earlier package shares its region)
    expect(await titles("search=mustang")).not.toContain("Bravo Trek");
    expect(await titles("search=pilgrim")).toEqual(["Charlie Trek"]);
    expect(await titles("sort=title_asc")).toEqual(["Alpha Trek", "Bravo Trek", "Charlie Trek"]);
    expect(await titles("sort=title_desc")).toEqual(["Charlie Trek", "Bravo Trek", "Alpha Trek"]);
    expect(await titles("sort=price_asc")).toEqual(["Alpha Trek", "Charlie Trek", "Bravo Trek"]);
    expect(await titles("sort=price_desc")).toEqual(["Bravo Trek", "Charlie Trek", "Alpha Trek"]);
    expect(await titles("sort=duration")).toEqual(["Charlie Trek", "Bravo Trek", "Alpha Trek"]);
    expect(await titles("sort=duration_desc")).toEqual(["Alpha Trek", "Bravo Trek", "Charlie Trek"]);
    expect(await titles("sort=oldest")).toEqual(["Bravo Trek", "Alpha Trek", "Charlie Trek"]);
    expect(await titles("sort=newest")).toEqual(["Charlie Trek", "Alpha Trek", "Bravo Trek"]);
  });
});
