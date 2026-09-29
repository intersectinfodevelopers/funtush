// Blog HTML is rendered on public sites: script/handler/URL payloads must not survive storage.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Blog input sanitising (e2e)", () => {
  let ctx: E2EContext;
  let categoryId: string;
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    categoryId = (await db.category.create({ data: { agencyId: ctx.agencyId, name: "cat", slug: "cat" }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await db.blog.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await ctx?.cleanup();
  });

  const post = (fields: Record<string, string>) => {
    const r = request(app).post("/agencies/me/blogs").set("x-refresh-token", ctx.refreshToken);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r;
  };
  const base = () => ({ title: "T", subtitle: "S", content: "<p>ok</p>", categoryId });

  it("stores a clean copy of hostile content and keeps normal formatting", async () => {
    const r = await post({
      ...base(),
      title: '<img src=x onerror=alert(1)>Hello',
      subtitle: "<script>alert(1)</script>Sub",
      tags: JSON.stringify(['"><svg onload=alert(1)>gear']),
      content: '<h2>Tips</h2><p onclick="steal()">Wear <strong>layers</strong></p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">',
    });
    expect(r.status).toBe(201);
    const b = r.body.data;
    const all = JSON.stringify(b).toLowerCase();
    for (const bad of ["<script", "onerror", "onclick", "onload", "javascript:", "<svg"]) expect(all).not.toContain(bad);
    expect(b.content).toContain("<h2>Tips</h2>");
    expect(b.content).toContain("<strong>layers</strong>");
    expect(b.title).toBe("Hello");
  });

  it("sanitises on update too", async () => {
    const created = await post({ ...base() });
    const r = await request(app).patch(`/agencies/me/blogs/${created.body.data.id}`).set("x-refresh-token", ctx.refreshToken)
      .field("content", '<iframe src="https://evil.example"></iframe><p>fine</p>');
    expect(r.status).toBe(200);
    expect(r.body.data.content).not.toContain("iframe");
    expect(r.body.data.content).toContain("<p>fine</p>");
  });

  it("a text-only edit keeps the post's photos (it used to wipe them); keepPhotos prunes explicitly", async () => {
    const cdn = process.env.CDN_BASE_URL ?? "https://cdn.example.com";
    process.env.CDN_BASE_URL = cdn;
    const a = `${cdn}/uploads/u/a.png`, b = `${cdn}/uploads/u/b.png`;
    const created = await post({ ...base() });
    await db.blog.update({ where: { id: created.body.data.id }, data: { photos: [a, b] } });
    const patch = (f: Record<string, string>) => {
      const r = request(app).patch(`/agencies/me/blogs/${created.body.data.id}`).set("x-refresh-token", ctx.refreshToken);
      for (const [k, v] of Object.entries(f)) r.field(k, v);
      return r;
    };
    expect((await patch({ title: "New title" })).body.data.photos).toEqual([a, b]);
    expect((await patch({ keepPhotos: JSON.stringify([b]) })).body.data.photos).toEqual([b]);
    // only CDN urls can be kept — an attacker URL is dropped
    expect((await patch({ keepPhotos: JSON.stringify([b, "https://evil.example/x.png"]) })).body.data.photos).toEqual([b]);
    expect((await patch({ keepPhotos: "not json" })).status).toBe(400);
  });

  it("stores, dedupes and caps tags; rejects a photoUrls array with a foreign URL", async () => {
    const r = await post({ ...base(), tags: JSON.stringify([" Nepal ", "nepal", "Trekking"]) });
    expect(r.body.data.tags).toEqual(["Nepal", "Trekking"]);
    const tooMany = await post({ ...base(), tags: JSON.stringify(Array.from({ length: 11 }, (_, i) => `t${i}`)) });
    expect(tooMany.status).toBe(400);

    const cdn = process.env.CDN_BASE_URL ?? "https://cdn.example.com";
    process.env.CDN_BASE_URL = cdn;
    const g = `${cdn}/uploads/u/gallery.png`;
    const withGallery = await post({ ...base(), photoUrls: JSON.stringify([g, "https://evil.example/x.png"]) });
    expect(withGallery.body.data.photos).toEqual([g]);
  });

  it("accepts only DRAFT / PUBLISHED as status", async () => {
    expect((await post({ ...base(), status: "published" })).body.data.status).toBe("PUBLISHED");
    expect((await post({ ...base(), status: "<script>" })).status).toBe(400);
    expect((await post({ ...base(), status: "HACKED" })).status).toBe(400);
  });
});
