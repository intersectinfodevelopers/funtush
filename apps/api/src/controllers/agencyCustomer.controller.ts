import type { Request, Response } from "express";
import { agencyCustomerListService, customerNoteService, getCustomerNoteService } from "src/services/agencyCustomer.service.js";

export const getAgencyCustomers = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.agencyId;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await agencyCustomerListService(
      agencyId,
      req.query
    );

    return res.status(200).json({
      success: true,
      result,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error,
    });
  }
};


export const createCustomerNote = async (
  req: Request,
  res: Response
) => {

  try {
    const agencyId = req.user.agencyId as string; // agency which staff belongs to
    const staffId = req.user?.id;                 //staff
    const customerId = req.params.id as string;

    if (!staffId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
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
    return res.status(500).json({
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
    const agencyId = req.agencyId;
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
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
};