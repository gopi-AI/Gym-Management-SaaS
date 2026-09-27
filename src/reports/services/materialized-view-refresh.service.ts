import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MaterializedView } from '../entities/materialized-view.entity';
import {
  DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS,
  MATERIALIZED_VIEW_REFRESH_CADENCE_MS,
  MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS,
  MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD,
  isRefreshableMaterializedViewName,
} from '../constants/materialized-view-refresh';

/** Outcome of one sweep over the registry (§7.4's unit of work is one row). */
export interface MaterializedViewRefreshSummary {
  /** Registry rows examined. */
  scanned: number;
  /** Rows refreshed and stamped successfully. */
  refreshed: number;
  /** Rows inside their §7.3 cadence window, so not due yet. */
  skipped: number;
  /** Rows whose refresh raised — logged, retried on the next cycle (§10). */
  failed: number;
}

/**
 * The materialized-view refresh engine (P6-15; §7.3, §7.4, §10).
 *
 * **§7.4 defines the unit of work precisely**: "The refresh worker treats a
 * `REPORTS_MATERIALIZED_VIEWS` row as its unit of work: resolve the row, run
 * `REFRESH MATERIALIZED VIEW <name>`, then stamp `last_refreshed = now()`." This
 * service is that unit, with the cron path (`refreshDue`) and the §4.3 on-demand
 * path (`refreshById`) both funnelling through one private `refreshRow()`, so a
 * view is never refreshed two different ways that could drift.
 *
 * **The registry is read here, and it is not tenant-scoped — deliberately.**
 * §3.3 (:287) is explicit that `REPORTS_MATERIALIZED_VIEWS` is a **platform-level
 * registry of view definitions**, not tenant data; there is no `organization_id`
 * on it to scope by. Tenant isolation is not weakened by this read: the registry
 * holds no tenant rows. It is enforced where it belongs — each view's own
 * `organization_id` grouping (§3.3, §7.2), which is untouched here because a
 * refresh recomputes the view from its base tables rather than being given a
 * tenant to operate on. §4.3's endpoints read the same rows for the same reason.
 *
 * **`last_refreshed` is stamped only on success** (§7.4's "Last successful
 * refresh"). A failed attempt leaves the previous stamp intact, so §10's "retried
 * on next cron cycle" happens on the next tick rather than being silently skipped
 * for a whole cadence window by a stamp the failure should not have earned.
 *
 * **`REFRESH MATERIALIZED VIEW "<name>"` is interpolated, and guarded.** The
 * statement takes an identifier rather than a bind parameter, so the name cannot
 * be parameterised; `isRefreshableMaterializedViewName()` is the control that
 * keeps a malformed registry row out of the SQL text. Non-concurrent refreshes
 * are used, as §7.4 specifies: they are permitted inside a transaction block and
 * take an exclusive lock on the view, so two concurrent refreshes of the same
 * view queue rather than corrupt each other. `CONCURRENTLY` is not used — it
 * needs a unique index on every view and cannot run in a transaction, neither of
 * which §7.4 asks for.
 *
 * **Consecutive failures are counted in Redis, not in a column** (§10's "Alert
 * after 3 consecutive failures"). §7.4's table gains no failure column — P6-29
 * resolution (B) bounds its shape to identity plus last refresh — and a Redis
 * counter is the pattern this domain already uses for cross-request state
 * (`ReportJobService`'s pending-job queue-depth guard, §3.2). The counter is
 * reset by a success, so it counts *consecutive* failures as §10 words it.
 * `cache-manager` offers no INCR, so the read-modify-write below is not atomic
 * across processes — the same stated limitation as the queue-depth guard, and
 * acceptable for a threshold that only decides when to log an alert.
 */
@Injectable()
export class MaterializedViewRefreshService {
  private readonly logger = new Logger(MaterializedViewRefreshService.name);

