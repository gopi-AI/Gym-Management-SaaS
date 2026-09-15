import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
  IsIn,
} from 'class-validator';
import { MeasurementType } from '../entities/measurement-log.entity';

export class CreateMeasurementDto {
  @IsUUID()
  member_id!: string;

  @IsEnum(MeasurementType)
  measurement_type!: MeasurementType;

  @IsNumber()
  @Min(0.01)
  value!: number;

  @IsString()
  @IsIn(['kg', 'lb', '%', 'cm', 'in'])
  unit!: string;

  @IsDateString()
  measured_at!: string;

  @IsUUID()
  @IsOptional()
  measured_by?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}