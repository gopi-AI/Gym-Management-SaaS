import * as fs from 'fs';
import * as path from 'path';

/**
 * Development configuration guard.
 *
 * Both hardened conditions are configuration, so they are pinned here:
 *   - docker-compose must publish the development database on the port the host
 *     environment file uses, while the API container keeps talking to
 *     `postgres:5432` inside the compose network;
 *   - an image build must refuse to proceed without a real Git revision.
 *
 * These are intentionally narrow text assertions on the files that carry the
 * contract — not snapshots — so unrelated edits keep passing.
 */
const ROOT = path.resolve(__dirname, '..');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const ENV_EXAMPLE = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

function envValue(contents: string, key: string): string | undefined {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(contents);
  return match ? match[1].trim() : undefined;
}

describe('development database wiring', () => {
  it('publishes the host port and pins the container-internal endpoint', () => {
    expect(COMPOSE).toContain('- "${DB_PORT}:5432"');

    const apiSection = COMPOSE.slice(COMPOSE.indexOf('\n  api:'), COMPOSE.indexOf('\nvolumes:'));
    expect(apiSection).toMatch(/^ {6}DB_HOST: postgres$/m);
    expect(apiSection).toMatch(/^ {6}DB_PORT: 5432$/m);
    expect(apiSection).toMatch(/^ {6}REDIS_HOST: redis$/m);
  });

  it('documents a loopback host endpoint that is not the host cluster port', () => {
    expect(envValue(ENV_EXAMPLE, 'DB_HOST')).toBe('127.0.0.1');
    expect(envValue(ENV_EXAMPLE, 'DB_PORT')).toBe('5433');
  });

  it('keeps the local .env aligned with the committed template', () => {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
      return; // No local environment file: nothing to compare.
    }

    const env = fs.readFileSync(envPath, 'utf8');
    expect(envValue(env, 'DB_HOST')).toBe(envValue(ENV_EXAMPLE, 'DB_HOST'));
    expect(envValue(env, 'DB_PORT')).toBe(envValue(ENV_EXAMPLE, 'DB_PORT'));
    expect(envValue(env, 'DB_DATABASE')).toBe(envValue(ENV_EXAMPLE, 'DB_DATABASE'));
  });

  it('routes host-side database commands through the verifying wrapper', () => {
    expect(ENV_EXAMPLE).toContain('scripts/dev-db-env.sh npm run migration:run');
    expect(ENV_EXAMPLE).toContain('scripts/dev-db-env.sh npm run bootstrap:dev');
  });
});

describe('image build provenance', () => {
  it('requires a validated Git revision before installing dependencies', () => {
    expect(DOCKERFILE).not.toMatch(/^ARG GIT_REVISION=unknown$/m);
    expect(DOCKERFILE).toMatch(/^ARG GIT_REVISION$/m);
    expect(DOCKERFILE).toContain('REQUIRE_GIT_REVISION=true');
    expect(DOCKERFILE).toContain('node scripts/build-info.js --check');
    expect(DOCKERFILE).toContain('org.opencontainers.image.revision');
  });

  it('tells the operator how to supply the revision', () => {
    const command = 'GIT_REVISION=$(git rev-parse HEAD) docker compose build api';
    expect(COMPOSE).toContain(command);
    expect(ENV_EXAMPLE).toContain(command);
  });
});
