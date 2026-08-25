import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { db } from '@funtush/database';
import { app } from '../src/index';
import {
  preflight,
  createAgency,
  createFraudFlag,
  cleanup,
  mintAdminAuth,
  MODELS,
  type TestAgency,
} from './fixtures';

/**
 * Week 6 Day 4 — Audit Trail & Data Retention
 *
 * Part A: every privileged admin action leaves a record.
 * Part B: retention rules exist and are enforced for the new data types.
 *
 * Run with:  pnpm test:security
 */

const PREFIX = '';

// ═══════════════════════════════════════════════════════════════════════════
// PART A CONFIG — actions that must be audited
// ═══════════════════════════════════════════════════════════════════════════

interface AuditCase {
  name: string;
  method: 'post' | 'patch' | 'delete';
  /** `:id` replaced from `targets` below. */
  path: string;
  body?: Record<string, unknown>;
  /** Expected value of the `action` column. Adjust to your enum. */
  expectedAction: string;
  targetKey: 'fraudFlagA' | 'fraudFlagB' | 'agency' | 'none';
}

const AUDITED_ACTIONS: AuditCase[] = [
  {
    name: 'fraud confirm',
    method: 'patch',
    path: '/fraud/:id/confirm',
    expectedAction: 'FRAUD_CONFIRM',
    targetKey: 'fraudFlagA',
  },
  {
    name: 'fraud dismiss',
    method: 'patch',
    path: '/fraud/:id/dismiss',
    body: { reason: 'audit test' },
    expectedAction: 'FRAUD_DISMISS',
    targetKey: 'fraudFlagB',
  },
  {
    name: 'break-glass elevation',
    method: 'post',
    path: '/admin/break-glass',
    body: { reason: 'audit test incident', durationMinutes: 5 },
    expectedAction: 'BREAK_GLASS',
    targetKey: 'none',
  },
  {
    name: 'domain change',
    method: 'patch',
    path: '/agencies/:id/domain',
    body: { domain: `audit-${Date.now()}.example.com` },
    expectedAction: 'DOMAIN_CHANGE',
    targetKey: 'agency',
  },
  // ── ad campaign approval: add once you confirm the route ────────────────
  // { name: 'ad campaign approve', method: 'post', path: '/ads/campaigns/:id/approve',
  //   expectedAction: 'AD_CAMPAIGN_APPROVE', targetKey: 'adCampaign' },
];

// ═══════════════════════════════════════════════════════════════════════════
// PART B CONFIG — retention policy
// ═══════════════════════════════════════════════════════════════════════════

interface RetentionRule {
  name: string;
  /** Key in MODELS. */
  model: keyof typeof MODELS;
  timestampField: string;
  /** From the written policy — replace the placeholders. */
  retentionDays: number;
  /** Records may outlive the window under a documented basis. */
  legalHoldPossible?: boolean;
}

const RETENTION_RULES: RetentionRule[] = [
  { name: 'GPS pings',           model: 'gpsPing',     timestampField: 'timestamp', retentionDays: 90 },
  { name: 'SOS records',         model: 'sosRequest',  timestampField: 'createdAt', retentionDays: 365, legalHoldPossible: true },
  { name: 'Fraud flags',         model: 'fraudFlag',   timestampField: 'createdAt', retentionDays: 730, legalHoldPossible: true },
  { name: 'Device fingerprints', model: 'fingerprint', timestampField: 'createdAt', retentionDays: 365 },
];

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

let agency: TestAgency;
let adminAuth: Record<string, string>;
let adminUserId: string;

const targets: Record<AuditCase['targetKey'], string> = {
  fraudFlagA: '',
  fraudFlagB: '',
  agency: '',
  none: 'none',
};

beforeAll(async () => {
  await preflight();

  agency = await createAgency('audit');
  targets.agency = agency.id;
  targets.fraudFlagA = await createFraudFlag(agency.id);
  targets.fraudFlagB = await createFraudFlag(agency.id);

  // A platform admin. Reuses the agency's user id unless you create a
  // dedicated one — adjust if your admin lives in a separate table.
  adminUserId = agency.userId;
  adminAuth = await mintAdminAuth(adminUserId);
}, 30_000);

afterAll(async () => {
  if (agency) await cleanup([agency.id], [agency.userId]);
});

