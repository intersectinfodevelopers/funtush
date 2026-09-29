// Guide create/update: field-level validation, language normalisation, certification checks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("guide validation (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const base = { name: "Suresh Gurung", phone: "+977 9801234567" };
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { await ctx?.cleanup(); });
  const post = (b: object) => request(app).post("/agencies/me/guides").set(rt()).send({ ...base, ...b });

  it("creates a guide; typed languages are normalised (names → codes, others tidied, no duplicates)", async () => {
    const r = await post({ email: "s@example.com", sex: "male", bio: "Loves the Annapurna.", languages: ["English", "nepali", "EN", "thakali  ", "Hindi"] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.languages).toEqual(["en", "ne", "Thakali", "hi"]);
    const byName = await request(app).get("/agencies/me/guides?language=English").set(rt());
    expect(byName.body.guides.some((g: { id: string }) => g.id === r.body.data.id)).toBe(true);
  });

  it("the list carries whole-agency stats for the page cards", async () => {
    const r = await request(app).get("/agencies/me/guides").set(rt());
    expect(r.status).toBe(200);
    expect(r.body.stats).toMatchObject({ total: r.body.total, onTrek: 0, certsExpiring: expect.any(Number), totalBeforeMonth: 0 });
    expect(r.body.stats.available).toBe(r.body.total);
  });

  it("says which field is wrong", async () => {
    const cases: Array<[object, string]> = [
      [{ name: "" }, "name"], [{ phone: "" }, "phone"], [{ phone: "abc" }, "phone"], [{ email: "nope" }, "email"], [{ sex: "robot" }, "sex"],
      [{ bio: "x".repeat(1001) }, "bio"], [{ languages: "English" }, "languages"], [{ languages: ["Eng1ish!"] }, "languages"], [{ languages: Array(13).fill("English") }, "languages"],
      [{ photo: "javascript:alert(1)" }, "photo"],
      [{ certifications: [{ name: "First aid", number: "", expiry: "2030-01-01" }] }, "certifications.0.number"],
      [{ certifications: [{ name: "First aid", number: "A1", expiry: "not-a-date" }] }, "certifications.0.expiry"],
      [{ certifications: [{ name: "", number: "A1", expiry: "2030-01-01" }] }, "certifications.0.name"],
      [{ certifications: [{ name: "First aid", number: "A1", expiry: "2030-01-01", document: "ftp://x" }] }, "certifications.0.document"],
    ];
    for (const [body, field] of cases) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(r.body.errors ?? {}), JSON.stringify(body)).toContain(field);
    }
  });

  it("accepts a certification and ignores an untouched empty row; update validates too", async () => {
    const ok = await post({ certifications: [{ name: "Trekking licence", issuingBody: "NTB", number: "L-1", expiry: "2030-05-01" }, { name: "", number: "", expiry: "" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.certifications).toHaveLength(1);
    const bad = await request(app).patch(`/agencies/me/guides/${ok.body.data.id}`).set(rt()).send({ email: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.email).toBeDefined();
    const upd = await request(app).patch(`/agencies/me/guides/${ok.body.data.id}`).set(rt()).send({ languages: ["german"] });
    expect(upd.body.data.languages).toEqual(["de"]);
  });
});
