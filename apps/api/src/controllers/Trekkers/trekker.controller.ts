import type { Request, Response } from "express";
import { createTrekker, trekkerPreferenceService } from "src/services/trekker.service.js";

export const registerTrekker= async(req:Request , res: Response) => {
    try {
        const trekker = await createTrekker(req.body);
        res.status(201).json({
            status: "success",
            data: trekker
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
}


export const trekkerPreference= async(req:Request , res: Response) => {
    try {

        /** 'trekkerId' passed in request body in service */
        const trekkerId = req.body;
        const preference = await trekkerPreferenceService(req.body, trekkerId);
        res.status(201).json({
            status: "success",
            data: preference
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
}


export const customerNote= async(req:Request , res: Response) => {
    try {
        
        const trekkerId = req.body;
        const preference = await trekkerPreferenceService(req.body, trekkerId);
        res.status(201).json({
            status: "success",
            data: preference
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
}
