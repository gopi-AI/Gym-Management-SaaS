import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ExerciseCategory } from '../entities/exercise-category.enum';

/** Partial update of an exercise-library row (all fields optional). */
export class UpdateExerciseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ExerciseCategory)
  category?: ExerciseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  muscle_group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  equipment_needed?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
