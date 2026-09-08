import { Router } from "express";
import { agencyGetCustomerProfile, createCustomerNote, getAgencyCustomers, getCustomerAnalytics, getCustomerNote } from "src/controllers/agencyCustomer.controller.js";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

/**
 * @openapi
 * /agencies/me/customers:
 *   get: { tags: [Customers], summary: List the agency's trekker customers, security: [{ refreshToken: [] }], responses: { 200: { description: Customers }, 401: { description: Unauthorized } } }
 * /agencies/me/customers/analytics:
 *   get: { tags: [Customers], summary: Customer analytics (repeat rate, countries, cohorts), security: [{ refreshToken: [] }], responses: { 200: { description: Analytics } } }
 * /customers/{id}/profile:
 *   get: { tags: [Customers], summary: One customer's profile + booking history, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Profile } } }
 * /customers/{id}/notes:
 *   get: { tags: [Customers], summary: List notes on a customer, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Notes } } }
 *   post: { tags: [Customers], summary: Add a note to a customer, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Created } } }
 */
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