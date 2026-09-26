import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { CancelPtEnrollmentDto } from '../dto/cancel-pt-enrollment.dto';
import { PtEnrollmentsService } from '../services/pt-enrollments.service';

@Controller('v1/pt/enrollments')
export class PtEnrollmentsController {
  constructor(private readonly enrollments: PtEnrollmentsService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'pt', action: 'delete' })
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelPtEnrollmentDto,
  ) {
    return this.enrollments.cancel(id, dto);
  }
}