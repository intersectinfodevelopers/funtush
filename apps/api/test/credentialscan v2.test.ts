import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';

/**
 * Week 6 Day 4 — Credential Leak Scanner (v2)
 *
 * Static analysis. No server, no database — safe in the default test run.
 *
 * v2 fixes two bugs in v1:
 *   - the bulk-dump regex matched the *word* `req`/`payload` anywhere in a log
 *     call, so `console.log("x", req.agencyId)` was flagged as an object dump.
 *     It now only fires on a bare object with no property access.
 *   - the schema path was resolved with a fixed number of `..` hops, which
 *     broke depending on where the test file lives. It now walks up looking
 *     for the repo root.
 */

// ── Path resolution ─────────────────────────────────────────────────────────

/** Walk up from `start` until a directory containing `marker` is found. */
function findUp(marker: string, start: string = __dirname): string | null {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findUp('pnpm-workspace.yaml') ?? findUp('packages') ?? process.cwd();
const API_ROOT = findUp('package.json') ?? process.cwd();
const SRC_ROOT = existsSync(join(API_ROOT, 'src')) ? join(API_ROOT, 'src') : API_ROOT;
const SCHEMA_PATH = join(REPO_ROOT, 'packages', 'database', 'prisma', 'schema.prisma');

// ── Scan configuration ──────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage',
  'test', 'tests', '__tests__', 'perf',
]);

/** Field names that must never reach a log sink. */
const SENSITIVE_FIELDS = [
  'cvv', 'cvc', 'cardNumber', 'card_number', 'pan',
  'expiryMonth', 'expiryYear', 'securityCode',
  'secretKey', 'secret_key', 'privateKey', 'private_key',
  'apiSecret', 'api_secret', 'clientSecret', 'client_secret',
  'password', 'passwordHash', 'accessToken', 'refreshToken',
];

const LOG_SINK = /(?:console\.(?:log|error|warn|info|debug|trace)|logger\.(?:log|error|warn|info|debug)|process\.stdout\.write)\s*\(/;

/**
 * A real object dump: the identifier appears as a whole argument, with no
 * `.property` after it. The negative lookahead for `.` and `[` is what v1
 * was missing.
 *
 * Fires on:      console.log(req.body)      console.log("x:", payload)
 * Does not fire: console.log("x", req.agencyId)   `${payload.agencyId}`
 */
const BULK_DUMP = new RegExp(
  String.raw`(?:console\.\w+|logger\.\w+)\s*\([^)]*?\b(req\.body|req\.headers|req|payload|paymentData|chargeData|webhookBody|body)\b(?!\s*[.\[])`,
);

/** Template-literal interpolation of a bare object, e.g. `${payload}`. */
const TEMPLATE_DUMP = /\$\{\s*(req\.body|req|payload|body|paymentData)\s*\}/;

interface Finding {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);

    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|js)$/.test(entry) && !/\.(test|spec|d)\.ts$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function scan() {
  const sensitiveInLogs: Finding[] = [];
  const bulkDumps: Finding[] = [];

  for (const file of walk(SRC_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (isComment(line)) return;

      const record = (reason: string): Finding => ({
        file: relative(API_ROOT, file),
        line: index + 1,
        text: line.trim().slice(0, 120),
        reason,
      });

      if (LOG_SINK.test(line)) {
        const hit = SENSITIVE_FIELDS.find((f) => new RegExp(`\\b${f}\\b`, 'i').test(line));
        if (hit) sensitiveInLogs.push(record(`logs sensitive field: ${hit}`));

        if (BULK_DUMP.test(line)) bulkDumps.push(record('logs a bare request/payload object'));
        else if (TEMPLATE_DUMP.test(line)) bulkDumps.push(record('interpolates a bare object into a log string'));
      }
    });
  }

  return { sensitiveInLogs, bulkDumps };
}

function report(title: string, findings: Finding[]) {
  if (findings.length === 0) {
    console.log(`  ✓ ${title}: none`);
    return;
  }
  console.log(`\n  ✗ ${title}: ${findings.length}`);
  findings.forEach((f) => {
    console.log(`    ${f.file}:${f.line}  — ${f.reason}`);
    console.log(`      ${f.text}`);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Day 4 — Credential handling (static scan)', () => {
  const { sensitiveInLogs, bulkDumps } = scan();

  it('resolves the paths it needs', () => {
    console.log(`  scanning:  ${SRC_ROOT}`);
    console.log(`  repo root: ${REPO_ROOT}`);
    expect(existsSync(SRC_ROOT)).toBe(true);
  });

  it('never passes payment or secret fields to a log sink', () => {
    report('Sensitive fields in log calls', sensitiveInLogs);
    expect(sensitiveInLogs).toEqual([]);
  });

  it('never logs a bare request body or payment payload', () => {
    report('Bare object dumps', bulkDumps);
    expect(bulkDumps).toEqual([]);
  });
});

describe('Day 4 — Credential storage (schema scan)', () => {
  const FORBIDDEN = [/\bcvv\b/i, /\bcvc\b/i, /\bcardNumber\b/i, /\bcard_number\b/i, /\bsecurityCode\b/i, /\bfullPan\b/i];

  function loadSchema(): string | null {
    try {
      return readFileSync(SCHEMA_PATH, 'utf8');
    } catch {
      console.log(`  ! schema not found at ${SCHEMA_PATH}`);
      return null;
    }
  }

  it('stores no raw cardholder data', () => {
    const schema = loadSchema();
    expect(schema, `schema.prisma not found — checked ${SCHEMA_PATH}`).not.toBeNull();
    if (!schema) return;

    const hits = schema
      .split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => !line.startsWith('//'))
      .filter(({ line }) => FORBIDDEN.some((re) => re.test(line)));

    hits.forEach((h) => console.log(`  ✗ schema.prisma:${h.no}  ${h.line}`));
    expect(hits).toEqual([]);
  });

  it('stores API keys as hashes rather than plaintext', () => {
    const schema = loadSchema();
    if (!schema) return;

    const model = schema.match(/model\s+ApiKey\s*\{[^}]*\}/s)?.[0];
    if (!model) {
      console.log('  ! no ApiKey model found — skipping');
      return;
    }

    const hashed = /hash|digest/i.test(model);
    if (!hashed) {
      console.log('  ✗ ApiKey model has no hash/digest column:');
      console.log(model.split('\n').map((l) => `      ${l}`).join('\n'));
    }
    expect(hashed).toBe(true);
  });
});