import { Router } from "express";
import {
    recordIncome,
    recordExpense,
    getTransactions,
} from "src/controllers/finance.controller";
import {
    createPayroll,
    markPayrollPaid,
    getPayrollHistory,
} from "src/controllers/payroll.controller";
import {
    getProfitAndLoss,
    getBalanceSheet,
    getCashFlow,
    getTaxSummary,
} from "src/controllers/financialStatements.controller";
import {
    listInvoices,
    createInvoice,
    getInvoice,
    updateInvoice,
    deleteInvoice,
    markInvoiceSent,
    markInvoicePaid,
    voidInvoice,
} from "src/controllers/trekkerInvoice.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

// ── Day 2: recording money in and out ────────────────────────────────────────

/**
 * @openapi
 * /agencies/me/finance/income:
 *   post:
 *     tags: [Finance]
 *     summary: Record an income journal entry
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Recorded }, 400: { description: Validation failed } }
 * /agencies/me/finance/expenses:
 *   post:
 *     tags: [Finance]
 *     summary: Record an expense journal entry
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Recorded }, 400: { description: Validation failed } }
 * /agencies/me/finance/transactions:
 *   get:
 *     tags: [Finance]
 *     summary: List ledger transactions, filterable by account code and date range
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: accountCode, in: query, schema: { type: string } }
 *       - { name: from, in: query, schema: { type: string, format: date } }
 *       - { name: to, in: query, schema: { type: string, format: date } }
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *     responses: { 200: { description: Transactions } }
 */
router.route("/agencies/me/finance/income")
    .post(authenticateWithRefreshToken, recordIncome);

router.route("/agencies/me/finance/expenses")
    .post(authenticateWithRefreshToken, recordExpense);

router.route("/agencies/me/finance/transactions")
    .get(authenticateWithRefreshToken, getTransactions);

// ── Day 3: payroll ───────────────────────────────────────────────────────────

/**
 * @openapi
 * /agencies/me/finance/payroll:
 *   post:
 *     tags: [Finance]
 *     summary: Create a payroll record for a guide or staff member
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 *   get:
 *     tags: [Finance]
 *     summary: List payroll history, filterable by guide/staff/status/date range
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: guideId, in: query, schema: { type: string } }
 *       - { name: staffId, in: query, schema: { type: string } }
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: from, in: query, schema: { type: string, format: date } }
 *       - { name: to, in: query, schema: { type: string, format: date } }
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *     responses: { 200: { description: Payroll history with summary } }
 * /agencies/me/finance/payroll/{id}/mark-paid:
 *   patch:
 *     tags: [Finance]
 *     summary: Mark one payroll record as paid, posting the corresponding journal entry
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Paid — includes the posted journal entry }, 404: { description: Payroll record not found for this agency } }
 */
router.route("/agencies/me/finance/payroll")
    .post(authenticateWithRefreshToken, createPayroll)
    .get(authenticateWithRefreshToken, getPayrollHistory);

// PATCH, not POST: this modifies one existing payroll record rather than
// creating a new resource.
router.route("/agencies/me/finance/payroll/:id/mark-paid")
    .patch(authenticateWithRefreshToken, markPayrollPaid);

// ── Day 4: financial statements ──────────────────────────────────────────────

/**
 * @openapi
 * /agencies/me/finance/pnl:
 *   get:
 *     tags: [Finance]
 *     summary: Profit & loss statement for a period
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: period, in: query, schema: { type: string } }]
 *     responses: { 200: { description: Report }, 400: { description: Invalid period } }
 * /agencies/me/finance/balance-sheet:
 *   get:
 *     tags: [Finance]
 *     summary: Balance sheet as of a given date
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: date, in: query, schema: { type: string, format: date } }]
 *     responses: { 200: { description: Report }, 400: { description: Invalid date } }
 * /agencies/me/finance/cash-flow:
 *   get:
 *     tags: [Finance]
 *     summary: Cash flow statement for a period
 *     security: [{ refreshToken: [] }]
 *     parameters: [{ name: period, in: query, schema: { type: string } }]
 *     responses: { 200: { description: Report }, 400: { description: Invalid period } }
 * /agencies/me/finance/tax-summary:
 *   get:
 *     tags: [Finance]
 *     summary: Tax summary for a period, at an optional VAT rate
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: period, in: query, schema: { type: string } }
 *       - { name: vatRate, in: query, schema: { type: number } }
 *     responses: { 200: { description: Report }, 400: { description: Invalid period } }
 */
router.route("/agencies/me/finance/pnl")
    .get(authenticateWithRefreshToken, getProfitAndLoss);

router.route("/agencies/me/finance/balance-sheet")
    .get(authenticateWithRefreshToken, getBalanceSheet);

router.route("/agencies/me/finance/cash-flow")
    .get(authenticateWithRefreshToken, getCashFlow);

router.route("/agencies/me/finance/tax-summary")
    .get(authenticateWithRefreshToken, getTaxSummary);

// ── Phase 2: trekker invoices ────────────────────────────────────────────────
/**
 * @openapi
 * /agencies/me/finance/invoices:
 *   get:
 *     tags: [Finance]
 *     summary: List trekker invoices the agency has issued
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [all, Draft, Sent, Paid, Overdue, Void] } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses: { 200: { description: Invoices }, 401: { description: Unauthorized } }
 *   post:
 *     tags: [Finance]
 *     summary: Create an invoice (optionally from a bookingId — pulls trekker/package/amount)
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/me/finance/invoices/{id}:
 *   get: { tags: [Finance], summary: Get an invoice, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 *   patch: { tags: [Finance], summary: Edit a draft/sent invoice (recomputes totals), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 409: { description: Paid/void cannot be edited } } }
 *   delete: { tags: [Finance], summary: Delete a non-paid invoice, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 409: { description: Paid — void instead } } }
 * /agencies/me/finance/invoices/{id}/send:
 *   patch: { tags: [Finance], summary: Mark an invoice as SENT, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Sent }, 409: { description: Invalid transition } } }
 * /agencies/me/finance/invoices/{id}/mark-paid:
 *   patch: { tags: [Finance], summary: Mark an invoice PAID (sets paidAt), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Paid }, 409: { description: Invalid transition } } }
 * /agencies/me/finance/invoices/{id}/void:
 *   patch: { tags: [Finance], summary: Void an invoice, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Voided } } }
 */
router.route("/agencies/me/finance/invoices")
    .get(authenticateWithRefreshToken, listInvoices)
    .post(authenticateWithRefreshToken, createInvoice);

router.route("/agencies/me/finance/invoices/:id/send")
    .patch(authenticateWithRefreshToken, markInvoiceSent);
router.route("/agencies/me/finance/invoices/:id/mark-paid")
    .patch(authenticateWithRefreshToken, markInvoicePaid);
router.route("/agencies/me/finance/invoices/:id/void")
    .patch(authenticateWithRefreshToken, voidInvoice);

router.route("/agencies/me/finance/invoices/:id")
    .get(authenticateWithRefreshToken, getInvoice)
    .patch(authenticateWithRefreshToken, updateInvoice)
    .delete(authenticateWithRefreshToken, deleteInvoice);

export default router;
