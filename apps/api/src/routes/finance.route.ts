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
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

// ── Day 2: recording money in and out ────────────────────────────────────────

router.route("/agencies/me/finance/income")
    .post(authenticateWithRefreshToken, recordIncome);

router.route("/agencies/me/finance/expenses")
    .post(authenticateWithRefreshToken, recordExpense);

router.route("/agencies/me/finance/transactions")
    .get(authenticateWithRefreshToken, getTransactions);

// ── Day 3: payroll ───────────────────────────────────────────────────────────

router.route("/agencies/me/finance/payroll")
    .post(authenticateWithRefreshToken, createPayroll)
    .get(authenticateWithRefreshToken, getPayrollHistory);

// PATCH, not POST: this modifies one existing payroll record rather than
// creating a new resource.
router.route("/agencies/me/finance/payroll/:id/mark-paid")
    .patch(authenticateWithRefreshToken, markPayrollPaid);

// ── Day 4: financial statements ──────────────────────────────────────────────

router.route("/agencies/me/finance/pnl")
    .get(authenticateWithRefreshToken, getProfitAndLoss);

router.route("/agencies/me/finance/balance-sheet")
    .get(authenticateWithRefreshToken, getBalanceSheet);

router.route("/agencies/me/finance/cash-flow")
    .get(authenticateWithRefreshToken, getCashFlow);

router.route("/agencies/me/finance/tax-summary")
    .get(authenticateWithRefreshToken, getTaxSummary);

export default router;
