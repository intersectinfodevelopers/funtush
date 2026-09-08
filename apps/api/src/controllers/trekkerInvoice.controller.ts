import type { Request, Response } from "express";
import * as svc from "../services/trekkerInvoice.service.js";

function need(req: Request, res: Response): string | null {
  const a = req.agencyId ?? null;
  if (!a) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return a;
}
function pid(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof svc.TrekkerInvoiceError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

export const listInvoices = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  const q = req.query as Record<string, string | undefined>;
  try {
    const result = await svc.listInvoices(a, {
      status: q.status,
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    fail(res, e);
  }
};

export const createInvoice = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.status(201).json({ success: true, data: await svc.createInvoice(a, req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
};

export const getInvoice = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.getInvoice(a, pid(req)) });
  } catch (e) {
    fail(res, e);
  }
};

export const updateInvoice = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.updateInvoice(a, pid(req), req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
};

export const deleteInvoice = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    await svc.deleteInvoice(a, pid(req));
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
};

export const markInvoiceSent = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.setInvoiceStatus(a, pid(req), "SENT") });
  } catch (e) {
    fail(res, e);
  }
};

export const markInvoicePaid = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.setInvoiceStatus(a, pid(req), "PAID") });
  } catch (e) {
    fail(res, e);
  }
};

export const voidInvoice = async (req: Request, res: Response) => {
  const a = need(req, res);
  if (!a) return;
  try {
    res.json({ success: true, data: await svc.setInvoiceStatus(a, pid(req), "VOID") });
  } catch (e) {
    fail(res, e);
  }
};
