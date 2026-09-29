import type { NextFunction, Request, Response } from "express";
import { db } from "@funtush/database";
import { recordPackageActivity, type PackageAction } from "../services/packageActivity.service";

const CHILD_LABEL: Record<string, string> = { itinerary: "itinerary", dates: "departure dates", addons: "add-ons" };
const FIELD_LABEL: Record<string, string> = {
  title: "title", description: "description", durationDays: "duration", pricePerPerson: "price", difficulty: "difficulty", maxGroupSize: "group size", photos: "photos",
  destination: "destination", category: "category", minDurationDays: "duration range", maxDurationDays: "duration range", altitudeMinM: "altitude", altitudeMaxM: "altitude",
  region: "region", bestTimeToVisit: "best time", activities: "activities", routes: "routes", shortSummary: "summary", currency: "currency", isFeatured: "featured", volumeDiscounts: "group discounts",
};

/**
 * Records who created / edited / published / deleted a package, from the outside: it watches the response of every
 * mutating /agencies/packages call, so no controller has to remember to log. Mount BEFORE the package routes.
 */
export function packageActivityLogger(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const path = req.originalUrl.split("?")[0].replace(/\/+$/, "");
  const m = path.match(/^\/agencies\/packages(?:\/([^/]+)(?:\/([^/]+))?)?/);
  if (!m) return next();
  const [, id, sub] = m;

  let body: { data?: { id?: string; title?: string } } | undefined;
  const json = res.json.bind(res);
  res.json = ((b: unknown) => { body = b as typeof body; return json(b); }) as typeof res.json;

  // The title of an existing package is read up front — after a permanent delete it no longer exists.
  const titleBefore = id && id !== "new" ? db.trekPackage.findUnique({ where: { id }, select: { title: true } }).then((p) => p?.title).catch(() => undefined) : Promise.resolve(undefined);

  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    void (async () => {
      const before = await titleBefore;
      if (!id && req.method === "POST") {
        if (body?.data?.id) await recordPackageActivity(req, { packageId: body.data.id, title: body.data.title ?? "Untitled", action: "CREATED", summary: "Created the package" });
        return;
      }
      if (!id) return;
      const title = before ?? body?.data?.title ?? "Package";
      let action: PackageAction | null = null;
      let parts: string[] | undefined;
      let summary: string | undefined;
      let packageId = id;
      if (!sub && req.method === "PATCH") {
        action = "UPDATED";
        parts = [...new Set(Object.keys(req.body ?? {}).map((k) => FIELD_LABEL[k]).filter(Boolean))];
        if (parts.length === 0) return;
      } else if (!sub && req.method === "DELETE") {
        action = req.query.permanent === "true" ? "DELETED" : "ARCHIVED";
        summary = action === "DELETED" ? "Permanently deleted the package" : "Deleted the package (moved to Archived)";
      } else if (sub === "publish") { action = "PUBLISHED"; summary = "Published the package"; }
      else if (sub === "unpublish") { action = "UNPUBLISHED"; summary = "Unpublished the package (back to draft)"; }
      else if (sub === "restore") { action = "RESTORED"; summary = "Restored the package from Archived (now a draft)"; }
      else if (sub === "duplicate") { action = "DUPLICATED"; summary = `Duplicated “${before ?? "a package"}”`; if (body?.data?.id) { packageId = body.data.id; } }
      else if (sub && CHILD_LABEL[sub]) { action = "UPDATED"; parts = [CHILD_LABEL[sub]]; }
      if (!action) return;
      await recordPackageActivity(req, { packageId, title: action === "DUPLICATED" ? body?.data?.title ?? title : title, action, summary, parts });
    })();
  });
  next();
}
