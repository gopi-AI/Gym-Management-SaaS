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
import { AttendanceService } from '../services/attendance.service';
import { AttendanceEventDto } from '../dto/attendance-event.dto';
import { QueryAttendanceRecordsDto } from '../dto/query-attendance-records.dto';
import { QueryAccessDecisionsDto } from '../dto/query-access-decisions.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Attendance API (`docs/api-plan.md` §Attendance).
 *
 * Check-in is recorded through the documented `POST /v1/attendance/events` route.
 * Check-out is its own route (`POST /v1/attendance/check-out`) because it is a
 * distinct operation with its own permission (`attendance:check-out`), and
 * `@RequirePermissions` ANDs its entries — a single route cannot express
 * "check-in OR check-out" without letting a check-in-only operator check members
 * out.
 *
 * A refused check-in answers 403 with a `reason` and still leaves its event +
 * access-decision audit rows behind (see `AttendanceService`); an attendance
 * state conflict (already checked in / not checked in) answers 409.
 */
@Controller('v1/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'attendance', action: 'check-in' })
  async checkIn(@Body() dto: AttendanceEventDto) {
    return this.attendanceService.recordCheckIn(dto);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'attendance', action: 'check-out' })
  async checkOut(@Body() dto: AttendanceEventDto) {
    return this.attendanceService.recordCheckOut(dto);
  }

  @Get('records')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async findRecords(@Query() query: QueryAttendanceRecordsDto) {
    return this.attendanceService.findRecords(query);
  }

  @Get('records/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async findRecord(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.attendanceService.findRecord(id);
  }

  @Get('access-decisions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async findAccessDecisions(@Query() query: QueryAccessDecisionsDto) {
    return this.attendanceService.findAccessDecisions(query);
  }
}
