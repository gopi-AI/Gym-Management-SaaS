import { Controller, Get } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../../shared/auth/public.decorator';

/**
 * Build provenance reported by the running process.
 *
 * - `source_fingerprint` is the deterministic hash of the build inputs written
 *   by `scripts/build-info.js` at build time. Comparing it with the fingerprint
 *   computed from a workspace (`npm run build:info`) proves whether the running
 *   artifact was built from that exact source.
 * - `git_revision` is the build-arg revision (or the local `git rev-parse`).
 *
 * Contains no configuration, secret or tenant data of any kind.
 */
export interface BuildInfoResponse {
  version: string;
  git_revision: string;
  source_fingerprint: string;
  source_files?: number;
  built_at: string;
}

export interface HealthResponse {
  status: 'ok';
  uptime_seconds: number;
  build: BuildInfoResponse | null;
}

/**
 * Unauthenticated liveness + build-identity endpoint.
 *
 * Deliberately `@Public()`: orchestrators (docker/k8s health probes, deploy
 * scripts) must be able to query it without credentials, and the payload is
 * limited to non-sensitive build identity — never configuration, provider
 * state, keys or tenant data. It returns 200 even when the build stamp is
 * missing, because "I cannot state my provenance" must not be reported as
 * "the service is down".
 */
@Controller('v1/health')
export class HealthController {
  @Get()
  @Public()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      uptime_seconds: Math.round(process.uptime()),
      build: readBuildInfo(),
    };
  }
}

/**
 * Reads the build stamp emitted next to the compiled application.
 *
 * Two candidate locations are checked because the process may be started with
 * the repository root or with `dist/` as its working directory; a missing or
 * unreadable stamp yields `null` instead of throwing.
 */
function readBuildInfo(): BuildInfoResponse | null {
  const candidates = [
    join(process.cwd(), 'dist', 'build-info.json'),
    join(__dirname, '..', '..', 'build-info.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        continue;
      }
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as BuildInfoResponse;
      if (parsed && typeof parsed.source_fingerprint === 'string') {
        return parsed;
      }
    } catch {
      // Malformed stamp: report "unknown provenance" rather than failing health.
    }
  }

  return null;
}
