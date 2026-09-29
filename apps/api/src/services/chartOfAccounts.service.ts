import { db } from "@funtush/database";

/**
 * Default chart of accounts for a trekking agency. Mirrors packages/database/prisma/accounting.seed.ts
 * (the manual seed script) so a brand-new agency can record its first income/expense without an
 * operator running that script first.
 */
type Row = { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; parentCode?: string };
export const DEFAULT_CHART: Row[] = [
  { code: "1000", name: "Cash & Bank", type: "ASSET" },
  { code: "1010", name: "Cash on Hand", type: "ASSET", parentCode: "1000" },
  { code: "1020", name: "Bank Account", type: "ASSET", parentCode: "1000" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET" },
  { code: "1500", name: "Trekking Equipment", type: "ASSET" },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "2100", name: "Customer Advances", type: "LIABILITY" },
  { code: "2200", name: "Taxes Payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's Equity", type: "EQUITY" },
  { code: "3100", name: "Retained Earnings", type: "EQUITY" },
  { code: "4000", name: "Trek Package Revenue", type: "REVENUE" },
  { code: "4100", name: "Add-on Revenue", type: "REVENUE" },
  { code: "4900", name: "Other Income", type: "REVENUE" },
  { code: "5000", name: "Guide Payroll", type: "EXPENSE" },
  { code: "5050", name: "Staff Salaries", type: "EXPENSE" },
  { code: "5100", name: "Porter Wages", type: "EXPENSE" },
  { code: "5200", name: "Permit Fees", type: "EXPENSE" },
  { code: "5300", name: "Equipment Purchase & Maintenance", type: "EXPENSE" },
  { code: "5400", name: "Marketing & Advertising", type: "EXPENSE" },
  { code: "5500", name: "Transportation", type: "EXPENSE" },
  { code: "5600", name: "Accommodation & Meals", type: "EXPENSE" },
  { code: "5700", name: "Insurance", type: "EXPENSE" },
  { code: "5800", name: "Office & Administration", type: "EXPENSE" },
  { code: "5900", name: "Platform Subscription", type: "EXPENSE" },
];

/**
 * Seeds the default chart when — and only when — the agency has no accounts at all. An agency that
 * deliberately deactivated or renamed accounts is never touched. Idempotent (upserts on agencyId+code).
 * Returns true when it seeded.
 */
export async function ensureChartOfAccounts(agencyId: string): Promise<boolean> {
  if ((await db.account.count({ where: { agencyId } })) > 0) return false;
  const idByCode = new Map<string, string>();
  for (const acc of DEFAULT_CHART) {
    const created = await db.account.upsert({
      where: { agencyId_code: { agencyId, code: acc.code } },
      update: {},
      create: { agencyId, code: acc.code, name: acc.name, type: acc.type, parentId: acc.parentCode ? (idByCode.get(acc.parentCode) ?? null) : null },
    });
    idByCode.set(acc.code, created.id);
  }
  return true;
}
