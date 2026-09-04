import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('MEMBERS_LOCAL_ID_COUNTERS')
@Index(['organization_id'], { unique: true })
export class LocalIdCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'int', default: 0 })
  last_local_id!: number;
}