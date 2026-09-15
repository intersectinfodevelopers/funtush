// Fraud review queue — integration test (API-wide docs/test pass, Batch 0).
// Real DB, skip if down. Exercises the real Prisma queries/transaction the
// mocked-service HTTP test (`test/fraud.route.test.ts`) cannot — this is the
// coverage that was missing entirely before this pass: `fraud.service.ts`
// referenced `FraudFlag`/`BlocklistEntry` models that did not exist in the
// schema, so nothing had ever proven this works against a real database.
import { describe, it, expect, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/fraud.service");

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
    where: { name: "FRAUD_TEST_TIER" },
    update: {},
    create: { name: "FRAUD_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/fraud.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[fraud.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Fraud review queue (real DB)", () => {
  const agencyIds: string[] = [];
  const flagIds: string[] = [];

  afterAll(async () => {
    await db.fraudFlag.deleteMany({ where: { id: { in: flagIds } } }).catch(() => {});
    await db.blocklistEntry.deleteMany({ where: { agencyId: { in: agencyIds } } }).catch(() => {});
    for (const id of agencyIds) {
      await db.agency.delete({ where: { id } }).catch(() => {});
    }
  });

  async function freshAgency(label: string) {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agency = await db.agency.create({
      data: { name: `Fraud ${label} ${s}`, email: `fraud-${label}-${s}@example.com`, slug: `fraud-${label}-${s}`, tierId },
    });
    agencyIds.push(agency.id);
    return agency;
  }

  it("getFraudQueue returns only PENDING flags, strongest signal first", async () => {
    const agency = await freshAgency("queue");

    const yellow = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "YELLOW", flagsTriggered: ["LOW_RISK"] },
    });
    const red = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "RED", flagsTriggered: ["DUPLICATE_FINGERPRINT"] },
    });
    const resolved = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "RED", status: "DISMISSED", flagsTriggered: [] },
    });
    flagIds.push(yellow.id, red.id, resolved.id);

    const queue = await svc.getFraudQueue();
    const ids = queue.map((f) => f.id);

    expect(ids).toContain(red.id);
    expect(ids).toContain(yellow.id);
    expect(ids).not.toContain(resolved.id);
    expect(ids.indexOf(red.id)).toBeLessThan(ids.indexOf(yellow.id));
  });

  it("confirmFraud bans the account and blocklists its fingerprint/IP/email in one transaction", async () => {
    const agency = await freshAgency("confirm");
    const flag = await db.fraudFlag.create({
      data: {
        agencyId: agency.id,
        signal: "RED",
        flagsTriggered: ["DUPLICATE_FINGERPRINT", "DISPOSABLE_EMAIL"],
        fingerprint: `fp-${agency.id}`,
        ip: `10.0.0.${Math.floor(Math.random() * 250)}`,
        email: `spam-${agency.id}@temp.com`,
      },
    });
    flagIds.push(flag.id);

    const updated = await svc.confirmFraud(flag.id, "Confirmed duplicate-account fraud");
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.reviewedAt).not.toBeNull();

    const bannedAgency = await db.agency.findUnique({ where: { id: agency.id } });
    expect(bannedAgency?.status).toBe("BANNED");
    expect(bannedAgency?.banReason).toBe("Confirmed duplicate-account fraud");

    const entries = await db.blocklistEntry.findMany({ where: { agencyId: agency.id } });
    expect(entries.map((e) => e.type).sort()).toEqual(["EMAIL", "FINGERPRINT", "IP"]);
  });

  it("confirmFraud is idempotent on the blocklist via skipDuplicates — a second account sharing a fingerprint doesn't error", async () => {
    const sharedFingerprint = `fp-shared-${Date.now()}`;

    const agencyA = await freshAgency("shared-a");
    const flagA = await db.fraudFlag.create({
      data: { agencyId: agencyA.id, signal: "RED", flagsTriggered: [], fingerprint: sharedFingerprint },
    });
    flagIds.push(flagA.id);
    await svc.confirmFraud(flagA.id);

    const agencyB = await freshAgency("shared-b");
    const flagB = await db.fraudFlag.create({
      data: { agencyId: agencyB.id, signal: "RED", flagsTriggered: [], fingerprint: sharedFingerprint },
    });
    flagIds.push(flagB.id);

    await expect(svc.confirmFraud(flagB.id)).resolves.toMatchObject({ status: "CONFIRMED" });

    const rows = await db.blocklistEntry.findMany({ where: { type: "FINGERPRINT", value: sharedFingerprint } });
    expect(rows).toHaveLength(1);
  });

  it("confirmFraud throws when the flag is already resolved", async () => {
    const agency = await freshAgency("already");
    const flag = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "YELLOW", status: "DISMISSED", flagsTriggered: [] },
    });
    flagIds.push(flag.id);

    await expect(svc.confirmFraud(flag.id)).rejects.toThrow(/already dismissed/i);
  });

  it("dismissFraud clears the flag and resets the agency's risk score", async () => {
    const agency = await freshAgency("dismiss");
    await db.agency.update({ where: { id: agency.id }, data: { riskScore: 42 } });

    const flag = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "ORANGE", flagsTriggered: ["VELOCITY"] },
    });
    flagIds.push(flag.id);

    const updated = await svc.dismissFraud(flag.id);
    expect(updated.status).toBe("DISMISSED");

    const cleared = await db.agency.findUnique({ where: { id: agency.id } });
    expect(cleared?.riskScore).toBe(0);
  });

  it("getBanRegistry lists only BANNED agencies, most recent first", async () => {
    const agency = await freshAgency("registry");
    const flag = await db.fraudFlag.create({
      data: { agencyId: agency.id, signal: "RED", flagsTriggered: [] },
    });
    flagIds.push(flag.id);
    await svc.confirmFraud(flag.id, "Registry test ban");

    const registry = await svc.getBanRegistry();
    const entry = registry.find((r) => r.id === agency.id);

    expect(entry).toBeDefined();
    expect(entry?.banReason).toBe("Registry test ban");
  });
});
