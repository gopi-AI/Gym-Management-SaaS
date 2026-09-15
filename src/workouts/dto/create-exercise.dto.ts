import {
  IsUUID,
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ExerciseCategory } from '../entities/exercise-category.enum';

export class CreateExerciseDto {
  @IsUUID()
  organization_id!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

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