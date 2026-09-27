import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — add `ATTENDANCE_ATTENDANCE_RECORDS.duration_minutes` (P6-38).
 *
 * Resolves §6.3's "Avg Session Duration" row, which declares `avg_duration` — a
 * measure that exists only as `AVG(check_out_time - check_in_time)`, an aggregate
 * over a **difference of two columns**. §3.1.1's `columns` contract admits exactly
 * three shapes (a plain column, a closed-set aggregate over a column, a closed-set
 * time bucket), so the row could not be declared at all; it was deliberately left
 * out of the initial 11-row seed (P6-07 / `1788965263405`) pending this decision.
 *
 * **The decision — persist the duration, do not widen the DSL.** The alternative
 * (Option A: extend the query DSL to admit a declared column-difference
 * expression) was rejected because `src/reports/types/query-definition.ts` records
 * that admitting arithmetic there "would reopen the hole the allowlist exists to
 * close", it is shared platform work (expression grammar, null handling, duration
 * units), and P6-43 already set the precedent of *not* widening the DSL for a
 * report that did not need it. Storing the difference at write time reduces the
 * measure to `AVG(duration_minutes)`, which the existing contract already accepts.
 *
 * Two steps, in this order — the same shape as
 * `1788965263403-AddOrganizationIdToLoyaltyTransactions.ts`, minus its final
 * `SET NOT NULL`:
 *
 * 1. Add the column nullable. It cannot be NOT NULL: an **open** session genuinely
 *    has no duration, and `check_out_time IS NULL` is the "still checked in" state
 *    that the partial UNIQUE index `UQ_attendance_open_record` relies on. A `0`
 *    placeholder would be indistinguishable from a real zero-length visit, so
 *    NULL is the correct representation of "not finished yet". Unlike the
 *    loyalty backfill above, this column is therefore **never** made NOT NULL.
 * 2. Backfill existing rows. Deterministic for every closed session: the value is
 *    computed from the row's own `check_in_time`/`check_out_time`, with no join,
 *    no default, no guess and no heuristic. Rows still open stay NULL, which is
 *    exactly the set that has no duration.
 *
 * **No new index, deliberately.** The report's access path is the tenant filter
 * plus the `check_in_time` date range, which `IDX_attendance_records_org_time`
 * (`(organization_id, check_in_time)`, created in
 * `1788965263233-CreateAttendanceSchema.ts:89-92`) already serves. An index on
 * `duration_minutes` would not be used: the column is never filtered on, only
 * averaged, and an `AVG` cannot be answered from an index without a scan of the
 * matching rows anyway. Adding one would be an unused index on a write path taken
 * on every front-desk check-out.
 *
 * **Expression parity.** The backfill's arithmetic is byte-for-byte the expression
 * §7.2's `reports_mv_daily_attendance` already uses for the same figure
 * (`1788965263406-CreateReportingMaterializedViews.ts:55`):
 * `EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 60`. `ROUND(...)::int` is
 * written explicitly rather than relying on `::int`'s rounding, because
 * `EXTRACT`'s return type is version-dependent (`numeric` on PostgreSQL 16, where
 * `::int` rounds; `double precision` on others, where `::int` would truncate) —
 * the MV relies on the `numeric` behaviour, so the explicit `ROUND` keeps the two
 * copies in agreement on any supported server. `numeric`'s `ROUND` resolves an
 * exact half **away from zero**, and the application's `elapsedMinutes`
 * (`attendance.service.ts`) applies that same rule rather than `Math.round`'s
 * tie-toward-`+Infinity`, which would put the stored and the backfilled value a
 * minute apart on the same reversed session. The two therefore agree over the
 * **whole** domain, not only the positive half of it: 90.5 minutes → 91,
 * −0.5 minutes → −1, −1.5 minutes → −2.
 *
 * **Negative durations are stored, never clamped.** The `UPDATE` below filters
 * only `check_out_time IS NOT NULL`: there is no ordering guard and no
 * `GREATEST(..., 0)`. If `check_out_time` precedes `check_in_time` — a
 * mis-stamped device event, a backwards server-clock step, or an operator
 * correction — the backfill writes the negative number the arithmetic produces,
 * exactly as the application's check-out path writes it for the same row.
 * Clamping it here would replace the value the two timestamps state with one they
 * do not, and the report's `AVG(duration_minutes)` would carry that substitution
 * silently; a negative duration is the signal that the timestamps disagree, so it
 * is deliberately left visible. `elapsedMinutes` in `attendance.service.ts`
 * records the same decision on the write path. That is also why the column stays
 * `integer` and nullable below, with no `CHECK` added.
 *
 * The application writes this column on the check-out path
 * (`AttendanceService.checkOut()`), in the same transaction that stamps
 * `check_out_time`. This migration only backfills history that predates it.
 */
export class AddAttendanceDurationMinutes1788965263409 implements MigrationInterface {
    name = 'AddAttendanceDurationMinutes1788965263409'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_RECORDS"
            ADD COLUMN "duration_minutes" integer;
        `);

        await queryRunner.query(`
            UPDATE "ATTENDANCE_ATTENDANCE_RECORDS"
               SET "duration_minutes" =
                   ROUND(EXTRACT(EPOCH FROM ("check_out_time" - "check_in_time")) / 60)::int
             WHERE "check_out_time" IS NOT NULL
               AND "duration_minutes" IS NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_RECORDS"
            DROP COLUMN "duration_minutes";
        `);
    }
}
