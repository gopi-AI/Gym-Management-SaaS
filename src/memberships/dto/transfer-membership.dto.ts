import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * Body for `POST /v1/memberships/:id/transfer`.
 *
 * Transfer is naturally idempotent — repeating it with the current branch is a
 * no-op — so it carries no idempotency key. `to_branch_id` is validated against
 * the membership's authorized organization before any write.
 *
 * Every property is decorated because the global ValidationPipe runs with
 * `whitelist: true` — an undecorated field would be silently dropped.
 */
export class TransferMembershipDto {
  @IsUUID()
  to_branch_id!: string;

  @IsString()
  @IsOptional()
  @Length(1, 500)
  reason?: string;
}
