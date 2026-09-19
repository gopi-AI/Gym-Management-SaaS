import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { MemberIdentifier } from './member-identifier.entity';
import { MemberProfile } from './member-profile.entity';
import { MeasurementLog } from './measurement-log.entity';
import { MemberConsent } from './consent-log.entity';
import { MemberDocument } from './member-document.entity';

@Entity('MEMBERS_MEMBERS')
@Index(['organization_id', 'local_id'], { unique: true })
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  branch_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  global_uuid!: string;

  @Column({ type: 'int' })
  local_id!: number;

  @Column({ type: 'varchar', length: 255 })
  first_name!: string;

  @Column({ type: 'varchar', length: 255 })
  last_name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  middle_name?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  preferred_name?: string;

  @Column({ type: 'date', nullable: true })
  date_of_birth?: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gender?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address_line1?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address_line2?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  state?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  postal_code?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  country?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /**
   * P3-04 — tax exemption (§15 Q7 ruling: the flag lives on the MEMBER).
   *
   * An exempt member is charged no tax on any invoice line, but the tax that would
   * have applied is still recorded on `FINANCE_TAX_LINES` as a zero-rated audit
   * row, so an exemption can be reviewed after the fact.
   *
   * `tax_exempt_reason` is why the exemption was granted. It is nullable rather
   * than conditionally required in the database; `UpdateMemberDto` requires it at
   * the API boundary when the flag is set, because the reason is a human
   * explanation and a database CHECK cannot tell a real one from a placeholder.
   */
  @Column({ type: 'boolean', default: false })
  tax_exempt!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tax_exempt_reason?: string | null;

  @OneToMany(() => MemberIdentifier, (identifier) => identifier.member)
  identifiers!: MemberIdentifier[];

  @OneToMany(() => MemberProfile, (profile) => profile.member)
  profiles!: MemberProfile[];

  @OneToMany(() => MeasurementLog, (log) => log.member)
  measurementLogs!: MeasurementLog[];

  @OneToMany(() => MemberConsent, (consent) => consent.member)
  consents!: MemberConsent[];

  @OneToMany(() => MemberDocument, (document) => document.member)
  documents!: MemberDocument[];
}