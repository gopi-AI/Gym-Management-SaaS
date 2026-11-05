import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Snapshot of one existing measurement used at a progress review
 * (`WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS`).
 *
 * The FK references the real `MEMBERS_MEMBER_MEASUREMENTS` row — there is no
 * duplicate measurement source of truth. The value/unit/type/date are copied
 * so a later data change cannot silently rewrite what the review relied on.
 */
@Entity('WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS')
@Unique(['review_id', 'measurement_id'])
@Index(['review_id'])
export class ProgressReviewMeasurement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  review_id!: string;

  @Column({ type: 'uuid' })
  measurement_id!: string;

  @Column({ type: 'varchar', length: 50 })
  measurement_type!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  value!: number;

  @Column({ type: 'varchar', length: 10 })
  unit!: string;

  @Column({ type: 'timestamptz' })
  measured_at!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
