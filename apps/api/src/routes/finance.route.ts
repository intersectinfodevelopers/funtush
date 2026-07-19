import { Router } from "express";
import {
    recordIncome,
    recordExpense,
    getTransactions,
} from "src/controllers/finance.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

router.route("/agencies/me/finance/income")
    .post(authenticateWithRefreshToken, recordIncome);

router.route("/agencies/me/finance/expenses")
    .post(authenticateWithRefreshToken, recordExpense);

router.route("/agencies/me/finance/transactions")
    .get(authenticateWithRefreshToken, getTransactions);

export default router;
