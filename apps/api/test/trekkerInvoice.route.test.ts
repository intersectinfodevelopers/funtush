import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const client = {
    trekkerInvoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: { findFirst: vi.fn() },
  };
  return { db: client, prisma: client, Prisma: {} };
});

import {
  createInvoice,
  updateInvoice,
  setInvoiceStatus,
  deleteInvoice,
  TrekkerInvoiceError,
} from "../src/services/trekkerInvoice.service";
import { db } from "@funtush/database";

const AG = "a1";
beforeEach(() => vi.clearAllMocks());

const echoCreate = () =>
  vi.mocked(db.trekkerInvoice.create).mockImplementation(
    async (x: never) =>
      ({
        ...(x as { data: Record<string, unknown> }).data,
        id: "inv1",
        status: (x as { data: { status?: string } }).data.status ?? "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        paidAt: null,
      }) as never,
  );

describe("createInvoice", () => {
  it("computes subtotal/total from line items and issues INV-{year}-001", async () => {
    vi.mocked(db.trekkerInvoice.findFirst).mockResolvedValue(null); // no prior invoice
    echoCreate();
    const inv = await createInvoice(AG, {
      trekkerName: "John Walker",
      lineItems: [
        { description: "EBC Trek", quantity: 1, unitPrice: 2000 },
        { description: "Porter", quantity: 2, unitPrice: 250 },
      ],
      discount: 100,
    });
    const data = vi.mocked(db.trekkerInvoice.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.subtotal).toBe(2500);
    expect(data.discount).toBe(100);
    expect(data.total).toBe(2400);
    expect(String(data.invoiceNumber)).toMatch(/^INV-\d{4}-001$/);
    expect(inv.amount).toBe(2400); // frontend alias
    expect(inv.status).toBe("Draft");
  });

  it("pulls trekker/package/amount from a booking when bookingId is given", async () => {
    vi.mocked(db.trekkerInvoice.findFirst).mockResolvedValue(null);
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "bk1",
      trekkerName: "Asha",
      trekkerEmail: "asha@x.com",
      totalPrice: 1800,
      package: { title: "Annapurna" },
    } as never);
    echoCreate();
    await createInvoice(AG, { bookingId: "bk1" });
    const data = vi.mocked(db.trekkerInvoice.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.trekkerName).toBe("Asha");
    expect(data.packageName).toBe("Annapurna");
    expect(data.total).toBe(1800);
    expect((data.lineItems as unknown[]).length).toBe(1);
  });

  it("400s a bookingId that isn't the agency's", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);
    await expect(createInvoice(AG, { bookingId: "other" })).rejects.toMatchObject({ status: 400 });
  });

  it("requires a name and at least one line item", async () => {
    await expect(createInvoice(AG, { lineItems: [{ description: "x", unitPrice: 1 }] })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("updateInvoice", () => {
  it("409s editing a PAID invoice", async () => {
    vi.mocked(db.trekkerInvoice.findFirst).mockResolvedValue({
      id: "inv1",
      status: "PAID",
      discount: 0,
      lineItems: [],
    } as never);
    await expect(updateInvoice(AG, "inv1", { trekkerName: "New" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("setInvoiceStatus", () => {
  const inv = (status: string) =>
    vi.mocked(db.trekkerInvoice.findFirst).mockResolvedValue({ id: "inv1", status } as never);

  it("allows DRAFT → SENT → PAID and sets paidAt", async () => {
    inv("DRAFT");
    vi.mocked(db.trekkerInvoice.update).mockImplementation(
      async (x: never) =>
        ({ id: "inv1", status: (x as { data: { status: string } }).data.status, paidAt: (x as { data: { paidAt: unknown } }).data.paidAt, createdAt: new Date(), updatedAt: new Date(), subtotal: 0, discount: 0, total: 0 }) as never,
    );
    expect((await setInvoiceStatus(AG, "inv1", "SENT")).status).toBe("Sent");

    inv("SENT");
    const paid = await setInvoiceStatus(AG, "inv1", "PAID");
    expect(paid.status).toBe("Paid");
    const data = vi.mocked(db.trekkerInvoice.update).mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data.paidAt).toBeInstanceOf(Date);
  });

  it("409s DRAFT → PAID (must be sent first)", async () => {
    inv("DRAFT");
    await expect(setInvoiceStatus(AG, "inv1", "PAID")).rejects.toMatchObject({ status: 409 });
  });
});

describe("deleteInvoice", () => {
  it("409s deleting a PAID invoice", async () => {
    vi.mocked(db.trekkerInvoice.findFirst).mockResolvedValue({ id: "inv1", status: "PAID" } as never);
    await expect(deleteInvoice(AG, "inv1")).rejects.toMatchObject({ status: 409 });
  });
});
