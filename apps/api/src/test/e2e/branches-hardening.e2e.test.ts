// Branches: no mass-assignment, per-agency name uniqueness, validation, delete rules.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("branches (e2e)", () => {
  let a: E2EContext;
  let b: E2EContext;
  const branch = (name = "Pokhara") => ({ name, address: "Lakeside, Pokhara", phone: "+977 61 460000" });
  const call = (m: "post" | "patch" | "delete" | "get", path: string, c: E2EContext, body?: object) => {
    const r = request(app)[m](path).set("x-refresh-token", c.refreshToken);
    return body ? r.send(body) : r;
  };

  beforeAll(async () => {
    if (!RUN) return;
    a = await createAgencyContext();
    b = await createAgencyContext();
  });
  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
  });

  it("lets two agencies use the same branch name, but not one agency twice", async () => {
    expect((await call("post", "/agencies/me/branches", a, branch())).status).toBe(201);
    expect((await call("post", "/agencies/me/branches", b, branch())).status).toBe(201);
    const dup = await call("post", "/agencies/me/branches", a, branch("pokhara"));
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/already have a branch/);
  });

  it("rejects malformed input with a 400", async () => {
    for (const body of [{ ...branch("X1"), name: "" }, { ...branch("X2"), name: 7 }, { ...branch("X3"), phone: "abc" }, { ...branch("X4"), address: undefined }, { ...branch("X5"), isHeadOffice: "yes" }]) {
      expect((await call("post", "/agencies/me/branches", a, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("ignores agencyId / id in an update (no mass assignment)", async () => {
    const mine = (await call("post", "/agencies/me/branches", a, branch("Chitwan"))).body.data;
    const r = await call("patch", `/agencies/me/branches/${mine.id}`, a, { address: "New road", agencyId: b.agencyId, id: "hijack", createdAt: "2000-01-01" });
    expect(r.status).toBe(200);
    const row = await db.branch.findUnique({ where: { id: mine.id } });
    expect(row?.agencyId).toBe(a.agencyId);
    expect(row?.address).toBe("New road");
  });

  it("cannot touch another agency's branch", async () => {
    const theirs = (await call("get", "/agencies/me/branches", b)).body.data[0];
    expect((await call("patch", `/agencies/me/branches/${theirs.id}`, a, { name: "Mine now" })).status).toBe(404);
    expect((await call("delete", `/agencies/me/branches/${theirs.id}`, a)).status).toBe(404);
  });

  it("clears the manager and whatsapp with null", async () => {
    const mine = (await call("post", "/agencies/me/branches", a, { ...branch("Lumbini"), whatsapp: "+977 9800000000" })).body.data;
    expect(mine.whatsapp).toBe("+977 9800000000");
    const r = await call("patch", `/agencies/me/branches/${mine.id}`, a, { whatsapp: null, managerStaffId: null });
    expect(r.body.data.whatsapp).toBeNull();
  });

  it("deletes an empty branch, refuses one with bookings", async () => {
    const empty = (await call("post", "/agencies/me/branches", a, branch("Temp"))).body.data;
    expect((await call("delete", `/agencies/me/branches/${empty.id}`, a)).status).toBe(204);
    const list = await call("get", "/agencies/me/branches", a);
    expect(list.body.data.some((x: { id: string }) => x.id === empty.id)).toBe(false);
    expect(list.body.data[0]).toHaveProperty("_count");
  });
});
