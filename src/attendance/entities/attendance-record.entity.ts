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
   * Staff user (IDENTITY_USERS.id) that performed the manual check-in.
   * Nullable because device/biometric records have no staff actor.
   */
  @Column({ type: 'uuid', nullable: true })
  checked_in_by?: string | null;
}
