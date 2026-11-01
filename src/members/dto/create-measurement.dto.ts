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

/**
 * Body of POST /v1/members/:memberId/measurements.
 *
 * The target member is the route parameter, never the body. Omitting
 * `member_id` here is deliberate: the global ValidationPipe validates this DTO
 * before the controller runs, so a required body field could never be filled
 * from the URL in time. With `whitelist: true` a client-supplied `member_id`
 * is stripped before the handler sees it, so it cannot compete with the route
 * parameter; ownership is still proven by the service's org-scoped lookup.
 */
export class CreateMeasurementDto {
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