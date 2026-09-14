import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Per-request AI usage record.
 *
 * Tenant/security invariants:
 * - `organization_id` is ALWAYS the authorized organization resolved through
 *   TenantContextService.requireOrganizationAccess() — never a client value.
 * - `user_id` is ALWAYS the authenticated user id taken from the verified JWT.
 * - No prompt, response, API key, JWT, MFA secret or password hash is stored.
 */
@Entity('AI_USAGE')
export class AiUsage {
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

  @Column({ type: 'int', default: 0 })
  input_tokens!: number;

  @Column({ type: 'int', default: 0 })
  output_tokens!: number;

  @Column({ type: 'int', default: 0 })
  total_tokens!: number;

  @Column({ type: 'int', default: 0 })
  latency_ms!: number;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  estimated_cost_usd?: string | null;

  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  error_code?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
