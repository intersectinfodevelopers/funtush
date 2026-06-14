import { Request, Response } from "express";
import type { jwtPayload } from "@funtush/auth";
import {
  addStaffService,
  listStaffService,
  reassignRoleService,
  deactivateStaffService,
   getStaffActivityService,
} from "../services/staff.service";

type AuthRequest = Request & { user?: jwtPayload };

export const addStaff = async (req: AuthRequest, res: Response) => {
  const agencyId = req.user?.agencyId;
  if (!agencyId) return res.status(403).json({ error: "No agency context" });

  const { email, roleId } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const { staff, tempPassword } = await addStaffService(agencyId, email, roleId);
  return res.status(201).json({ staff, tempPassword });
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