  constructor(
    @InjectRepository(MaterializedView)
    private readonly registryRepository: Repository<MaterializedView>,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /** §7.3 cadence for a view, falling back to the documented default. */
  cadenceMs(name: string): number {
    return (
      MATERIALIZED_VIEW_REFRESH_CADENCE_MS[name] ??
      DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS
    );
  }

  /**
   * §7.3's debounce key (§7.4: "Debounce window (5 min) → Redis lock").
   *
   * Keyed by view name rather than registry id so the debounce survives a
   * re-registration of the same view — the thing being debounced is the view,
   * not the row that describes it.
   */
  private debounceKey(name: string): string {
    return `reports:mv:refresh:debounce:${name}`;
  }

  /** §10's consecutive-failure counter key. */
  private failuresKey(name: string): string {
    return `reports:mv:refresh:failures:${name}`;
  }

  /**
   * Is this registry row due under its §7.3 cadence?
   *
   * Never refreshed (NULL `last_refreshed`) is always due — a view registered by
   * a migration is populated on the first tick rather than after one full
   * cadence, which is what makes the "no Phase 6.0 catalog row may depend on a
   * view" note in the plan's catalog section unnecessary to revisit.
   */
  private isDue(row: MaterializedView, now: Date): boolean {
    if (!row.last_refreshed) return true;
    const last = new Date(row.last_refreshed).getTime();
    if (!Number.isFinite(last)) return true;
    return last + this.cadenceMs(row.name) <= now.getTime();
  }

  /**
   * The cron path: refresh every registered view whose cadence has elapsed.
   *
   * Returns counts rather than throwing, so one failing view cannot stop the
   * others in the same sweep — §10 puts a failed refresh on the next cron cycle,
   * and the other five views have nothing to do with it. The worker logs the
   * summary; per-view failures are logged here with their consecutive count.
   *
   * `now` is threaded into the stamp as well as the due-check, so the sweep
   * decides *and* records against one instant. Stamping the wall clock while
   * testing against `now` would let the two disagree by the sweep's own runtime,
   * which for a slow refresh of a large view is not negligible.
   */
  async refreshDue(now: Date = new Date()): Promise<MaterializedViewRefreshSummary> {
    const rows = await this.registryRepository.find({ order: { name: 'ASC' } });

    let refreshed = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      if (!this.isDue(row, now)) {
        skipped += 1;
        continue;
      }
      const ok = await this.refreshRow(row, now);
      if (ok) refreshed += 1;
      else failed += 1;
    }

    return { scanned: rows.length, refreshed, skipped, failed };
  }

  /**
   * §4.3's `POST /v1/report/materialized-views/{id}/refresh` — an explicit,
   * synchronous refresh of one view.
   *
   * **No debounce on this path (explicit decision).** §7.3's 5-minute window
   * exists so a stream of *events* cannot refresh a view per event; an operator
   * asking for a refresh after correcting data is a single deliberate act, and
   * debouncing it would make the endpoint refuse the request the plan documents
   * it as serving. The debounce is applied on the event path
   * (`refreshOnEvent`) instead, which is the one §7.3 describes it for.
   *
   * **A failure is surfaced, not swallowed.** The caller asked for the refresh
   * and is waiting for it, so reporting success while `last_refreshed` was not
   * stamped would be a false confirmation. §10's "retried on next cron cycle"
   * still holds — the cadence's due-check does not see a stamp — so 503 is the
   * honest answer: the refresh did not happen and will be retried.
   */
  async refreshById(id: string): Promise<MaterializedView> {
    const row = await this.registryRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Materialized view not found');
    }

    // Checked before the attempt so a malformed registry row is reported as the
    // server-side data defect it is, rather than as a transient refresh failure.
    this.assertRefreshableName(row.name);

    const refreshedAt = new Date();
    const ok = await this.refreshRow(row, refreshedAt);
    if (!ok) {
      throw new ServiceUnavailableException(
        `Materialized view ${row.name} could not be refreshed; it will be retried on the next refresh cycle`,
      );
    }

