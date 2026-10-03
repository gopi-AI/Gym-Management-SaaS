#!/usr/bin/env node
'use strict';

/**
 * API / integration gate (Phase 3 sign-off, deliverable D15).
 *
 * WHY THIS EXISTS
 * ---------------
 * The unit suite mocks every repository and the three `*.integration.spec.ts`
 * files drive services directly, so nothing in this repository boots the real
 * application and speaks HTTP to it. That gap has a real failure mode: a route
 * can be perfectly correct in a mocked spec and still be unreachable in the
 * assembled app (a mis-wired guard, a tenant-context field that is never set,
 * a missing permission row). The owner ruling of 2026-10-01 required an
 * API/integration gate for exactly this reason: "boot the app, apply
 * migrations, exercise the new endpoints including cross-org rejection;
 * browser E2E is not required."
 *
 * WHAT IT DOES
 * ------------
 * 1. Refuses to run unless it is wrapped by `scripts/dev-db-env.sh`, so the
 *    loopback + published-port guard always applies. It re-execs itself
 *    through the wrapper when the sentinel is absent.
 * 2. Creates a throwaway database (`gym_gate_<runid>`) and a scratch Redis
 *    index. The development database (`DB_DATABASE`) can never be opened by
 *    this process — `connect()` refuses it.
 * 3. Boots the REAL entrypoint (`src/main.ts`, ts-node) with
 *    `DB_MIGRATIONS_RUN=true`, applying all migrations from zero.
 * 4. Seeds one organization through the documented dev flow
 *    (register -> bootstrap:dev -> login) and a second, genuine tenant via a
 *    direct membership insert (no HTTP route links a user to an organization).
 * 5. Runs a table of HTTP checks across every Phase 3 module — including the
 *    negative paths (401/403/400/404/409) that prove tenant isolation.
 * 6. Prints a per-check report and exits non-zero when any check fails.
 * 7. Always tears the scratch database and Redis index down (`--keep` /
 *    `--keep-on-failure` opt out).
 *
 * The negative checks assert a *discriminating message fragment*, not just the
 * status code, so a 403 returned for the wrong reason cannot pass as a
 * tenant-isolation proof.
 *
 * USAGE
 * -----
 *   scripts/dev-db-env.sh node scripts/api-gate.js            # the normal run
 *   node scripts/api-gate.js                                  # self-wraps the guard
 *   node scripts/api-gate.js --list-checks                    # inventory, no DB
 *   node scripts/api-gate.js --only=inventory,webhook         # selected groups
 *   node scripts/api-gate.js --keep-on-failure                # forensics
 *
 * EXIT CODES
 * ----------
 *   0   every selected check passed
 *   1   the gate ran and at least one check failed
 *   2   refused to run (unsafe target, bad scratch name, database/Redis guard)
 *   3   could not run (Postgres/Redis unreachable, boot, seed or migrations failed)
 *   4   unexpected internal error
 *   64  usage error (unknown flag or group)
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, 'scripts', 'dev-db-env.sh');
const TS_NODE = path.join(ROOT, 'node_modules', '.bin', 'ts-node');
const SENTINEL = 'GYM_API_GATE_GUARDED';
const SCRATCH_RE = /^gym_gate_[a-z0-9_]{1,40}$/;
const MIGRATIONS_DIR = path.join(ROOT, 'src', 'migrations');

/** Every worker is forced OFF: a polling worker racing the checks is not a check. */
const WORKER_NAMES = [
  'OUTBOX',
  'MEMBERSHIP_EXPIRY',
  'PAYMENT_RETRY',
  'DUNNING',
  'WEBHOOK',
  'EXPIRY',
  'CRM_FOLLOW_UPS',
  'CRM_SLA_MONITOR',
];

const GROUPS = ['seed', 'boot', 'auth', 'tenancy', 'inventory', 'finance', 'crm', 'pt', 'webhook'];

const EXIT = { OK: 0, CHECK_FAILED: 1, REFUSED: 2, CANT_RUN: 3, INTERNAL: 4, USAGE: 64 };

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const USAGE = `api-gate — boot the API on a throwaway database and exercise it over HTTP.

Usage: scripts/dev-db-env.sh node scripts/api-gate.js [options]

Options:
  --only=a,b        run only these check groups: ${GROUPS.join(', ')}
  --skip=a,b        skip these check groups
  --keep            keep the scratch database and Redis index afterwards
  --keep-on-failure keep them only when the run fails
  --scratch-name=n  reuse an explicit gym_gate_* database name
  --redis-db=n      scratch Redis database index (default 15)
  --port=n          API port (default: an ephemeral free port)
  --env-path=path   environment file for the guard (default <repo>/.env)
  --built           boot dist/main.js instead of ts-node (run npm run build first)
  --boot-timeout-ms=n  readiness deadline (default 90000)
  --http-timeout-ms=n  per-request deadline (default 15000)
  --log=path        capture the app's stdout/stderr (default a temp file)
  --verbose         stream the app's output live
  --json            emit one JSON report document
  --list-checks     print the check inventory and exit (no database access)
  --help            this text

Exit codes: 0 ok | 1 check failed | 2 refused | 3 could not run | 4 internal | 64 usage`;

function parseArgs(argv) {
  const opts = {
    only: [],
    skip: [],
    keep: false,
    keepOnFailure: false,
    scratchName: null,
    redisDb: 15,
    port: null,
    envFile: path.join(ROOT, '.env'),
    built: false,
    bootTimeoutMs: 90_000,
    httpTimeoutMs: 15_000,
    log: null,
    verbose: false,
    json: false,
    listChecks: false,
    help: false,
  };
  // Value-taking flags accept both `--flag=value` and `--flag value`, because the
  // sibling guard (`scripts/dev-db-env.sh`) uses the space form and this script is
  // documented next to it.
  const VALUE_FLAGS = new Set([
    '--only',
    '--skip',
    '--scratch-name',
    '--redis-db',
    '--port',
    '--env-path',
    '--boot-timeout-ms',
    '--http-timeout-ms',
    '--log',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let flag;
    let value;
    if (arg.includes('=')) {
      flag = arg.slice(0, arg.indexOf('='));
      value = arg.slice(arg.indexOf('=') + 1);
    } else {
      flag = arg;
      if (VALUE_FLAGS.has(flag)) {
        value = argv[index + 1];
        if (value === undefined) {
          throw Object.assign(new Error(`${flag} needs a value`), { usage: true });
        }
        index += 1;
      }
    }
    const groups = (v) =>
      String(v || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    switch (flag) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--list-checks':
        opts.listChecks = true;
        break;
      case '--only':
        opts.only = groups(value);
        break;
      case '--skip':
        opts.skip = groups(value);
        break;
      case '--keep':
        opts.keep = true;
        break;
      case '--keep-on-failure':
        opts.keepOnFailure = true;
        break;
      case '--scratch-name':
        opts.scratchName = value;
        break;
      case '--redis-db':
        opts.redisDb = Number(value);
        break;
      case '--port':
        opts.port = Number(value);
        break;
      case '--env-path':
        // NOT `--env-file`: that is a Node.js built-in option. Node would load the
        // file itself (exiting 9 when it is missing, outside this script's exit
        // contract) and could inject DB_* into the process behind the guard's back.
        opts.envFile = path.resolve(value);
        break;
      case '--built':
        opts.built = true;
        break;
      case '--boot-timeout-ms':
        opts.bootTimeoutMs = Number(value);
        break;
      case '--http-timeout-ms':
        opts.httpTimeoutMs = Number(value);
        break;
      case '--log':
        opts.log = path.resolve(value);
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        throw Object.assign(new Error(`unknown option: ${arg}`), { usage: true });
    }
  }
  for (const g of [...opts.only, ...opts.skip]) {
    if (!GROUPS.includes(g)) {
      throw Object.assign(new Error(`unknown group "${g}" (expected one of: ${GROUPS.join(', ')})`), {
        usage: true,
      });
    }
  }
  if (opts.scratchName && !SCRATCH_RE.test(opts.scratchName)) {
    throw Object.assign(
      new Error(
        `--scratch-name "${opts.scratchName}" must match ${SCRATCH_RE} — the gate only ever ` +
          'creates or drops databases in the gym_gate_* namespace',
      ),
      { refused: true },
    );
  }
  if (!Number.isInteger(opts.redisDb) || opts.redisDb < 0 || opts.redisDb > 15) {
    throw Object.assign(new Error('--redis-db must be an integer 0..15'), { usage: true });
  }
  return opts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (n) => crypto.randomBytes(n).toString('hex');
const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1'].includes(String(host || ''));

function migrationFileCount() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{13}-.*\.ts$/.test(name)).length;
}

/**
 * The worker tick-interval floor, read from its source of truth —
 * `MIN_WORKER_INTERVAL_MS` in `src/shared/workers/worker-config.ts` — rather than
 * copied here, so the gate can never set an interval the app would clamp.
 */
