import { Router } from "express";
import { agencyGetCustomerProfile, createCustomerNote, getAgencyCustomers, getCustomerAnalytics, getCustomerNote } from "src/controllers/agencyCustomer.controller.js";
import { authenticateWithRefreshToken } from "src/middlewares/refreshTokenAuthentication";

const router = Router();

router.route('/agencies/me/customers')
    .get(authenticateWithRefreshToken, getAgencyCustomers);

router.route('/customers/:id/notes')
    .get(authenticateWithRefreshToken, getCustomerNote)
    .post(authenticateWithRefreshToken, createCustomerNote);

router.route('/customers/:id/profile')
    .get(authenticateWithRefreshToken, agencyGetCustomerProfile);

router.route('/agencies/me/customers/analytics')
    .get(authenticateWithRefreshToken, getCustomerAnalytics);

export default router;