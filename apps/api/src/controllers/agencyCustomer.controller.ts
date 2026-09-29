import type { Request, Response } from "express";
import type { BookingStatus } from "@funtush/database";
import { parsePagination } from "../utils/pagination";
import { cacheGet, cacheSet } from "../services/redis.service.js";

const CUSTOMER_LIST_TTL_SECONDS = 10;
import { updateCustomerRecord, hideCustomer } from "../services/agencyCustomerRecords.service";
import { agencyCustomerListService, agencyGetCustomersProfileService, customerAnalyticsService, customerNoteService, getCustomerNoteService } from "src/services/agencyCustomer.service.js";

export const getAgencyCustomers = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId as string;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // req.query values are strings; passing them straight through made the
    // service compute `slice(start, start + "5")` — string concatenation —
    // so any page after the first returned the wrong rows.
    const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const q = req.query;
    const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const params = {
      page,
      limit,
      search: one(q.search),
      customerType: one(q.customerType) as "repeat" | "new" | undefined,
      destination: one(q.destination),
      bookingStatus: one(q.bookingStatus) as BookingStatus | undefined,
      sortBy: one(q.sortBy) as "lastBookingDate" | "totalBookings" | "totalSpending" | undefined,
      sortOrder: one(q.sortOrder) as "asc" | "desc" | undefined,
    };

    // This aggregates every one of the agency's bookings (a load test with
    // 40k bookings/20k customers cost ~140ms of Postgres time per call), and a
    // dashboard re-requests it constantly. A 10s per-agency cache keeps that
    // off the database; the agency-scoped key means it can never cross tenants.
    const ver = (await cacheGet<number>(`agency-customers-ver:${agencyId}`)) ?? 0; // bumped by edit / delete
    const cacheKey = `agency-customers:${agencyId}:${ver}:${JSON.stringify(params)}`;
    let result = await cacheGet<Awaited<ReturnType<typeof agencyCustomerListService>>>(cacheKey);
    if (result) {
      res.set("X-Cache", "HIT");
    } else {
      result = await agencyCustomerListService(agencyId, params);
      await cacheSet(cacheKey, result, CUSTOMER_LIST_TTL_SECONDS);
      res.set("X-Cache", "MISS");
    }

    return res.status(200).json({
      success: true,
      result,
    });

  } catch (error) {
    return res.status((error as { status?: number })?.status ?? 500).json({
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong",
    });
  }
};


export const createCustomerNote = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId as string; // agency which staff belongs to
    const staffId = req.tenantId as string;         //staff
    const customerId = req.params.id as string;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!staffId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized staff",
      });
    }

    const result = await customerNoteService(
      req.body,
      customerId,         // customer the note is about
      staffId,            // who wrote the note
      agencyId,           // agency that owns the staff and their note
    );

    return res.status(200).json({
      success: true,
      result,
    });

  } catch (error) {
    return res.status((error as { status?: number })?.status ?? 500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
};



export const getCustomerNote = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId as string;
    const customerId = req.params.id as string;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await getCustomerNoteService(
      customerId,
      agencyId,
    );

    return res.status(200).json({
      success: true,
      result,
    });

  } catch (error) {
    return res.status((error as { status?: number })?.status ?? 500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
};


export const agencyGetCustomerProfile = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId as string;
    const customerId = req.params.id as string;

    const customer = await agencyGetCustomersProfileService(customerId, agencyId);

    return res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    return res.status((error as { status?: number })?.status ?? 500).json({
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong",
    });
  }
};


export const getCustomerAnalytics = async (
  req: Request,
  res: Response
) => {
  try {

    const agencyId = req.agencyId as string;

    const analytics = await customerAnalyticsService(agencyId);

    return res.status(200).json({
      success: true,
      data: analytics,
    });

  } catch (error) {
    return res.status((error as { status?: number })?.status ?? 500).json({
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong",
    });
  }
};
const bumpCustomerCache = (agencyId: string) => cacheSet(`agency-customers-ver:${agencyId}`, Date.now(), 86_400);
const fail = (res: Response, error: unknown) => {
  const e = error as { status?: number; field?: string; message?: string };
  return res.status(e.status ?? 500).json({ success: false, message: e.message ?? "Something went wrong", ...(e.field ? { errors: { [e.field]: e.message } } : {}) });
};

// PATCH /agencies/me/customers/:id — edit how this agency sees a customer (name / phone / country)
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await updateCustomerRecord(agencyId, decodeURIComponent(req.params.id as string), req.body ?? {});
    await bumpCustomerCache(agencyId);
    return res.status(200).json(result);
  } catch (error) {
    return fail(res, error);
  }
};

// DELETE /agencies/me/customers/:id — remove the customer from this agency's list (bookings + account untouched)
export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await hideCustomer(agencyId, decodeURIComponent(req.params.id as string));
    await bumpCustomerCache(agencyId);
    return res.status(200).json(result);
  } catch (error) {
    return fail(res, error);
  }
};