function minWorkerIntervalMs() {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'shared', 'workers', 'worker-config.ts'),
    'utf8',
  );
  const match = source.match(/export const MIN_WORKER_INTERVAL_MS = ([\d_]+);/);
  if (!match) {
    throw new Error('could not read MIN_WORKER_INTERVAL_MS from src/shared/workers/worker-config.ts');
  }
  return Number(match[1].replace(/_/g, ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// The check table
// ─────────────────────────────────────────────────────────────────────────────

const checks = [];
const check = (def) => {
  checks.push(def);
  return def;
};

/**
 * Verdict helper: `ok` decides PASS/FAIL; `evidence` is printed and stored.
 * `values` are merged into the fixture context for later checks.
 */
const verdict = (ok, evidence, values) => ({
  status: ok ? 'PASS' : 'FAIL',
  evidence: String(evidence),
  values,
});
const fragment = (result) => {
  const body = result.body;
  if (body && typeof body === 'object') {
    const message = body.message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
  }
  return (result.text || '').slice(0, 160);
};
const hasFragment = (result, needle) => fragment(result).includes(needle);
const bodyHas = (result, needle) => JSON.stringify(result.body ?? '').includes(needle);

async function call(ctx, { method, path: urlPath, token, org, body, rawBody, headers = {} }) {
  const h = { ...headers };
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (org) h['X-Organization-Id'] = org;
  const response = await fetch(`${ctx.baseUrl}${urlPath}`, {
    method,
    headers: h,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ctx.httpTimeoutMs),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed, text };
}

// ── seed: the fixtures everything else depends on ────────────────────────────
// Order matters: register -> bootstrap:dev -> login -> branch, then tenant B.

check({
  id: 'seed-01',
  group: 'seed',
  title: 'register user A',
  fatal: true,
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/auth/register',
      body: {
        email: ctx.userAEmail,
        password: ctx.userAPassword,
        first_name: 'Gate',
        last_name: 'Owner',
      },
    });
    return verdict(r.status === 201, `POST /v1/auth/register -> ${r.status}`, undefined);
  },
});

check({
  id: 'seed-02',
  group: 'seed',
  title: 'bootstrap:dev seeds permissions, owner role, org, membership',
  fatal: true,
  provides: ['bootstrapped'],
  run: async (ctx) => {
    const result = await ctx.runBootstrap();
    return verdict(
      result.code === 0,
      result.code === 0
        ? 'bootstrap:dev exit 0'
        : `bootstrap:dev exit ${result.code}: ${result.tail}`,
      { bootstrapped: true },
    );
  },
});

check({
  id: 'seed-03',
  group: 'seed',
  title: 'login user A',
  fatal: true,
  provides: ['tokenA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/auth/login',
      body: { email: ctx.userAEmail, password: ctx.userAPassword },
    });
    const token = r.body && r.body.accessToken;
    return verdict(
      r.status === 200 && Boolean(token),
      `POST /v1/auth/login -> ${r.status}`,
      token ? { tokenA: token } : undefined,
    );
  },
});

check({
  id: 'seed-04',
  group: 'seed',
  title: 'organization A is reachable',
  fatal: true,
  requires: ['tokenA', 'bootstrapped'],
  provides: ['orgA'],
  run: async (ctx) => {
    const r = await call(ctx, { method: 'GET', path: '/v1/organizations', token: ctx.tokenA });
    const org = Array.isArray(r.body) ? r.body.find((o) => o.name === 'Development Gym') : undefined;
    return verdict(
      r.status === 200 && Boolean(org),
      `GET /v1/organizations -> ${r.status}, Development Gym ${org ? 'found' : 'MISSING'}`,
      org ? { orgA: org.id } : undefined,
    );
  },
});

check({
  id: 'seed-05',
  group: 'seed',
  title: 'create branch A',
  fatal: true,
  requires: ['tokenA', 'orgA'],
  provides: ['branchA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/branches',
      token: ctx.tokenA,
      org: ctx.orgA,
      // address/phone are NOT NULL columns on BRANCHES; the DTO marks them
      // optional, so omitting them is an unhandled 500 (filed as DEF-03). A real
      // client sends them, and so does this fixture.
      body: {
        organization_id: ctx.orgA,
        name: `Gate Branch ${ctx.runId}`,
        address: '1 Gate Street',
        phone: '+1-555-0100',
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/branches -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { branchA: id } : undefined,
    );
  },
});

check({
  id: 'seed-06',
  group: 'seed',
  title: 'register user B',
  fatal: true,
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/auth/register',
      body: {
        email: ctx.userBEmail,
        password: ctx.userBPassword,
        first_name: 'Gate',
        last_name: 'TenantB',
      },
    });
    return verdict(r.status === 201, `POST /v1/auth/register (B) -> ${r.status}`);
  },
});

check({
  id: 'seed-07',
  group: 'seed',
  title: 'create organization B (a real second tenant)',
  fatal: true,
  requires: ['tokenA', 'bootstrapped'],
  provides: ['orgB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/organizations',
      token: ctx.tokenA,
      body: {
        name: `Gate Tenant B ${ctx.runId}`,
        timezone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/organizations -> ${r.status}`,
      id ? { orgB: id } : undefined,
    );
  },
});

check({
  id: 'seed-08',
  group: 'seed',
  title: 'create organization C (non-member org for the 403 path)',
  fatal: true,
  requires: ['tokenA', 'bootstrapped'],
  provides: ['orgC'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/organizations',
      token: ctx.tokenA,
      body: {
        name: `Gate Tenant C ${ctx.runId}`,
        timezone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/organizations -> ${r.status}`,
      id ? { orgC: id } : undefined,
    );
  },
});

check({
  id: 'seed-09',
  group: 'seed',
  title: "seed user B's owner role and org-B membership (no HTTP route exists)",
  fatal: true,
  requires: ['orgB'],
  run: async (ctx) => {
    const result = await ctx.grantOwnerMembership(ctx.userBEmail, ctx.orgB);
    return verdict(result.ok, result.evidence);
  },
});

check({
  id: 'seed-10',
  group: 'seed',
  title: 'login user B',
  fatal: true,
  provides: ['tokenB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/auth/login',
      body: { email: ctx.userBEmail, password: ctx.userBPassword },
    });
    const token = r.body && r.body.accessToken;
    return verdict(
      r.status === 200 && Boolean(token),
      `POST /v1/auth/login (B) -> ${r.status}`,
      token ? { tokenB: token } : undefined,
    );
  },
});

check({
  id: 'seed-11',
  group: 'seed',
  title: 'create branch B as user B (proves the membership is genuine)',
  fatal: true,
  requires: ['tokenB', 'orgB'],
  provides: ['branchB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/branches',
      token: ctx.tokenB,
      org: ctx.orgB,
      body: {
        organization_id: ctx.orgB,
        name: `Gate Branch B ${ctx.runId}`,
        address: '2 Gate Street',
        phone: '+1-555-0200',
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/branches (B) -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { branchB: id } : undefined,
    );
  },
});

// ── boot ─────────────────────────────────────────────────────────────────────
check({
  id: 'boot-01',
  group: 'boot',
  title: 'GET /v1/health is public and ok',
  run: async (ctx) => {
    const r = await call(ctx, { method: 'GET', path: '/v1/health' });
    return verdict(
      r.status === 200 && r.body && r.body.status === 'ok',
      `GET /v1/health -> ${r.status} status=${r.body && r.body.status}`,
    );
  },
});

check({
  id: 'boot-02',
  group: 'boot',
  title: 'every migration applied on the fresh database',
  run: async (ctx) => {
    const expected = migrationFileCount();
    const rows = await ctx.queryScratch('SELECT count(*)::int AS n FROM typeorm_migrations');
    const actual = rows[0] && rows[0].n;
    return verdict(actual === expected, `typeorm_migrations rows=${actual}, files=${expected}`);
  },
});

// ── auth ─────────────────────────────────────────────────────────────────────
check({
  id: 'auth-01',
  group: 'auth',
  title: 'wrong password is rejected',
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/auth/login',
      body: { email: ctx.userAEmail, password: 'definitely-wrong' },
    });
    return verdict(r.status === 401, `POST /v1/auth/login (wrong password) -> ${r.status}`);
  },
});

check({
  id: 'auth-02',
  group: 'auth',
  title: 'no token on a protected route is 401',
  run: async (ctx) => {
    const r = await call(ctx, { method: 'GET', path: '/v1/inventory/suppliers' });
    return verdict(r.status === 401, `GET /v1/inventory/suppliers (no token) -> ${r.status}`);
  },
});

check({
  id: 'auth-03',
  group: 'auth',
  title: 'malformed bearer token is 401',
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/inventory/suppliers',
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    return verdict(r.status === 401, `GET /v1/inventory/suppliers (bad token) -> ${r.status}`);
  },
});

