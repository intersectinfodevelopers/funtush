import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../index';
import { db } from '@funtush/database';

/**
 * Week 6 Day 4 — Audit Trail & Data Retention
 *
 * Part A verifies every privileged admin action leaves a record.
 * Part B verifies retention rules exist and are enforced for new data types.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDIT THE CONFIG BLOCKS. The assertions are generic.
 *
 * Find your audit model first:
 *   Select-String -Path packages\database\prisma\schema.prisma `
 *     -Pattern "model AuditLog" -Context 0,20
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════
// PART A CONFIG — admin actions that must be audited
// ═══════════════════════════════════════════════════════════════════════════

interface AuditCase {
  name: string;
  method: 'post' | 'patch' | 'delete';
  /** `:id` replaced with a fixture id created in beforeAll. */
  path: string;
  body?: Record<string, unknown>;
  /** Expected `action` value on the audit row. Adjust to your enum. */
  expectedAction: string;
  /** Fixture key holding the target id. */
  fixtureKey: string;
}

const AUDITED_ACTIONS: AuditCase[] = [
  {
    name: 'fraud flag — confirm',
    method: 'patch',
    path: '/fraud/:id/confirm',
    expectedAction: 'FRAUD_CONFIRM',
    fixtureKey: 'fraudFlagId',
  },
  {
    name: 'fraud flag — dismiss',
    method: 'patch',
    path: '/fraud/:id/dismiss',
    expectedAction: 'FRAUD_DISMISS',
    fixtureKey: 'fraudFlagId2',
  },
  {
    name: 'ad campaign — approve',
    method: 'post',
    path: '/ads/campaigns/:id/approve',
    expectedAction: 'AD_CAMPAIGN_APPROVE',
    fixtureKey: 'adCampaignId',
  },
  {
    name: 'break-glass — elevate',
    method: 'post',
    path: '/admin/break-glass',
    body: { reason: 'incident-1234', durationMinutes: 15 },
    expectedAction: 'BREAK_GLASS',
    fixtureKey: 'noop',
  },
  {
    name: 'domain change',
    method: 'patch',
    path: '/agencies/:id/domain',
    body: { domain: 'audit-test.example.com' },
    expectedAction: 'DOMAIN_CHANGE',
    fixtureKey: 'agencyId',
  },
];

const PREFIX = '/api';

/** REPLACE with your auth scheme. */
function adminAuth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART B CONFIG — retention policy
// ═══════════════════════════════════════════════════════════════════════════

interface RetentionRule {
  name: string;
  /** Prisma delegate name on `db`, e.g. 'gpsPing'. */
  model: string;
  /** Timestamp column used for ageing. */
  timestampField: string;
  /** Retention window in days, per the policy document. */
  retentionDays: number;
  /**
   * If true, records may be kept past the window under a documented legal or
   * legitimate-interest basis — the test then asserts the basis is recorded
   * rather than asserting deletion.
   */
  legalHoldPossible?: boolean;
}

/** REPLACE the day counts with the actual figures from your retention policy. */
const RETENTION_RULES: RetentionRule[] = [
  { name: 'GPS pings',         model: 'gpsPing',      timestampField: 'timestamp',  retentionDays: 90 },
  { name: 'SOS records',       model: 'sosRequest',   timestampField: 'createdAt',  retentionDays: 365, legalHoldPossible: true },
  { name: 'Fraud flags',       model: 'fraudFlag',    timestampField: 'createdAt',  retentionDays: 730, legalHoldPossible: true },
  { name: 'Device fingerprints', model: 'fingerprint', timestampField: 'createdAt', retentionDays: 365 },
  { name: 'IP registrations',  model: 'iPRegistration', timestampField: 'timestamp', retentionDays: 90 },
];

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const fixtures: Record<string, string> = {};
let adminToken = '';
let adminUserId = '';

