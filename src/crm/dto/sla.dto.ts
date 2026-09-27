import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from "class-validator";

/**
 * `POST /v1/sla/policies` — the endpoint §15.1 O6 records as missing.
 *
 * §9's API table gives the policy CRUD a Permission column of `—` and says
 * "without a configuration API, policies can only be seeded". Since a net-new
 * table with no way to populate it would leave the whole SLA feature unreachable,
 * the endpoints are built here and guarded with the existing `crm:read` /
 * `crm:update` pair that §9's RBAC table defines. No new permission is invented
 * for them.
 */
export class CreateSlaPolicyDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsString() @Length(1, 50) applies_to?: string;
  @IsInt() @Min(1) first_response_hours!: number;
  @IsInt() @Min(1) follow_up_interval_hours!: number;
  @IsInt() @Min(1) escalation_after_hours!: number;
  /** Optional cap — §9's "Follow-up fatigue" mitigation. Null/absent = uncapped. */
  @IsOptional() @IsInt() @Min(1) max_follow_ups_per_period?: number;
  @IsOptional() @IsInt() @Min(1) cap_period_days?: number;
}

/** `PATCH /v1/sla/policies/:id` — update or deactivate an org-owned policy. */
export class UpdateSlaPolicyDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 50) applies_to?: string | null;
  @IsOptional() @IsInt() @Min(1) first_response_hours?: number;
  @IsOptional() @IsInt() @Min(1) follow_up_interval_hours?: number;
  @IsOptional() @IsInt() @Min(1) escalation_after_hours?: number;
  @IsOptional() @IsInt() @Min(1) max_follow_ups_per_period?: number | null;
  @IsOptional() @IsInt() @Min(1) cap_period_days?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

/** `GET /v1/sla/reports` — SLA compliance reporting for the authorized org. */
export class SlaReportQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
