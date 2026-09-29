import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the finance route (income/expenses/transactions,
 * payroll, and the read-only financial statements). All routes require a
 * real agency session; the invoices sub-resource on this same router already
 * has its own dedicated route + integration tests
 * (test/trekkerInvoice.route.test.ts, src/test/trekkerInvoice.integration.test.ts)
 * so it isn't duplicated here.
 */

const { authState } = vi.hoisted(() => ({ authState: { valid: false } }));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.valid) return res.status(401).json({ success: false, message: "Unauthorized" });
    req.agencyId = "agency-1";
    req.tenantId = "agency-user-1";
    next();
  },
}));

const recordIncomeService = vi.fn();
const recordExpenseService = vi.fn();
const getTransactionsService = vi.fn();
vi.mock("src/services/finance.service", () => ({
  recordIncomeService: (...a: unknown[]) => recordIncomeService(...a),
  recordExpenseService: (...a: unknown[]) => recordExpenseService(...a),
  getTransactionsService: (...a: unknown[]) => getTransactionsService(...a),
}));

const createPayrollService = vi.fn();
const markPayrollPaidService = vi.fn();
const getPayrollHistoryService = vi.fn();
vi.mock("src/services/payroll.service", () => ({
  createPayrollService: (...a: unknown[]) => createPayrollService(...a),
  markPayrollPaidService: (...a: unknown[]) => markPayrollPaidService(...a),
  getPayrollHistoryService: (...a: unknown[]) => getPayrollHistoryService(...a),
}));

const getProfitAndLossService = vi.fn();
const getBalanceSheetService = vi.fn();
const getCashFlowService = vi.fn();
const getTaxSummaryService = vi.fn();
vi.mock("src/services/financialStatements.service", () => ({
  getProfitAndLossService: (...a: unknown[]) => getProfitAndLossService(...a),
  getBalanceSheetService: (...a: unknown[]) => getBalanceSheetService(...a),
  getCashFlowService: (...a: unknown[]) => getCashFlowService(...a),
  getTaxSummaryService: (...a: unknown[]) => getTaxSummaryService(...a),
}));

