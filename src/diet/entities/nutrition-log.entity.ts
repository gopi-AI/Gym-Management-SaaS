import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * A member's logged meal (`DIET_NUTRITION_LOGS`, Q9/Q10).
 *
 * Two mutually exclusive forms (Q9):
 *   - TEMPLATED: `meal_template_id` set → macros are computed as
 *     `template_value × servings` AT LOG TIME and SNAPSHOTTED onto this row.
 *     Immutable — a later edit to the template never retroactively changes past logs
 *     (Q10's core invariant).
 *   - FREE-TEXT: `meal_template_id` null → `meal_description` holds the
 *     free-text entry; macro columns are entered manually and MAY remain null.
 *
 * A row MUST never have both a template reference AND independently-editable
 * manually-entered macros. When `meal_template_id` is set, the macro columns are
 * ALWAYS the computed/derived values and are never independently editable.
 *
 * **NULUM-MACRO AGGREGATION RULE**: daily/weekly totals EXCLUDE rows with null
 * macros (Q9/Q10 addendum). The aggregation NEVER uses `COALESCE(x, 0)` to
 * treat a null as zero. Instead `{calories, proteinG, carbsG, fatG}` sums
 * only non-null rows, and a separate `mealsMissingMacros` count is surfaced for
 * the same period.
 */
@Entity('DIET_NUTRITION_LOGS')
@Index(['organization_id', 'member_id', 'log_date'])
@Index(['meal_template_id'])
export class NutritionLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  /** Nullable FK to the `DietPlanAssignment` this meal was logged against. */
  @Column({ type: 'uuid', nullable: true })
  assignment_id?: string | null;

  /**
   * When set, this is a templated meal and the macro columns below are the
   * computed/derived values (`template_value × servings`).
   */
  @Column({ type: 'uuid', nullable: true })
  meal_template_id?: string | null;

  /**
   * When `meal_template_id` is null, holds the free-text entry (Q9).
   */
  @Column({ type: 'text', nullable: true })
  meal_description?: string | null;

  @Column({ type: 'date' })
  log_date!: string;

  @Column({ type: 'int' })
  servings!: number;

  @Column({ type: 'timestamptz' })
  logged_at!: Date;

  /** Nullable — null means "no macro data submitted" (excluded from totals). */
  @Column({ type: 'int', nullable: true })
  calories?: number | null;

  /** Nullable — EXCLUDED from totals when null. */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  protein_g?: string | null;

  /** Nullable — EXCLUDED from totals when null. */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  carbs_g?: string | null;

  /** Nullable — EXCLUDED from totals when null. */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  fat_g?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