// ═══════════════════════════════════════════════════════════════════════════
// PART A — AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4A — Audit trail', () => {
  const auditDelegate = () => (db as any)[MODELS.auditLog];

  it('an audit model exists', () => {
    expect(
      auditDelegate(),
      `db.${MODELS.auditLog} does not exist. Find the real name with:\n` +
      '  Select-String -Path packages\\database\\prisma\\schema.prisma -Pattern "^model.*[Aa]udit"\n' +
      'then update MODELS.auditLog in fixtures.ts.'
    ).toBeDefined();
  });

  it('audit records carry actor, action, and timestamp', async () => {
    const sample = await auditDelegate()?.findFirst();

    if (!sample) {
      console.log('  ! audit table is empty — the action tests below will populate it');
      return;
    }

    const required = ['action', 'createdAt'];
    const actorFields = ['actorId', 'userId', 'performedBy', 'adminId'];

    const missing = required.filter((f) => sample[f] == null);
    const hasActor = actorFields.some((f) => sample[f] != null);

    if (!hasActor) missing.push(`actor (none of: ${actorFields.join(', ')})`);

    expect(
      missing,
      `Audit rows lack required field(s): ${missing.join(', ')}.\n` +
      `  Columns present: ${Object.keys(sample).join(', ')}`
    ).toEqual([]);
  });

  describe('every privileged action writes an audit record', () => {
    AUDITED_ACTIONS.forEach((action) => {
      it(`${action.name} → audit row`, async () => {
        const delegate = auditDelegate();
        if (!delegate) return;

        const before = await delegate.count();
        const url = PREFIX + action.path.replace(':id', targets[action.targetKey]);

        const res = await request(app)
          [action.method](url)
          .set(adminAuth)
          .send(action.body ?? {});

        if (res.status === 404) {
          console.log(`  ! ${action.name}: route ${url} not found — update the path`);
          return;
        }

        // If the action itself fails, the audit assertion proves nothing.
        expect(
          res.status,
          `${action.name} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`
        ).toBeLessThan(400);

        const after = await delegate.count();

        expect(
          after,
          `GAP: ${action.name} succeeded (${res.status}) but wrote no audit record.`
        ).toBeGreaterThan(before);

        const record = await delegate.findFirst({ orderBy: { createdAt: 'desc' } });

        expect(
          record?.action,
          `Audit row action was "${record?.action}", expected "${action.expectedAction}". ` +
          'Adjust expectedAction if your enum differs.'
        ).toBe(action.expectedAction);
      });
    });
  });

  it('audit records are not mutable through the API', async () => {
    const delegate = auditDelegate();
    if (!delegate) return;

    const sample = await delegate.findFirst();
    if (!sample) return;

    for (const method of ['patch', 'delete'] as const) {
      const res = await request(app)
        [method](`${PREFIX}/audit-logs/${sample.id}`)
        .set(adminAuth)
        .send({ action: 'TAMPERED' });

      expect(
        [401, 403, 404, 405],
        `${method.toUpperCase()} on an audit record returned ${res.status} — ` +
        'audit rows should not be editable via the API'
      ).toContain(res.status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART B — DATA RETENTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4B — Data retention', () => {
  describe('no records survive past their retention window', () => {
    RETENTION_RULES.forEach((rule) => {
      it(`${rule.name}: nothing older than ${rule.retentionDays} days`, async () => {
        const delegate = (db as any)[MODELS[rule.model]];

        if (!delegate) {
          console.log(
            `  ! db.${MODELS[rule.model]} not found — fix MODELS.${rule.model} in fixtures.ts`
          );
          return;
        }

        const cutoff = new Date(Date.now() - rule.retentionDays * 86_400_000);

        let stale: number;
        try {
          stale = await delegate.count({ where: { [rule.timestampField]: { lt: cutoff } } });
        } catch (e) {
          console.log(
            `  ! ${rule.name}: '${rule.timestampField}' is not a column — ` +
            `${(e as Error).message.slice(0, 120)}`
          );
          return;
        }

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
          // Retention past the window is defensible only if the basis is recorded.
          const unjustified = await delegate
            .count({
              where: {
                [rule.timestampField]: { lt: cutoff },
                OR: [{ legalHold: null }, { legalHold: false }],
              },
            })
            .catch(() => {
              console.log(
                `  ! ${MODELS[rule.model]} has no legalHold column — ` +
                'retention past the window cannot be justified in data'
              );
              return stale;
            });

          expect(
            unjustified,
            `${rule.name}: ${unjustified} record(s) past retention with no legal hold`
          ).toBe(0);
        } else {
          expect(stale, `${rule.name}: ${stale} record(s) past retention`).toBe(0);
        }
      });
    });
  });

  it('a purge mechanism exists', async () => {
    /**
     * A policy nobody enforces is not a control.
     * Adjust the path if your cleanup lives elsewhere.
     */
    let purge: (() => Promise<unknown>) | undefined;

    for (const candidate of [
      '../src/services/retention.service',
      '../src/services/cleanup.service',
      '../src/jobs/retention',
    ]) {
      try {
        const mod = await import(candidate);
        purge = mod.purgeExpiredRecords ?? mod.runRetention ?? mod.default;
        if (purge) break;
      } catch {
        // try next
      }
    }

    expect(
      purge,
      'FINDING: no retention purge routine found. Checked retention.service, ' +
      'cleanup.service, jobs/retention. If retention is enforced elsewhere, point ' +
      'this test at it. If it is not enforced anywhere, that is the finding — ' +
      'record it in the Day 4 report rather than deleting this test.'
    ).toBeTypeOf('function');
  });
});