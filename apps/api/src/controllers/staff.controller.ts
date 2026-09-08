import { Request, Response } from "express";
import type { jwtPayload } from "@funtush/auth";
import {
  addStaffService,
  listStaffService,
  reassignRoleService,
  updateStaffProfileService,
  deactivateStaffService,
   getStaffActivityService,
} from "../services/staff.service";

function staffErrStatus(err: unknown): number {
  const withStatus = err as { status?: number };
  return typeof withStatus.status === "number" ? withStatus.status : 400;
}

type AuthRequest = Request & { user?: jwtPayload };

export const addStaff = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const { email, roleId, name, phone } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const { staff, tempPassword } = await addStaffService(agencyId, email, roleId, { name, phone });
    return res.status(201).json({ staff, tempPassword });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add staff";
    return res.status(staffErrStatus(err)).json({ error: message });
  }
};

export const listStaff = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const staff = await listStaffService(agencyId);
  return res.status(200).json({ staff });
};

export const reassignRole = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const id = req.params["id"] as string;
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: "roleId is required" });

  const staff = await reassignRoleService(agencyId, id, roleId);
  return res.status(200).json({ staff });
};

export const updateStaff = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const id = req.params["id"] as string;
  const { name, phone, email, roleId } = req.body ?? {};

  if (
    name === undefined && phone === undefined &&
    email === undefined && roleId === undefined
  ) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (email !== undefined && (typeof email !== "string" || !email.includes("@"))) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  try {
    const staff = await updateStaffProfileService(agencyId, id, { name, phone, email, roleId });
    return res.status(200).json({ staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update staff";
    return res.status(staffErrStatus(err)).json({ error: message });
  }
};

export const deactivateStaff = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const id = req.params["id"] as string;
  const staff = await deactivateStaffService(agencyId, id);
  return res.status(200).json({ staff });
};


export const getStaffActivity = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const id = req.params["id"] as string;
  const activity = await getStaffActivityService(agencyId, id);
  return res.status(200).json({ activity });
};