// ── tenancy ──────────────────────────────────────────────────────────────────
check({
  id: 'ten-01',
  group: 'tenancy',
  title: 'a tenant route without X-Organization-Id is refused',
  requires: ['tokenA'],
  run: async (ctx) => {
    const r = await call(ctx, { method: 'GET', path: '/v1/branches', token: ctx.tokenA });
    return verdict(
      r.status === 403 && hasFragment(r, 'Organization context required'),
      `GET /v1/branches (no org header) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'ten-02',
  group: 'tenancy',
  title: "a non-member organization is refused (X-Organization-Id is a request, not proof)",
  requires: ['tokenA', 'orgC'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/branches',
      token: ctx.tokenA,
      org: ctx.orgC,
    });
    return verdict(
      r.status === 403 && hasFragment(r, 'Access to this organization is not allowed'),
      `GET /v1/branches (non-member org) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'ten-03',
  group: 'tenancy',
  title: "another tenant's branch id is refused",
  requires: ['tokenA', 'orgA', 'branchB', 'tokenB'],
  run: async (ctx) => {
    // A is authorized for orgA; branchB belongs to orgB. The branch check must
    // fail with the branch-specific message, not a generic 403.
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/items?branch_id=${encodeURIComponent(ctx.branchB)}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 403 && hasFragment(r, 'Access to this branch is not allowed'),
      `GET /v1/inventory/items?branch_id=<org B branch> -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'ten-04',
  group: 'tenancy',
  title: 'creating a branch without address or phone is a 400, not a 500',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    // DEF-03: address/phone are NOT NULL on TENANCY_BRANCHES and are now required
    // by the DTO, so an omission must be refused by the ValidationPipe (400 naming
    // the field) instead of reaching the database and surfacing as a 500.
    const post = (body) =>
      call(ctx, { method: 'POST', path: '/v1/branches', token: ctx.tokenA, org: ctx.orgA, body });
    const base = { organization_id: ctx.orgA, name: `Gate Branch DEF-03 ${ctx.runId}` };
    // Each request omits exactly ONE field, so the 400 can only be explained by
    // that field being required.
    const missingAddress = await post({ ...base, phone: '+1-555-0100' });
    const missingPhone = await post({ ...base, address: '1 Gate Street' });
    const complete = await post({ ...base, address: '1 Gate Street', phone: '+1-555-0100' });
    return verdict(
      missingAddress.status === 400 &&
        hasFragment(missingAddress, 'address') &&
        missingPhone.status === 400 &&
        hasFragment(missingPhone, 'phone') &&
        complete.status === 201,
      `POST /v1/branches: no address -> ${missingAddress.status} "${fragment(missingAddress)}"; ` +
        `no phone -> ${missingPhone.status} "${fragment(missingPhone)}"; complete -> ${complete.status}`,
    );
  },
});

// ── inventory (P3-05 / OI-1 / OI-2) ─────────────────────────────────────────
check({
  id: 'inv-01',
  group: 'inventory',
  title: 'create supplier',
  requires: ['tokenA', 'orgA'],
  provides: ['supplierA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/suppliers',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { name: `Gate Supplier ${ctx.runId}` },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/inventory/suppliers -> ${r.status}`,
      id ? { supplierA: id } : undefined,
    );
  },
});

check({
  id: 'inv-02',
  group: 'inventory',
  title: 'create item in branch A',
  requires: ['tokenA', 'orgA', 'branchA'],
  provides: ['itemA', 'skuA'],
  run: async (ctx) => {
    const sku = `GATE-${ctx.runId}-A`;
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/items',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { branch_id: ctx.branchA, name: 'Gate Item A', sku },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/inventory/items -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { itemA: id, skuA: sku } : undefined,
    );
  },
});

check({
  id: 'inv-03',
  group: 'inventory',
  title: 'duplicate SKU in the same branch is 409, not 500',
  requires: ['tokenA', 'orgA', 'branchA', 'skuA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/items',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { branch_id: ctx.branchA, name: 'Gate Item A duplicate', sku: ctx.skuA },
    });
    return verdict(
      r.status === 409 && hasFragment(r, 'already exists'),
      `POST /v1/inventory/items (same SKU) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'inv-04',
  group: 'inventory',
  title: 'listing items without branch_id is 400 (OI-1: branch is required)',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/inventory/items',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 400, `GET /v1/inventory/items (no branch) -> ${r.status}`);
  },
});

check({
  id: 'inv-05',
  group: 'inventory',
  title: 'branch-scoped item list contains the item',
  requires: ['tokenA', 'orgA', 'branchA', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/items?branch_id=${encodeURIComponent(ctx.branchA)}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 200 && bodyHas(r, ctx.itemA),
      `GET /v1/inventory/items?branch_id=<A> -> ${r.status}, contains item=${bodyHas(r, ctx.itemA)}`,
    );
  },
});

check({
  id: 'inv-06',
  group: 'inventory',
  title: 'item by id (control: same org, same branch)',
  requires: ['tokenA', 'orgA', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/items/${ctx.itemA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/inventory/items/:id -> ${r.status}`);
  },
});

check({
  id: 'inv-07',
  group: 'inventory',
  title: 'PATCH price applies money formatting',
  requires: ['tokenA', 'orgA', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'PATCH',
      path: `/v1/inventory/items/${ctx.itemA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { selling_price: 12.5 },
    });
    const value = r.body && r.body.selling_price;
    return verdict(r.status === 200 && value === '12.50', `PATCH -> ${r.status} selling_price=${value}`);
  },
});

check({
  id: 'inv-08',
  group: 'inventory',
  title: 'create an item in tenant B',
  requires: ['tokenB', 'orgB', 'branchB'],
  provides: ['itemB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/items',
      token: ctx.tokenB,
      org: ctx.orgB,
      body: { branch_id: ctx.branchB, name: 'Gate Item B', sku: `GATE-${ctx.runId}-B` },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/inventory/items (B) -> ${r.status}`,
      id ? { itemB: id } : undefined,
    );
  },
});

check({
  id: 'inv-09',
  group: 'inventory',
  title: "tenant A cannot read tenant B's item (cross-org 404)",
  requires: ['tokenA', 'orgA', 'itemB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/items/${ctx.itemB}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 404 && hasFragment(r, 'Inventory item not found'),
      `GET /v1/inventory/items/<B item> as A -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'inv-10',
  group: 'inventory',
  title: "tenant B cannot read tenant A's item (reverse direction)",
  requires: ['tokenB', 'orgB', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/items/${ctx.itemA}`,
      token: ctx.tokenB,
      org: ctx.orgB,
    });
    return verdict(
      r.status === 404 && hasFragment(r, 'Inventory item not found'),
      `GET /v1/inventory/items/<A item> as B -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'inv-11',
  group: 'inventory',
  title: 'create purchase order',
  requires: ['tokenA', 'orgA', 'branchA', 'supplierA', 'itemA'],
  provides: ['poA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/purchase-orders',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        branch_id: ctx.branchA,
        supplier_id: ctx.supplierA,
        items: [{ inventory_item_id: ctx.itemA, quantity_ordered: 10, unit_cost: 2.5 }],
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/inventory/purchase-orders -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { poA: id } : undefined,
    );
  },
});

check({
  id: 'inv-12',
  group: 'inventory',
  title: 'purchase order by id',
  requires: ['tokenA', 'orgA', 'poA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/purchase-orders/${ctx.poA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/inventory/purchase-orders/:id -> ${r.status}`);
  },
});

check({
  id: 'inv-13',
  group: 'inventory',
  title: 'receive the purchase order (creates a FIFO lot)',
  requires: ['tokenA', 'orgA', 'poA', 'itemA'],
  provides: ['lotNumber'],
  run: async (ctx) => {
    const lot = `LOT-${ctx.runId}`;
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/inventory/purchase-orders/${ctx.poA}/receive`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        items: [{ inventory_item_id: ctx.itemA, quantity: 10, unit_cost: 2.5, lot_number: lot }],
      },
    });
    return verdict(
      r.status === 201,
      `POST /v1/inventory/purchase-orders/:id/receive -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
      { lotNumber: lot },
    );
  },
});

check({
  id: 'inv-14',
  group: 'inventory',
  title: 'lots are listed for the branch',
  requires: ['tokenA', 'orgA', 'branchA', 'lotNumber'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/lots?branch_id=${encodeURIComponent(ctx.branchA)}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 200 && bodyHas(r, ctx.lotNumber),
      `GET /v1/inventory/lots?branch_id=<A> -> ${r.status}, contains ${ctx.lotNumber}=${bodyHas(r, ctx.lotNumber)}`,
    );
  },
});

check({
  id: 'inv-15',
  group: 'inventory',
  title: 'stock matview reflects the receipt',
  requires: ['tokenA', 'orgA', 'branchA', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/stock?branch_id=${encodeURIComponent(ctx.branchA)}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    const row = Array.isArray(r.body) ? r.body.find((x) => x.inventory_item_id === ctx.itemA) : undefined;
    return verdict(
      r.status === 200 && Boolean(row) && Number(row.quantity_on_hand) === 10,
      `GET /v1/inventory/stock?branch_id=<A> -> ${r.status}, qty=${row && row.quantity_on_hand}`,
    );
  },
});

