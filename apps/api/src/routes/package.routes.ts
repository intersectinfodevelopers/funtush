import express from "express";
import { authenticateWithRefreshToken } from "../middlewares/refreshTokenAuthentication.js";
import { createPackage, updatePackage, listPackages, publishPackage,
         duplicatePackage, archivePackage } from "../controllers/package.controller.js";

const router = express.Router();

router.route("/agencies/packages")
  .post(authenticateWithRefreshToken, createPackage)
  .get(authenticateWithRefreshToken, listPackages);

router.route("/agencies/packages/:id")
  .patch(authenticateWithRefreshToken, updatePackage)
  .delete(authenticateWithRefreshToken, archivePackage);

router.route("/agencies/packages/:id/publish")
  .post(authenticateWithRefreshToken, publishPackage);

router.route("/agencies/packages/:id/duplicate")
  .post(authenticateWithRefreshToken, duplicatePackage);

export default router;
