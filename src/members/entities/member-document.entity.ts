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
import { DocumentType } from './document-type.enum';

/**
 * MemberDocument — the file itself (S3 key + metadata).
 *
 * Independent of MemberConsent: a document can exist with no consent record
 * (e.g. a photo or ID upload). Conversely, a consent can be granted with no
 * linked document (verbal consent). The optional `document_id` FK on
 * MemberConsent bridges them when a signed form was uploaded.
 *
 * S3 key convention (Q25):
 *   `orgs/{orgId}/members/{memberId}/documents/{uuid}/{fileName}`
 */
@Entity('MEMBERS_MEMBER_DOCUMENTS')
@Index(['organization_id', 'member_id'])
export class MemberDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 50 })
  document_type!: DocumentType;

  /** Original human-friendly file name (e.g. "signed_waiver_2026.pdf") */
  @Column({ type: 'varchar', length: 500 })
  file_name!: string;

  /** Full S3 storage path (Q25 convention) */
  @Column({ type: 'varchar', length: 2000 })
  s3_key!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mime_type?: string | null;

  @Column({ type: 'int', nullable: true })
  file_size_bytes?: number | null;

  /** User id of the uploader */
  @Column({ type: 'uuid' })
  uploaded_by!: string;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  uploaded_at!: Date;

  @ManyToOne(() => Member, (member) => member.documents)
  @JoinColumn({ name: 'member_id' })
  member!: Member;
}