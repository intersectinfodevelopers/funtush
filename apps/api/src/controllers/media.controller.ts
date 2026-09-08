import type { Request, Response } from "express";
import * as svc from "../services/media.service.js";

function guard(req: Request, res: Response): string | null {
  const id = req.agencyId ?? null;
  if (!id) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return id;
}
function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.MediaServiceError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}
function listQuery(req: Request) {
  const q = req.query as Record<string, string | undefined>;
  return {
    status: q.status,
    search: q.search,
    page: q.page ? parseInt(q.page, 10) : undefined,
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
  };
}

/** Builds a REST controller from a service's {list,create,get,update,remove} fns. */
function crud(fns: {
  list: (a: string, q: ReturnType<typeof listQuery>) => Promise<unknown>;
  create: (a: string, b: unknown) => Promise<unknown>;
  get: (a: string, id: string) => Promise<unknown>;
  update: (a: string, id: string, b: unknown) => Promise<unknown>;
  remove: (a: string, id: string) => Promise<void>;
}) {
  return {
    async list(req: Request, res: Response) {
      const a = guard(req, res);
      if (!a) return;
      try {
        res.json({ success: true, ...(await fns.list(a, listQuery(req)) as object) });
      } catch (e) {
        fail(res, e);
      }
    },
    async create(req: Request, res: Response) {
      const a = guard(req, res);
      if (!a) return;
      try {
        res.status(201).json({ success: true, data: await fns.create(a, req.body ?? {}) });
      } catch (e) {
        fail(res, e);
      }
    },
    async get(req: Request, res: Response) {
      const a = guard(req, res);
      if (!a) return;
      try {
        res.json({ success: true, data: await fns.get(a, paramId(req)) });
      } catch (e) {
        fail(res, e);
      }
    },
    async update(req: Request, res: Response) {
      const a = guard(req, res);
      if (!a) return;
      try {
        res.json({ success: true, data: await fns.update(a, paramId(req), req.body ?? {}) });
      } catch (e) {
        fail(res, e);
      }
    },
    async remove(req: Request, res: Response) {
      const a = guard(req, res);
      if (!a) return;
      try {
        await fns.remove(a, paramId(req));
        res.status(204).send();
      } catch (e) {
        fail(res, e);
      }
    },
  };
}

export const GalleryController = crud({
  list: svc.listGallery,
  create: svc.createGallery as never,
  get: svc.getGallery,
  update: svc.updateGallery as never,
  remove: svc.deleteGallery,
});

export const VideosController = crud({
  list: svc.listVideos,
  create: svc.createVideo as never,
  get: svc.getVideo,
  update: svc.updateVideo as never,
  remove: svc.deleteVideo,
});
