#!/usr/bin/env node
'use strict';

/**
 * Build provenance for this service.
 *
 * WHY THIS EXISTS
 * ----------------
 * The API is shipped as a compiled artifact (`dist/`) inside a Docker image, so
 * "which source produced the running process?" is not answerable from the
 * container alone. That gap has a real failure mode: an image built BEFORE a
 * feature was added still reports "Up (healthy)" while the feature simply is
 * not there.
 *
 * WHAT IT DOES
 * ------------
 * Computes a deterministic fingerprint of the BUILD INPUTS (every non-spec
 * `*.ts`/`*.json` under `src/` and `packages/contracts/`, plus `package.json`
 * and `tsconfig.json`), and writes `dist/build-info.json` next to the compiled
 * application. Because the hash covers file PATHS and file CONTENTS and is
 * independent of timestamps, the same source yields the same fingerprint on a
 * developer machine and inside `docker build` — which is exactly what makes the
 * comparison `workspace == built artifact == running image` possible (see
 * `GET /v1/health`).
 *
 * `git_revision` identifies the source revision the artifact was built from.
 * Docker build contexts exclude `.git`, so the revision is passed in as the
 * `GIT_REVISION` build argument by the Dockerfile (and by docker-compose).
 * Image builds run this script with `REQUIRE_GIT_REVISION=true`, which turns a
 * missing or non-revision value into a BUILD FAILURE: an artifact that cannot
 * name its source revision must not be deployable. Local `npm run build` keeps
 * the documented development fallback (`git rev-parse --short=12 HEAD`, then
 * "unknown"). The revision never affects the fingerprint.
 *
 * Determinism rules (must not be relaxed):
 *   - paths are relative, POSIX-separated and sorted;
 *   - spec files and `__specs__/` directories are excluded (they are not
 *     compiled into the artifact);
 *   - `built_at` is a human hint only and is NOT hashed.
 */

const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOTS = ['src', 'packages/contracts'];
const ROOT_FILES = ['package.json', 'tsconfig.json'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '__specs__']);
const IGNORED_FILE = /\.spec\.ts$/;

/**
 * What we are willing to stamp on a releasable artifact: a Git hex object name
 * (short or full SHA-1/SHA-256). Branch names, tags and the literal "unknown"
 * are NOT revisions — they do not identify an immutable source state.
 */
const REVISION_PATTERN = /^[0-9a-f]{7,40}$/;
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function collect(dir, out) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        collect(absolute, out);
      }
    } else if (/\.(ts|json)$/.test(entry.name) && !IGNORED_FILE.test(entry.name)) {
      out.push(absolute);
    }
  }
  return out;
}

function relativeToRoot(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceFingerprint() {
  const collected = [];
  for (const root of SOURCE_ROOTS) {
    collect(path.join(ROOT, root), collected);
  }
  for (const file of ROOT_FILES) {
    if (fs.existsSync(path.join(ROOT, file))) {
      collected.push(path.join(ROOT, file));
    }
  }

  const files = Array.from(new Set(collected.map(relativeToRoot))).sort();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(`file:${file}\n`);
    digest.update(`${sha256(fs.readFileSync(path.join(ROOT, file)))}\n`);
  }

  return { fingerprint: digest.digest('hex'), fileCount: files.length };
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Resolves the revision to stamp, plus where it came from (the failure message
 * uses the source so an operator knows which knob to turn).
 */
function resolveRevision() {
  const fromEnvironment = (process.env.GIT_REVISION || '').trim();
  if (fromEnvironment) {
    return { value: fromEnvironment.toLowerCase(), source: 'GIT_REVISION build argument / environment variable' };
  }
  try {
    const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .toLowerCase();
    if (revision) {
      return { value: revision, source: 'git rev-parse --short=12 HEAD (working copy)' };
    }
  } catch {
    // Not a Git working copy: an exported source tree, or a Docker build
    // context (`.git` is excluded there). There is nothing to fall back to.
  }
  return { value: 'unknown', source: 'nothing supplied and no readable .git' };
}

function revisionRequired() {
  return TRUTHY.has((process.env.REQUIRE_GIT_REVISION || '').trim().toLowerCase());
}

function revisionFailure(revision) {
  return [
    '',
    '[build-info] FATAL: this build cannot identify its source revision.',
    '',
    `  revision : "${revision.value}"`,
    `  source   : ${revision.source}`,
    '  required : REQUIRE_GIT_REVISION=true',
    '',
    'An artifact that cannot name the revision it was built from is not a',
    'releasable artifact, so the build stops here. Stamp the revision of the',
    'workspace you are building from, for example:',
    '',
    '    GIT_REVISION=$(git rev-parse HEAD) docker compose build api',
    '',
    'A revision must be a 7-40 character hex object name (e.g. 6b281f393df6).',
    'Local `npm run build` runs without REQUIRE_GIT_REVISION and keeps the',
    'documented development fallback: `git rev-parse --short=12 HEAD`, then',
    '"unknown".',
    '',
  ].join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const revision = resolveRevision();

  // Fail closed: when a real revision is required (image builds) an unusable
  // value aborts the build BEFORE anything is written, so no artifact or stamp
  // can exist for an unidentifiable source.
  if (revisionRequired() && !REVISION_PATTERN.test(revision.value)) {
    process.stderr.write(revisionFailure(revision));
    process.exit(1);
  }

  if (checkOnly) {
    // Used by the Dockerfile to fail in ~1s, before `npm ci` runs.
    process.stdout.write(`[build-info] revision ok: ${revision.value} (${revision.source})\n`);
    return;
  }

  const { fingerprint, fileCount } = sourceFingerprint();
  const info = {
    version: process.env.APP_VERSION || readVersion(),
    git_revision: revision.value,
    source_fingerprint: `sha256:${fingerprint}`,
    source_files: fileCount,
    built_at: new Date().toISOString(),
  };

  const outputDir = path.join(ROOT, 'dist');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);

  process.stdout.write(
    `[build-info] ${info.source_fingerprint} (${info.source_files} source files, revision ${info.git_revision})\n`,
  );
}

main();
