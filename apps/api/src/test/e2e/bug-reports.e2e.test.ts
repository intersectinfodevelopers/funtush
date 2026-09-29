// Agency bug reports: validation, http(s)-only screenshots, tenant scoping.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("agency bug reports (e2e)", () => {
  let a: E2EContext;
  let b: E2EContext;
  beforeAll(async () => {
    if (!RUN) return;
    a = await createAgencyContext();
    b = await createAgencyContext();
  });
  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
  });
  const post = (body: object, c = a) => request(app).post("/agencies/me/bugs").set("Authorization", `Bearer ${c.accessToken}`).send(body);
  const list = (c = a) => request(app).get("/agencies/me/bugs").set("Authorization", `Bearer ${c.accessToken}`);

  it("creates a report and lists it only for its own agency", async () => {
    const r = await post({ title: "Map broken", description: "It never loads", screenshotUrl: "https://cdn.example.com/s.png" });
    expect(r.status).toBe(201);
    expect((await list()).body.data.items.some((x: { id: string }) => x.id === r.body.data.id)).toBe(true);
    expect((await list(b)).body.data.items.some((x: { id: string }) => x.id === r.body.data.id)).toBe(false);
  });

  it("rejects bad input with a 400", async () => {
    for (const body of [
      { title: "", description: "x" },
      { title: "x", description: "" },
      { title: 5, description: "x" },
      { title: "x".repeat(151), description: "x" },
      { title: "x", description: "y", screenshotUrl: "javascript:alert(1)" },
      { title: "x", description: "y", stepsToReproduce: { a: 1 } },
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });
});
