import express from "express";
import { registerAgency } from "../controllers/agency.controller";

const router = express.Router();

router.route("/register")
  .post(registerAgency);

export default router;