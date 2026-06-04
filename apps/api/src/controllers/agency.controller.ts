import type { Request, Response } from "express";

import { createAgency } from "../services/agency.service";

export const registerAcency = async (req: Request, res: Response) => {
    try {
        const result = await createAgency(req.body);
        res.status(201).json({
            status: "success",
            data: result
        });
    } catch (err) {
        const error = err as { status?: number; message?: string };
        res.status(error.status || 500).json({
            status: "error",
            message: error.message
        });
    }
};