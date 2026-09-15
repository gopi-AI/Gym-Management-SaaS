import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { MemberDocument } from './member-document.entity';
import { ConsentType } from './consent-type.enum';

/**
 * Append-only consent ledger.
 *
 * Every grant or revocation inserts a NEW row — NEVER an UPDATE on an existing
 * row (see `.clinerules`-approved design decision for Q23). The "current
 * status" for a (member, consent_type) pair is the latest row by `created_at`.
 *
 * This preserves the full audit trail required for GDPR: we can always prove
 * *when* and *why* a consent was granted and withdrawn, because the history is
 * immutable.
 */
@Entity('MEMBERS_MEMBER_CONSENTS')
@Index(['organization_id', 'member_id', 'consent_type', 'created_at'])
export class MemberConsent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 50 })
  consent_type!: ConsentType;

  /** true = granted, false = revoked (this row is a revocation record) */
  @Column({ type: 'boolean' })
  is_given!: boolean;

  @Column({ type: 'timestamptz' })
  given_at!: Date;

  /** Only populated when this row is a revocation (is_given = false). */
  @Column({ type: 'timestamptz', nullable: true })
  revoked_at?: Date | null;

  /** Optional compliance/audit reason for the revocation. */
  @Column({ type: 'text', nullable: true })
  revocation_reason?: string | null;

  /** Optional expiry; can be null for non-expiring consents. */
  @Column({ type: 'timestamptz', nullable: true })
  expires_at?: Date | null;

  /** Nullable FK → MemberDocument, used only when a signed form was uploaded. */
  @Column({ type: 'uuid', nullable: true })
  document_id?: string | null;

  @Column({ type: 'int', nullable: true })
  version?: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @ManyToOne(() => Member, (member) => member.consents)
  @JoinColumn({ name: 'member_id' })
  member!: Member;

  @ManyToOne(() => MemberDocument, { nullable: true })
  @JoinColumn({ name: 'document_id' })
  document?: MemberDocument | null;
}