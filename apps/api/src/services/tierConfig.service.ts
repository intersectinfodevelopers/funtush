import { db, Prisma } from "@funtush/database";

/**
 * Super-Admin subscription-tier configuration (Concept doc §6). Read-only for
 * agencies (agency.service.getSubscriptionTiers); this service is the write side
 * used by the admin surface.
 */

export class TierConfigError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SELECT = {
  id: true,
  name: true,
  maxStaff: true,
  maxGuides: true,
  maxPackages: true,
  monthlyPrice: true,
  annualPrice: true,
  trialDays: true,
  marketplaceWeight: true,
  adsEnabled: true,
  customDomainEnabled: true,
  whiteLabelComplete: true,
  apiAccessEnabled: true,
  features: true,
} satisfies Prisma.SubscriptionTierSelect;

type Row = Prisma.SubscriptionTierGetPayload<{ select: typeof SELECT }>;

function toApi(r: Row) {
  return {
    id: r.id,
    name: r.name,
    maxStaff: r.maxStaff,
    maxGuides: r.maxGuides,
    maxPackages: r.maxPackages,
    monthlyPrice: Number(r.monthlyPrice),
    annualPrice: r.annualPrice === null ? null : Number(r.annualPrice),
    trialDays: r.trialDays,
    marketplaceWeight: r.marketplaceWeight,
    adsEnabled: r.adsEnabled,
    customDomainEnabled: r.customDomainEnabled,
    whiteLabelComplete: r.whiteLabelComplete,
    apiAccessEnabled: r.apiAccessEnabled,
    features: r.features,
  };
}

export interface TierInput {
  name?: string;
  maxStaff?: number;
  maxGuides?: number;
  maxPackages?: number;
  monthlyPrice?: number;
  annualPrice?: number | null;
  trialDays?: number;
  marketplaceWeight?: number;
  adsEnabled?: boolean;
  customDomainEnabled?: boolean;
  whiteLabelComplete?: boolean;
  apiAccessEnabled?: boolean;
  features?: unknown;
}

const NUM_FIELDS = [
  "maxStaff",
  "maxGuides",
  "maxPackages",
  "monthlyPrice",
  "trialDays",
  "marketplaceWeight",
] as const;
const BOOL_FIELDS = [
  "adsEnabled",
  "customDomainEnabled",
  "whiteLabelComplete",
  "apiAccessEnabled",
] as const;

function buildData(body: TierInput, forCreate: boolean): Prisma.SubscriptionTierUncheckedCreateInput {
  const data = {} as Record<string, unknown>;
  if (body.name !== undefined) data.name = body.name.trim();
  for (const f of NUM_FIELDS) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) throw new TierConfigError(400, `${f} must be a non-negative number.`);
      data[f] = n;
    }
  }
  if (body.annualPrice !== undefined) {
    data.annualPrice = body.annualPrice === null ? null : Number(body.annualPrice);
  }
  for (const f of BOOL_FIELDS) {
    if (body[f] !== undefined) data[f] = Boolean(body[f]);
  }
  if (body.features !== undefined) data.features = body.features as Prisma.InputJsonValue;

  if (forCreate) {
    if (!data.name) throw new TierConfigError(400, "Tier name is required.");
    data.maxStaff ??= 0;
    data.maxGuides ??= 0;
    data.monthlyPrice ??= 0;
    data.features ??= {};
  }
  return data as Prisma.SubscriptionTierUncheckedCreateInput;
}

export async function listTiers() {
  const rows = await db.subscriptionTier.findMany({ select: SELECT, orderBy: { monthlyPrice: "asc" } });
  return rows.map(toApi);
}

export async function createTier(body: TierInput) {
  try {
    const row = await db.subscriptionTier.create({ data: buildData(body, true), select: SELECT });
    return toApi(row);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new TierConfigError(409, "A tier with that name already exists.");
    }
    throw e;
  }
}

export async function updateTier(id: string, body: TierInput) {
  const existing = await db.subscriptionTier.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new TierConfigError(404, "Tier not found.");
  try {
    const row = await db.subscriptionTier.update({
      where: { id },
      data: buildData(body, false),
      select: SELECT,
    });
    return toApi(row);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new TierConfigError(409, "A tier with that name already exists.");
    }
    throw e;
  }
}
