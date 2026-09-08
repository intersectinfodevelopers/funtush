import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index';
import { db } from '@funtush/database';

/**
 * Week 6 Day 4 — Tenant Isolation
 *
 * The single most important security test in the codebase: agency A must never
 * see agency B's data through any endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDIT ONLY THE CONFIG BLOCK BELOW.
 *
 * The test bodies are generic and iterate over the config, so adding coverage
 * for a new endpoint is one line, not one test.
 *
 * Fill `ENDPOINTS` from your real routes:
 *   Select-String -Path src\routes\*.ts -Pattern "router\.(get|post|patch|delete)"
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — edit this, not the tests
// ═══════════════════════════════════════════════════════════════════════════

interface EndpointCase {
  /** Label in test output. */
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  /** `:id` is replaced with the *other* agency's resource id. */
  path: string;
  /** Body for write methods. `__OTHER_AGENCY__` is replaced with agency B's id. */
  body?: Record<string, unknown>;
  /**
   * 'resource' — path targets a single record owned by the other agency.
   * 'list'     — path returns a collection that must be scoped to the caller.
   */
  kind: 'resource' | 'list';
  /** For 'list': the field on each row carrying the owning agency id. */
  ownerField?: string;
}

/** Week 4–6 endpoints. Replace with your actual routes. */
const ENDPOINTS: EndpointCase[] = [
  // ── Week 5: fraud detection ──────────────────────────────────────────────
  { name: 'fraud summary',        method: 'get',  path: '/fraud-detection/summary/:id',   kind: 'resource' },
  { name: 'fingerprints byagency',method: 'get',  path: '/fingerprint/agency/:id',        kind: 'resource' },
  { name: 'fraud flags by agency',method: 'get',  path: '/fingerprint/fraud-flags/:id',   kind: 'resource' },
  { name: 'fraud review',         method: 'post', path: '/fingerprint/review/:id',        kind: 'resource', body: { decision: 'dismiss' } },

  // ── Week 4: bookings & payments ──────────────────────────────────────────
  { name: 'booking detail',       method: 'get',  path: '/bookings/:id',                  kind: 'resource' },
  { name: 'booking list',         method: 'get',  path: '/bookings',                      kind: 'list', ownerField: 'agencyId' },
  { name: 'payment detail',       method: 'get',  path: '/payments/:id',                  kind: 'resource' },

  // ── Week 6: monitoring-adjacent ──────────────────────────────────────────
  { name: 'branch report',        method: 'get',  path: '/branch/reports/:id',            kind: 'resource' },

  // ── Add the rest of your Week 4–6 routes here ────────────────────────────
];

/** Route prefix, e.g. '' if your routes mount at root, '/api' if under /api. */
const PREFIX = '/api';

/**
 * Build an auth header for an agency.
 * REPLACE with however your app authenticates — a signed JWT, a session
 * cookie, a test-only header. This is the one thing that must match your app.
 */
function authFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

let agencyA = { id: '', token: '' };
let agencyB = { id: '', token: '' };

/** Resource ids owned by agency B, keyed loosely by endpoint name. */
const agencyBResources: Record<string, string> = {};

