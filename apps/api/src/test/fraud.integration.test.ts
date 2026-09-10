// ─────────────────────────────────────────────────────────────────────────────
// Fraud review queue — integration tests (real Postgres).
//
// Exercises fraud.service.ts against a real DB: a PENDING flag is queued,
// confirming it bans the agency + writes blocklist rows (idempotently), and
// dismissing it clears the flag + resets the risk score.
//
// SAFE anywhere: skips when no DB is reachable. Uses a throwaway agency.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type FraudService = typeof import("../services/fraud.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: FraudService;
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  const tier = await db.subscriptionTier.upsert({
    where: { name: "FRAUD_TEST_TIER" },
    update: {},
    create: { name: "FRAUD_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;

  svc = await import("../services/fraud.service");
  DB_AVAILABLE = true;
} catch (err) {
  console.warn(`[fraud.integration] DB unavailable — skipping (${err instanceof Error ? err.message : err})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Fraud review queue (real DB)", () => {
  let agencyId = "";
  let flagId = "";

  beforeAll(async () => {
    const suffix = `${Date.now()}`;
    const agency = await db.agency.create({
      data: {
        name: `Fraud Test Agency ${suffix}`,
        email: `fraudtest-${suffix}@example.com`,
        slug: `fraudtest-${suffix}`,
        tierId,
        riskScore: 80,
      },
      select: { id: true },
    });
    agencyId = agency.id;

    const flag = await db.fraudFlag.create({
      data: {
        agencyId,
        signal: "RED",
        flagsTriggered: ["DUPLICATE_FINGERPRINT", "DISPOSABLE_EMAIL"],
        evidenceSummary: "Same device fingerprint as 3 banned accounts",
        fingerprint: `fp-${suffix}`,
        ip: "203.0.113.7",
        email: `spam-${suffix}@temp.example`,
      },
      select: { id: true },
    });
    flagId = flag.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.blocklistEntry.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {}); // cascades the flag
    }
  });

  it("getFraudQueue returns the PENDING flag, strongest signal first", async () => {
    const queue = await svc.getFraudQueue();
    const mine = queue.find((f) => f.id === flagId);
    expect(mine).toBeTruthy();
    expect(mine!.status).toBe("PENDING");
    // RED should sort ahead of anything ORANGE/YELLOW in the queue
    const firstNonMineWeaker = queue.every(
      (f, i) => i === 0 || ["RED", "ORANGE", "YELLOW"].indexOf(f.signal) >= ["RED", "ORANGE", "YELLOW"].indexOf(queue[i - 1].signal),
    );
    expect(firstNonMineWeaker).toBe(true);
  });

  it("confirmFraud bans the agency and blocklists fingerprint/IP/email", async () => {
    const updated = await svc.confirmFraud(flagId, "Confirmed duplicate-account fraud");
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.reviewedAt).toBeInstanceOf(Date);

    const agency = await db.agency.findUnique({ where: { id: agencyId } });
    expect(agency!.status).toBe("BANNED");
    expect(agency!.bannedAt).toBeInstanceOf(Date);
    expect(agency!.banReason).toBe("Confirmed duplicate-account fraud");

    const blocked = await db.blocklistEntry.findMany({ where: { agencyId } });
    expect(blocked.map((b) => b.type).sort()).toEqual(["EMAIL", "FINGERPRINT", "IP"]);
  });

  it("confirmFraud is idempotent on the blocklist and 409s a resolved flag", async () => {
    await expect(svc.confirmFraud(flagId)).rejects.toThrow(/already confirmed/i);
    // still exactly 3 rows — no duplicates
    const blocked = await db.blocklistEntry.count({ where: { agencyId } });
    expect(blocked).toBe(3);
  });

  it("getBanRegistry includes the banned agency", async () => {
    const registry = await svc.getBanRegistry();
    const mine = registry.find((a) => a.id === agencyId);
    expect(mine).toBeTruthy();
    expect(mine!.banReason).toBe("Confirmed duplicate-account fraud");
  });

  it("dismissFraud clears a PENDING flag and resets the risk score", async () => {
    const suffix = `${Date.now()}-d`;
    const agency = await db.agency.create({
      data: {
        name: `Fraud Dismiss Agency ${suffix}`,
        email: `frauddismiss-${suffix}@example.com`,
        slug: `frauddismiss-${suffix}`,
        tierId,
        riskScore: 65,
      },
      select: { id: true },
    });
    const flag = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "YELLOW", evidenceSummary: "Weak signal" },
      select: { id: true },
    });

    const updated = await svc.dismissFraud(flag.id);
    expect(updated.status).toBe("DISMISSED");

    const after = await db.agency.findUnique({ where: { id: agency.id } });
    expect(after!.riskScore).toBe(0);
    expect(after!.status).not.toBe("BANNED");

    await db.agency.delete({ where: { id: agency.id } }).catch(() => {});
  });
});
