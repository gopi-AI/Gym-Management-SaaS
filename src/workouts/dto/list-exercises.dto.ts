import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ExerciseCategory } from '../entities/exercise-category.enum';

/**
 * Exercise-library browse/search filters.
 *
 * Boolean query params use an explicit transform: `@Type(() => Boolean)`
 * inverts `?is_active=false` (DEF-01). The `@Transform` form is the shipped
 * convention.
 */
export class ListExercisesDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsEnum(ExerciseCategory)
  category?: ExerciseCategory;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_active?: boolean;
}
