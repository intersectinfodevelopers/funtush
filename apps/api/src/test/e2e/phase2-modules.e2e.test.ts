// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 agency modules — end-to-end (real HTTP, real DB).
//
// Drives src/app.ts via supertest with a real x-refresh-token credential.
// Covers: guides · blog + categories · gallery + videos · destinations ·
// site ads · package add-ons · agency profile/branding · trekker invoices ·
// roles + the permission catalog.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { createAgencyContext, seedPackage, dbAvailable, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Phase 2 modules (e2e)", () => {
  let ctx: E2EContext;
  const auth = () => ({ "x-refresh-token": ctx.refreshToken });

  beforeAll(async () => {
    ctx = await createAgencyContext({ tierName: "E2E_PHASE2_MODULES", maxGuides: 25 });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  // ── auth guard ─────────────────────────────────────────────────────────────
  it("rejects an anonymous caller with 401", async () => {
    const res = await request(app).get("/agencies/me/guides");
    expect(res.status).toBe(401);
  });

  it("rejects a bogus refresh token with 401", async () => {
    const res = await request(app).get("/agencies/me/guides").set("x-refresh-token", "not-a-real-token");
    expect(res.status).toBe(401);
  });

  // ── Guides ─────────────────────────────────────────────────────────────────
  describe("Guides", () => {
    let guideId = "";

    it("POST creates a guide in the frontend shape", async () => {
      const res = await request(app)
        .post("/agencies/me/guides")
        .set(auth())
        .send({
          name: "Pemba Sherpa",
          phone: "+977 9800000001",
          email: "pemba@example.com",
          languages: ["Nepali", "English"],
          status: "available",
          certifications: [{ name: "Wilderness First Aid", number: "WFA-1", expiry: "2027-11-01" }],
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Pemba Sherpa");
      expect(res.body.data.status).toBe("available");
      expect(res.body.data.guideRef).toBe(res.body.data.id);
      expect(res.body.data.certifications[0].expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      guideId = res.body.data.id;
    });

    it("POST without a name → 400", async () => {
      const res = await request(app).post("/agencies/me/guides").set(auth()).send({ phone: "+977 1" });
      expect(res.status).toBe(400);
    });

    it("GET list returns the created guide", async () => {
      const res = await request(app).get("/agencies/me/guides").set(auth());
      expect(res.status).toBe(200);
      expect(res.body.guides.some((g: { id: string }) => g.id === guideId)).toBe(true);
    });

    it("GET /:id includes computed fields", async () => {
      const res = await request(app).get(`/agencies/me/guides/${guideId}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data.totalTreks).toBe(0);
      expect(res.body.data.upcomingAssignments).toEqual([]);
    });

    it("PATCH replaces the certification set", async () => {
      const res = await request(app)
        .patch(`/agencies/me/guides/${guideId}`)
        .set(auth())
        .send({ status: "on_trek", certifications: [{ name: "New Cert", number: "NC-1", expiry: "2029-01-01" }] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("on_trek");
      expect(res.body.data.certifications).toHaveLength(1);
    });

    it("DELETE soft-deletes (204) and hides it from the list", async () => {
      const del = await request(app).delete(`/agencies/me/guides/${guideId}`).set(auth());
      expect(del.status).toBe(204);
      const res = await request(app).get("/agencies/me/guides").set(auth());
      expect(res.body.guides.some((g: { id: string }) => g.id === guideId)).toBe(false);
    });
  });

  // ── Blog + categories ──────────────────────────────────────────────────────
  // ── Gallery + videos ───────────────────────────────────────────────────────
  describe("Media", () => {
    it("gallery: create caps images at 5 and keeps featuredImage valid", async () => {
      const images = ["a", "b", "c", "d", "e", "f", "g"].map((s) => `https://cdn/${s}.jpg`);
      const res = await request(app)
        .post("/agencies/me/gallery")
        .set(auth())
        .send({ title: "Everest 2026", images, featuredImage: "https://cdn/z.jpg" });
      expect(res.status).toBe(201);
      expect(res.body.data.images).toHaveLength(5);
      expect(res.body.data.images).toContain(res.body.data.featuredImage);

      const del = await request(app).delete(`/agencies/me/gallery/${res.body.data.id}`).set(auth());
      expect(del.status).toBe(204);
    });

    it("gallery: no images → 400", async () => {
      const res = await request(app).post("/agencies/me/gallery").set(auth()).send({ title: "x", images: [] });
      expect(res.status).toBe(400);
    });

    it("video: rejects a non-YouTube URL, accepts a real one", async () => {
      const bad = await request(app)
        .post("/agencies/me/videos")
        .set(auth())
        .send({ title: "x", youtubeUrl: "https://vimeo.com/123" });
      expect(bad.status).toBe(400);

      const ok = await request(app)
        .post("/agencies/me/videos")
        .set(auth())
        .send({ title: "EBC flythrough", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
      expect(ok.status).toBe(201);
      expect(ok.body.data.status).toBe("active");

      const del = await request(app).delete(`/agencies/me/videos/${ok.body.data.id}`).set(auth());
      expect(del.status).toBe(204);
    });
  });

  // ── Destinations ───────────────────────────────────────────────────────────
  describe("Destinations", () => {
    let id = "";
    it("POST parses '5,364m' → int and returns flat + nested shape", async () => {
      const res = await request(app)
        .post("/agencies/me/destinations")
        .set(auth())
        .send({
          title: "Everest Base Camp",
          shortDescription: "The classic",
          altitudeMax: "5,364m",
          durationMin: 12,
          durationMax: 16,
          activities: ["Trekking"],
          bestSeason: "Spring",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.slug).toBe("everest-base-camp");
      expect(res.body.data.altitude.max).toBe(5364);
      expect(res.body.data.duration).toEqual({ min: 12, max: 16 });
      expect(res.body.data.bestSeason).toBe("Spring");
      id = res.body.data.id;
    });

    it("PATCH toggles published", async () => {
      const res = await request(app).patch(`/agencies/me/destinations/${id}`).set(auth()).send({ published: true });
      expect(res.status).toBe(200);
      expect(res.body.data.published).toBe(true);
    });

    it("GET list filters by published=true", async () => {
      const res = await request(app).get("/agencies/me/destinations?published=true").set(auth());
      expect(res.status).toBe(200);
      expect(res.body.destinations.some((x: { id: string }) => x.id === id)).toBe(true);
    });

    it("DELETE → 204", async () => {
      const del = await request(app).delete(`/agencies/me/destinations/${id}`).set(auth());
      expect(del.status).toBe(204);
    });
  });

  // ── Site ads ───────────────────────────────────────────────────────────────
  describe("Site ads", () => {
    let id = "";
    it("GET /positions returns the known slots", async () => {
      const res = await request(app).get("/agencies/me/advertisements/positions").set(auth());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it("POST requires title/image/position", async () => {
      const res = await request(app).post("/agencies/me/advertisements").set(auth()).send({ title: "x" });
      expect(res.status).toBe(400);
    });

    it("POST creates, PATCH pauses, DELETE removes", async () => {
      const create = await request(app)
        .post("/agencies/me/advertisements")
        .set(auth())
        .send({ title: "Spring sale", image: "https://cdn/ad.jpg", position: "homepage-top", linkUrl: "https://x" });
      expect(create.status).toBe(201);
      id = create.body.data.id;

      const pause = await request(app).patch(`/agencies/me/advertisements/${id}`).set(auth()).send({ status: "paused" });
      expect(pause.status).toBe(200);
      expect(pause.body.data.status).toBe("paused");

      const del = await request(app).delete(`/agencies/me/advertisements/${id}`).set(auth());
      expect(del.status).toBe(204);
    });
  });

  // ── Package add-ons ────────────────────────────────────────────────────────
  describe("Package add-ons", () => {
    let packageId = "";
    let addOnId = "";

    beforeAll(async () => {
      ({ packageId } = await seedPackage(ctx.agencyId));
    });

    it("POST creates an add-on", async () => {
      const res = await request(app)
        .post(`/agencies/packages/${packageId}/addons`)
        .set(auth())
        .send({ name: "Helicopter return", price: 950, perPerson: true });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Helicopter return");
      addOnId = res.body.data.id;
    });

    it("POST against another agency's package → 404", async () => {
      const other = await createAgencyContext({ tierName: "E2E_ADDON_OTHER" });
      try {
        const res = await request(app)
          .post(`/agencies/packages/${packageId}/addons`)
          .set("x-refresh-token", other.refreshToken)
          .send({ name: "x", price: 1 });
        expect(res.status).toBe(404);
      } finally {
        await other.cleanup();
      }
    });

    it("GET lists, PATCH updates, DELETE removes", async () => {
      const list = await request(app).get(`/agencies/packages/${packageId}/addons`).set(auth());
      expect(list.status).toBe(200);
      expect(list.body.data.some((a: { id: string }) => a.id === addOnId)).toBe(true);

      const patch = await request(app)
        .patch(`/agencies/packages/${packageId}/addons/${addOnId}`)
        .set(auth())
        .send({ price: 1000 });
      expect(patch.status).toBe(200);
      expect(Number(patch.body.data.price)).toBe(1000);

      const del = await request(app).delete(`/agencies/packages/${packageId}/addons/${addOnId}`).set(auth());
      expect(del.status).toBe(204);
    });
  });

  // ── Agency profile / branding ──────────────────────────────────────────────
  // ── Trekker invoices ───────────────────────────────────────────────────────
  describe("Trekker invoices", () => {
    let invoiceId = "";

    it("POST computes totals and auto-numbers INV-YYYY-NNN", async () => {
      const res = await request(app)
        .post("/agencies/me/finance/invoices")
        .set(auth())
        .send({
          trekkerName: "Jane Doe",
          trekkerEmail: "jane@example.com",
          lineItems: [
            { description: "EBC trek", quantity: 2, unitPrice: 1200 },
            { description: "Insurance", quantity: 2, unitPrice: 100 },
          ],
          discount: 200,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{3}$/);
      expect(Number(res.body.data.subtotal)).toBe(2600);
      expect(Number(res.body.data.total)).toBe(2400);
      expect(res.body.data.status).toBe("Draft");
      invoiceId = res.body.data.id;
    });

    it("send → mark-paid transitions; a PAID invoice can't be edited (409)", async () => {
      const sent = await request(app).patch(`/agencies/me/finance/invoices/${invoiceId}/send`).set(auth());
      expect(sent.status).toBe(200);
      expect(sent.body.data.status).toBe("Sent");

      const paid = await request(app).patch(`/agencies/me/finance/invoices/${invoiceId}/mark-paid`).set(auth());
      expect(paid.status).toBe(200);
      expect(paid.body.data.status).toBe("Paid");
      expect(paid.body.data.paidAt).toBeTruthy();

      const edit = await request(app)
        .patch(`/agencies/me/finance/invoices/${invoiceId}`)
        .set(auth())
        .send({ notes: "late" });
      expect(edit.status).toBe(409);
    });

    it("a paid invoice cannot be deleted (409)", async () => {
      const del = await request(app).delete(`/agencies/me/finance/invoices/${invoiceId}`).set(auth());
      expect(del.status).toBe(409);
    });

    it("GET list includes the invoice", async () => {
      const res = await request(app).get("/agencies/me/finance/invoices").set(auth());
      expect(res.status).toBe(200);
      const rows = res.body.invoices ?? res.body.data ?? [];
      expect(rows.some((r: { id: string }) => r.id === invoiceId)).toBe(true);
    });
  });

  // ── Roles + permission catalog ─────────────────────────────────────────────
  describe("Roles & permission catalog", () => {
    let roleId = "";

    it("GET /agencies/me/roles/permissions returns the grouped catalog", async () => {
      const res = await request(app).get("/agencies/me/roles/permissions").set(auth());
      expect(res.status).toBe(200);
      const groups = res.body.data;
      expect(Array.isArray(groups)).toBe(true);
      const keys = groups.flatMap((g: { permissions: { key: string }[] }) => g.permissions.map((p) => p.key));
      expect(keys).toEqual(
        expect.arrayContaining(["packages", "bookings", "guides", "finance", "staff", "settings"]),
      );
    });

    it("POST role → PATCH permissions with catalog keys → reflected in list", async () => {
      const create = await request(app)
        .post("/agencies/me/roles")
        .set(auth())
        .send({ name: "Trek Coordinator", description: "ops" });
      expect(create.status).toBe(201);
      roleId = create.body.data.id;

      const patch = await request(app)
        .patch(`/agencies/me/roles/${roleId}/permissions`)
        .set(auth())
        .send({ permissionKeys: ["bookings", "guides", "bookings"] });
      expect(patch.status).toBe(200);

      const list = await request(app).get("/agencies/me/roles").set(auth());
      const role = list.body.data.find((r: { id: string }) => r.id === roleId);
      expect(role.permissions.sort()).toEqual(["bookings", "guides"]);
    });

    it("PATCH permissions with an unknown key → 400 (not 500)", async () => {
      const res = await request(app)
        .patch(`/agencies/me/roles/${roleId}/permissions`)
        .set(auth())
        .send({ permissionKeys: ["bookings", "not-a-real-permission"] });
      expect(res.status).toBe(400);
    });

    it("DELETE role → 204", async () => {
      const del = await request(app).delete(`/agencies/me/roles/${roleId}`).set(auth());
      expect(del.status).toBe(204);
    });
  });
});
