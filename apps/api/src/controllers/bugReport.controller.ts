import type { Request, Response } from "express";
import { parsePagination } from "../utils/pagination";
import { hasPlatformPermission } from "../services/platformPermissions.service";
import {
  submitBug,
  getAgencyBugs,
  setBugPriority,
  assignBug,
  addBugHint,
  resolveBug,
  listPlatformStaff,
} from "../services/bugReport.service";

export const submitBugController = async (req: Request, res: Response) => {
  try {
    const agencyId = req.user!.agencyId!;
    const { title, description, stepsToReproduce, screenshotUrl } = req.body;

    const result = await submitBug(agencyId, {
      title,
      description,
      stepsToReproduce,
      screenshotUrl,
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit bug report";
    const status = /required|must be|limit/.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

export const getAgencyBugsController = async (req: Request, res: Response) => {
  try {
    // Platform admins (reaching this via /admin/bugs) have no agencyId of
    // their own — null means "every agency" (see getAgencyBugs' doc comment).
    const agencyId = req.user!.agencyId ?? null;

    // This route also serves AGENCY_ADMIN's own-agency list, so it can't
    // carry a blanket requirePlatformPermission gate (that would 403 the
    // TENANT-roleType caller). PLATFORM_SUPPORT specifically needs the
    // "bugs" permission to see the cross-agency triage list; SUPER_ADMIN /
    // PLATFORM_ADMIN / AGENCY_ADMIN are unaffected.
    if (req.user!.roleType === "PLATFORM" && req.user!.role === "PLATFORM_SUPPORT") {
      const allowed = await hasPlatformPermission(req.user!.userId, "bugs");
      if (!allowed) {
        return res.status(403).json({ success: false, message: "You don't have permission to view bug reports." });
      }
    }

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const result = await getAgencyBugs(agencyId, status, page, limit);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch bug reports";
    return res.status(500).json({ success: false, message });
  }
};

export const setBugPriorityController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { priority } = req.body;
    const result = await setBugPriority(id, priority);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set priority";
    const status = message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const listPlatformStaffController = async (_req: Request, res: Response) => {
  try {
    const result = await listPlatformStaff();
    return res.status(200).json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to list platform staff" });
  }
};

export const assignBugController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { assignedToId } = req.body;
    const result = await assignBug(id, assignedToId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to assign bug";
    const status = message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const addBugHintController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { note } = req.body;
    const createdById = req.user!.userId;
    const result = await addBugHint(id, createdById, note);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add hint";
    const status = message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
};

export const resolveBugController = async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const { resolutionNote } = req.body;
    const result = await resolveBug(id, resolutionNote);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve bug";
    const status = message.includes("not found") ? 404
      : message.includes("already resolved") ? 409 : 400;
    return res.status(status).json({ success: false, message });
  }
};