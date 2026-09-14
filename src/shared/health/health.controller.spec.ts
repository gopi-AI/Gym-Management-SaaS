import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { HealthController } from './health.controller';

/**
 * Liveness + build-provenance endpoint.
 *
 * The stamp file is produced by `npm run build:info`; these assertions are
 * therefore written to hold both before and after a build, while pinning the
 * two properties that matter: the route is public and the payload never carries
 * anything beyond build identity.
 */
describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get<HealthController>(HealthController);
  });

  it('never requires authentication (orchestrator probe)', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.getHealth),
    ).toBe(true);
  });

  it('reports liveness and either real build identity or an explicit null', () => {
    const response = controller.getHealth();

    expect(response.status).toBe('ok');
    expect(response.uptime_seconds).toBeGreaterThanOrEqual(0);
    if (response.build === null) {
      // Provenance unknown: reported as null, never as a fabricated value.
      expect(response.build).toBeNull();
    } else {
      expect(response.build.source_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof response.build.git_revision).toBe('string');
      expect(typeof response.build.built_at).toBe('string');
      expect(Number.isNaN(Date.parse(response.build.built_at))).toBe(false);
    }
  });

  it('exposes no configuration, provider or tenant data', () => {
    const payload = JSON.stringify(controller.getHealth());

    for (const forbidden of [
      'AI_API_KEY',
      'JWT_SECRET',
      'password',
      'organization_id',
      'X-Organization-Id',
      'token',
    ]) {
      expect(payload).not.toContain(forbidden);
    }
    expect(Object.keys(controller.getHealth()).sort()).toEqual([
      'build',
      'status',
      'uptime_seconds',
    ]);
  });
});
