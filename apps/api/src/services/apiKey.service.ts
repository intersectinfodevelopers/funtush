import crypto from "crypto";
import { prisma } from "../packages/database/prisma";
import { hashToken } from '@funtush/auth';

const LARGE_TIER = "LARGE" as const;

export class ApiKeyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiKeyError";
  }
}

function generateRawKey(): { rawKey: string; prefix: string } {
  const secret = crypto.randomBytes(32).toString("hex");
  const rawKey = `funtush_live_${secret}`;
  const prefix = rawKey.slice(0, 20);
  return { rawKey, prefix };
}

const MAX_ACTIVE_KEYS = 20;

export async function createApiKey(agencyId: string, name: unknown, scope: unknown) {
  if (typeof name !== "string" || !name.trim()) throw new ApiKeyError(400, "name is required");
  if (name.trim().length > 60) throw new ApiKeyError(400, "name must be at most 60 characters");
  if (scope !== "READ_ONLY" && scope !== "READ_WRITE") throw new ApiKeyError(400, "scope must be READ_ONLY or READ_WRITE");

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: { tier: true },
  });
  if (!agency) throw new ApiKeyError(404, "Agency not found");
  if (agency.tier.name !== LARGE_TIER) {
    throw new ApiKeyError(403, "API key management is only available on the Large tier");
  }

  const active = await prisma.apiKey.count({ where: { agencyId, revoked: false } });
  if (active >= MAX_ACTIVE_KEYS) throw new ApiKeyError(400, `You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke one first.`);

  const { rawKey, prefix } = generateRawKey();
  const keyHash = hashToken(rawKey);

  const created = await prisma.apiKey.create({
    data: {
      agencyId,
      name: name.trim(),
      keyHash,
      keyPrefix: prefix,
      scope,
    },
  });

  return {
    id: created.id,
    name: created.name,
    scope: created.scope,
    keyPrefix: created.keyPrefix,
    createdAt: created.createdAt,
    key: rawKey,
  };
}

export async function listApiKeys(agencyId: string) {
  return prisma.apiKey.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      lastUsedAt: true,
      revoked: true,
      createdAt: true,
    },
  });
}

export async function revokeApiKey(id: string, agencyId: string) {
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) throw new ApiKeyError(404, "API key not found");
  if (key.agencyId !== agencyId) throw new ApiKeyError(403, "Not authorized to revoke this key");
  if (key.revoked) throw new ApiKeyError(409, "API key is already revoked");

  return prisma.apiKey.update({
    where: { id },
    data: { revoked: true },
  });
}

export async function authenticateApiKey(rawKey: string) {
  const keyHash = hashToken(rawKey);

  const key = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { agency: true },
  });

  if (!key || key.revoked) return null;

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return { agencyId: key.agencyId, scope: key.scope, keyId: key.id };
}