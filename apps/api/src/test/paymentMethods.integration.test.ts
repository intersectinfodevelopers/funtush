// Payment methods — integration test (API-wide docs/test pass, Batch 3).
// Real DB, real AES-256-GCM encryption (ENCRYPTION_KEY from .env.test).
// Proves credentials actually round-trip through encryptCredentials/
// decryptCredentials and are never stored in plaintext.
import { describe, it, expect, afterAll } from "vitest";
import { encryptCredentials, decryptCredentials } from "../utils/encryption";

type Database = typeof import("@funtush/database");

let DB_AVAILABLE = false;
let db: Database["db"];
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "PAYMENTMETHODS_TEST_TIER" },
    update: {},
    create: { name: "PAYMENTMETHODS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[paymentMethods.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Payment methods encryption (real DB)", () => {
  let agencyId = "";

  afterAll(async () => {
    if (agencyId) {
      await db.agencyPaymentMethod.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("encrypted credentials round-trip through the real DB, never in plaintext", async () => {
    const s = `${Date.now()}`;
    const agency = await db.agency.create({
      data: { name: `PaymentMethods ${s}`, email: `pm-${s}@example.com`, slug: `pm-${s}`, tierId },
    });
    agencyId = agency.id;

    const secret = { apiKey: "sk_live_super_secret_12345", webhookSecret: "whsec_abc" };
    const encrypted = encryptCredentials(secret);

    expect(encrypted).not.toContain("sk_live_super_secret_12345");

    const saved = await db.agencyPaymentMethod.create({
      data: { agencyId, provider: "STRIPE", credentialsEncrypted: encrypted },
    });

    // Read the raw row back — the encrypted column must never contain the plaintext.
    const raw = await db.agencyPaymentMethod.findUniqueOrThrow({ where: { id: saved.id } });
    expect(raw.credentialsEncrypted).not.toContain("sk_live_super_secret_12345");

    const decrypted = decryptCredentials(raw.credentialsEncrypted);
    expect(decrypted).toEqual(secret);
  });

  it("two encryptions of the same data produce different ciphertext (random IV)", () => {
    const a = encryptCredentials({ apiKey: "same-value" });
    const b = encryptCredentials({ apiKey: "same-value" });
    expect(a).not.toBe(b);
    expect(decryptCredentials(a)).toEqual(decryptCredentials(b));
  });

  it("decrypting a tampered ciphertext throws (GCM auth tag fails)", () => {
    const encrypted = encryptCredentials({ apiKey: "tamper-test" });
    const [iv, tag, cipherHex] = encrypted.split(":");
    const tampered = `${iv}:${tag}:${cipherHex.slice(0, -2)}ff`;
    expect(() => decryptCredentials(tampered)).toThrow();
  });
});
