import { Router } from "express";
import { createCustomerNote, getAgencyCustomers, getCustomerNote } from "src/controllers/agencyCustomer.controller.js";

const router = Router();

router.route('/agencies/me/customers')
    .get(getAgencyCustomers);

router.route('/customers/:id/notes')
    .get(getCustomerNote)
    .post(createCustomerNote);

export default router;