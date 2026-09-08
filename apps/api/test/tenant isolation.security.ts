import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';
import {
  preflight,
  createAgency,
  createFraudFlag,
  createBooking,
  cleanup,
  type TestAgency,
} from './fixtures';

/**
 * Week 6 Day 4 — Tenant Isolation
 *
 * The highest-value security check in the codebase: agency A must never reach
 * agency B's data through any endpoint.
 *
 * Run with:  pnpm test:security
 * Requires:  DATABASE_URL set, database reachable, fixtures.ts TODOs filled in.
 *
 * To add coverage for an endpoint, add one line to ENDPOINTS. The test bodies
 * are generic and iterate over the config.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/** Route prefix. '' if routes mount at root, '/api' if under /api. */
const PREFIX = '';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface ResourceCase {
  name: string;
  method: Method;
  /** `:id` is replaced by the victim agency's resource id. */
  path: string;
  /** Which fixture supplies the id: the agency itself, or a child record. */
  target: 'agency' | 'fraudFlag' | 'booking';
  body?: Record<string, unknown>;
}

interface ListCase {
  name: string;
  path: string;
  /** Field on each row carrying the owning agency id. */
  ownerField?: string;
}

/**
 * Single-record endpoints. Agency A requests agency B's record; must not get 200.
 *
 * Populate from your real routes:
 *   Select-String -Path src\routes\*.ts -Pattern "router\.(get|post|patch|delete)"
 */
const RESOURCE_ENDPOINTS: ResourceCase[] = [
  { name: 'fraud summary',        method: 'get',   path: '/fraud-detection/summary/:id',  target: 'agency' },
  { name: 'fingerprints byagency',method: 'get',   path: '/fingerprint/agency/:id',       target: 'agency' },
  { name: 'fraud flags by agency',method: 'get',   path: '/fingerprint/fraud-flags/:id',  target: 'agency' },
  { name: 'fraud flag confirm',   method: 'patch', path: '/fraud/:id/confirm',            target: 'fraudFlag' },
  { name: 'fraud flag dismiss',   method: 'patch', path: '/fraud/:id/dismiss',            target: 'fraudFlag' },
  { name: 'booking detail',       method: 'get',   path: '/bookings/:id',                 target: 'booking' },
  // ── add your remaining Week 4–6 routes ─────────────────────────────────
];

/** Collection endpoints. Must return only the caller's rows. */
const LIST_ENDPOINTS: ListCase[] = [
  { name: 'bookings',    path: '/bookings' },
  { name: 'fraud queue', path: '/fraud/queue' },
  // ── add yours ──────────────────────────────────────────────────────────
];

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

let attacker: TestAgency;  // agency A — makes the requests
let victim: TestAgency;    // agency B — owns every record under test

const victimResources: Record<ResourceCase['target'], string> = {
  agency: '',
  fraudFlag: '',
  booking: '',
};

beforeAll(async () => {
  await preflight();

  attacker = await createAgency('attacker');
  victim = await createAgency('victim');

  victimResources.agency = victim.id;
  victimResources.fraudFlag = await createFraudFlag(victim.id);
  victimResources.booking = await createBooking(victim.id);
}, 30_000);

afterAll(async () => {
  if (attacker && victim) {
    await cleanup([attacker.id, victim.id], [attacker.userId, victim.userId]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4 — Tenant isolation', () => {
  describe('cross-agency resource access is denied', () => {
    RESOURCE_ENDPOINTS.forEach((ep) => {
      it(`${ep.method.toUpperCase()} ${ep.path} — attacker cannot reach victim's record`, async () => {
        const url = PREFIX + ep.path.replace(':id', victimResources[ep.target]);

        const res = await request(app)
          [ep.method](url)
          .set(attacker.auth)
          .send(ep.body ?? {});

        // 404 is preferable to 403 — it does not confirm the record exists.
        // Either is acceptable. 200 is a breach.
        expect(
          res.status,
          `LEAK: ${ep.name} returned ${res.status} to a foreign agency.\n` +
          `  ${ep.method.toUpperCase()} ${url}\n` +
          `  Body: ${JSON.stringify(res.body).slice(0, 300)}`
        ).not.toBe(200);

        expect(
          [401, 403, 404],
          `${ep.name} returned ${res.status}; expected 401/403/404`
        ).toContain(res.status);
      });
    });
  });

  describe('list endpoints are scoped to the caller', () => {
    LIST_ENDPOINTS.forEach((ep) => {
      it(`GET ${ep.path} — returns no rows owned by another agency`, async () => {
        const res = await request(app)
          .get(PREFIX + ep.path)
          .set(attacker.auth);

        if (res.status === 404) {
          console.log(`  ! ${ep.name}: route not found — remove it from LIST_ENDPOINTS or fix the path`);
          return;
        }

        expect(res.status).toBe(200);

        // Tolerate {data:[]}, {items:[]}, {results:[]}, or a bare array.
        const rows: Record<string, unknown>[] =
          (Array.isArray(res.body) && res.body) ||
          res.body?.data ||
          res.body?.items ||
          res.body?.results ||
          [];

        const field = ep.ownerField ?? 'agencyId';
        const foreign = rows.filter(
          (row) => row[field] !== undefined && row[field] !== attacker.id
        );

        expect(
          foreign,
          `LEAK: ${ep.name} returned ${foreign.length} row(s) from another agency.\n` +
          `  First: ${JSON.stringify(foreign[0] ?? {}).slice(0, 300)}`
        ).toHaveLength(0);
      });
    });
  });

  describe('unauthenticated access is rejected', () => {
    RESOURCE_ENDPOINTS.forEach((ep) => {
      it(`${ep.method.toUpperCase()} ${ep.path} — requires auth`, async () => {
        const url = PREFIX + ep.path.replace(':id', victimResources[ep.target]);

        const res = await request(app)[ep.method](url).send(ep.body ?? {});

        expect(
          [401, 403],
          `${ep.name} returned ${res.status} without credentials`
        ).toContain(res.status);
      });
    });
  });

  describe('the agency id in a request body cannot override the token', () => {
    /**
     * A classic bypass: the handler trusts `req.body.agencyId` rather than the
     * authenticated principal. Add a case per write endpoint that accepts one.
     */
    it('POST /bookings — forged agencyId in body is ignored or rejected', async () => {
      const res = await request(app)
        .post(`${PREFIX}/bookings`)
        .set(attacker.auth)
        .send({
          agencyId: victim.id, // forged
          groupSize: 1,
          totalPrice: 100,
          trekkerEmail: 'forge@test.local',
          trekkerName: 'Forged',
        });

      if (res.status >= 400) {
        expect([400, 403, 422]).toContain(res.status);
        return;
      }

      const createdId = res.body?.id ?? res.body?.bookingId;
      expect(createdId, 'created a booking but returned no id').toBeTruthy();

      const { db } = await import('@funtush/database');
      const created = await (db as any).booking.findUnique({
        where: { id: createdId },
        select: { agencyId: true },
      });

      expect(
        created?.agencyId,
        'BYPASS: handler trusted body.agencyId over the authenticated agency'
      ).toBe(attacker.id);
    });
  });
});