beforeAll(async () => {
  // REPLACE: create two agencies with real users and mint real tokens.
  // Using your existing test helpers is better than hand-rolling here —
  // look for a createTestAgency / signTestToken utility in src/test/.
  //
  // The shape you need:
  //   agencyA = { id, token }   // caller
  //   agencyB = { id, token }   // victim — owns every resource under test
  //
  // Example sketch:
  //
  // const a = await createTestAgency({ name: 'Agency A' });
  // const b = await createTestAgency({ name: 'Agency B' });
  // agencyA = { id: a.id, token: await signTestToken(a.adminUserId, a.id) };
  // agencyB = { id: b.id, token: await signTestToken(b.adminUserId, b.id) };
  //
  // const booking = await createTestBooking({ agencyId: b.id });
  // agencyBResources['booking detail'] = booking.id;

  throw new Error(
    'Tenant isolation fixtures not wired up. Fill in beforeAll with your ' +
    'agency/token factories before running this suite.'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — generic, driven by CONFIG
// ═══════════════════════════════════════════════════════════════════════════

describe('Day 4 — Tenant isolation across Week 4–6 endpoints', () => {
  const resourceCases = ENDPOINTS.filter((e) => e.kind === 'resource');
  const listCases = ENDPOINTS.filter((e) => e.kind === 'list');

  describe('cross-agency resource access is denied', () => {
    resourceCases.forEach((ep) => {
      it(`${ep.method.toUpperCase()} ${ep.path} — agency A cannot reach agency B's record`, async () => {
        const resourceId = agencyBResources[ep.name] ?? agencyB.id;
        const url = PREFIX + ep.path.replace(':id', resourceId);

        const body = ep.body
          ? JSON.parse(JSON.stringify(ep.body).replace(/__OTHER_AGENCY__/g, agencyB.id))
          : undefined;

        const res = await request(app)
          [ep.method](url)
          .set(authFor(agencyA.token))
          .send(body);

        // 404 is preferable to 403 — it does not confirm the record exists.
        // Both are acceptable; 200 is a breach.
        expect(
          res.status,
          `${ep.name}: expected 403/404, got ${res.status}. ` +
          `Body: ${JSON.stringify(res.body).slice(0, 200)}`
        ).not.toBe(200);

        expect([401, 403, 404]).toContain(res.status);
      });
    });
  });

  describe('list endpoints are scoped to the caller', () => {
    listCases.forEach((ep) => {
      it(`${ep.method.toUpperCase()} ${ep.path} — returns no rows owned by another agency`, async () => {
        const res = await request(app)
          [ep.method](PREFIX + ep.path)
          .set(authFor(agencyA.token));

        expect(res.status).toBe(200);

        // Tolerate {data: []}, {items: []}, or a bare array.
        const rows: unknown[] =
          (Array.isArray(res.body) && res.body) ||
          res.body?.data ||
          res.body?.items ||
          res.body?.results ||
          [];

        const field = ep.ownerField ?? 'agencyId';
        const foreign = (rows as Record<string, unknown>[]).filter(
          (row) => row[field] !== undefined && row[field] !== agencyA.id
        );

        expect(
          foreign,
          `${ep.name}: ${foreign.length} row(s) belong to another agency. ` +
          `First: ${JSON.stringify(foreign[0] ?? {}).slice(0, 200)}`
        ).toHaveLength(0);
      });
    });
  });

  describe('unauthenticated access is rejected', () => {
    ENDPOINTS.forEach((ep) => {
      it(`${ep.method.toUpperCase()} ${ep.path} — requires auth`, async () => {
        const url = PREFIX + ep.path.replace(':id', agencyB.id);
        const res = await request(app)[ep.method](url).send(ep.body);

        expect([401, 403]).toContain(res.status);
      });
    });
  });

  describe('agency id in the body cannot override the token', () => {
    /**
     * A classic bypass: the handler trusts `req.body.agencyId` instead of the
     * authenticated principal. Any write endpoint accepting an agencyId is a
     * candidate. Add cases here as you find them.
     */
    it('rejects or ignores a forged agencyId in the request body', async () => {
      const res = await request(app)
        .post(`${PREFIX}/bookings`)
        .set(authFor(agencyA.token))
        .send({
          agencyId: agencyB.id, // forged
          packageId: 'pkg-test',
          participants: 1,
        });

      if (res.status === 201 || res.status === 200) {
        const created = await db.booking.findUnique({
          where: { id: res.body.id ?? res.body.bookingId },
          select: { agencyId: true },
        });
        expect(
          created?.agencyId,
          'Handler trusted body.agencyId over the authenticated agency'
        ).toBe(agencyA.id);
      } else {
        expect([400, 403]).toContain(res.status);
      }
    });
  });
});