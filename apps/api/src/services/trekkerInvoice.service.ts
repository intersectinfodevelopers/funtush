import { db, Prisma } from "@funtush/database";

/**
 * Trekker invoices — invoices an agency issues to its customers for a booking.
 * API shape follows funtush-frontend finance/invoices (invoice_number,
 * trekker_name, package_name, amount, issue_date, due_date, status).
 */

export class TrekkerInvoiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface LineItemInput {
  description?: string;
  quantity?: number;
  unitPrice?: number;
}
interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

const bad = (m: string): never => {
  throw new TrekkerInvoiceError(400, m);
};

function text(v: unknown, label: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return bad(`${label} must be text.`);
  const t = v.trim();
  if (t.length > max) return bad(`${label} must be at most ${max} characters.`);
  return t === "" ? null : t;
}

function money(v: unknown, label: string, { min = 0, max = 1_000_000_000 } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return bad(`${label} must be a number between ${min} and ${max}.`);
  return v;
}

function currency(v: unknown): string {
  if (v === undefined || v === null || v === "") return "NPR";
  if (typeof v !== "string" || !/^[A-Za-z]{3}$/.test(v.trim())) return bad("currencyCode must be a 3-letter code like NPR.");
  return v.trim().toUpperCase();
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
function email(v: unknown): string | null {
  const t = text(v, "trekkerEmail", 254);
  if (t && !EMAIL_RE.test(t)) return bad("trekkerEmail must be a valid email address.");
  return t;
}

function normalizeLineItems(raw: unknown): LineItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return bad("lineItems must be a list.");
  if (raw.length > 50) return bad("An invoice can have at most 50 line items.");
  const out: LineItem[] = [];
  for (const li of raw as LineItemInput[]) {
    if (!li || typeof li !== "object") return bad("Each line item must be an object.");
    const description = text(li.description, "Line item description", 200);
    if (!description) continue; // blank rows are ignored, as before
    out.push({
      description,
      quantity: li.quantity === undefined ? 1 : money(li.quantity, "Quantity", { min: 0.001, max: 100000 }),
      unitPrice: li.unitPrice === undefined ? 0 : money(li.unitPrice, "Unit price"),
    });
  }
  return out;
}

function computeTotals(items: LineItem[], discount: unknown) {
  const subtotal = items.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const d = discount === undefined || discount === null ? 0 : money(discount, "Discount");
  if (d > subtotal) bad("The discount can't be more than the invoice subtotal.");
  return { subtotal, discount: d, total: subtotal - d };
}

function ymd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
function toDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = typeof v === "string" ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return bad("Invalid date.");
  return d;
}

