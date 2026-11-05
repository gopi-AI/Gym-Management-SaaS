import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One ordered slot in a reusable weekly plan template. */
export class PlanTemplateDayInputDto {
  /** Reference to a reusable day template; null/omitted for a rest marker. */
  @IsOptional()
  @IsUUID()
  day_template_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  day_label?: string;

  @IsOptional()
  @IsBoolean()
  is_rest_day?: boolean;

  @IsOptional()
  @IsBoolean()
  is_optional?: boolean;

  @IsInt()
  @Min(0)
  day_order!: number;
}

/**
 * Replace the complete ordered day list of a weekly plan template.
 *
 * The plan order is a stable rolling sequence, not a calendar: `day_order`
 * decides what follows what. Rest markers are snapshotted for display but are
 * never prescribed workout days.
 */
export class SetPlanTemplateDaysDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanTemplateDayInputDto)
  days!: PlanTemplateDayInputDto[];
}
