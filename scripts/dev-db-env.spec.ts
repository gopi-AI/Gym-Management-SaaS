import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Host-side database targeting.
 *
 * `npm run migration:*` (the TypeORM CLI) does not read .env and
 * `npm run bootstrap:dev` reads a possibly stale DB_PORT, so both can silently
 * reach a native PostgreSQL cluster on 5432 instead of the docker-compose
 * development database published on 5433. `scripts/dev-db-env.sh` is the
 * documented entry point that refuses that: it loads the environment file,
 * compares the target against the port Docker publishes for `gym-postgres` and
 * only then runs the command with those variables exported.
 *
 * The published port is asserted through DEV_DB_PUBLISHED_PORT so these tests do
 * not depend on a running container.
 */
const SCRIPT = path.resolve(__dirname, 'dev-db-env.sh');
const PUBLISHED_PORT = '5433';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-env-'));
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

/**
 * Run the guard against a specific environment file.
 *
 * The child bash process inherits the parent environment, but the DB_* keys are
 * stripped before spawning. The guard's contract is that $ENV_FILE is the SOLE
 * source of truth for DB_*; if a sibling test file running in the same Jest
 * worker leaked a DB_* value into `process.env`, the missing-key check in the
 * script would see it as present and incorrectly succeed. Stripping them here makes
 * each test deterministic regardless of worker scheduling — PATH / DOCKER_HOST etc.
 * are still inherited so the `docker`-backed probe and command resolution work.
 */
function run(envFile: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DB_')) {
      delete env[key];
    }
  }
  env.DEV_DB_PUBLISHED_PORT = PUBLISHED_PORT;

  const result = spawnSync('bash', [SCRIPT, '--env-file', envFile, ...args], {
    encoding: 'utf8',
    env,
  });

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('dev-db-env guard', () => {
  it('reports the verified host target and the container-internal equivalent', () => {
    const result = run(makeEnvFile(), ['--show']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('127.0.0.1:5433/gym_management');
    expect(result.stdout).toContain('gym-postgres:5432 (published on host port 5433)');
  });

  it('exports the verified environment to the wrapped command', () => {
    const result = run(makeEnvFile(), [
      '--',
      'bash',
      '-c',
      'printf "%s|%s|%s" "$DB_HOST" "$DB_PORT" "$DB_DATABASE"',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('127.0.0.1|5433|gym_management');
  });

  it('refuses the port owned by the host PostgreSQL cluster', () => {
    const result = run(makeEnvFile({ DB_PORT: '5432' }), ['--show']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing DB_PORT=5432');
    expect(result.stderr).toContain('HOST PostgreSQL cluster');
  });

  it('refuses a port docker-compose does not publish for the dev database', () => {
    const result = run(makeEnvFile({ DB_PORT: '5500' }), ['--show']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('publishes the development database on 5433');
  });

  it('refuses a non-loopback database host', () => {
    const result = run(makeEnvFile({ DB_HOST: 'db.internal' }), ['--show']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('loopback');
  });

  it('refuses an incomplete or malformed environment file', () => {
    const incomplete = run(makeEnvFile({ DB_DATABASE: undefined }), ['--show']);
    expect(incomplete.status).toBe(2);
    expect(incomplete.stderr).toContain('does not define: DB_DATABASE');

    const malformed = run(makeEnvFile({ DB_PORT: 'postgresql' }), ['--show']);
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toContain('must be a number');
  });

  it('exits 3 when the environment file does not exist', () => {
    const result = run(path.join(makeTempDir(), 'missing', '.env'), ['--show']);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('no environment file');
  });

  it('fails the identity probe when the container cannot serve the database', () => {
    const result = run(makeEnvFile({ DB_DATABASE: 'definitely_not_a_gym_database' }), ['--probe', '--show']);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('probe failed');
  });
});
