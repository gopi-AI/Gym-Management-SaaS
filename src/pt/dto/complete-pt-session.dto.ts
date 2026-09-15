import { IsOptional, IsString, IsDateString } from 'class-validator';

/**
 * Input for completing a `PTSession` (§12 Q1).
 *
 * `workout_session_id` is deliberately NOT accepted here — the optional link to
 * a logged workout is manual only (Q27) and has its own operation
 * (`PtSessionsService.linkWorkoutSession()`); completion must never set it.
 */
export class CompletePtSessionDto {
  /** Defaults to "now" when omitted. */
  @IsDateString()
  @IsOptional()
  actual_start?: string;

  /** Defaults to `actual_start` when omitted. */
  @IsDateString()
  @IsOptional()
  actual_end?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}