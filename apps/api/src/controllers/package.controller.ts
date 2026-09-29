import type { Request, Response } from "express";
import {
  createPackageService,
  updatePackageService,
  listPackagesService,
  getPackageDetailService,
  publishPackageService,
  duplicatePackageService,
  archivePackageService,
  deleteArchivedPackageService,
  unpublishPackageService,
  restorePackageService,
} from "../services/package.service.js";
import { parsePagination, buildMeta } from "../utils/pagination.js";

// helper: maps a thrown Error (with optional .status) to the right HTTP code.
// "not found" errors carry status 404; validation errors have none → fall back to 400.
const errorResponse = (res: Response, err: unknown) => {
  const e = err as Error & { status?: number; field?: string };
  return res.status(e.status ?? 400).json({ success: false, message: e.message, ...(e.field ? { errors: { [e.field]: e.message } } : {}) });
};

// ── Endpoint 1: POST /agencies/packages ──────────────────────────────
export const createPackage = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await createPackageService(agencyId, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── Endpoint 2: PATCH /agencies/packages/:id ─────────────────────────
export const updatePackage = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    const packageId = req.params.id as string;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await updatePackageService(agencyId, packageId, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── Endpoint 3: GET /agencies/packages?status=&destination= ──────────
export const getPackage = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const pkg = await getPackageDetailService(agencyId, id);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    return res.status(200).json({ success: true, data: pkg });
  } catch (err) {
    return errorResponse(res, err);
  }
};

export const listPackages = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // An unknown status used to reach Prisma as an invalid enum (a 500).
    const rawStatus = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    if (rawStatus && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(rawStatus)) {
      return res.status(400).json({ success: false, message: "status must be DRAFT, PUBLISHED or ARCHIVED" });
    }
    const filters = {
      status: rawStatus,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      sort: (["newest", "oldest", "price_asc", "price_desc", "duration", "duration_desc", "title_asc", "title_desc"] as const).find((s) => s === req.query.sort),
      destination: req.query.destination as string | undefined,
    };

    const pageReq = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const { data, total, counts, totalBeforeMonth } = await listPackagesService(agencyId, filters, pageReq);
    return res.status(200).json({ success: true, data, meta: buildMeta(total, pageReq.page, pageReq.limit), counts, totalBeforeMonth });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── Endpoint 4: POST /agencies/packages/:id/publish ──────────────────
export const publishPackage = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    const packageId = req.params.id as string;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await publishPackageService(agencyId, packageId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── Endpoint 5: POST /agencies/packages/:id/duplicate ────────────────
export const duplicatePackage = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    const packageId = req.params.id as string;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await duplicatePackageService(agencyId, packageId);
    return res.status(201).json({ success: true, data: result }); // 201 — new resource
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── Endpoint 6: DELETE /agencies/packages/:id ────────────────────────
export const archivePackage = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    const packageId = req.params.id as string;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // ?permanent=true removes an already-archived package for good; otherwise DELETE archives.
    const result = req.query.permanent === "true"
      ? await deleteArchivedPackageService(agencyId, packageId)
      : await archivePackageService(agencyId, packageId);
    return res.status(200).json(result);
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── POST /agencies/packages/:id/unpublish ────────────────────────────
export const unpublishPackage = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
    return res.status(200).json(await unpublishPackageService(agencyId, req.params.id as string));
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── POST /agencies/packages/:id/restore ──────────────────────────────
export const restorePackage = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
    return res.status(200).json(await restorePackageService(agencyId, req.params.id as string));
  } catch (err) {
    return errorResponse(res, err);
  }
};
