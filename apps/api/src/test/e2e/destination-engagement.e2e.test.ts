// Views and saves on a destination are real counts: views from public page visits (deduped per visitor), saves from trekkers' bookmarks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { app } from "../../app";
import { saveDestination, unsaveDestination, listSavedDestinations } from "../../services/trekkerSavedDestinations.service";
import { recordDestinationView } from "../../services/siteContent.service";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("destination views & saves (e2e)", () => {
  let ctx: E2EContext;
  const userIds: string[] = [];
  const tag = Date.now().toString().slice(-6);
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const trekker = async (name: string) => {
    const email = `${name}-${tag}@example.com`;
    const user = await db.user.create({ data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" }, select: { id: true } });
    userIds.push(user.id);
    await db.trekker.create({ data: { userId: user.id, fullName: name } });
    return user.id;
  };

  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => {
    if (ctx) await ctx.cleanup();
    await db.trekker.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  });

  it("counts views once per visitor and saves once per trekker", async () => {
    const live = await request(app).post("/agencies/me/destinations").set(rt()).send({ title: `Engage ${tag}`, shortDescription: "s", featuredImage: "https://cdn.example.com/e.jpg", published: true });
    expect(live.status).toBe(201);
    const { id, slug } = live.body.data;
    const draft = await request(app).post("/agencies/me/destinations").set(rt()).send({ title: `Hidden ${tag}` });

    expect((await recordDestinationView(ctx.agencyId, slug, `ip-a-${tag}`)).counted).toBe(true);
    expect((await recordDestinationView(ctx.agencyId, slug, `ip-a-${tag}`)).counted).toBe(false);
    expect((await recordDestinationView(ctx.agencyId, slug, `ip-b-${tag}`)).counted).toBe(true);
    await expect(recordDestinationView(ctx.agencyId, draft.body.data.slug, "x")).rejects.toThrow(/not found/i);

    const a = await trekker("ann"), b = await trekker("bob");
    expect((await saveDestination(a, id)).saves).toBe(1);
    expect((await saveDestination(a, id)).saves).toBe(1); // idempotent
    expect((await saveDestination(b, id)).saves).toBe(2);
    await expect(saveDestination(a, draft.body.data.id)).rejects.toThrow(/not found/i);
    expect((await listSavedDestinations(a)).map((x) => x.id)).toEqual([id]);

    const list = await request(app).get("/agencies/me/destinations").set(rt());
    const row = list.body.destinations.find((x: { id: string }) => x.id === id);
    expect(row.engagement).toEqual({ views: 2, saves: 2 });

    expect((await unsaveDestination(a, id)).saves).toBe(1);
    const one = await request(app).get(`/agencies/me/destinations/${id}`).set(rt());
    expect(one.body.data.engagement).toEqual({ views: 2, saves: 1 });
  });
});
