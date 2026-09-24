import { ConfigService } from '@nestjs/config';

/**
 * Background-worker configuration.
 *
 * Every worker is OFF unless it is explicitly enabled: a worker that silently
 * starts scanning tenants as soon as the API boots is an operational surprise
 * (and, for the outbox poller, can race a dedicated worker deployment). Enabling
 * is a two-level decision:
 *
 *   WORKERS_ENABLED=true                     master switch (default false)
 *   WORKERS_<NAME>_ENABLED=false             per-worker override of the master
 *
 * Cadence is configurable per worker via `WORKERS_<NAME>_INTERVAL_MS`.
 */
export const WORKERS_MASTER_SWITCH = 'WORKERS_ENABLED';

/** Default tick intervals (ms) per worker. */
export const WORKER_INTERVALS: Record<string, number> = {
  OUTBOX: 10_000,
  MEMBERSHIP_EXPIRY: 60 * 60 * 1000,
  PAYMENT_RETRY: 15 * 60 * 1000,
  EXPIRY: 60 * 60 * 1000,
  // Report jobs execute real queries, so the cadence is short enough to feel
  // synchronous but not so short that a batch queues behind itself.
  REPORT_JOBS: 15_000,
  // Materialized-view refresh (§7.3). This is the sweep interval, not a view's
  // own cadence: each view's hourly / 6-hourly / daily frequency is applied by
  // MaterializedViewRefreshService against `last_refreshed`, so a short sweep
  // only makes a due view refresh promptly — it cannot make one refresh early.
  MATERIALIZED_VIEW_REFRESH: 5 * 60 * 1000,
};

/** Default batch size per worker. */
export const WORKER_BATCH_SIZES: Record<string, number> = {
  OUTBOX: 25,
  MEMBERSHIP_EXPIRY: 200,
  PAYMENT_RETRY: 50,
  // §5.1 serializes execution to one job globally; the batch is the queue-drain unit.
  REPORT_JOBS: 5,
};

/** Outbox lease duration: comfortably longer than a normal batch's runtime. */
export const OUTBOX_LOCK_DURATION_MS = 30_000;

/** Refuse absurd intervals (e.g. `WORKERS_OUTBOX_INTERVAL_MS=1`). */
export const MIN_WORKER_INTERVAL_MS = 1_000;

/** Accept the usual truthy spellings; anything else is false. */
export function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * Is the named worker enabled? The per-worker variable wins over the master
 * switch, so one worker can be disabled in an otherwise enabled deployment.
 */
export function isWorkerEnabled(configService: ConfigService, worker: string): boolean {
  const specific = configService.get<string>(`WORKERS_${worker}_ENABLED`);
  if (specific !== undefined && specific !== '') return parseBoolean(specific);
  return parseBoolean(configService.get<string>(WORKERS_MASTER_SWITCH), false);
}

/** Tick interval (ms) for the named worker, with the default when unset/invalid. */
export function workerIntervalMs(configService: ConfigService, worker: string): number {
  const fallback = WORKER_INTERVALS[worker] ?? MIN_WORKER_INTERVAL_MS;
  const raw = Number(configService.get<string>(`WORKERS_${worker}_INTERVAL_MS`));
  if (!Number.isFinite(raw) || raw < MIN_WORKER_INTERVAL_MS) return fallback;
  return raw;
}
