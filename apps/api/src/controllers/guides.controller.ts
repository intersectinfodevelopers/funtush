import { assignableGuidesFor } from "../services/guideAvailability.service.js";
import type { Request, Response } from "express";
import {
  listGuides,
  createGuide,
  getGuide,
  updateGuide,
  deleteGuide,
  GuideServiceError,
} from "../services/guides.service.js";

function agencyIdOf(req: Request): string | null {
  return req.agencyId ?? null;
}

function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}

function handleError(res: Response, err: unknown) {
  if (err instanceof GuideServiceError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.field ? { errors: { [err.field]: err.message } } : {}) });
  }
  const message = err instanceof Error ? err.message : "Something went wrong";
  return res.status(400).json({ success: false, message });
}

export const GuidesController = {
  /** GET /agencies/me/guides/assignable?departureDateId=…&bookingId=… — every guide + whether that trek can use them. */
  async assignable(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const departureDateId = typeof req.query.departureDateId === "string" ? req.query.departureDateId : "";
      if (!departureDateId) return res.status(400).json({ success: false, message: "departureDateId is required." });
      const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId : undefined;
      return res.status(200).json({ success: true, guides: await assignableGuidesFor(agencyId, departureDateId, bookingId) });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async list(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const q = req.query as Record<string, string | undefined>;
      const result = await listGuides(agencyId, {
        status: q.status,
        search: q.search,
        language: q.language,
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const guide = await createGuide(agencyId, req.body ?? {});
      return res.status(201).json({ success: true, data: guide });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getOne(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const guide = await getGuide(agencyId, paramId(req));
      return res.status(200).json({ success: true, data: guide });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const guide = await updateGuide(agencyId, paramId(req), req.body ?? {});
      return res.status(200).json({ success: true, data: guide });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async remove(req: Request, res: Response) {
    try {
      const agencyId = agencyIdOf(req);
      if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
      await deleteGuide(agencyId, paramId(req));
      return res.status(204).send();
    } catch (err) {
      return handleError(res, err);
    }
  },
};
