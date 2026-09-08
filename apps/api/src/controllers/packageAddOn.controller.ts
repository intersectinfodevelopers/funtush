import type { Request, Response } from "express";
import * as svc from "../services/packageAddOn.service.js";

function need(req: Request, res: Response): string | null {
  const a = req.agencyId ?? null;
  if (!a) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return a;
}
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.PackageAddOnError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

export const listPackageAddOns = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.listAddOns(a, p(req, "id")) });
  } catch (e) {
    fail(res, e);
  }
};

export const createPackageAddOn = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.status(201).json({ success: true, data: await svc.createAddOn(a, p(req, "id"), req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
};

export const updatePackageAddOn = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({
      success: true,
      data: await svc.updateAddOn(a, p(req, "id"), p(req, "addOnId"), req.body ?? {}),
    });
  } catch (e) {
    fail(res, e);
  }
};

export const deletePackageAddOn = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    await svc.deleteAddOn(a, p(req, "id"), p(req, "addOnId"));
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
};
