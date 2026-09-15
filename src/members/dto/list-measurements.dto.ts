import { IsOptional, IsEnum, IsUUID, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { MeasurementType } from '../entities/measurement-log.entity';

export class ListMeasurementsDto {
  @IsUUID()
  member_id!: string;

  @IsEnum(MeasurementType)
  @IsOptional()
  measurement_type?: MeasurementType;

  @IsDateString()
  @IsOptional()
  date_from?: string;

  @IsDateString()
  @IsOptional()
  date_to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}