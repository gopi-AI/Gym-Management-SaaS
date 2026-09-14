import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { isWorkerEnabled, workerIntervalMs } from './worker-config';

/**
 * Shared lifecycle for the background workers.
 *
 * Registration is dynamic (through `SchedulerRegistry`, which requires
 * `ScheduleModule.forRoot()` in the application module) rather than a static
 * `@Interval()` decorator, because a decorator interval fires whether or not it
 * is configured — an always-ticking no-op timer in every instance is exactly
 * what the enable/disable switch exists to avoid.
 *
 * `tick()` can never overlap with itself: a slow batch must not stack up
 * concurrent runs against the same rows.
 */
export abstract class BackgroundWorker implements OnModuleInit, OnModuleDestroy {
  /** Config suffix, e.g. OUTBOX -> WORKERS_OUTBOX_ENABLED / _INTERVAL_MS. */
  protected abstract readonly workerName: string;

  /** Unique scheduler-registry name for the registered interval. */
  protected abstract readonly workerInstanceKey: string;

  protected readonly logger = new Logger(this.constructor.name);

  private isRunning = false;
  private isEnabled = false;

  constructor(
    protected readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!isWorkerEnabled(this.configService, this.workerName)) {
      this.logger.log(`${this.workerName} worker disabled (set WORKERS_ENABLED=true to enable)`);
      return;
    }

    const intervalMs = workerIntervalMs(this.configService, this.workerName);
    this.isEnabled = true;

    const timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    this.schedulerRegistry.addInterval(this.workerInstanceKey, timer);
    this.logger.log(`${this.workerName} worker enabled: every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', this.workerInstanceKey)) {
      this.schedulerRegistry.deleteInterval(this.workerInstanceKey);
    }
  }

  /**
   * Run one tick. Never throws: a failing batch is logged and the next tick is
   * still scheduled, so one bad row cannot stop the worker permanently.
   *
   * A disabled worker is a no-op even when this is called directly: "disabled"
   * must mean no work happens, not merely "no timer was registered".
   */
  async tick(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug(`${this.workerName} worker tick ignored: worker is disabled`);
      return;
    }
    if (this.isRunning) {
      this.logger.warn(`${this.workerName} worker tick skipped: previous tick still running`);
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        `${this.workerName} worker tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /** One unit of work. Implementations must be safe to run repeatedly. */
  protected abstract runOnce(): Promise<void>;
}
