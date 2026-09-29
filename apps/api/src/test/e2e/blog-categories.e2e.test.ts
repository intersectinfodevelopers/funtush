import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("blog categories (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { if (ctx) { await db.blog.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {}); await ctx.cleanup(); } });

  it("validates with field errors, keeps name and slug unique, and refuses to delete a used category", async () => {
    const post = (b: object) => request(app).post("/agencies/me/categories").set(rt()).send(b);
    const noName = await post({ name: " " });
    expect(noName.status).toBe(400);
    expect(noName.body.errors.name).toMatch(/required/i);
    expect((await post({ name: "Ok", slug: "Bad Slug" })).body.errors.slug).toMatch(/lowercase/i);
    expect((await post({ name: "Ok", color: "blue" })).body.errors.color).toMatch(/hex/i);
    expect((await post({ name: "Ok", displayOrder: -1 })).body.errors.displayOrder).toBeTruthy();

    const a = await post({ name: "Travel Tips", description: "Plan trips", displayOrder: 1, color: "#358cbd" });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ name: "Travel Tips", slug: "travel-tips", color: "#358CBD", isActive: true, displayOrder: 1, postCount: 0 });
    const dup = await post({ name: "travel tips" });
    expect(dup.status).toBe(409);
    expect(dup.body.errors.name).toMatch(/already exists/i);
    const dupSlug = await post({ name: "Other", slug: "travel-tips" });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.errors.slug).toMatch(/already used/i);

    const b = await post({ name: "Food Guide", isActive: false });
    expect(b.body.data.isActive).toBe(false);
    const list = await request(app).get("/agencies/me/categories").set(rt());
    expect(list.body.stats).toMatchObject({ total: 2, active: 1, inactive: 1 });

    const upd = await request(app).patch(`/agencies/me/categories/${a.body.data.id}`).set(rt()).send({ isActive: false, color: "#111111" });
    expect(upd.body.data).toMatchObject({ isActive: false, color: "#111111", slug: "travel-tips", name: "Travel Tips" });
    await request(app).patch(`/agencies/me/categories/${a.body.data.id}`).set(rt()).send({ isActive: true });

    // a post can't go into an inactive category, and a used category can't be deleted
    const blog = (categoryId: string) => request(app).post("/agencies/me/blogs").set(rt()).field("title", "T").field("subtitle", "S").field("content", "<p>x</p>").field("categoryId", categoryId).field("status", "DRAFT");
    expect((await blog(b.body.data.id)).status).toBe(400);
    expect((await blog(a.body.data.id)).status).toBe(201);
    const one = await request(app).get(`/agencies/me/categories/${a.body.data.id}`).set(rt());
    expect(one.body.data.postCount).toBe(1);
    const del = await request(app).delete(`/agencies/me/categories/${a.body.data.id}`).set(rt());
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/used by 1 post/);
    expect((await request(app).delete(`/agencies/me/categories/${b.body.data.id}`).set(rt())).status).toBe(204);
    expect((await request(app).get(`/agencies/me/categories/${b.body.data.id}`).set(rt())).status).toBe(404);
  });
});
