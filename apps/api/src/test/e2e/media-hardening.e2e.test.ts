// Gallery + video URL hardening: only real http(s) media, only real YouTube links.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("media URL hardening (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const post = (path: string, body: object) => request(app).post(path).set("x-refresh-token", ctx.refreshToken).send(body);

  it("drops non-http(s) gallery images and rejects a post with none left", async () => {
    const bad = await post("/agencies/me/gallery", { title: "x", images: ["javascript:alert(1)", "data:text/html,<b>"] });
    expect(bad.status).toBe(400);
    const ok = await post("/agencies/me/gallery", { title: "x", images: ["javascript:alert(1)", "https://cdn.example.com/a.jpg"] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.images).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("accepts a site-relative image path but not a protocol-relative one", async () => {
    expect((await post("/agencies/me/gallery", { title: "x", images: ["/uploads/a.jpg"] })).status).toBe(201);
    expect((await post("/agencies/me/gallery", { title: "x", images: ["//evil.example/a.jpg"] })).status).toBe(400);
  });

  it("rejects a bad order value", async () => {
    const r = await post("/agencies/me/gallery", { title: "x", images: ["https://a.example/a.jpg"], order: -3 });
    expect(r.status).toBe(400);
  });

  it("accepts real YouTube links and rejects scheme/host tricks", async () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/abcdefghijk"]) {
      expect((await post("/agencies/me/videos", { title: "v", youtubeUrl: u })).status).toBe(201);
    }
    for (const u of ["javascript:alert(1)//youtu.be/abcdefgh", "https://evil.example/?u=youtube.com/watch?v=abcdefgh", "https://youtube.com.evil.example/watch?v=abcdefgh", "https://youtu.be/"]) {
      expect((await post("/agencies/me/videos", { title: "v", youtubeUrl: u })).status).toBe(400);
    }
  });

  it("drops a non-http thumbnail", async () => {
    const r = await post("/agencies/me/videos", { title: "v", youtubeUrl: "https://youtu.be/abcdefgh", thumbnail: "javascript:1" });
    expect(r.status).toBe(201);
    expect(r.body.data.thumbnail).toBeNull();
  });
});
