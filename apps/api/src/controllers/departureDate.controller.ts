import type { Request, Response } from "express";
import {
  addDepartureDateService,
  updateDepartureDateService,
  deleteDepartureDateService,
} from "../services/departureDate.service.js";

// Same mapping as the other package controllers: "not found" errors carry a
// status of 404, validation errors have none → fall back to 400.
const errorResponse = (res: Response, err: unknown) => {
  const e = err as Error & { status?: number };
  return res.status(e.status ?? 400).json({ success: false, message: e.message });
};

// ── POST /agencies/packages/:id/dates ────────────────────────────────
export const addDepartureDate = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const result = await addDepartureDateService(agencyId, packageId, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── PATCH /agencies/packages/:id/dates/:dateId ───────────────────────
export const updateDepartureDate = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const dateId = req.params.dateId as string;
    const result = await updateDepartureDateService(agencyId, packageId, dateId, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── DELETE /agencies/packages/:id/dates/:dateId ──────────────────────
export const deleteDepartureDate = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const dateId = req.params.dateId as string;
    const result = await deleteDepartureDateService(agencyId, packageId, dateId);
    return res.status(200).json(result);
  } catch (err) {
    return errorResponse(res, err);
  }
};