check({
  id: 'inv-16',
  group: 'inventory',
  title: 'FIFO consume writes a transaction',
  requires: ['tokenA', 'orgA', 'branchA', 'itemA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/inventory/transactions/consume',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { branch_id: ctx.branchA, inventory_item_id: ctx.itemA, quantity: 4 },
    });
    return verdict(
      r.status === 201,
      `POST /v1/inventory/transactions/consume -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'inv-17',
  group: 'inventory',
  title: 'listing purchase orders without branch_id is 400 (OI-2)',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/inventory/purchase-orders',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 400, `GET /v1/inventory/purchase-orders (no branch) -> ${r.status}`);
  },
});

check({
  id: 'inv-18',
  group: 'inventory',
  title: 'purchase-order list is branch-scoped (OI-2)',
  requires: ['tokenA', 'orgA', 'branchA', 'poA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/inventory/purchase-orders?branch_id=${encodeURIComponent(ctx.branchA)}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 200 && bodyHas(r, ctx.poA),
      `GET /v1/inventory/purchase-orders?branch_id=<A> -> ${r.status}, contains po=${bodyHas(r, ctx.poA)}`,
    );
  },
});

// ── finance (P3-01..P3-04b, P3-08/P3-10) ────────────────────────────────────
check({
  id: 'fin-01',
  group: 'finance',
  title: 'create member fixture',
  requires: ['tokenA', 'orgA', 'branchA'],
  provides: ['memberA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/members',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { first_name: 'Gate', last_name: 'Member', branch_id: ctx.branchA },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/members -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { memberA: id } : undefined,
    );
  },
});

check({
  id: 'fin-02',
  group: 'finance',
  title: 'create invoice',
  requires: ['tokenA', 'orgA', 'memberA', 'branchA'],
  provides: ['invoiceA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/invoices',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        member_id: ctx.memberA,
        branch_id: ctx.branchA,
        line_items: [{ description: 'Gate line', quantity: 1, unit_price: 100 }],
      },
    });
    const id = r.body && r.body.invoice && r.body.invoice.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/invoices -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { invoiceA: id } : undefined,
    );
  },
});

check({
  id: 'fin-03',
  group: 'finance',
  title: 'invoice by id returns its detail',
  requires: ['tokenA', 'orgA', 'invoiceA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/invoices/${ctx.invoiceA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    const ok = r.status === 200 && r.body && r.body.invoice && Array.isArray(r.body.items);
    return verdict(ok, `GET /v1/invoices/:id -> ${r.status}, items=${r.body && r.body.items && r.body.items.length}`);
  },
});

check({
  id: 'fin-04',
  group: 'finance',
  title: 'record payment against the invoice',
  requires: ['tokenA', 'orgA', 'invoiceA'],
  provides: ['paymentA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/invoices/${ctx.invoiceA}/payments`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { amount: 100, payment_method: 'cash' },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/invoices/:id/payments -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { paymentA: id } : undefined,
    );
  },
});

check({
  id: 'fin-05',
  group: 'finance',
  title: 'refund the payment',
  requires: ['tokenA', 'orgA', 'paymentA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/payments/${ctx.paymentA}/refunds`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { amount: 20, reason: `gate ${ctx.runId}` },
    });
    return verdict(
      r.status === 201,
      `POST /v1/payments/:id/refunds -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'fin-06',
  group: 'finance',
  title: 'issue a credit note',
  requires: ['tokenA', 'orgA', 'invoiceA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/invoices/${ctx.invoiceA}/credit-notes`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { amount: 10, reason: `gate ${ctx.runId}` },
    });
    return verdict(
      r.status === 201,
      `POST /v1/invoices/:id/credit-notes -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'fin-07',
  group: 'finance',
  title: 'create a tax rate (finance:admin)',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/tax-rates',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { name: 'Gate VAT', code: `GATE${ctx.runId}`, rate: '18.00' },
    });
    return verdict(
      r.status === 201,
      `POST /v1/tax-rates -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'fin-08',
  group: 'finance',
  title: 'revenue summary (ledger view) is readable',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/financial-reports/revenue-summary',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/financial-reports/revenue-summary -> ${r.status}`);
  },
});

check({
  id: 'fin-09',
  group: 'finance',
  title: 'attach a gateway-referenced payment method',
  requires: ['tokenA', 'orgA', 'memberA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/members/${ctx.memberA}/payment-methods`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        stripe_customer_id: `cus_gate_${ctx.runId}`,
        stripe_payment_method_id: `pm_gate_${ctx.runId}`,
        card_brand: 'visa',
        card_last4: '4242',
      },
    });
    return verdict(
      r.status === 201,
      `POST /v1/members/:id/payment-methods -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'fin-10',
  group: 'finance',
  title: 'raw card data is rejected (@IsEmpty)',
  requires: ['tokenA', 'orgA', 'memberA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/members/${ctx.memberA}/payment-methods`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        card_number: '4242424242424242',
        stripe_customer_id: 'cus_x',
        stripe_payment_method_id: 'pm_x',
        card_brand: 'visa',
        card_last4: '4242',
      },
    });
    return verdict(
      r.status === 400 && hasFragment(r, 'Raw card data'),
      `POST payment-methods (card_number) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'fin-11',
  group: 'finance',
  title: "tenant B cannot read tenant A's invoice (cross-org 404)",
  requires: ['tokenB', 'orgB', 'invoiceA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/invoices/${ctx.invoiceA}`,
      token: ctx.tokenB,
      org: ctx.orgB,
    });
    return verdict(
      r.status === 404 && hasFragment(r, 'Invoice not found'),
      `GET /v1/invoices/<A invoice> as B -> ${r.status} "${fragment(r)}"`,
    );
  },
});

// ── CRM (P3-06 / P3-07) ─────────────────────────────────────────────────────
check({
  id: 'crm-01',
  group: 'crm',
  title: 'create lead',
  requires: ['tokenA', 'orgA', 'branchA'],
  provides: ['leadA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/leads',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { branch_id: ctx.branchA, first_name: 'Gate', last_name: 'Lead' },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/leads -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { leadA: id } : undefined,
    );
  },
});

check({
  id: 'crm-02',
  group: 'crm',
  title: 'lead by id',
  requires: ['tokenA', 'orgA', 'leadA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/leads/${ctx.leadA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/leads/:id -> ${r.status}`);
  },
});

check({
  id: 'crm-03',
  group: 'crm',
  title: 'log a lead activity',
  requires: ['tokenA', 'orgA', 'leadA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/leads/${ctx.leadA}/activities`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { activity_type: 'call', notes: `gate ${ctx.runId}` },
    });
    return verdict(
      r.status === 201,
      `POST /v1/leads/:id/activities -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'crm-04',
  group: 'crm',
  title: 'schedule a follow-up (in the past, so it is due)',
  requires: ['tokenA', 'orgA', 'leadA'],
  provides: ['followUpA'],
  run: async (ctx) => {
    const due = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/leads/${ctx.leadA}/follow-ups`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { follow_up_date: due },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/leads/:id/follow-ups -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { followUpA: id } : undefined,
    );
  },
});

check({
  id: 'crm-05',
  group: 'crm',
  title: 'the due queue contains the follow-up',
  requires: ['tokenA', 'orgA', 'followUpA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/follow-ups/due',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 200 && bodyHas(r, ctx.followUpA),
      `GET /v1/follow-ups/due -> ${r.status}, contains follow-up=${bodyHas(r, ctx.followUpA)}`,
    );
  },
});

check({
  id: 'crm-06',
  group: 'crm',
  title: 'complete the follow-up',
  requires: ['tokenA', 'orgA', 'followUpA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/follow-ups/${ctx.followUpA}/complete`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { outcome: 'Reached by phone' },
    });
    return verdict(
      r.status === 201,
      `POST /v1/follow-ups/:id/complete -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'crm-07',
  group: 'crm',
  title: 'convert the lead (creates a member)',
  requires: ['tokenA', 'orgA', 'leadA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/leads/${ctx.leadA}/convert`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 201,
      `POST /v1/leads/:id/convert -> ${r.status}${r.status === 201 ? '' : ` (${fragment(r)})`}`,
    );
  },
});

check({
  id: 'crm-08',
  group: 'crm',
  title: 'the converted status persisted',
  requires: ['tokenA', 'orgA', 'leadA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/leads/${ctx.leadA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    const status = r.body && r.body.status;
    return verdict(r.status === 200 && status === 'converted', `lead status=${status}`);
  },
});

