import express from "express";
import { registerAcency } from "../controllers/agency.controller";

const router = express.Router();

router.route("/register")
    .get(registerAcency)

export default router;