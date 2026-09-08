// Trekker invoices — integration test (Phase 2). Real DB, skip if down.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/trekkerInvoice.service");

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
    where: { name: "INV_TEST_TIER" },
    update: {},
    create: { name: "INV_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/trekkerInvoice.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[trekkerInvoice.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Trekker invoices (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Inv ${s}`, email: `inv-${s}@example.com`, slug: `inv-${s}`, tierId },
    });
    agencyId = a.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("create → sequential numbers → send → pay → list filter; void path", async () => {
    const a = await svc.createInvoice(agencyId, {
      trekkerName: "John Walker",
      packageName: "Everest Base Camp Trek",
      lineItems: [{ description: "EBC Trek", quantity: 1, unitPrice: 2400 }],
    });
    const b = await svc.createInvoice(agencyId, {
      trekkerName: "Asha Rai",
      packageName: "Annapurna Circuit",
      lineItems: [{ description: "Annapurna", quantity: 1, unitPrice: 1800 }],
      discount: 50,
    });
    expect(a.invoiceNumber).toMatch(/-001$/);
    expect(b.invoiceNumber).toMatch(/-002$/);
    expect(b.total).toBe(1750);
    expect(a.status).toBe("Draft");

    // DRAFT can't jump straight to PAID
    await expect(svc.setInvoiceStatus(agencyId, a.id, "PAID")).rejects.toMatchObject({ status: 409 });

    const sent = await svc.setInvoiceStatus(agencyId, a.id, "SENT");
    expect(sent.status).toBe("Sent");
    const paid = await svc.setInvoiceStatus(agencyId, a.id, "PAID");
    expect(paid.status).toBe("Paid");
    expect(paid.paidAt).toBeInstanceOf(Date);

    // paid invoice is locked
    await expect(svc.updateInvoice(agencyId, a.id, { notes: "x" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.deleteInvoice(agencyId, a.id)).rejects.toMatchObject({ status: 409 });

    expect((await svc.listInvoices(agencyId, { status: "Paid" })).total).toBe(1);
    expect((await svc.listInvoices(agencyId, { status: "Draft" })).total).toBe(1);
    expect((await svc.listInvoices(agencyId, { search: "annapurna" })).total).toBe(1);

    // void + delete the draft
    await svc.setInvoiceStatus(agencyId, b.id, "VOID");
    await expect(svc.updateInvoice(agencyId, b.id, { notes: "x" })).rejects.toMatchObject({ status: 409 });
  });
});