beforeAll(async () => {
  // REPLACE: create a platform admin, plus one target record per audited
  // action, and store their ids in `fixtures` under the fixtureKey names above.
  //
  //   const admin = await createTestPlatformAdmin();
  //   adminToken = await signTestToken(admin.id);
  //   adminUserId = admin.id;
  //   fixtures.fraudFlagId  = (await createTestFraudFlag()).id;
  //   fixtures.fraudFlagId2 = (await createTestFraudFlag()).id;
  //   fixtures.adCampaignId = (await createTestAdCampaign({ status: 'PENDING_APPROVAL' })).id;
  //   fixtures.agencyId     = (await createTestAgency()).id;
  //   fixtures.noop         = 'noop';

  throw new Error(
    'Audit fixtures not wired up. Fill in beforeAll with your admin and ' +
    'target-record factories before running this suite.'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// PART A — AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4A — Audit trail completeness', () => {
  describe('the audit model captures what compliance requires', () => {
    it('records actor, action, target, and timestamp', async () => {
      // A row missing any of these is not an audit record, it is a log line.
      const sample = await db.auditLog.findFirst();

      if (!sample) {
        console.log('  ! audit_log is empty — run an admin action first');
        return;
      }

      const required = ['actorId', 'action', 'createdAt'];
      const missing = required.filter((f) => (sample as Record<string, unknown>)[f] == null);

      expect(
        missing,
        `Audit rows are missing required field(s): ${missing.join(', ')}`
      ).toEqual([]);
    });
  });

  describe('every privileged action writes an audit record', () => {
    AUDITED_ACTIONS.forEach((action) => {
      it(`${action.name} → audit row with action=${action.expectedAction}`, async () => {
        const before = await db.auditLog.count();
        const targetId = fixtures[action.fixtureKey];
        const url = PREFIX + action.path.replace(':id', targetId);

        const res = await request(app)
          [action.method](url)
          .set(adminAuth(adminToken))
          .send(action.body);

        // The action itself must succeed, or the audit assertion is vacuous.
        expect(
          res.status,
          `${action.name} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`
        ).toBeLessThan(400);

        const after = await db.auditLog.count();
        expect(
          after,
          `${action.name} produced no audit row`
        ).toBeGreaterThan(before);

        const record = await db.auditLog.findFirst({
          orderBy: { createdAt: 'desc' },
        });

        expect(record?.action).toBe(action.expectedAction);
        expect(record?.actorId).toBe(adminUserId);
      });
    });
  });

  describe('audit records are tamper-evident', () => {
    it('exposes no update or delete route for audit logs', async () => {
      const sample = await db.auditLog.findFirst();
      if (!sample) return;

      for (const method of ['patch', 'delete'] as const) {
        const res = await request(app)
          [method](`${PREFIX}/audit-logs/${sample.id}`)
          .set(adminAuth(adminToken));

        expect(
          [404, 405, 403],
          `${method.toUpperCase()} on an audit log returned ${res.status} — ` +
          'audit records should not be mutable via the API'
        ).toContain(res.status);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART B — DATA RETENTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4B — Data retention', () => {
  describe('no records exist beyond their retention window', () => {
    RETENTION_RULES.forEach((rule) => {
      it(`${rule.name}: nothing older than ${rule.retentionDays} days`, async () => {
        const delegate = (db as unknown as Record<string, {
          count: (args: unknown) => Promise<number>;
          findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
        }>)[rule.model];

        if (!delegate) {
          console.log(`  ! model '${rule.model}' not found on db — check the name`);
          return;
        }

        const cutoff = new Date(Date.now() - rule.retentionDays * 24 * 60 * 60 * 1000);

        const stale = await delegate.count({
          where: { [rule.timestampField]: { lt: cutoff } },
        });

        if (stale > 0) {
          const oldest = await delegate.findFirst({
            where: { [rule.timestampField]: { lt: cutoff } },
            orderBy: { [rule.timestampField]: 'asc' },
          });
          console.log(
            `  ✗ ${rule.name}: ${stale} record(s) past retention. ` +
            `Oldest: ${oldest?.[rule.timestampField]}`
          );
        }

        if (rule.legalHoldPossible && stale > 0) {
          // Retention past the window is defensible only if the reason is
          // recorded. Adjust the field name to your schema.
          const unheld = await delegate.count({
            where: {
              [rule.timestampField]: { lt: cutoff },
              OR: [{ legalHold: null }, { legalHold: false }],
            },
          }).catch(() => {
            console.log(`  ! ${rule.model} has no legalHold column — cannot justify retention`);
            return stale;
          });

          expect(
            unheld,
            `${rule.name}: ${unheld} record(s) past retention with no legal hold`
          ).toBe(0);
        } else {
          expect(stale, `${rule.name}: ${stale} record(s) past retention`).toBe(0);
        }
      });
    });
  });

  describe('a purge mechanism exists and works', () => {
    /**
     * A policy nobody enforces is not a control. This asserts the cleanup job
     * is callable and removes what it should.
     *
     * REPLACE the import with your actual purge entry point, e.g.
     *   import { purgeExpiredRecords } from '../services/retention.service';
     */
    it('purge job removes records past their window', async () => {
      let purge: (() => Promise<unknown>) | undefined;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        purge = require('../services/retention.service').purgeExpiredRecords;
      } catch {
        // fall through
      }

      if (!purge) {
        throw new Error(
          'No retention purge job found. Expected ' +
          "`purgeExpiredRecords` in src/services/retention.service.ts. " +
          'If retention is enforced elsewhere, point this test at it; if it is ' +
          'not enforced anywhere, that is the finding.'
        );
      }

      await purge();

      // Re-run the staleness check for the shortest window as a smoke test.
      const rule = RETENTION_RULES[0];
      const delegate = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[rule.model];
      const cutoff = new Date(Date.now() - rule.retentionDays * 24 * 60 * 60 * 1000);
      const remaining = await delegate.count({
        where: { [rule.timestampField]: { lt: cutoff } },
      });

      expect(remaining).toBe(0);
    });
  });

  describe('deletion requests remove personal data', () => {
    it('erases GPS, fingerprint, and SOS personal data for a deleted user', async () => {
      // GDPR Art. 17 / equivalent. REPLACE with your erasure entry point.
      //
      // const user = await createTestUser();
      // await createTestGpsPings({ userId: user.id, count: 5 });
      // await eraseUserData(user.id);
      //
      // expect(await db.gpsPing.count({ where: { userId: user.id } })).toBe(0);
      // expect(await db.fingerprint.count({ where: { userId: user.id } })).toBe(0);

      throw new Error('Erasure test not wired up — point it at your deletion routine.');
    });
  });
});