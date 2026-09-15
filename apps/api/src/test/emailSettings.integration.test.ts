// Email settings — integration test (backend catch-up pass). Real DB, skip if
// down. Exercises the real Prisma upsert/findUnique the mocked-service route
// tests cannot.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/emailSettings.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "EMAILSETTINGS_TEST_TIER" },
    update: {},
    create: { name: "EMAILSETTINGS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/emailSettings.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[emailSettings.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Email settings (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Email ${s}`, email: `email-${s}@example.com`, slug: `email-${s}`, tierId },
    });
    agencyId = a.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.agencyEmailSettings.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("a never-saved agency gets the platform defaults, not an error", async () => {
    const settings = await svc.getEmailSettings(agencyId);

    expect(settings.values.senderName).toBeNull();
    expect(settings.values.footerText).toBe("Sent by your trekking agency via Funtush.");
    expect(settings.values.includeUnsubscribe).toBe(true);
  });

  it("save → the real row round-trips through a fresh read", async () => {
    await svc.updateEmailSettings(agencyId, {
      senderName: "Himalayan Trails",
      fromAddress: "bookings@himalayantrails.com",
      bccBookingsTo: "ops@himalayantrails.com",
    });

    const reread = await svc.getEmailSettings(agencyId);
    expect(reread.values.senderName).toBe("Himalayan Trails");
    expect(reread.values.fromAddress).toBe("bookings@himalayantrails.com");
    expect(reread.values.bccBookingsTo).toBe("ops@himalayantrails.com");
    // Untouched field keeps its default — the upsert did not clobber it.
    expect(reread.values.footerText).toBe("Sent by your trekking agency via Funtush.");
  });

  it("a partial PATCH leaves the other fields untouched", async () => {
    await svc.updateEmailSettings(agencyId, { includeUnsubscribe: false });

    const after = await svc.getEmailSettings(agencyId);
    expect(after.values.includeUnsubscribe).toBe(false);
    // Still what the previous test saved.
    expect(after.values.senderName).toBe("Himalayan Trails");
  });

  it("null clears a field back to the platform default", async () => {
    await svc.updateEmailSettings(agencyId, { fromAddress: null });

    const after = await svc.getEmailSettings(agencyId);
    expect(after.values.fromAddress).toBeNull();
  });
});