check({
  id: 'crm-09',
  group: 'crm',
  title: 'create a lead in tenant B',
  requires: ['tokenB', 'orgB', 'branchB'],
  provides: ['leadB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/leads',
      token: ctx.tokenB,
      org: ctx.orgB,
      body: { branch_id: ctx.branchB, first_name: 'Gate', last_name: 'LeadB' },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/leads (B) -> ${r.status}`,
      id ? { leadB: id } : undefined,
    );
  },
});

check({
  id: 'crm-10',
  group: 'crm',
  title: "tenant A cannot read tenant B's lead (cross-org 404)",
  requires: ['tokenA', 'orgA', 'leadB'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/leads/${ctx.leadB}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 404 && hasFragment(r, 'Lead not found'),
      `GET /v1/leads/<B lead> as A -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'crm-11',
  group: 'crm',
  title: 'SLA report is readable',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/sla/reports',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/sla/reports -> ${r.status}`);
  },
});

check({
  id: 'crm-12',
  group: 'crm',
  title: 'create an SLA policy',
  requires: ['tokenA', 'orgA'],
  provides: ['policyA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/sla/policies',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: {
        name: `Gate SLA ${ctx.runId}`,
        first_response_hours: 1,
        follow_up_interval_hours: 24,
        escalation_after_hours: 48,
      },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/sla/policies -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { policyA: id } : undefined,
    );
  },
});

check({
  id: 'crm-13',
  group: 'crm',
  title: 'the policy is listed',
  requires: ['tokenA', 'orgA', 'policyA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: '/v1/sla/policies',
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(
      r.status === 200 && bodyHas(r, ctx.policyA),
      `GET /v1/sla/policies -> ${r.status}, contains policy=${bodyHas(r, ctx.policyA)}`,
    );
  },
});

// ── PT (P3-11 / P3-12) ──────────────────────────────────────────────────────
check({
  id: 'pt-01',
  group: 'pt',
  title: 'create a commission payout run (pt:payout)',
  requires: ['tokenA', 'orgA'],
  provides: ['payoutA'],
  run: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/pt/commission-payouts',
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { period_start: today, period_end: today, currency: 'USD' },
    });
    const id = r.body && r.body.id;
    return verdict(
      r.status === 201 && Boolean(id),
      `POST /v1/pt/commission-payouts -> ${r.status}${id ? '' : ` (${fragment(r)})`}`,
      id ? { payoutA: id } : undefined,
    );
  },
});

check({
  id: 'pt-02',
  group: 'pt',
  title: 'payout run by id (pt:read)',
  requires: ['tokenA', 'orgA', 'payoutA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'GET',
      path: `/v1/pt/commission-payouts/${ctx.payoutA}`,
      token: ctx.tokenA,
      org: ctx.orgA,
    });
    return verdict(r.status === 200, `GET /v1/pt/commission-payouts/:id -> ${r.status}`);
  },
});

check({
  id: 'pt-03',
  group: 'pt',
  title: 'cancelling an unknown enrollment is a scoped 404',
  requires: ['tokenA', 'orgA'],
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: `/v1/pt/enrollments/${crypto.randomUUID()}/cancel`,
      token: ctx.tokenA,
      org: ctx.orgA,
      body: { reason: 'gate' },
    });
    return verdict(
      r.status === 404,
      `POST /v1/pt/enrollments/<random>/cancel -> ${r.status} (${fragment(r)})`,
    );
  },
});

