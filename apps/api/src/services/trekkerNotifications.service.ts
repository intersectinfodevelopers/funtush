import { db } from "@funtush/database";

const PAGE = 20;

async function trekkerIdOf(userId: string): Promise<string> {
  const t = await db.trekker.findUnique({ where: { userId }, select: { id: true } });
  if (!t) throw Object.assign(new Error("Trekker profile not found"), { status: 404 });
  return t.id;
}

/** The signed-in trekker's own inbox (newest first) plus the unread count. */
export async function listMyNotifications(userId: string, page = 1) {
  const trekkerId = await trekkerIdOf(userId);
  const p = Math.max(1, Math.floor(page) || 1);
  const [rows, total, unread] = await Promise.all([
    db.trekkerNotification.findMany({ where: { trekkerId }, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE, select: { id: true, title: true, body: true, data: true, readAt: true, createdAt: true } }),
    db.trekkerNotification.count({ where: { trekkerId } }),
    db.trekkerNotification.count({ where: { trekkerId, readAt: null } }),
  ]);
  return { items: rows, unread, meta: { total, page: p, limit: PAGE, pages: Math.max(1, Math.ceil(total / PAGE)) } };
}

export async function unreadCount(userId: string) {
  const trekkerId = await trekkerIdOf(userId);
  return db.trekkerNotification.count({ where: { trekkerId, readAt: null } });
}

/** Marks some (`ids`) or all notifications read. Only ever this trekker's own rows. */
export async function markRead(userId: string, ids?: unknown) {
  const trekkerId = await trekkerIdOf(userId);
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || ids.some((i) => typeof i !== "string"))) {
    throw Object.assign(new Error("ids must be a list of at most 200 notification ids"), { status: 400 });
  }
  const r = await db.trekkerNotification.updateMany({
    where: { trekkerId, readAt: null, ...(Array.isArray(ids) ? { id: { in: ids as string[] } } : {}) },
    data: { readAt: new Date() },
  });
  return { updated: r.count };
}
