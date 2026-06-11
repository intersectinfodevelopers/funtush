import type { Request, Response } from "express";
import {
  createPackageService,
  updatePackageService,
  listPackagesService,
  publishPackageService,
  duplicatePackageService,
  archivePackageService,
} from "../services/package.service.js";

// helper: maps a thrown Error (with optional .status) to the right HTTP code.
// "not found" errors carry status 404; validation errors have none → fall back to 400.
const errorResponse = (res: Response, err: unknown) => {
  const e = err as Error & { status?: number };
  return res.status(e.status ?? 400).json({ success: false, message: e.message });
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
export const listPackages = async (
  req: Request,
  res: Response
) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const filters = {
      status: req.query.status as string | undefined,
      destination: req.query.destination as string | undefined,
    };

    const result = await listPackagesService(agencyId, filters);
    return res.status(200).json({ success: true, data: result });
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

    const result = await archivePackageService(agencyId, packageId);
    return res.status(200).json(result);
  } catch (err) {
    return errorResponse(res, err);
  }
};
