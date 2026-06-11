import type { Request, Response } from "express";
import {
  addItineraryDayService,
  updateItineraryDayService,
  deleteItineraryDayService,
  reorderItineraryService,
} from "../services/itinerary.service.js";

// Same mapping as package.controller: "not found" errors carry status 404,
// validation errors have none → fall back to 400.
const errorResponse = (res: Response, err: unknown) => {
  const e = err as Error & { status?: number };
  return res.status(e.status ?? 400).json({ success: false, message: e.message });
};

// `:day` route param → a positive integer day_number. Anything else is a 400.
const parseDay = (raw: string): number => {
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1) {
    throw new Error("day must be a positive integer");
  }
  return day;
};

// ── POST /agencies/packages/:id/itinerary ────────────────────────────
export const addItineraryDay = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const result = await addItineraryDayService(agencyId, packageId, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── PUT /agencies/packages/:id/itinerary/:day ────────────────────────
export const updateItineraryDay = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const day = parseDay(req.params.day as string);
    const result = await updateItineraryDayService(agencyId, packageId, day, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── DELETE /agencies/packages/:id/itinerary/:day ─────────────────────
export const deleteItineraryDay = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const day = parseDay(req.params.day as string);
    const result = await deleteItineraryDayService(agencyId, packageId, day);
    return res.status(200).json(result);
  } catch (err) {
    return errorResponse(res, err);
  }
};

// ── PATCH /agencies/packages/:id/itinerary/reorder ───────────────────
export const reorderItinerary = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const packageId = req.params.id as string;
    const result = await reorderItineraryService(agencyId, packageId, req.body?.order);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return errorResponse(res, err);
  }
};
