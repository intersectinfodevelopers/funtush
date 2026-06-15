import { Router } from "express";
import { agencyGetCustomerProfile, createCustomerNote, getAgencyCustomers, getCustomerAnalytics, getCustomerNote } from "src/controllers/agencyCustomer.controller.js";

const router = Router();

router.route('/agencies/me/customers')
    .get(getAgencyCustomers);

router.route('/customers/:id/notes')
    .get(getCustomerNote)
    .post(createCustomerNote);

router.route('/customers/:id/profile')
    .get(agencyGetCustomerProfile);

router.route('/agencies/me/customers/analytics ')
    .get(getCustomerAnalytics);

export default router;