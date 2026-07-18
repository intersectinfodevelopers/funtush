import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { prisma, AccountType } from "@funtush/database";

// Default chart of accounts for trekking agency operations.
// Codes follow standard accounting numbering: 1xxx assets, 2xxx liabilities,
// 3xxx equity, 4xxx revenue, 5xxx expenses. `parentCode` builds the hierarchy
// (e.g. "Cash on Hand" is a child of "Cash & Bank"), so parents are created
// first and children look their parent's id up by code.
export const DEFAULT_CHART_OF_ACCOUNTS: {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
}[] = [
  // ── Assets ─────────────────────────────────────────
  { code: "1000", name: "Cash & Bank", type: "ASSET" },
  { code: "1010", name: "Cash on Hand", type: "ASSET", parentCode: "1000" },
  { code: "1020", name: "Bank Account", type: "ASSET", parentCode: "1000" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET" },
  { code: "1500", name: "Trekking Equipment", type: "ASSET" },

  // ── Liabilities ────────────────────────────────────
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "2100", name: "Customer Advances", type: "LIABILITY" },
  { code: "2200", name: "Taxes Payable", type: "LIABILITY" },

  // ── Equity ─────────────────────────────────────────
  { code: "3000", name: "Owner's Equity", type: "EQUITY" },
  { code: "3100", name: "Retained Earnings", type: "EQUITY" },

  // ── Revenue ────────────────────────────────────────
  { code: "4000", name: "Trek Package Revenue", type: "REVENUE" },
  { code: "4100", name: "Add-on Revenue", type: "REVENUE" },
  { code: "4900", name: "Other Income", type: "REVENUE" },

  // ── Expenses ───────────────────────────────────────
  { code: "5000", name: "Guide Payroll", type: "EXPENSE" },
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

// Idempotent: upserts on the (agencyId, code) unique key, so re-running the
// seed never duplicates accounts. Called per tenant — every agency owns its
// own copy of the chart (tenant isolation, Backend Guide §4).
export async function seedChartOfAccounts(agencyId: string) {
  const idByCode = new Map<string, string>();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    const parentId = acc.parentCode ? idByCode.get(acc.parentCode) : undefined;

    const created = await prisma.account.upsert({
      where: { agencyId_code: { agencyId, code: acc.code } },
      update: { name: acc.name, type: acc.type, parentId: parentId ?? null },
      create: {
        agencyId,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        parentId: parentId ?? null,
      },
    });

    idByCode.set(acc.code, created.id);
  }
}

async function main() {
  console.log("🌱 Seeding default chart of accounts...");

  const agencies = await prisma.agency.findMany({ select: { id: true, name: true } });

  if (agencies.length === 0) {
    console.log("No agencies found — run the main seed first (pnpm db:seed).");
    return;
  }

  for (const agency of agencies) {
    await seedChartOfAccounts(agency.id);
    console.log(`  ✔ ${agency.name} (${agency.id})`);
  }

  console.log(`Chart of accounts seeded for ${agencies.length} agencies.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // The @funtush/database package opens a Redis connection at import time,
    // which keeps the Node event loop alive forever — exit explicitly.
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
