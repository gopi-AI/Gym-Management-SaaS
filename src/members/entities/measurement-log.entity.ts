import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Member } from './member.entity';

export enum MeasurementType {
  WEIGHT = 'weight',
  BODY_FAT = 'body_fat',
  CHEST = 'chest',
  WAIST = 'waist',
  HIP = 'hip',
  ARM = 'arm',
  THIGH = 'thigh',
  CALF = 'calf',
}

@Entity('MEMBERS_MEMBER_MEASUREMENTS')
@Index(['organization_id', 'member_id', 'measurement_type', 'measured_at'])
export class MeasurementLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'enum', enum: MeasurementType })
  measurement_type!: MeasurementType;

  @Column({ type: 'numeric', precision: 8, scale: 2 })
  value!: number;

  @Column({ type: 'varchar', length: 10 })
  unit!: string;

  @Column({ type: 'timestamptz' })
  measured_at!: Date;

  @Column({ type: 'uuid', nullable: true })
  measured_by?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @ManyToOne(() => Member, (member) => member.measurementLogs)
  @JoinColumn({ name: 'member_id' })
  member!: Member;
}