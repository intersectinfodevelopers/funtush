// Domain & publish — integration test (backend catch-up pass, Phase 6). Real
// DB, skip if down. Exercises the real Prisma update()/findUnique() the
// mocked-service route tests cannot, plus real DNS resolution for the
// verify step (no mocking `lib/dnsVerification` here on purpose).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/domain.service");

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
    where: { name: "DOMAIN_TEST_TIER" },
    update: {},
    create: { name: "DOMAIN_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/domain.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[domain.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";
let agencySlug = "";

d("Domain & publish (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    agencySlug = `domain-${s}`;
    const a = await db.agency.create({
      data: { name: `Domain ${s}`, email: `domain-${s}@example.com`, slug: agencySlug, tierId },
    });
    agencyId = a.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("a fresh agency has no custom domain and is unpublished", async () => {
    const settings = await svc.getDomainSettings(agencyId);

    expect(settings.subdomain).toBe(agencySlug);
    expect(settings.customDomain).toBeNull();
    expect(settings.status).toBe("NONE");
    expect(settings.dnsInstructions).toBeNull();
    expect(settings.published).toBe(false);
    expect(settings.publishedAt).toBeNull();
  });

  it("connecting a domain writes PENDING status, a token, and dns instructions — round-trips through a fresh read", async () => {
    await svc.connectDomain(agencyId, "TrekkingAgency.example");

    const reread = await svc.getDomainSettings(agencyId);
    expect(reread.customDomain).toBe("trekkingagency.example");
    expect(reread.status).toBe("PENDING");
    expect(reread.verifiedAt).toBeNull();
    expect(reread.dnsInstructions).not.toBeNull();
    expect(reread.dnsInstructions?.cname.name).toBe("www.trekkingagency.example");
    expect(reread.dnsInstructions?.txt.name).toBe("_funtush-verify.trekkingagency.example");
  });

  it("reconnecting the same domain issues a fresh verification token", async () => {
    const first = await svc.connectDomain(agencyId, "trekkingagency.example");
    const firstToken = first.dnsInstructions?.txt.value;

    const second = await svc.connectDomain(agencyId, "trekkingagency.example");
    const secondToken = second.dnsInstructions?.txt.value;

    expect(firstToken).toBeTruthy();
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);
  });

  it("verifying against real DNS with no TXT record present comes back unverified, not an error", async () => {
    const result = await svc.verifyDomain(agencyId);

    expect(result.verified).toBe(false);
    expect(result.detail).toBeTruthy();

    const after = await svc.getDomainSettings(agencyId);
    expect(after.status).toBe("PENDING");
    expect(after.verifiedAt).toBeNull();
  });

  it("verifying with no domain connected throws a 400", async () => {
    await svc.disconnectDomain(agencyId);

    await expect(svc.verifyDomain(agencyId)).rejects.toMatchObject({ status: 400 });
  });

  it("disconnecting clears the domain, token, status, and verifiedAt", async () => {
    await svc.connectDomain(agencyId, "trekkingagency.example");
    await svc.disconnectDomain(agencyId);

    const after = await svc.getDomainSettings(agencyId);
    expect(after.customDomain).toBeNull();
    expect(after.status).toBe("NONE");
    expect(after.dnsInstructions).toBeNull();
  });

  it("publish sets publishedAt; unpublish clears it back to null — independent of custom-domain state", async () => {
    const published = await svc.publishSite(agencyId);
    expect(published.published).toBe(true);
    expect(published.publishedAt).not.toBeNull();

    const unpublished = await svc.unpublishSite(agencyId);
    expect(unpublished.published).toBe(false);
    expect(unpublished.publishedAt).toBeNull();
  });

  it("getDomainSettings throws 404 for an unknown agency id", async () => {
    await expect(svc.getDomainSettings("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      status: 404,
    });
  });
});