    return { ...row, last_refreshed: refreshedAt };
  }

  /**
   * The §7.3 outbox-triggered path, debounced to at most one refresh per view per
   * 5 minutes with a Redis key.
   *
   * **Not wired to an event, and that is the documented state rather than an
   * omission.** §7.3's own note records that `EventHandlerRegistry` has exactly
   * one registration (`AttendanceEventRecorded.v1` to loyalty), so no handler
   * exists for invoices, workout sessions or membership termination; the plan
   * states registering them "is **not** required for correctness" because a
   * refresh recomputes the whole view. This method is the debounced primitive
   * those handlers call — the "Redis lock" §7.4's table names — so the wiring
   * that lands later calls one tested path instead of inventing its own.
   *
   * The debounce key is written **before** the refresh, not after: a slow refresh
   * must not let the events arriving while it runs queue up behind it.
   *
   * Returns whether a refresh was actually performed; `false` means debounced,
   * failed, or no registry row by that name.
   */
  async refreshOnEvent(name: string, now: Date = new Date()): Promise<boolean> {
    const key = this.debounceKey(name);
    const withinWindow = await this.cacheManager.get<boolean>(key);
    if (withinWindow) {
      this.logger.debug(
        `Materialized view ${name} refresh debounced (section 7.3: at most once per ${
          MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS / 1000
        }s)`,
      );
      return false;
    }
    await this.cacheManager.set(key, true, MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS);

    const row = await this.registryRepository.findOne({ where: { name } });
    if (!row) {
      this.logger.debug(`Materialized view ${name} is not registered; event refresh ignored`);
      return false;
    }

    return this.refreshRow(row, now);
  }

  /**
   * `REFRESH MATERIALIZED VIEW "<name>"` plus the §7.4 stamp, for one row.
   *
   * Returns `true` on success. Never throws on a refresh failure: the cron sweep
   * must continue with the remaining views (§10). The only throw is the
   * identifier guard, which is a registry-data defect rather than a refresh
   * failure — and even that is caught here, counted as a failed row, so the sweep
   * keeps going.
   */
  private async refreshRow(row: MaterializedView, refreshedAt: Date = new Date()): Promise<boolean> {
    const name = row.name;
    try {
      this.assertRefreshableName(name);
      await this.dataSource.query(`REFRESH MATERIALIZED VIEW "${name}"`);
      await this.registryRepository.update(row.id, { last_refreshed: refreshedAt });
      await this.resetConsecutiveFailures(name);
      this.logger.log(`Refreshed materialized view ${name}`);
      return true;
    } catch (error) {
      const failures = await this.recordConsecutiveFailure(name);
      this.logger.error(
        `Materialized view ${name} refresh failed (${failures} consecutive): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (failures >= MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD) {
        // Section 10: "Alert after 3 consecutive failures." Logged at error level,
        // which is the alertable signal this application has (Sentry's global
        // filter is wired in AppModule and captures errors; no separate alert
        // channel exists).
        this.logger.error(
          `ALERT: materialized view ${name} has failed ${failures} consecutive refreshes (section 10)`,
        );
      }
      return false;
    }
  }

  /**
   * The one place a view name is interpolated into SQL, and therefore the one
   * place it is validated. A name that is not a plain PostgreSQL identifier
   * cannot reach the database as SQL text.
   */
  private assertRefreshableName(name: unknown): asserts name is string {
    if (!isRefreshableMaterializedViewName(name)) {
      throw new InternalServerErrorException(
        `Registered materialized view name ${JSON.stringify(name)} is not a valid view identifier`,
      );
    }
  }

  /** Increment §10's consecutive-failure count and return the new value. */
  private async recordConsecutiveFailure(name: string): Promise<number> {
    const key = this.failuresKey(name);
    const current = (await this.cacheManager.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.cacheManager.set(key, next);
    return next;
  }

  /** A successful refresh clears §10's consecutive-failure count. */
  private async resetConsecutiveFailures(name: string): Promise<void> {
    await this.cacheManager.set(this.failuresKey(name), 0);
  }
}