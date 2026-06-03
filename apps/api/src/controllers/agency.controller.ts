import { Request, Response } from "express";
import { createAgency } from "../services/agency.service";

export const registerAcency = async (req: Request, res: Response) => {
    try {
        const result = await createAgency(req.body);
        res.status(201).json({
            status: "success",
            data: result
        });
    } catch (err: any) {
        res.status(err.status || 500).json({
            status: "error",
            message: err.message
        });
    }
};