// ── webhook (P3-03) ─────────────────────────────────────────────────────────
check({
  id: 'wh-01',
  group: 'webhook',
  title: 'an unsigned webhook is rejected (fail closed)',
  run: async (ctx) => {
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/webhooks/payment-gateway',
      rawBody: JSON.stringify({ id: `evt_gate_unsigned_${ctx.runId}`, type: 'payment_intent.succeeded' }),
    });
    return verdict(
      r.status === 400 && hasFragment(r, 'Invalid webhook signature'),
      `POST /v1/webhooks/payment-gateway (no signature) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'wh-02',
  group: 'webhook',
  title: 'a signature from the wrong secret is rejected',
  run: async (ctx) => {
    const payload = JSON.stringify({
      id: `evt_gate_badsig_${ctx.runId}`,
      type: 'payment_intent.succeeded',
    });
    const signature = ctx.signWebhook(payload, `whsec_wrong_${ctx.runId}`);
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/webhooks/payment-gateway',
      rawBody: payload,
      headers: { 'stripe-signature': signature },
    });
    return verdict(
      r.status === 400 && hasFragment(r, 'Invalid webhook signature'),
      `POST /v1/webhooks/payment-gateway (wrong secret) -> ${r.status} "${fragment(r)}"`,
    );
  },
});

check({
  id: 'wh-03',
  group: 'webhook',
  title: 'a correctly signed webhook is accepted',
  provides: ['webhookEventId', 'webhookPayloadRaw'],
  run: async (ctx) => {
    const eventId = `evt_gate_${ctx.runId}`;
    const paymentId = ctx.paymentA || crypto.randomUUID();
    const payload = ctx.webhookPayload(eventId, paymentId);
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/webhooks/payment-gateway',
      rawBody: payload,
      headers: { 'stripe-signature': ctx.signWebhook(payload, ctx.webhookSecret) },
    });
    return verdict(
      r.status === 201 && r.body && r.body.received === true,
      `POST /v1/webhooks/payment-gateway (signed) -> ${r.status} received=${r.body && r.body.received}`,
      { webhookEventId: eventId, webhookPayloadRaw: payload },
    );
  },
});

check({
  id: 'wh-04',
  group: 'webhook',
  title: 'the event is persisted in FINANCE_WEBHOOK_EVENTS',
  requires: ['webhookEventId'],
  run: async (ctx) => {
    const rows = await ctx.queryScratch(
      'SELECT status, event_type FROM "FINANCE_WEBHOOK_EVENTS" WHERE provider_event_id = $1',
      [ctx.webhookEventId],
    );
    return verdict(
      rows.length === 1 && rows[0].status === 'received',
      `FINANCE_WEBHOOK_EVENTS rows=${rows.length} status=${rows[0] && rows[0].status}`,
    );
  },
});

check({
  id: 'wh-05',
  group: 'webhook',
  title: 'a replayed delivery is idempotent (one row, no 500)',
  requires: ['webhookEventId', 'webhookPayloadRaw'],
  run: async (ctx) => {
    const payload = ctx.webhookPayloadRaw;
    const r = await call(ctx, {
      method: 'POST',
      path: '/v1/webhooks/payment-gateway',
      rawBody: payload,
      headers: { 'stripe-signature': ctx.signWebhook(payload, ctx.webhookSecret) },
    });
    const rows = await ctx.queryScratch(
      'SELECT count(*)::int AS n FROM "FINANCE_WEBHOOK_EVENTS" WHERE provider_event_id = $1',
      [ctx.webhookEventId],
    );
    const count = rows[0] && rows[0].n;
    return verdict(
      r.status === 201 && count === 1,
      `replay -> ${r.status}, rows=${count}`,
    );
  },
});

/**
 * Deadline for the worker checks (wh-06/07). The worker ticks every
 * `MIN_WORKER_INTERVAL_MS`, so processing is quick; 30 s is generous headroom
 * and the poll reports the row's own state on timeout rather than a bare
 * "timed out".
 */
const WORKER_CHECK_TIMEOUT_MS = 30_000;

// ── webhook, with the real worker running (DEF-11 coverage) ──────────────────
// These run last, against the second, worker-enabled app (`worker: true`).

check({
  id: 'wh-06',
  group: 'webhook',
  title: 'the webhook worker drives a signed payment_intent.succeeded end to end',
  worker: true,
  requires: ['orgA', 'memberA', 'invoiceA'],
  run: async (ctx) => {
    if (!ctx.workerBaseUrl) {
      return verdict(false, `worker app unavailable: ${ctx.workerBootFailure || 'not booted'}`);
    }
    const paymentId = await ctx.seedPendingPayment({
      organizationId: ctx.orgA,
      memberId: ctx.memberA,
      invoiceId: ctx.invoiceA,
    });
    const eventId = `evt_gate_worker_a_${ctx.runId}`;
    const payload = ctx.webhookPayload(eventId, paymentId);
    const r = await call(
      { ...ctx, baseUrl: ctx.workerBaseUrl },
      {
        method: 'POST',
        path: '/v1/webhooks/payment-gateway',
        rawBody: payload,
        headers: { 'stripe-signature': ctx.signWebhook(payload, ctx.webhookSecret) },
      },
    );
    if (r.status !== 201) {
      return verdict(false, `POST /v1/webhooks/payment-gateway (worker app) -> ${r.status} "${fragment(r)}"`);
    }
    const polled = await pollWebhookEvent(ctx, eventId, WORKER_CHECK_TIMEOUT_MS);
    const payments = await ctx.queryScratch(
      'SELECT status, organization_id FROM "FINANCE_PAYMENTS" WHERE id = $1',
      [paymentId],
    );
    const payment = payments[0];
    const ok =
      Boolean(polled.row) &&
      polled.row.status === 'processed' &&
      Boolean(payment) &&
      payment.status === 'succeeded' &&
      polled.row.organization_id === payment.organization_id;
    return verdict(
      ok,
      ok
        ? `event processed in ${polled.elapsedMs}ms; payment succeeded, event org == payment org`
        : `event row status=${polled.row && polled.row.status} attempts=${polled.row && polled.row.attempts} ` +
            `error=${polled.row && polled.row.error_message}; payment status=${payment && payment.status}`,
    );
  },
});

check({
  id: 'wh-07',
  group: 'webhook',
  title: 'an unhandled event type is recorded with no state change',
  worker: true,
  requires: ['orgA', 'memberA', 'invoiceA'],
  run: async (ctx) => {
    if (!ctx.workerBaseUrl) {
      return verdict(false, `worker app unavailable: ${ctx.workerBootFailure || 'not booted'}`);
    }
    const paymentId = await ctx.seedPendingPayment({
      organizationId: ctx.orgA,
      memberId: ctx.memberA,
      invoiceId: ctx.invoiceA,
    });
    const eventId = `evt_gate_worker_b_${ctx.runId}`;
    const payload = ctx.webhookPayload(eventId, paymentId, { type: 'customer.created' });
    const r = await call(
      { ...ctx, baseUrl: ctx.workerBaseUrl },
      {
        method: 'POST',
        path: '/v1/webhooks/payment-gateway',
        rawBody: payload,
        headers: { 'stripe-signature': ctx.signWebhook(payload, ctx.webhookSecret) },
      },
    );
    if (r.status !== 201) {
      return verdict(false, `POST /v1/webhooks/payment-gateway (worker app) -> ${r.status} "${fragment(r)}"`);
    }
    const polled = await pollWebhookEvent(ctx, eventId, WORKER_CHECK_TIMEOUT_MS);
    const payments = await ctx.queryScratch('SELECT status FROM "FINANCE_PAYMENTS" WHERE id = $1', [
      paymentId,
    ]);
    const payment = payments[0];
    const ok =
      Boolean(polled.row) &&
      polled.row.status === 'processed' &&
      Boolean(payment) &&
      payment.status === 'pending' &&
      polled.row.organization_id === null;
    return verdict(
      ok,
      ok
        ? `event processed in ${polled.elapsedMs}ms; payment still pending, organization_id NULL`
        : `event row status=${polled.row && polled.row.status} attempts=${polled.row && polled.row.attempts} ` +
            `error=${polled.row && polled.row.error_message}; payment status=${payment && payment.status}, ` +
            `event org=${polled.row && JSON.stringify(polled.row.organization_id)}`,
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

function selectChecks(all, opts) {
  let wanted = new Set(
    all
      .filter((c) => (opts.only.length ? opts.only.includes(c.group) : true))
      .filter((c) => !opts.skip.includes(c.group))
      .map((c) => c.id),
  );
  // Pull in any check that provides a fixture the selection requires.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (!wanted.has(c.id)) continue;
      for (const key of c.requires || []) {
        const provider = all.find((p) => (p.provides || []).includes(key));
        if (provider && !wanted.has(provider.id)) {
          wanted.add(provider.id);
          changed = true;
        }
      }
    }
  }
  return all.filter((c) => wanted.has(c.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Database / Redis / app plumbing
// ─────────────────────────────────────────────────────────────────────────────

function dbConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  };
}

/** Refuse to ever connect to the development database. */
async function connect(database, { allowDev = false } = {}) {
  if (!allowDev && database === process.env.DB_DATABASE) {
    throw Object.assign(
      new Error(
        `refusing to connect to DB_DATABASE="${database}" — the gate only touches its scratch database`,
      ),
      { refused: true },
    );
  }
  const { Client } = require('pg');
  const cfg = dbConfig();
  const client = new Client({ ...cfg, database });
  await client.connect();
  return client;
}

function redisUrl(index) {
  const env = readEnvFile(guardEnvFile());
  const host = process.env.REDIS_HOST || env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD || env.REDIS_PASSWORD || '';
  const username = process.env.REDIS_USERNAME || env.REDIS_USERNAME || '';
  const auth = password ? `${username ? `${encodeURIComponent(username)}:` : ''}${encodeURIComponent(password)}@` : '';
  return { url: `redis://${auth}${host}:${port}/${index}`, host, port };
}

let ENV_FILE_PATH = path.join(ROOT, '.env');
const guardEnvFile = () => ENV_FILE_PATH;

/**
 * Boot a SECOND application instance on the same scratch database with ONLY the
 * webhook-event worker enabled (`WORKERS_ENABLED=true`; every other worker's
 * per-worker switch explicitly `false`), ticking at `MIN_WORKER_INTERVAL_MS`.
 *
 * Why a second instance rather than enabling the worker on the first: `wh-04`
 * asserts the stored row is still `'received'` — the pre-processing state — so a
 * ticking worker in the same process could claim `wh-03`'s row before that check
 * reads it. The worker checks (wh-06/07) run last, after every pre-existing check
 * has already been decided against the worker-less app.
 */
async function bootWorkerApp({ childEnv, opts, logPath, tail, log }) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...childEnv,
    PORT: String(port),
    DB_MIGRATIONS_RUN: 'false', // the first boot already migrated this scratch database
    WORKERS_ENABLED: 'true',
    WORKERS_WEBHOOK_INTERVAL_MS: String(minWorkerIntervalMs()),
  };
  for (const name of WORKER_NAMES) {
    env[`WORKERS_${name}_ENABLED`] = name === 'WEBHOOK' ? 'true' : 'false';
  }
  const command = opts.built
    ? { cmd: process.execPath, args: ['dist/main.js'] }
    : { cmd: TS_NODE, args: ['--transpile-only', 'src/main.ts'] };
  const child = spawn(command.cmd, command.args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (chunk) => {
    try {
      fs.appendFileSync(logPath, chunk);
    } catch {
      /* the log is a convenience; never fail the run over it */
    }
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 400) tail.shift();
      if (opts.verbose) process.stderr.write(`  worker| ${line}\n`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (code !== null && code !== 0) log(`[api-gate] worker app exited early with code ${code}`);
  });
  log(
    `[api-gate] worker app ${command.cmd} ${command.args.join(' ')} (pid ${child.pid}) ` +
      `WEBHOOK worker every ${env.WORKERS_WEBHOOK_INTERVAL_MS}ms`,
  );
  const ready = await waitForHealth(baseUrl, opts.bootTimeoutMs, child);
  if (!ready.ok) return { ok: false, child, reason: ready.reason };
  return { ok: true, child, baseUrl };
}

/**
 * Bounded poll of one webhook row until the worker has processed it. The
 * deadline is explicit; on timeout the caller reports the row's
 * status/attempts/error_message rather than a bare "timed out".
 */
async function pollWebhookEvent(ctx, eventId, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const rows = await ctx.queryScratch(
      'SELECT status, attempts, error_message, organization_id FROM "FINANCE_WEBHOOK_EVENTS" WHERE provider_event_id = $1',
      [eventId],
    );
    const row = rows[0];
    if (row && row.status === 'processed') return { row, elapsedMs: Date.now() - started };
    if (Date.now() - started >= timeoutMs) {
      return { row, elapsedMs: Date.now() - started, timedOut: true };
    }
    await sleep(250);
  }
}

/**
 * Resources this run owns. Module scope so `cleanupGate` can release them even
 * when an unexpected error unwinds out of `runGuarded`.
 */
const gateState = {
  child: null,
  workerChild: null,
  redisClient: null,
  scratch: null,
  scratchApp: null,
  scratchName: null,
  redisDb: null,
};
let activeLog = (line) => process.stdout.write(`${line}\n`);

/** Stop one booted app instance: SIGTERM, then SIGKILL after a short grace. */
async function stopAppChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Idempotent teardown: stop the apps, close clients, drop the scratch database. */
async function cleanupGate({ keep }) {
  if (gateState.scratchApp) {
    try {
      await gateState.scratchApp.end();
    } catch {
      /* best effort */
    }
    gateState.scratchApp = null;
  }
  await stopAppChild(gateState.child);
  await stopAppChild(gateState.workerChild);
  if (gateState.redisClient) {
    try {
      if (!keep) await gateState.redisClient.flushDb();
    } catch {
      /* best effort */
    }
    try {
      await gateState.redisClient.quit();
    } catch {
      /* best effort */
    }
    gateState.redisClient = null;
  }
  if (gateState.scratch) {
    try {
      if (!keep) {
        await gateState.scratch.query(`DROP DATABASE IF EXISTS "${gateState.scratchName}" WITH (FORCE)`);
        activeLog(`[api-gate] cleanup: dropped ${gateState.scratchName}`);
      } else {
        activeLog(`[api-gate] cleanup: kept ${gateState.scratchName} and Redis db${gateState.redisDb}`);
      }
    } catch (error) {
      activeLog(`[api-gate] cleanup: could not drop ${gateState.scratchName}: ${error.message}`);
    }
    try {
      await gateState.scratch.end();
    } catch {
      /* best effort */
    }
    gateState.scratch = null;
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[api-gate] ${error.message}\n`);
    if (error.usage) process.stderr.write(`\n${USAGE}\n`);
    process.exit(error.refused ? EXIT.REFUSED : EXIT.USAGE);
  }

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(EXIT.OK);
  }
  if (opts.listChecks) {
    for (const c of selectChecks(checks, opts)) {
      process.stdout.write(
        `${c.id}\t${c.group}\t${c.title}\t${(c.requires || []).join(',')}\t${(c.provides || []).join(',')}\n`,
      );
    }
    process.exit(EXIT.OK);
  }

  // ── re-exec through the guard so the loopback/published-port rules apply ──
  if (!process.env[SENTINEL]) {
    const args = [
      GUARD,
      '--env-file',
      opts.envFile,
      '--',
      process.execPath,
      __filename,
      ...process.argv.slice(2),
    ];
    if (opts.verbose) {
      process.stderr.write(`[api-gate] re-exec: bash ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
    }
    const child = spawn('bash', args, {
      stdio: 'inherit',
      env: { ...process.env, [SENTINEL]: '1' },
    });
    child.on('exit', (code, signal) => {
      process.exit(signal ? EXIT.CANT_RUN : code == null ? EXIT.CANT_RUN : code);
    });
    return;
  }

  ENV_FILE_PATH = opts.envFile;
  runGuarded(opts).catch(async (error) => {
    process.stderr.write(`[api-gate] internal error: ${error && error.stack ? error.stack : error}\n`);
    // Never leave a booted app or a scratch database behind on the way out.
    await cleanupGate({ keep: opts.keep || opts.keepOnFailure }).catch(() => {});
    process.exit(EXIT.INTERNAL);
  });
}

