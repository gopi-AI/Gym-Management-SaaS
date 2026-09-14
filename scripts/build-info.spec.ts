import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Build provenance: the revision contract for image builds.
 *
 * These tests run the real `scripts/build-info.js` inside a throwaway fixture
 * repository (its own `src/`, `package.json`, `tsconfig.json` and NO `.git`) —
 * the same situation a Docker build context is in, where no revision can be
 * discovered locally and the build argument is the only source of truth.
 *
 * Two properties matter for deployment:
 *   - an image build (REQUIRE_GIT_REVISION=true) must FAIL when the revision is
 *     missing, is the legacy "unknown" default, or is a branch/tag name, and it
 *     must leave no stamp behind;
 *   - a local `npm run build` must keep the documented development fallback.
 */
const SCRIPT = path.resolve(__dirname, 'build-info.js');
const FULL_SHA = '6b281f393df63a9b3c10321cd93e0bce7ba011dc';

const fixtures: string[] = [];

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-fixture-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'build-info.js'));
  fs.writeFileSync(path.join(root, 'src', 'sample.ts'), 'export const sample = 1;\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}\n');
  fixtures.push(root);
  return root;
}

function run(fixture: string, env: Record<string, string>, args: string[] = []) {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'GIT_REVISION' && key !== 'REQUIRE_GIT_REVISION' && key !== 'APP_VERSION') {
      base[key] = value;
    }
  }

  const result = spawnSync(process.execPath, [path.join(fixture, 'scripts', 'build-info.js'), ...args], {
    cwd: fixture,
    env: { ...base, ...env },
    encoding: 'utf8',
  });

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function stampPath(fixture: string): string {
  return path.join(fixture, 'dist', 'build-info.json');
}

interface BuildStamp {
  version: string;
  git_revision: string;
  source_fingerprint: string;
  source_files: number;
  built_at: string;
}

function readStamp(fixture: string): BuildStamp {
  return JSON.parse(fs.readFileSync(stampPath(fixture), 'utf8')) as BuildStamp;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fs.rmSync(fixtures.pop() as string, { recursive: true, force: true });
  }
});

describe('build-info revision contract', () => {
  it('stamps a provided revision and is deterministic for identical sources', () => {
    const fixture = makeFixture();

    const first = run(fixture, { GIT_REVISION: FULL_SHA, REQUIRE_GIT_REVISION: 'true' });
    expect(first.status).toBe(0);

    const stamp = readStamp(fixture);
    expect(stamp.git_revision).toBe(FULL_SHA);
    expect(stamp.source_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stamp.source_files).toBe(3);
    expect(Number.isNaN(Date.parse(stamp.built_at))).toBe(false);

    const second = run(fixture, { GIT_REVISION: FULL_SHA, REQUIRE_GIT_REVISION: 'true' });
    expect(second.status).toBe(0);
    expect(readStamp(fixture).source_fingerprint).toBe(stamp.source_fingerprint);
  });

  it('accepts a short revision and normalises hexadecimal case', () => {
    const fixture = makeFixture();

    const result = run(fixture, { GIT_REVISION: '6B281F393DF6', REQUIRE_GIT_REVISION: 'true' });

    expect(result.status).toBe(0);
    expect(readStamp(fixture).git_revision).toBe('6b281f393df6');
  });

  const unusableRevisions: Array<[string, Record<string, string>]> = [
    ['no revision supplied (no .git in the build context)', {}],
    ['the legacy "unknown" default', { GIT_REVISION: 'unknown' }],
    ['a branch name', { GIT_REVISION: 'main' }],
    ['a release tag', { GIT_REVISION: 'v1.2.3-rc1' }],
    ['a truncated revision', { GIT_REVISION: '6b281f' }],
  ];

  it.each(unusableRevisions)('fails closed for %s and writes no stamp', (_label, env) => {
    const fixture = makeFixture();

    const result = run(fixture, { ...env, REQUIRE_GIT_REVISION: 'true' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FATAL');
    expect(result.stderr).toContain('GIT_REVISION=$(git rev-parse HEAD) docker compose build api');
    expect(fs.existsSync(stampPath(fixture))).toBe(false);
  });

  it('keeps the documented development fallback without REQUIRE_GIT_REVISION', () => {
    const fixture = makeFixture();

    const result = run(fixture, {});

    expect(result.status).toBe(0);
    expect(readStamp(fixture).git_revision).toBe('unknown');
  });

  it('validates with --check without writing a stamp', () => {
    const fixture = makeFixture();

    const accepted = run(fixture, { GIT_REVISION: FULL_SHA, REQUIRE_GIT_REVISION: 'true' }, ['--check']);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('revision ok');
    expect(fs.existsSync(stampPath(fixture))).toBe(false);

    const refused = run(fixture, { REQUIRE_GIT_REVISION: 'true' }, ['--check']);
    expect(refused.status).toBe(1);
    expect(fs.existsSync(stampPath(fixture))).toBe(false);
  });
});
