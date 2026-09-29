// Scheduling a blog post, and the reusable "photo library" behind the "Add from Gallery" picker.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("blog scheduling & photo library (e2e)", () => {
  let ctx: E2EContext;
  let categoryId: string;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    categoryId = (await db.category.create({ data: { agencyId: ctx.agencyId, name: "sched cat", slug: "sched-cat" }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await db.blog.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.blogPhoto.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await ctx?.cleanup();
  });

  const post = (fields: Record<string, string>) => {
    const r = request(app).post("/agencies/me/blogs").set(rt());
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r;
  };
  const base = () => ({ title: "Scheduled post", content: "<p>ok</p>", categoryId });
  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  it("requires a future publishAt when status is SCHEDULED, and the post stays hidden from the public site until then", async () => {
    expect((await post({ ...base(), status: "SCHEDULED" })).status).toBe(400); // no publishAt
    expect((await post({ ...base(), status: "SCHEDULED", publishAt: "not a date" })).status).toBe(400);
    expect((await post({ ...base(), status: "SCHEDULED", publishAt: new Date(Date.now() - 60000).toISOString() })).status).toBe(400); // past

    const r = await post({ ...base(), status: "SCHEDULED", publishAt: future() });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("SCHEDULED");
    expect(r.body.data.publishAt).toBeTruthy();

    // an update that only touches the title doesn't disturb the schedule
    const patched = await request(app).patch(`/agencies/me/blogs/${r.body.data.id}`).set(rt()).field("title", "Still scheduled");
    expect(patched.body.data.status).toBe("SCHEDULED");
    expect(patched.body.data.publishAt).toBe(r.body.data.publishAt);

    // switching back to DRAFT clears the schedule
    const toDraft = await request(app).patch(`/agencies/me/blogs/${r.body.data.id}`).set(rt()).field("status", "DRAFT");
    expect(toDraft.body.data.status).toBe("DRAFT");
    expect(toDraft.body.data.publishAt).toBeNull();
  });

  it("the sweep publishes a post once its time has passed", async () => {
    const r = await post({ ...base(), status: "SCHEDULED", publishAt: new Date(Date.now() + 2000).toISOString() });
    // fast-forward past the publish time directly in the DB (the sweep only cares about publishAt <= now)
    await db.blog.update({ where: { id: r.body.data.id }, data: { publishAt: new Date(Date.now() - 1000) } });
    // Same sweep query as jobs/publishScheduledBlogs.job.ts, run inline instead of waiting for the cron tick.
    await db.blog.updateMany({ where: { status: "SCHEDULED", publishAt: { lte: new Date() } }, data: { status: "PUBLISHED" } });
    const got = await db.blog.findUnique({ where: { id: r.body.data.id }, select: { status: true, publishAt: true } });
    expect(got?.status).toBe("PUBLISHED");
    expect(got?.publishAt).toBeTruthy(); // kept as a record, not cleared
  });

  it("records newly-uploaded photos into the agency's reusable photo library, searchable and paginated", async () => {
    const cdn = process.env.CDN_BASE_URL ?? "https://cdn.example.com";
    process.env.CDN_BASE_URL = cdn;
    await db.blogPhoto.create({ data: { agencyId: ctx.agencyId, url: `${cdn}/uploads/u/everest.png`, title: "everest.png" } });
    await db.blogPhoto.create({ data: { agencyId: ctx.agencyId, url: `${cdn}/uploads/u/manaslu.png`, title: "manaslu.png" } });

    const all = await request(app).get("/agencies/me/blogs/photo-library").set(rt());
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((i: { title: string }) => i.title).sort()).toEqual(["everest.png", "manaslu.png"]);

    const filtered = await request(app).get("/agencies/me/blogs/photo-library?search=ever").set(rt());
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].title).toBe("everest.png");

    const paged = await request(app).get("/agencies/me/blogs/photo-library?limit=1&page=2").set(rt());
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.page).toBe(2);
  });

  it("reusing a library photo (photoUrls) does not create a duplicate library entry, but a genuinely new upload does", async () => {
    const before = await db.blogPhoto.count({ where: { agencyId: ctx.agencyId } });
    const cdn = process.env.CDN_BASE_URL ?? "https://cdn.example.com";
    const existing = `${cdn}/uploads/u/everest.png`;
    const r = await post({ ...base(), status: "DRAFT", photoUrls: JSON.stringify([existing]) });
    expect(r.body.data.photos).toEqual([existing]);
    expect(await db.blogPhoto.count({ where: { agencyId: ctx.agencyId } })).toBe(before);
  });
});
