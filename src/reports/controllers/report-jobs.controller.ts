import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { ReportJobsService } from '../services/report-jobs.service';
import { ExecuteReportDto, ReportJobResponse } from '../dto/report-job.dto';

/**
 * Report-job trigger and status (§4.1/§4.2, `docs/api-plan.md` §Reports).
 *
 * **Paths are §4's, verbatim**: `POST /v1/report/schemas/{id}/execute` (§4.1 — executing
 * a report is a schemas sub-route, which is why this controller is rooted at
 * `/v1/report` rather than `/v1/report/jobs`) and `GET /v1/report/jobs/{id}` (§4.2).
 *
 * **Execution is asynchronous and this endpoint does not wait for it.** It returns the
 * created job's id/status immediately; the `ReportJobWorker` (Phase B) drains the queue,
 * and the caller polls §4.2's status route. Nothing here runs a query or touches Phase
 * B's claim/execute path.
 *
 * **Permission**: `report:view`, because §9.1 defines `REPORT_VIEW` as "View report
 * catalog **+ run reports**" — there is no separate `report:run` action in §9.1, and
 * inventing one would leave the route guarded by a permission no migration provisions.
 */
@Controller('v1/report')
export class ReportJobsController {
  constructor(private readonly reportJobsService: ReportJobsService) {}

  /**
   * `POST /v1/report/schemas/{id}/execute` (§4.1, "Execute a report (async — creates a
   * job)").
   *
   * The `Retry-After` header is set here rather than in the service because §10 specifies
   * it ("429 … with the current pending count and a `Retry-After` header") and a response
   * header is only reachable from the request pipeline. Nest's `HttpException` carries a
   * body, not headers, so the body's `retryAfterSeconds` — computed by the service from
   * the worker's own configured cadence — is copied onto the response.
   */
  @Post('schemas/:id/execute')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'report', action: 'view' })
  async execute(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ExecuteReportDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void },
  ): Promise<ReportJobResponse> {
    try {
      return await this.reportJobsService.execute(id, dto);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        const body: unknown = error.getResponse();
        const retryAfterSeconds =
          typeof body === 'object' && body !== null && 'retryAfterSeconds' in body
            ? (body as { retryAfterSeconds?: unknown }).retryAfterSeconds
            : undefined;
        if (typeof retryAfterSeconds === 'number') {
          res.setHeader('Retry-After', String(retryAfterSeconds));
        }
      }
      throw error;
    }
  }

  /** §4.2: "Get job status, progress, and result metadata". */
  @Get('jobs/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'report', action: 'view' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ReportJobResponse> {
    return this.reportJobsService.findOne(id);
  }
}
