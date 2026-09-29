import { db } from "@funtush/database";

async function trekkerIdOf(userId: string): Promise<string> {
  const t = await db.trekker.findUnique({ where: { userId }, select: { id: true } });
  if (!t) throw Object.assign(new Error("Trekker profile not found"), { status: 404 });
  return t.id;
}

/** `AgencyDestination.saves` is always the number of rows in the save table, recomputed on every change. */
async function syncSaves(destinationId: string) {
  const saves = await db.trekkerSavedDestination.count({ where: { destinationId } });
  await db.agencyDestination.update({ where: { id: destinationId }, data: { saves } });
  return saves;
}

async function publishedDestination(destinationId: string) {
  const d = await db.agencyDestination.findFirst({ where: { id: destinationId, published: true }, select: { id: true } });
  if (!d) throw Object.assign(new Error("Destination not found"), { status: 404 });
}

export async function saveDestination(userId: string, destinationId: string) {
  const trekkerId = await trekkerIdOf(userId);
  await publishedDestination(destinationId);
  await db.trekkerSavedDestination.upsert({ where: { trekkerId_destinationId: { trekkerId, destinationId } }, create: { trekkerId, destinationId }, update: {} });
  return { saved: true, saves: await syncSaves(destinationId) };
}

export async function unsaveDestination(userId: string, destinationId: string) {
  const trekkerId = await trekkerIdOf(userId);
  await db.trekkerSavedDestination.deleteMany({ where: { trekkerId, destinationId } });
  const exists = await db.agencyDestination.findUnique({ where: { id: destinationId }, select: { id: true } });
  return { saved: false, saves: exists ? await syncSaves(destinationId) : 0 };
}

export async function listSavedDestinations(userId: string) {
  const trekkerId = await trekkerIdOf(userId);
  const rows = await db.trekkerSavedDestination.findMany({
    where: { trekkerId, destination: { published: true } },
    orderBy: { createdAt: "desc" },
    select: { destination: { select: { id: true, slug: true, title: true, category: true, region: true, shortDescription: true, featuredImage: true, agency: { select: { id: true, name: true } } } } },
  });
  return rows.map((r) => r.destination);
}
