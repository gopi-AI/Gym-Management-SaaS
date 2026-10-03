import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * `scripts/api-gate.js` — the D15 API/integration gate.
 *
 * The gate's happy path needs Postgres, Redis and a booted application, so it is
 * not exercised here; this spec pins the contract that CAN be checked without a
 * database: the CLI surface, the exit-code mapping, the guard re-exec, and the
 * refusal rules that keep the gate away from the development database and the
 * development Redis index. The end-to-end run is a separate, manual artifact.
 *
 * Like `dev-db-env.spec.ts`, every child gets DB_* stripped and
 * DEV_DB_PUBLISHED_PORT asserted, so no test in this file depends on a running
 * Docker container or on a sibling spec's environment.
 */
const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'api-gate.js');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');
const PUBLISHED_PORT = '5433';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-gate-'));
  tempDirs.push(dir);
  return dir;
}

function makeEnvFile(overrides: Record<string, string | undefined> = {}): string {
  const values: Record<string, string | undefined> = {
    DB_HOST: '127.0.0.1',
    DB_PORT: PUBLISHED_PORT,
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
    DB_DATABASE: 'gym_management',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    REDIS_DATABASE: '0',
    ...overrides,
  };
  const contents = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const file = path.join(makeTempDir(), '.env');
  fs.writeFileSync(file, `${contents}\n`);
  return file;
}

interface RunOptions {
  envFile?: string;
  /** Simulate being invoked BY the guard (skips the self re-exec). */
  sentinel?: boolean;
  /** Keep the inherited DB_* values (used to test the missing-key refusal). */
  keepDbEnv?: boolean;
}

function runGate(args: string[], options: RunOptions = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!options.keepDbEnv) {
    for (const key of Object.keys(env)) {
      if (key.startsWith('DB_')) delete env[key];
    }
  }
  env.DEV_DB_PUBLISHED_PORT = PUBLISHED_PORT;
  if (options.sentinel) env.GYM_API_GATE_GUARDED = '1';

  const argv = options.envFile
    ? [SCRIPT, '--env-path', options.envFile, ...args]
    : [SCRIPT, ...args];
  const result = spawnSync(process.execPath, argv, { encoding: 'utf8', env, cwd: REPO });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('api-gate CLI', () => {
  it('prints usage and exits 0 for --help', () => {
    const result = runGate(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Exit codes: 0 ok | 1 check failed | 2 refused');
  });

  it('lists the check inventory without touching a database', () => {
    const result = runGate(['--list-checks']);
    expect(result.status).toBe(0);

    const lines = result.stdout.replace(/\n+$/, '').split('\n');
    expect(lines.length).toBeGreaterThan(60); // the table is the deliverable's scope

    const ids = lines.map((line) => line.split('\t')[0]);
    expect(new Set(ids).size).toBe(ids.length); // ids are unique
    // The worker checks are the DEF-11 regression guard; losing them silently
    // would leave processBatch unexercised again.
    expect(ids).toEqual(expect.arrayContaining(['wh-06', 'wh-07']));
    for (const line of lines) {
      // id, group, title, requires, provides — the trailing field may be empty.
      const fields = line.split('\t');
      expect(fields.length).toBeGreaterThanOrEqual(5);
      expect(fields[0]).toMatch(/^[a-z]+-\d+$/);
      expect(fields[1].length).toBeGreaterThan(0);
    }

    // Coverage floors: deleting a whole module's checks from the table is the
    // silent regression this pins.
    const groupCount = (group: string) =>
      lines.filter((line) => line.split('\t')[1] === group).length;
    expect(groupCount('seed')).toBeGreaterThanOrEqual(11);
    expect(groupCount('inventory')).toBeGreaterThanOrEqual(16);
    expect(groupCount('finance')).toBeGreaterThanOrEqual(10);
    expect(groupCount('crm')).toBeGreaterThanOrEqual(12);
    expect(groupCount('pt')).toBeGreaterThanOrEqual(3);
    expect(groupCount('webhook')).toBeGreaterThanOrEqual(5);
  });

  it('refuses an unknown flag with the usage exit code', () => {
    const result = runGate(['--definitely-not-a-flag']);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('unknown option');
  });

  it('refuses an unknown check group with the usage exit code', () => {
    const result = runGate(['--only=not-a-group']);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('unknown group');
  });

  it('refuses a scratch name outside the gym_gate_ namespace', () => {
    const result = runGate(['--scratch-name=gym_management']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('gym_gate_');
  });
});

describe('api-gate guard integration', () => {
  it("propagates the guard's refusal of DB_PORT=5432 (the host cluster)", () => {
    const result = runGate([], { envFile: makeEnvFile({ DB_PORT: '5432' }) });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing DB_PORT=5432');
  });

  it("propagates the guard's refusal of a non-loopback DB_HOST", () => {
    const result = runGate([], { envFile: makeEnvFile({ DB_HOST: 'db.internal' }) });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('loopback');
  });

  it("propagates the guard's missing-env-file exit code", () => {
    const result = runGate([], { envFile: path.join(makeTempDir(), 'nope.env') });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('no environment file');
  });

  it('refuses the development Redis index before touching any database', () => {
    const result = runGate(['--redis-db=0'], {
      envFile: makeEnvFile({ REDIS_DATABASE: '0' }),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('is the development Redis database');
  });

  it('refuses to run guarded without the DB_* exports', () => {
    const result = runGate([], { sentinel: true });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/run the gate through the guard/i);
  });

  it('answers --list-checks without ever invoking the guard', () => {
    // The database-free paths short-circuit BEFORE the sentinel/re-exec: pointing
    // --env-path at a file that does not exist must still list the checks, and the
    // guard's banner must not appear.
    const result = runGate(['--list-checks'], {
      envFile: path.join(makeTempDir(), 'does-not-exist.env'),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('seed-01');
    expect(result.stderr).not.toContain('[dev-db]');
  });
});

describe('api-gate coverage contract', () => {
  it('references every Phase 3 module over HTTP', () => {
    // If a module's checks were removed wholesale, its path literal would leave
    // the source with them. This is the cheap guard against that silent loss.
    for (const route of [
      '/v1/inventory/items',
      '/v1/inventory/purchase-orders',
      '/v1/inventory/transactions/consume',
      '/v1/invoices',
      '/v1/payments',
      '/credit-notes',
      '/v1/tax-rates',
      '/v1/financial-reports/revenue-summary',
      '/v1/leads',
      '/v1/follow-ups',
      '/v1/sla/reports',
      '/v1/pt/commission-payouts',
      '/v1/webhooks/payment-gateway',
    ]) {
      expect(SOURCE).toContain(route);
    }
  });

  it('never opens the development database by name', () => {
    // The refusal is structural: one connection helper, and it compares against
    // DB_DATABASE before connecting.
    expect(SOURCE).toContain('refusing to connect to DB_DATABASE');
  });

  it('runs the webhook worker in a second app with only WEBHOOK enabled', () => {
    // wh-04 asserts the stored row is still 'received', so a ticking worker in
    // the same instance would race it. The worker checks therefore run against a
    // separate instance that enables only WEBHOOK, ticking at the floor read
    // from worker-config.ts rather than a number copied into the gate.
    expect(SOURCE).toContain("name === 'WEBHOOK' ? 'true' : 'false'");
    expect(SOURCE).toContain('WORKERS_WEBHOOK_INTERVAL_MS');
    expect(SOURCE).toContain('MIN_WORKER_INTERVAL_MS');
    expect(SOURCE).toContain('worker-config.ts');
    expect(SOURCE).toMatch(/worker: true/);
  });
});
