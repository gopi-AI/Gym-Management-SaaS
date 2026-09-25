import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Front-desk attendance record.
 *
 * Columns follow `docs/database-plan.md` (ERD `ATTENDANCE_ATTENDANCE_RECORDS`):
 *   id, organization_id, branch_id, member_id,
 *   check_in_time, check_out_time, check_in_method, check_out_method
 *
 * `checked_in_by` (the staff user that performed a manual check-in) is the one
 * approved addition to that spec — it is required to attribute a manual
 * front-desk check-in to a staff user for audit purposes.
 *
 * `duration_minutes` (P6-38) is the one *derived* column here, and the only
 * column on this table that is not an observed fact. It exists because §6.3's
 * report contract cannot express the measure it declares: `QueryDefinition`'s
 * `columns` admits a plain column, a closed-set aggregate over a column, or a
 * closed-set time bucket (src/reports/types/query-definition.ts), so
 * `AVG(check_out_time - check_in_time)` — an aggregate over a *difference of two
 * columns* — is not declarable at all. Persisting the difference at write time
 * turns the measure into an ordinary `AVG(duration_minutes)`, which is one of the
 * three admitted shapes. That widening of the schema was chosen over widening the
 * DSL: `query-definition.ts` records that admitting arithmetic there "would reopen
 * the hole the allowlist exists to close", and P6-43 set the precedent of not
 * widening it for the PT report.
 *
 * It is nullable, and stays nullable, because an **open session has no duration**:
 * `check_out_time IS NULL` is the "still checked in" state (the partial UNIQUE
 * index below depends on that), and a placeholder `0` would be indistinguishable
 * from a real zero-length visit and would drag an `AVG` down. `AVG` ignores NULLs,
 * so an unfinished session contributing no duration is the correct arithmetic
 * rather than a special case. The column must never be back-computed from a
 * suggestion — it is written once, at check-out, from the two timestamps.
 *
 * Two further, deliberate deviations from the ERD:
 *   - `branch_id` is nullable. It is optional on the check-in API (single-site
 *     tenants have no branch to name, and the memberships module treats
 *     `branch_id` as optional in exactly the same way), so it cannot be NOT NULL
 *     here without rejecting valid check-ins.
 *   - the partial UNIQUE index on `member_id ... WHERE check_out_time IS NULL` is
 *     not in the ERD but is the database-level guarantee that a member can never
 *     be checked in twice at the same time; the front-desk UI cannot be trusted
 *     to serialize that, and a duplicate open session is unrecoverable data.
 *
 * The table deliberately has no `created_at`/`updated_at`: those columns are not
 * in the database plan and `check_in_time` already carries the record's
 * business timestamp.
 */
@Entity('ATTENDANCE_ATTENDANCE_RECORDS')
@Index(['member_id', 'check_in_time'])
@Index(['organization_id', 'check_in_time'])
@Index(['branch_id', 'check_in_time'])
@Index(['member_id'], { unique: true, where: 'check_out_time IS NULL' })
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  branch_id?: string | null;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'timestamptz' })
  check_in_time!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_time?: Date | null;

  @Column({ type: 'varchar', length: 50, default: 'manual' })
  check_in_method!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  check_out_method?: string | null;

  /**
   * Whole minutes between `check_in_time` and `check_out_time`, rounded to
   * nearest. NULL while the session is open (P6-38).
   *
   * Written only by `AttendanceService.checkOut()`, in the same transaction that
   * stamps `check_out_time`, so the two can never disagree. Kept in lockstep with
   * the SQL in `1788965263409-AddAttendanceDurationMinutes.ts` (the backfill) and
   * with §7.2's `reports_mv_daily_attendance`, which computes the identical figure
   * over the same two timestamps.
   */
  @Column({ type: 'int', nullable: true })
  duration_minutes?: number | null;

  /**
   * Staff user (IDENTITY_USERS.id) that performed the manual check-in.
   * Nullable because device/biometric records have no staff actor.
   */
  @Column({ type: 'uuid', nullable: true })
  checked_in_by?: string | null;
}