async function runGuarded(opts) {
  const state = gateState;
  const started = Date.now();
  const runId = crypto.randomBytes(4).toString('hex');
  const missing = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_DATABASE'].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    process.stderr.write(
      `[api-gate] refused: ${missing.join(', ')} are not exported. Run the gate through the guard:\n` +
        '  scripts/dev-db-env.sh node scripts/api-gate.js\n',
    );
    process.exit(EXIT.REFUSED);
  }

  const envFileValues = readEnvFile(opts.envFile);
  const redisDevIndex = String(envFileValues.REDIS_DATABASE || '0');
  if (String(opts.redisDb) === redisDevIndex) {
    process.stderr.write(
      `[api-gate] refused: --redis-db=${opts.redisDb} is the development Redis database ` +
        '(REDIS_DATABASE in the env file). Pick another index.\n',
    );
    process.exit(EXIT.REFUSED);
  }
  const redis = redisUrl(opts.redisDb);
  if (!isLoopback(redis.host)) {
    process.stderr.write(`[api-gate] refused: REDIS host "${redis.host}" is not loopback.\n`);
    process.exit(EXIT.REFUSED);
  }

  const scratchName = opts.scratchName || `gym_gate_${runId}`;
  if (!SCRATCH_RE.test(scratchName)) {
    process.stderr.write(`[api-gate] refused: scratch name "${scratchName}" is outside gym_gate_*.\n`);
    process.exit(EXIT.REFUSED);
  }

  const logPath = opts.log || path.join(os.tmpdir(), `gym-api-gate-${runId}.log`);
  const out = opts.json ? [] : null;
  const log = (line) => {
    if (opts.json) out.push(line);
    else process.stdout.write(`${line}\n`);
  };
  // Teardown must also run when the unexpected happens, so the state it needs and
  // the logger it writes to live at module scope (`cleanupGate` / `gateState`).
  activeLog = log;
  gateState.scratchName = scratchName;
  gateState.redisDb = opts.redisDb;

  log(`[api-gate] run ${runId}  ${new Date().toISOString()}`);
  log(`[api-gate] guard      ${process.env.DB_HOST}:${process.env.DB_PORT} -> scratch ${scratchName}`);
  log(`[api-gate] dev db     ${process.env.DB_DATABASE} (never opened by this run)`);
  log(`[api-gate] redis      ${redis.host}:${redis.port} db${opts.redisDb}`);
  log(`[api-gate] app log    ${logPath}`);

  const cleanup = cleanupGate;

  process.on('SIGINT', () => {
    Promise.resolve(cleanup({ keep: false })).then(() => process.exit(EXIT.CANT_RUN));
  });
  process.on('SIGTERM', () => {
    Promise.resolve(cleanup({ keep: false })).then(() => process.exit(EXIT.CANT_RUN));
  });

  // ── reachability preflight ────────────────────────────────────────────────
  const maintenanceDb = process.env.DB_DATABASE === 'postgres' ? 'template1' : 'postgres';
  try {
    state.scratch = await connect(maintenanceDb, { allowDev: true });
    await state.scratch.query('SELECT 1');
  } catch (error) {
    process.stderr.write(
      `[api-gate] cannot reach Postgres at ${process.env.DB_HOST}:${process.env.DB_PORT} (${error.message}).\n` +
        '  start it with: docker compose up -d postgres\n',
    );
    process.exit(EXIT.CANT_RUN);
  }

  try {
    const { createClient } = require('redis');
    state.redisClient = createClient({ url: redis.url });
    state.redisClient.on('error', () => {});
    await state.redisClient.connect();
    const pong = await state.redisClient.ping();
    if (pong !== 'PONG') throw new Error(`unexpected PING reply ${pong}`);
    await state.redisClient.flushDb();
  } catch (error) {
    process.stderr.write(
      `[api-gate] cannot reach Redis at ${redis.host}:${redis.port} (${error.message}).\n` +
        '  start it with: docker compose up -d redis\n',
    );
    await cleanup({ keep: true });
    process.exit(EXIT.CANT_RUN);
  }

  // ── scratch database ──────────────────────────────────────────────────────
  try {
    const rows = await state.scratch.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      scratchName,
    ]);
    if (rows.rowCount === 0) {
      await state.scratch.query(`CREATE DATABASE "${scratchName}"`);
      log(`[api-gate] created    ${scratchName}`);
    } else {
      log(`[api-gate] reusing    ${scratchName}`);
    }
  } catch (error) {
    process.stderr.write(`[api-gate] could not create ${scratchName}: ${error.message}\n`);
    await cleanup({ keep: true });
    process.exit(EXIT.CANT_RUN);
  }

  // ── boot the real entrypoint ──────────────────────────────────────────────
  const port = opts.port || (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_DATABASE: scratchName,
    DB_MIGRATIONS_RUN: 'true',
    PORT: String(port),
    REDIS_HOST: redis.host,
    REDIS_PORT: String(redis.port),
    REDIS_DATABASE: String(opts.redisDb),
    WORKERS_ENABLED: 'false',
    JWT_SECRET: random(24),
    JWT_REFRESH_SECRET: random(24),
    MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    STRIPE_SECRET_KEY: `sk_test_gate_${runId}`,
    STRIPE_WEBHOOK_SECRET: `whsec_gate_${runId}`,
    SENTRY_DSN: '',
    AI_ENABLED: 'false',
  };
  for (const name of WORKER_NAMES) childEnv[`WORKERS_${name}_ENABLED`] = 'false';

  const tail = [];
  const command = opts.built
    ? { cmd: process.execPath, args: ['dist/main.js'] }
    : { cmd: TS_NODE, args: ['--transpile-only', 'src/main.ts'] };
  if (opts.built && !fs.existsSync(path.join(ROOT, 'dist', 'main.js'))) {
    process.stderr.write('[api-gate] --built requires dist/main.js; run npm run build first.\n');
    await cleanup({ keep: true });
    process.exit(EXIT.CANT_RUN);
  }

  state.child = spawn(command.cmd, command.args, {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (chunk) => {
    // Append synchronously: the app is killed at cleanup, and an async stream
    // would lose its last buffered writes exactly when they matter most.
    try {
      fs.appendFileSync(logPath, chunk);
    } catch {
      /* the log is a convenience; never fail the run over it */
    }
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 400) tail.shift();
      if (opts.verbose) process.stderr.write(`  app| ${line}\n`);
    }
  };
  state.child.stdout.on('data', onData);
  state.child.stderr.on('data', onData);
  state.child.on('exit', (code) => {
    if (code !== null && code !== 0) log(`[api-gate] app exited early with code ${code}`);
  });
  log(`[api-gate] app        ${command.cmd} ${command.args.join(' ')} (pid ${state.child.pid})`);

  const ready = await waitForHealth(baseUrl, opts.bootTimeoutMs, state.child);
  if (!ready.ok) {
    process.stderr.write(
      `[api-gate] the app did not become healthy within ${opts.bootTimeoutMs}ms (${ready.reason}).\n` +
        `  last log lines (${logPath}):\n${tail.slice(-25).map((l) => `    ${l}`).join('\n')}\n`,
    );
    await cleanup({ keep: true });
    process.exit(EXIT.CANT_RUN);
  }
  log(`[api-gate] boot       healthy after ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // ── the context the checks share ──────────────────────────────────────────
  const { Client } = require('pg');
  const scratchClient = new Client({ ...dbConfig(), database: scratchName });

  const ctx = {
    runId,
    baseUrl,
    httpTimeoutMs: opts.httpTimeoutMs,
    userAEmail: 'test2@example.com',
    userAPassword: `Gate-${random(8)}`,
    userBEmail: `gate-b-${runId}@example.com`,
    userBPassword: `Gate-${random(8)}`,
    webhookSecret: childEnv.STRIPE_WEBHOOK_SECRET,
    signWebhook: (payload, secret) => {
      const Stripe = require('stripe');
      return new Stripe(childEnv.STRIPE_SECRET_KEY).webhooks.generateTestHeaderString({
        payload,
        secret,
      });
    },
    webhookPayload: (eventId, paymentId, options = {}) => {
      const type = options.type || 'payment_intent.succeeded';
      // The default path stays byte-identical: wh-03 uses it unchanged.
      const object = type.startsWith('payment_intent.')
        ? {
            id: `pi_${runId}`,
            object: 'payment_intent',
            status: 'succeeded',
            metadata: { paymentId },
          }
        : { id: `obj_gate_${runId}`, object: type.split('.')[0], metadata: { paymentId } };
      return JSON.stringify({ id: eventId, object: 'event', type, data: { object } });
    },
    queryScratch: async (sql, params) => {
      const result = await scratchClient.query(sql, params);
      return result.rows;
    },
    runBootstrap: async () => {
      const result = await runProcess(TS_NODE, ['--transpile-only', 'src/scripts/bootstrap-dev.ts'], {
        env: { ...childEnv, DB_DATABASE: scratchName },
      });
      return { code: result.code, tail: result.tail };
    },
    grantOwnerMembership: async (email, organizationId) => {
      try {
        const users = await scratchClient.query('SELECT id FROM "IDENTITY_USERS" WHERE email = $1', [email]);
        if (users.rowCount !== 1) return { ok: false, evidence: `user ${email} rows=${users.rowCount}` };
        const roles = await scratchClient.query(
          'SELECT id FROM "IDENTITY_ROLES" WHERE name = $1 ORDER BY created_at ASC LIMIT 1',
          ['owner'],
        );
        if (roles.rowCount !== 1) return { ok: false, evidence: 'owner role not found' };
        const userId = users.rows[0].id;
        const roleId = roles.rows[0].id;
        const existing = await scratchClient.query(
          'SELECT id FROM "IDENTITY_USER_ROLES" WHERE user_id = $1 AND role_id = $2 LIMIT 1',
          [userId, roleId],
        );
        if (existing.rowCount === 0) {
          await scratchClient.query('INSERT INTO "IDENTITY_USER_ROLES" (user_id, role_id) VALUES ($1, $2)', [
            userId,
            roleId,
          ]);
        }
        await scratchClient.query(
          `INSERT INTO "IDENTITY_USER_ORGANIZATIONS" (user_id, organization_id, role_id, is_active)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (user_id, organization_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true`,
          [userId, organizationId, roleId],
        );
        return { ok: true, evidence: `granted owner role + membership to ${email}` };
      } catch (error) {
        return { ok: false, evidence: `membership seed failed: ${error.message}` };
      }
    },
    /**
     * Create a PENDING payment directly. No route produces one: the manual
     * recording path writes `succeeded` immediately, and the gateway path only
     * drives rows that are already pending. The worker checks need a payment the
     * gateway outcome can actually move, so this is the gate's direct-insert
     * fixture (same shape as the membership grant above).
     */
    seedPendingPayment: async ({ organizationId, memberId, invoiceId }) => {
      const id = crypto.randomUUID();
      await scratchClient.query(
        `INSERT INTO "FINANCE_PAYMENTS"
           (id, organization_id, member_id, invoice_id, payment_method, amount, payment_date,
            status, idempotency_key, retry_count, created_at)
         VALUES ($1, $2, $3, $4, 'card', '100.00', now(), 'pending', $5, 0, now())`,
        [id, organizationId, memberId, invoiceId, `gate-worker:${id}`],
      );
      return id;
    },
  };
  await scratchClient.connect();
  state.scratchApp = scratchClient;

  // ── run the table ─────────────────────────────────────────────────────────
  const selected = selectChecks(checks, opts);
  const results = [];
  let fatal = null;
  for (const c of selected) {
    const missingFixtures = (c.requires || []).filter((key) => ctx[key] === undefined);
    if (missingFixtures.length) {
      const entry = { id: c.id, group: c.group, title: c.title, status: 'SKIP', evidence: `missing fixture(s): ${missingFixtures.join(', ')}` };
      results.push(entry);
      log(`SKIP  ${pad(c.id, 9)} ${pad(c.title, 62)} ${entry.evidence}`);
      continue;
    }
    if (c.worker && !state.workerChild && !ctx.workerBootFailure) {
      // Lazy boot at the FIRST worker check, which registration order puts after
      // every pre-existing check — wh-04's 'received' assertion included. A
      // selection without worker checks never pays for the second instance.
      try {
        const booted = await bootWorkerApp({ childEnv, opts, logPath, tail, log });
        state.workerChild = booted.child;
        if (booted.ok) {
          ctx.workerBaseUrl = booted.baseUrl;
          log('[api-gate] worker app healthy');
        } else {
          ctx.workerBootFailure = booted.reason;
          log(`[api-gate] worker app did NOT become healthy: ${booted.reason}`);
        }
      } catch (error) {
        ctx.workerBootFailure = error && error.message ? error.message : String(error);
        log(`[api-gate] worker app could not be started: ${ctx.workerBootFailure}`);
      }
    }
    let outcome;
    try {
      outcome = await c.run(ctx);
    } catch (error) {
      outcome = { status: 'FAIL', evidence: `threw: ${error && error.message ? error.message : error}` };
    }
    if (outcome.values) Object.assign(ctx, outcome.values);
    const entry = { id: c.id, group: c.group, title: c.title, status: outcome.status, evidence: outcome.evidence };
    results.push(entry);
    log(
      `${entry.status === 'PASS' ? 'PASS' : 'FAIL'}  ${pad(c.id, 9)} ${pad(c.title, 62)} ${entry.evidence}`,
    );
    if (entry.status === 'FAIL' && c.fatal) {
      fatal = entry;
      break;
    }
  }

  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, fail: 0, skip: 0 };
    byGroup[r.group][r.status === 'PASS' ? 'pass' : r.status === 'FAIL' ? 'fail' : 'skip'] += 1;
  }
  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');

  log('');
  log('--- SUMMARY ---');
  for (const group of GROUPS) {
    const g = byGroup[group];
    if (!g) continue;
    log(`group      ${pad(group, 12)} pass ${String(g.pass).padStart(3)}  fail ${String(g.fail).padStart(3)}  skip ${String(g.skip).padStart(3)}`);
  }
  log(
    `TOTAL      pass ${results.filter((r) => r.status === 'PASS').length}  fail ${failed.length}  skip ${skipped.length}`,
  );
  if (failed.length) {
    log('');
    log('FAILURES');
    for (const r of failed) log(`  ${r.id}: ${r.evidence}`);
    // The app's own log is where a 500 explains itself; surface the tail so a
    // failure is diagnosable from the report alone.
    const interesting = tail
      .filter((line) => /"level":(4|5|6)0|Error|error|exception/i.test(line))
      .slice(-12);
    if (interesting.length) {
      log('');
      log('APP LOG (error lines)');
      for (const line of interesting) log(`  ${line.slice(0, 400)}`);
    }
  }
  log(`log: ${logPath}`);

  const exitCode = fatal ? EXIT.CANT_RUN : failed.length ? EXIT.CHECK_FAILED : EXIT.OK;
  log(`RESULT: ${fatal ? 'COULD NOT RUN' : failed.length ? 'FAIL' : 'PASS'} (${failed.length} failed)`);

  const keep = opts.keep || (opts.keepOnFailure && (failed.length > 0 || fatal));
  if (keep) {
    log(`[api-gate] scratch database ${scratchName} kept; redis db${opts.redisDb} kept`);
    log(
      `[api-gate]   psql -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USERNAME} -d ${scratchName}`,
    );
  }
  await cleanup({ keep });

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ runId, checks: results, failed: failed.length, exit: exitCode, log: logPath }, null, 2) + '\n',
    );
  }
  process.exit(exitCode);
}

const pad = (value, width) => String(value).padEnd(width, ' ');

async function freePort() {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ok: false, reason: `app exited with code ${child.exitCode}` };
    try {
      const response = await fetch(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) {
        const body = await response.json().catch(() => null);
        if (body && body.status === 'ok') return { ok: true };
        lastReason = `health body ${JSON.stringify(body)}`;
      } else {
        lastReason = `health status ${response.status}`;
      }
    } catch (error) {
      lastReason = error.message;
    }
    await sleep(250);
  }
  return { ok: false, reason: lastReason };
}

function runProcess(cmd, args, { env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = [];
    const collect = (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) tail.push(line);
        if (tail.length > 20) tail.shift();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', (code) => resolve({ code: code == null ? 1 : code, tail: tail.slice(-6).join(' | ') }));
  });
}

main();
