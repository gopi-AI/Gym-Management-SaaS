import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Append-only AI audit event.
 *
 * Privacy invariants (enforced by the service that writes this entity):
 * - the FULL prompt is never stored; only a server-generated SHA-256
 *   `prompt_hash` plus a short, non-sensitive `prompt_summary`;
 * - the FULL AI response is never stored; only a short, non-sensitive
 *   `response_summary`;
 * - `tool_calls` stays null because AI tools are out of scope;
 * - JWTs, refresh tokens, MFA secrets/keys, password hashes and API keys are
 *   never persisted.
 */
@Entity('AI_AUDIT_EVENTS')
export class AiAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  user_id!: string;

  @Column({ type: 'varchar', length: 100 })
  request_type!: string;

  @Column({ type: 'varchar', length: 50 })
  provider!: string;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  /** Server-generated SHA-256 hex digest of the exact provider prompt. */
  @Column({ type: 'varchar', length: 64 })
  prompt_hash!: string;

  /** Short, non-sensitive description of the request (never the prompt). */
  @Column({ type: 'varchar', length: 500 })
  prompt_summary!: string;

  /** Short, non-sensitive description of the result (never the response). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  response_summary?: string | null;

  /** Reserved for future tool support; always null in this batch. */
  @Column({ type: 'jsonb', nullable: true })
  tool_calls?: Record<string, unknown>[] | null;

  @Column({ type: 'int', default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', default: 0 })
  output_tokens!: number;

  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  error_code?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