vi.mock("src/services/trekkerInvoice.service", () => ({
  listInvoicesService: vi.fn(),
  createInvoiceService: vi.fn(),
  getInvoiceService: vi.fn(),
  updateInvoiceService: vi.fn(),
  deleteInvoiceService: vi.fn(),
  markInvoiceSentService: vi.fn(),
  markInvoicePaidService: vi.fn(),
  voidInvoiceService: vi.fn(),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: financeRoutes } = await import("./finance.route");

  const app = express();
  app.use(express.json());
  app.use("/", financeRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.valid = false;
});

async function call(method: string, path: string, body?: unknown, opts: { auth?: boolean } = { auth: true }) {
  if (opts.auth !== false) authState.valid = true;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("auth gate", () => {
  it("401s every route without a session", async () => {
    const routes: Array<[string, string]> = [
      ["POST", "/agencies/me/finance/income"],
      ["POST", "/agencies/me/finance/expenses"],
      ["GET", "/agencies/me/finance/transactions"],
      ["POST", "/agencies/me/finance/payroll"],
      ["GET", "/agencies/me/finance/payroll"],
      ["PATCH", "/agencies/me/finance/payroll/p1/mark-paid"],
      ["GET", "/agencies/me/finance/pnl"],
      ["GET", "/agencies/me/finance/balance-sheet"],
      ["GET", "/agencies/me/finance/cash-flow"],
      ["GET", "/agencies/me/finance/tax-summary"],
    ];
    for (const [method, path] of routes) {
      const res = await call(method, path, undefined, { auth: false });
      expect(res.status).toBe(401);
    }
  });
});

describe("income / expenses / transactions", () => {
  it("POST /income records an income entry and passes the session's agencyUserId", async () => {
    recordIncomeService.mockResolvedValue({ id: "je-1" });
    const res = await call("POST", "/agencies/me/finance/income", { amount: 100, accountCode: "4000" });
    expect(res.status).toBe(201);
    expect(recordIncomeService).toHaveBeenCalledWith("agency-1", "agency-user-1", { amount: 100, accountCode: "4000" });
  });

  it("POST /income 400s on a service validation error", async () => {
    recordIncomeService.mockRejectedValue(new Error("accountCode is required"));
    const res = await call("POST", "/agencies/me/finance/income", {});
    expect(res.status).toBe(400);
  });

  it("POST /expenses records an expense entry", async () => {
    recordExpenseService.mockResolvedValue({ id: "je-2" });
    const res = await call("POST", "/agencies/me/finance/expenses", { amount: 50, accountCode: "5000" });
    expect(res.status).toBe(201);
    expect(recordExpenseService).toHaveBeenCalledWith("agency-1", "agency-user-1", { amount: 50, accountCode: "5000" });
  });

  it("GET /transactions passes through filters and returns pagination", async () => {
    getTransactionsService.mockResolvedValue({ transactions: [{ id: "t1" }], pagination: { page: 1, total: 1 } });
    const res = await call("GET", "/agencies/me/finance/transactions?accountCode=4000&page=1&limit=10");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([{ id: "t1" }]);
    expect(getTransactionsService).toHaveBeenCalledWith("agency-1", {
      accountCode: "4000",
      from: undefined,
      to: undefined,
      page: 1,
      limit: 10,
    });
  });
});

describe("payroll", () => {
  it("POST /payroll creates a payroll record", async () => {
    createPayrollService.mockResolvedValue({ id: "pr-1" });
    const res = await call("POST", "/agencies/me/finance/payroll", { guideId: "g1", amount: 200 });
    expect(res.status).toBe(201);
    expect(createPayrollService).toHaveBeenCalledWith("agency-1", "agency-user-1", { guideId: "g1", amount: 200 });
  });

  it("GET /payroll returns history with summary", async () => {
    getPayrollHistoryService.mockResolvedValue({ payroll: [], summary: { totalPaid: 0 }, pagination: {} });
    const res = await call("GET", "/agencies/me/finance/payroll?status=PAID");
    expect(res.status).toBe(200);
    expect(getPayrollHistoryService).toHaveBeenCalledWith("agency-1", expect.objectContaining({ status: "PAID" }));
  });

  it("PATCH /payroll/:id/mark-paid returns the payroll and its journal entry", async () => {
    markPayrollPaidService.mockResolvedValue({ payroll: { id: "pr-1", status: "PAID" }, journalEntry: { id: "je-3" } });
    const res = await call("PATCH", "/agencies/me/finance/payroll/pr-1/mark-paid", {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { status: string }; journalEntry: { id: string } };
    expect(json.data.status).toBe("PAID");
    expect(json.journalEntry.id).toBe("je-3");
    expect(markPayrollPaidService).toHaveBeenCalledWith("agency-1", "agency-user-1", "pr-1", {});
  });

  it("PATCH /payroll/:id/mark-paid 404s when the record isn't found for this agency", async () => {
    markPayrollPaidService.mockRejectedValue(new Error("Payroll record not found for this agency"));
    const res = await call("PATCH", "/agencies/me/finance/payroll/missing/mark-paid", {});
    expect(res.status).toBe(404);
  });
});

describe("financial statements", () => {
  it("GET /pnl returns a report", async () => {
    getProfitAndLossService.mockResolvedValue({ revenue: 1000, expenses: 400, net: 600 });
    const res = await call("GET", "/agencies/me/finance/pnl?period=2026-01");
    expect(res.status).toBe(200);
    expect(getProfitAndLossService).toHaveBeenCalledWith("agency-1", "2026-01");
  });

  it("GET /balance-sheet returns a report", async () => {
    getBalanceSheetService.mockResolvedValue({ assets: 1000, liabilities: 200 });
    const res = await call("GET", "/agencies/me/finance/balance-sheet?date=2026-01-31");
    expect(res.status).toBe(200);
    expect(getBalanceSheetService).toHaveBeenCalledWith("agency-1", "2026-01-31");
  });

  it("GET /cash-flow returns a report", async () => {
    getCashFlowService.mockResolvedValue({ operating: 100 });
    const res = await call("GET", "/agencies/me/finance/cash-flow");
    expect(res.status).toBe(200);
    expect(getCashFlowService).toHaveBeenCalledWith("agency-1", undefined);
  });

  it("GET /tax-summary passes through the vatRate as a number", async () => {
    getTaxSummaryService.mockResolvedValue({ taxDue: 130 });
    const res = await call("GET", "/agencies/me/finance/tax-summary?period=2026-01&vatRate=13");
    expect(res.status).toBe(200);
    expect(getTaxSummaryService).toHaveBeenCalledWith("agency-1", "2026-01", 13);
  });

  it("GET /pnl 400s on an invalid period from the service", async () => {
    getProfitAndLossService.mockRejectedValue(new Error("Invalid period"));
    const res = await call("GET", "/agencies/me/finance/pnl?period=bogus");
    expect(res.status).toBe(400);
  });
});