const SELECT = {
  id: true,
  invoiceNumber: true,
  bookingId: true,
  trekkerName: true,
  trekkerEmail: true,
  packageName: true,
  lineItems: true,
  subtotal: true,
  discount: true,
  total: true,
  currencyCode: true,
  status: true,
  issueDate: true,
  dueDate: true,
  paidAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrekkerInvoiceSelect;

type Row = Prisma.TrekkerInvoiceGetPayload<{ select: typeof SELECT }>;

function toApi(r: Row) {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    bookingId: r.bookingId,
    trekkerName: r.trekkerName,
    trekkerEmail: r.trekkerEmail,
    packageName: r.packageName,
    lineItems: r.lineItems,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    total: Number(r.total),
    amount: Number(r.total), // frontend uses `amount`
    currencyCode: r.currencyCode,
    status: r.status.charAt(0) + r.status.slice(1).toLowerCase(), // "Paid"
    issueDate: ymd(r.issueDate),
    dueDate: ymd(r.dueDate),
    paidAt: r.paidAt,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function nextInvoiceNumber(agencyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await db.trekkerInvoice.findFirst({
    where: { agencyId, invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const lastSeq = last ? parseInt(last.invoiceNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, "0")}`;
}

export interface CreateInvoiceInput {
  bookingId?: string | null;
  trekkerName?: string;
  trekkerEmail?: string | null;
  packageName?: string | null;
  lineItems?: LineItemInput[];
  discount?: number;
  currencyCode?: string;
  issueDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export async function listInvoices(
  agencyId: string,
  q: { status?: string; search?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  const where: Prisma.TrekkerInvoiceWhereInput = { agencyId };
  if (q.status && q.status.toLowerCase() !== "all") {
    where.status = q.status.toUpperCase() as Prisma.EnumTrekkerInvoiceStatusFilter["equals"];
  }
  if (q.search?.trim()) {
    const s = q.search.trim();
    where.OR = [
      { invoiceNumber: { contains: s, mode: "insensitive" } },
      { trekkerName: { contains: s, mode: "insensitive" } },
      { packageName: { contains: s, mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.trekkerInvoice.findMany({
      where,
      select: SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.trekkerInvoice.count({ where }),
  ]);
  return { invoices: rows.map(toApi), total, page, limit };
}

export async function createInvoice(agencyId: string, body: CreateInvoiceInput) {
  let trekkerName = text(body.trekkerName, "trekkerName", 120) ?? "";
  let trekkerEmail = email(body.trekkerEmail);
  let packageName = text(body.packageName, "packageName", 150);
  let items = normalizeLineItems(body.lineItems);
  const notes = text(body.notes, "notes", 1000);
  const currencyCode = currency(body.currencyCode);
  const issueDate = toDate(body.issueDate) ?? new Date();
  const dueDate = toDate(body.dueDate) ?? null;
  if (dueDate && dueDate < issueDate && ymd(dueDate) !== ymd(issueDate)) bad("The due date can't be before the issue date.");

  // If created from a booking, pull the defaults from it.
  if (body.bookingId) {
    const booking = await db.booking.findFirst({
      where: { id: body.bookingId, agencyId },
      select: {
        id: true,
        trekkerName: true,
        trekkerEmail: true,
        totalPrice: true,
        package: { select: { title: true } },
      },
    });
    if (!booking) throw new TrekkerInvoiceError(400, "Booking not found for this agency.");
    trekkerName ||= booking.trekkerName;
    trekkerEmail ||= booking.trekkerEmail ?? null;
    packageName ||= booking.package?.title ?? null;
    if (items.length === 0) {
      items = [
        {
          description: booking.package?.title ?? "Trek booking",
          quantity: 1,
          unitPrice: Number(booking.totalPrice),
        },
      ];
    }
  }

  if (!trekkerName) throw new TrekkerInvoiceError(400, "A trekker name is required.");
  if (items.length === 0) throw new TrekkerInvoiceError(400, "At least one line item is required.");

  const { subtotal, discount, total } = computeTotals(items, body.discount);
  const invoiceNumber = await nextInvoiceNumber(agencyId);

  const row = await db.trekkerInvoice.create({
    data: {
      agencyId,
      invoiceNumber,
      bookingId: body.bookingId || null,
      trekkerName,
      trekkerEmail,
      packageName,
      lineItems: items as unknown as Prisma.InputJsonValue,
      subtotal,
      discount,
      total,
      currencyCode,
      issueDate,
      dueDate,
      notes,
    },
    select: SELECT,
  });
  return toApi(row);
}

export async function getInvoice(agencyId: string, id: string) {
  const row = await db.trekkerInvoice.findFirst({ where: { id, agencyId }, select: SELECT });
  if (!row) throw new TrekkerInvoiceError(404, "Invoice not found.");
  return toApi(row);
}

export interface UpdateInvoiceInput extends CreateInvoiceInput {
  trekkerName?: string;
}

export async function updateInvoice(agencyId: string, id: string, body: UpdateInvoiceInput) {
  const existing = await db.trekkerInvoice.findFirst({
    where: { id, agencyId },
    select: { id: true, status: true, discount: true, lineItems: true },
  });
  if (!existing) throw new TrekkerInvoiceError(404, "Invoice not found.");
  if (existing.status === "PAID" || existing.status === "VOID") {
    throw new TrekkerInvoiceError(409, `A ${existing.status.toLowerCase()} invoice cannot be edited.`);
  }

  const data: Prisma.TrekkerInvoiceUpdateInput = {};
  if (body.trekkerName !== undefined) {
    const n = text(body.trekkerName, "trekkerName", 120);
    if (!n) throw new TrekkerInvoiceError(400, "Trekker name cannot be empty.");
    data.trekkerName = n;
  }
  if (body.trekkerEmail !== undefined) data.trekkerEmail = email(body.trekkerEmail);
  if (body.packageName !== undefined) data.packageName = text(body.packageName, "packageName", 150);
  if (body.currencyCode !== undefined) data.currencyCode = currency(body.currencyCode);
  if (body.notes !== undefined) data.notes = text(body.notes, "notes", 1000);
  const issue = toDate(body.issueDate);
  if (issue !== undefined) data.issueDate = issue;
  const due = toDate(body.dueDate);
  if (due !== undefined) data.dueDate = due;

  if (body.lineItems !== undefined || body.discount !== undefined) {
    const items =
      body.lineItems !== undefined
        ? normalizeLineItems(body.lineItems)
        : (existing.lineItems as unknown as LineItem[]);
    if (items.length === 0) throw new TrekkerInvoiceError(400, "At least one line item is required.");
    const discount: unknown = body.discount !== undefined ? body.discount : Number(existing.discount);
    const totals = computeTotals(items, discount);
    data.lineItems = items as unknown as Prisma.InputJsonValue;
    data.subtotal = totals.subtotal;
    data.discount = totals.discount;
    data.total = totals.total;
  }

  const row = await db.trekkerInvoice.update({ where: { id }, data, select: SELECT });
  return toApi(row);
}

export async function setInvoiceStatus(
  agencyId: string,
  id: string,
  target: "SENT" | "PAID" | "OVERDUE" | "VOID",
) {
  const existing = await db.trekkerInvoice.findFirst({
    where: { id, agencyId },
    select: { id: true, status: true },
  });
  if (!existing) throw new TrekkerInvoiceError(404, "Invoice not found.");

  const allowed: Record<string, string[]> = {
    DRAFT: ["SENT", "VOID"],
    SENT: ["PAID", "OVERDUE", "VOID"],
    OVERDUE: ["PAID", "VOID"],
    PAID: [],
    VOID: [],
  };
  if (!(allowed[existing.status] ?? []).includes(target)) {
    throw new TrekkerInvoiceError(409, `Cannot move a ${existing.status} invoice to ${target}.`);
  }

  const row = await db.trekkerInvoice.update({
    where: { id },
    data: { status: target, paidAt: target === "PAID" ? new Date() : null },
    select: SELECT,
  });
  return toApi(row);
}

export async function deleteInvoice(agencyId: string, id: string) {
  const existing = await db.trekkerInvoice.findFirst({
    where: { id, agencyId },
    select: { id: true, status: true },
  });
  if (!existing) throw new TrekkerInvoiceError(404, "Invoice not found.");
  if (existing.status === "PAID") {
    throw new TrekkerInvoiceError(409, "A paid invoice cannot be deleted — void it instead.");
  }
  await db.trekkerInvoice.delete({ where: { id } });
}
