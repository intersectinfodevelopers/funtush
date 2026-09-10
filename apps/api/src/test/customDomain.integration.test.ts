// ─────────────────────────────────────────────────────────────────────────────
// Custom domain — integration tests (real Postgres).
//
// set → get (PENDING) → verify (mocked DNS: fail then pass) → VERIFIED routes
// via getTenantByCustomDomain → remove. Skips when no DB is reachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/customDomain.service");
type TenantSvc = typeof import("../services/tenant.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let tenantSvc: TenantSvc;
let paidTierId = "";
let freeTierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  const paid = await db.subscriptionTier.upsert({
    where: { name: "DOMAIN_TEST_PAID" },
    update: { customDomainEnabled: true },
    create: { name: "DOMAIN_TEST_PAID", maxStaff: 5, maxGuides: 5, monthlyPrice: 99, features: {}, customDomainEnabled: true },
    select: { id: true },
  });
  const free = await db.subscriptionTier.upsert({
    where: { name: "DOMAIN_TEST_FREE" },
    update: { customDomainEnabled: false },
    create: { name: "DOMAIN_TEST_FREE", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {}, customDomainEnabled: false },
    select: { id: true },
  });
  paidTierId = paid.id;
  freeTierId = free.id;

  svc = await import("../services/customDomain.service");
  tenantSvc = await import("../services/tenant.service");
  DB_AVAILABLE = true;
} catch (err) {
  console.warn(`[customDomain.integration] DB unavailable — skipping (${err instanceof Error ? err.message : err})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Custom domain (real DB)", () => {
  let agencyId = "";
  let tenantId = "";
  const DOMAIN = `book-${Date.now()}.example.com`;

  beforeAll(async () => {
    const s = `${Date.now()}`;
    tenantId = `tenant-${s}`;
    const agency = await db.agency.create({
      data: { name: `Domain Agency ${s}`, email: `dom-${s}@example.com`, slug: `dom-${s}`, tierId: paidTierId, tenantId },
      select: { id: true },
    });
    agencyId = agency.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {}); // cascades the mapping
  });

  it("rejects an invalid or reserved domain", async () => {
    await expect(svc.setCustomDomain(agencyId, "not a domain")).rejects.toMatchObject({ status: 400 });
    await expect(svc.setCustomDomain(agencyId, "shop.funtush.io")).rejects.toMatchObject({ status: 400 });
  });

  it("free tier cannot set a custom domain (403)", async () => {
    const s = `${Date.now()}`;
    const free = await db.agency.create({
      data: { name: `Free ${s}`, email: `free-${s}@example.com`, slug: `free-${s}`, tierId: freeTierId },
      select: { id: true },
    });
    await expect(svc.setCustomDomain(free.id, "x.example.org")).rejects.toMatchObject({ status: 403 });
    await db.agency.delete({ where: { id: free.id } }).catch(() => {});
  });

  it("set → PENDING with DNS instructions; not yet routable", async () => {
    const m = await svc.setCustomDomain(agencyId, DOMAIN.toUpperCase()); // normalized to lowercase
    expect(m.domain).toBe(DOMAIN);
    expect(m.status).toBe("PENDING");
    expect(m.dns.txt.host).toBe(`_funtush-verify.${DOMAIN}`);
    expect(m.dns.txt.value).toMatch(/^funtush-domain-verification=[0-9a-f]{32}$/);
    expect(m.dns.cname.value).toBeTruthy();

    expect(await tenantSvc.getTenantByCustomDomain(DOMAIN)).toBeNull();
  });

  it("verify fails when the TXT record is absent, succeeds when present", async () => {
    const failRes = await svc.verifyCustomDomain(agencyId, { lookupTxt: async () => [] });
    expect(failRes.status).toBe("FAILED");
    expect(failRes.lastError).toBeTruthy();
    expect(await tenantSvc.getTenantByCustomDomain(DOMAIN)).toBeNull();

    const row = await db.domainMapping.findUnique({ where: { agencyId } });
    const expected = `funtush-domain-verification=${row!.verificationToken}`;
    const okRes = await svc.verifyCustomDomain(agencyId, {
      lookupTxt: async () => [["some-other-record"], [expected]],
    });
    expect(okRes.status).toBe("VERIFIED");
    expect(okRes.verifiedAt).toBeTruthy();
    expect(okRes.lastError).toBeNull();
  });

  it("a VERIFIED mapping routes via getTenantByCustomDomain + copies onto Agency.customDomain", async () => {
    const info = await tenantSvc.getTenantByCustomDomain(DOMAIN);
    expect(info).toEqual({ tenantId, agencyId });

    const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { customDomain: true } });
    expect(agency!.customDomain).toBe(DOMAIN);
  });

  it("changing the domain resets verification and drops the old routing", async () => {
    const NEW = `www-${Date.now()}.example.net`;
    const m = await svc.setCustomDomain(agencyId, NEW);
    expect(m.status).toBe("PENDING");
    expect(await tenantSvc.getTenantByCustomDomain(DOMAIN)).toBeNull();
    expect(await tenantSvc.getTenantByCustomDomain(NEW)).toBeNull();
    const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { customDomain: true } });
    expect(agency!.customDomain).toBeNull();
  });

  it("remove deletes the mapping", async () => {
    expect(await svc.removeCustomDomain(agencyId)).toEqual({ removed: true });
    expect(await svc.getDomainMapping(agencyId)).toBeNull();
    expect(await svc.removeCustomDomain(agencyId)).toEqual({ removed: false });
  });
});
