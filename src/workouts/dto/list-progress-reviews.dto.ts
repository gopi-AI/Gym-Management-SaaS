import { IsOptional, IsUUID } from 'class-validator';

/** Progress-review listing filters. */
export class ListProgressReviewsDto {
  @IsOptional()
  @IsUUID()
  assignment_id?: string;
}
