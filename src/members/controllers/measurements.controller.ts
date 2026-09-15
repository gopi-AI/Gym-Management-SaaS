import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MeasurementLogsService } from '../services/measurement-logs.service';
import { CreateMeasurementDto } from '../dto/create-measurement.dto';
import { ListMeasurementsDto } from '../dto/list-measurements.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

@Controller('v1/members')
export class MeasurementsController {
  constructor(
    private readonly measurementLogsService: MeasurementLogsService,
  ) {}

  @Post(':memberId/measurements')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'measurement', action: 'create' })
  async create(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: CreateMeasurementDto,
  ) {
    dto.member_id = memberId;
    return this.measurementLogsService.create(dto);
  }

  @Get(':memberId/measurements')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'measurement', action: 'read' })
  async findAll(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: ListMeasurementsDto,
  ) {
    query.member_id = memberId;
    return this.measurementLogsService.findAll(query);
  }
}