// ─────────────────────────────────────────────────────────────────────────────
// Break-Glass emergency access — integration tests (real Postgres).
//
// issue → verify (records first use) → list → revoke → history, plus expiry.
// Skips when no DB is reachable. Uses a throwaway agency.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/breakGlass.service");

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
    where: { name: "BREAKGLASS_TEST_TIER" },
    update: {},
    create: { name: "BREAKGLASS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/breakGlass.service");
  DB_AVAILABLE = true;
} catch (err) {
  console.warn(`[breakGlass.integration] DB unavailable — skipping (${err instanceof Error ? err.message : err})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Break-Glass (real DB)", () => {
  let agencyId = "";

  beforeAll(async () => {
    const s = `${Date.now()}`;
    const agency = await db.agency.create({
      data: { name: `BG Agency ${s}`, email: `bg-${s}@example.com`, slug: `bg-${s}`, tierId },
      select: { id: true },
    });
    agencyId = agency.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("issue returns a raw token once + an ACTIVE record; verify records first use", async () => {
    const { token, expiresAt, breakGlass } = await svc.issueBreakGlass(agencyId, {
      issuedByIp: "10.0.0.1",
      issuedBy: "admin@platform",
      reason: "SOS incident triage",
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(breakGlass.status).toBe("ACTIVE");
    expect(breakGlass.reason).toBe("SOS incident triage");

    // raw token is not stored
    const row = await db.breakGlassToken.findUnique({ where: { id: breakGlass.id } });
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.usedAt).toBeNull();

    const ctx = await svc.verifyBreakGlass(token);
    expect(ctx).toEqual({ agencyId, breakGlassId: breakGlass.id });

    const after = await db.breakGlassToken.findUnique({ where: { id: breakGlass.id } });
    expect(after!.usedAt).toBeInstanceOf(Date);

    // second verify still works and doesn't move usedAt
    const usedAt = after!.usedAt;
    const ctx2 = await svc.verifyBreakGlass(token);
    expect(ctx2).toEqual({ agencyId, breakGlassId: breakGlass.id });
    const after2 = await db.breakGlassToken.findUnique({ where: { id: breakGlass.id } });
    expect(after2!.usedAt!.getTime()).toBe(usedAt!.getTime());
  });

  it("verify rejects unknown, expired and revoked tokens", async () => {
    expect(await svc.verifyBreakGlass("deadbeef")).toBeNull();

    const expired = await svc.issueBreakGlass(agencyId, { issuedByIp: "10.0.0.2", ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await svc.verifyBreakGlass(expired.token)).toBeNull();

    const live = await svc.issueBreakGlass(agencyId, { issuedByIp: "10.0.0.3" });
    await svc.revokeBreakGlass(live.breakGlass.id, "10.0.0.9");
    expect(await svc.verifyBreakGlass(live.token)).toBeNull();
  });

  it("revoke is 404 for unknown and 409 when already revoked", async () => {
    await expect(svc.revokeBreakGlass("nope", "1.1.1.1")).rejects.toMatchObject({ status: 404 });
    const t = await svc.issueBreakGlass(agencyId, { issuedByIp: "10.0.0.4" });
    await svc.revokeBreakGlass(t.breakGlass.id, "10.0.0.9");
    await expect(svc.revokeBreakGlass(t.breakGlass.id, "10.0.0.9")).rejects.toMatchObject({ status: 409 });
  });

  it("listBreakGlass(activeOnly) excludes revoked/expired; history is redacted", async () => {
    const active = await svc.listBreakGlass({ agencyId, activeOnly: true });
    expect(active.every((t) => t.status === "ACTIVE" || t.status === "USED")).toBe(true);

    const all = await svc.listBreakGlass({ agencyId });
    expect(all.length).toBeGreaterThan(active.length);

    const history = await svc.getAgencyBreakGlassHistory(agencyId);
    expect(history.length).toBe(all.length);
    // redacted: no token/IP fields
    expect(Object.keys(history[0])).toEqual(
      expect.arrayContaining(["id", "reason", "issuedAt", "expiresAt", "usedAt", "revokedAt", "status"]),
    );
    expect(history[0]).not.toHaveProperty("tokenHash");
    expect(history[0]).not.toHaveProperty("issuedByIp");
  });

  it("issue for an unknown agency → 404", async () => {
    await expect(
      svc.issueBreakGlass("does-not-exist", { issuedByIp: "10.0.0.5" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
