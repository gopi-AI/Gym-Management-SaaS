import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Liveness + build-provenance reporting.
 *
 * Kept separate from the feature modules so it can never depend on (or leak)
 * business state: it reports process liveness and the build stamp only.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
