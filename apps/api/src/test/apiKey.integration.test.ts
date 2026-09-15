// API keys — integration test (API-wide docs/test pass, Batch 3). Real DB.
// This module previously had zero real tests — a stray fixture comment
// (`src/test/bugReporting/largeTier.ts`) referenced `apiKey.service.test.ts`
// and `apiKey.integration.test.ts`, neither of which existed.
import { describe, it, expect, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/apiKey.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let largeTierId = "";
let freeTierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  const largeTier = await db.subscriptionTier.upsert({
    where: { name: "LARGE" },
    update: {},
    create: { name: "LARGE", maxStaff: 50, maxGuides: 50, monthlyPrice: 199, features: {} },
    select: { id: true },
  });
  largeTierId = largeTier.id;

  const freeTier = await db.subscriptionTier.upsert({
    where: { name: "APIKEY_TEST_FREE_TIER" },
    update: {},
    create: { name: "APIKEY_TEST_FREE_TIER", maxStaff: 1, maxGuides: 1, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  freeTierId = freeTier.id;

  svc = await import("../services/apiKey.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[apiKey.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("API keys (real DB)", () => {
  let largeAgencyId = "";
  let freeAgencyId = "";
  const createdKeyIds: string[] = [];

  afterAll(async () => {
    await db.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } }).catch(() => {});
    for (const id of [largeAgencyId, freeAgencyId]) {
      if (id) await db.agency.delete({ where: { id } }).catch(() => {});
    }
  });

  it("createApiKey rejects a FREE-tier agency with 403", async () => {
    const s = `${Date.now()}`;
    const agency = await db.agency.create({
      data: { name: `ApiKey Free ${s}`, email: `apikey-free-${s}@example.com`, slug: `apikey-free-${s}`, tierId: freeTierId },
    });
    freeAgencyId = agency.id;

    await expect(svc.createApiKey(freeAgencyId, "My Key", "READ_ONLY")).rejects.toMatchObject({ status: 403 });
  });

  it("createApiKey rejects a missing name with 400", async () => {
    const s = `${Date.now()}`;
    const agency = await db.agency.create({
      data: { name: `ApiKey Large ${s}`, email: `apikey-large-${s}@example.com`, slug: `apikey-large-${s}`, tierId: largeTierId },
    });
    largeAgencyId = agency.id;

    await expect(svc.createApiKey(largeAgencyId, "", "READ_ONLY")).rejects.toMatchObject({ status: 400 });
  });

  it("creates a real key, stores only the hash + prefix, and returns the raw key exactly once", async () => {
    const result = await svc.createApiKey(largeAgencyId, "Integration Key", "READ_WRITE");
    createdKeyIds.push(result.id);

    expect(result.key).toMatch(/^funtush_live_[a-f0-9]{64}$/);
    expect(result.keyPrefix).toBe(result.key.slice(0, 20));

    const row = await db.apiKey.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.keyHash).not.toBe(result.key);
    expect(row.keyHash).not.toContain(result.key);
  });

  it("listApiKeys never returns the raw key or hash", async () => {
    const list = await svc.listApiKeys(largeAgencyId);
    expect(list.length).toBeGreaterThan(0);
    for (const key of list) {
      expect(key).not.toHaveProperty("keyHash");
      expect(key).not.toHaveProperty("key");
    }
  });

  it("authenticateApiKey resolves the raw key back to the owning agency and bumps lastUsedAt", async () => {
    const created = await svc.createApiKey(largeAgencyId, "Auth Test Key", "READ_ONLY");
    createdKeyIds.push(created.id);

    const auth = await svc.authenticateApiKey(created.key);
    expect(auth?.agencyId).toBe(largeAgencyId);
    expect(auth?.scope).toBe("READ_ONLY");

    const row = await db.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("authenticateApiKey returns null for an unknown or malformed key", async () => {
    expect(await svc.authenticateApiKey("funtush_live_not_a_real_key")).toBeNull();
  });

  it("revokeApiKey works once, then 409s on a second revoke", async () => {
    const created = await svc.createApiKey(largeAgencyId, "Revoke Test Key", "READ_ONLY");
    createdKeyIds.push(created.id);

    const revoked = await svc.revokeApiKey(created.id, largeAgencyId);
    expect(revoked.revoked).toBe(true);

    await expect(svc.revokeApiKey(created.id, largeAgencyId)).rejects.toMatchObject({ status: 409 });
  });

  it("revokeApiKey refuses to revoke a key owned by a different agency", async () => {
    const created = await svc.createApiKey(largeAgencyId, "Cross-Agency Key", "READ_ONLY");
    createdKeyIds.push(created.id);

    await expect(svc.revokeApiKey(created.id, "some-other-agency-id")).rejects.toMatchObject({ status: 403 });
  });

  it("authenticateApiKey returns null once a key is revoked", async () => {
    const created = await svc.createApiKey(largeAgencyId, "Revoke Then Auth", "READ_ONLY");
    createdKeyIds.push(created.id);
    await svc.revokeApiKey(created.id, largeAgencyId);

    expect(await svc.authenticateApiKey(created.key)).toBeNull();
  });
});
