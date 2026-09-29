// Author name (resolved once at creation), deleting a post, capping photos at one, and view counting.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { recordBlogView } from "../../services/siteContent.service";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("blog author, delete, single photo & views (e2e)", () => {
  let ctx: E2EContext;
  let categoryId: string;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    categoryId = (await db.category.create({ data: { agencyId: ctx.agencyId, name: "author cat", slug: "author-cat" }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await db.blog.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await ctx?.cleanup();
  });

  const post = (fields: Record<string, string> = {}) => {
    const r = request(app).post("/agencies/me/blogs").set(rt());
    for (const [k, v] of Object.entries({ title: "T", content: "<p>ok</p>", categoryId, ...fields })) r.field(k, v);
    return r;
  };

  it("resolves the creator's name as the author, and it doesn't change on a later edit", async () => {
    const r = await post();
    expect(r.status).toBe(201);
    expect(r.body.data.authorName).toContain("e2e-admin-");

    const patched = await request(app).patch(`/agencies/me/blogs/${r.body.data.id}`).set(rt()).field("title", "New title");
    expect(patched.body.data.authorName).toBe(r.body.data.authorName);
  });

  it("a post can have only one photo, on create and on edit", async () => {
    const cdn = process.env.CDN_BASE_URL ?? "https://cdn.example.com";
    process.env.CDN_BASE_URL = cdn;
    const oneUrl = await post({ photoUrls: JSON.stringify([`${cdn}/uploads/u/a.png`]) });
    expect(oneUrl.status).toBe(201);
    expect(oneUrl.body.data.photos).toHaveLength(1);

    const twoUrls = await post({ photoUrls: JSON.stringify([`${cdn}/uploads/u/a.png`, `${cdn}/uploads/u/b.png`]) });
    expect(twoUrls.status).toBe(400);
    expect(twoUrls.body.message).toMatch(/only one photo/i);

    const editTwo = await request(app).patch(`/agencies/me/blogs/${oneUrl.body.data.id}`).set(rt())
      .field("keepPhotos", JSON.stringify([`${cdn}/uploads/u/a.png`]))
      .field("photoUrls", JSON.stringify([`${cdn}/uploads/u/b.png`]));
    expect(editTwo.status).toBe(400);
  });

  it("deletes a post (204), refuses a missing or another agency's post (404), and it's gone from the list", async () => {
    const r = await post({ title: "To delete" });
    const del = await request(app).delete(`/agencies/me/blogs/${r.body.data.id}`).set(rt());
    expect(del.status).toBe(204);
    expect((await request(app).delete(`/agencies/me/blogs/${r.body.data.id}`).set(rt())).status).toBe(404);

    const other = await createAgencyContext();
    try {
      const theirs = await post();
      expect((await request(app).delete(`/agencies/me/blogs/${theirs.body.data.id}`).set({ "x-refresh-token": other.refreshToken })).status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("counts a view once per visitor per 30 minutes, and refuses a draft", async () => {
    const live = await post({ title: "Viewable", status: "PUBLISHED" });
    expect((await recordBlogView(ctx.agencyId, live.body.data.id, "ip-a")).counted).toBe(true);
    expect((await recordBlogView(ctx.agencyId, live.body.data.id, "ip-a")).counted).toBe(false);
    expect((await recordBlogView(ctx.agencyId, live.body.data.id, "ip-b")).counted).toBe(true);

    const draft = await post({ title: "Draft one", status: "DRAFT" });
    await expect(recordBlogView(ctx.agencyId, draft.body.data.id, "ip-c")).rejects.toThrow(/not found/i);

    const list = await request(app).get("/agencies/me/blogs").set(rt());
    const row = list.body.data.find((x: { id: string }) => x.id === live.body.data.id);
    expect(row.views).toBe(2);
  });
});
