import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ReportJob } from './entities/report-job.entity';
import { ReportSchema } from './entities/report-schema.entity';
import { MaterializedView } from './entities/materialized-view.entity';
import { ReportQueryValidator } from './services/report-query-validator.service';
import { ReportQueryBuilder } from './services/report-query-builder.service';
import { ReportJobService } from './services/report-job.service';
import { ReportSchemasService } from './services/report-schemas.service';
import { ReportJobsService } from './services/report-jobs.service';
import { MaterializedViewRefreshService } from './services/materialized-view-refresh.service';
import { ReportSchemasController } from './controllers/report-schemas.controller';
import { ReportJobsController } from './controllers/report-jobs.controller';
import { ReportJobWorker } from './workers/report-job.worker';
import { MaterializedViewRefreshWorker } from './workers/materialized-view-refresh.worker';

/**
 * Reports: the report executor (P6-02/P6-03) and its HTTP surface (P6-04 piece 1, §4).
 *
 * Phase A's `ReportQueryValidator` + `ReportQueryBuilder` and Phase B's
 * `ReportJobService` + `ReportJobWorker` live here, unchanged; this module now also
 * serves §4.1/§4.2 through `ReportSchemasController` + `ReportJobsController`.
 *
 * `TenancyModule` is imported for `TenantContextService`, which is how every route
 * resolves the authorized organization — the same dependency the loyalty, attendance and
 * memberships modules use. It is a one-way import: `ReportsModule` queries the domain
 * tables through entity metadata (§2.2's read-only-consumer design), so no domain module
 * imports this one, and there is no cycle.
 *
 * `ReportJobWorker` is exported so `WorkersModule` can register it the same way it
 * registers every other worker (it imports domain modules and lists their workers),
 * keeping the enable/disable switch and the scheduler registration in one place.
 *
 * `MaterializedView` is registered because §3.3's registry entity belongs to this
 * domain and §7.4's refresh work reads it.
 *
 * `MaterializedViewRefreshService` + `MaterializedViewRefreshWorker` are P6-15's
 * §7.3/§7.4 refresh flow: the service treats one registry row as its unit of work
 * (`REFRESH MATERIALIZED VIEW` then stamp `last_refreshed`), and the worker drives
 * it on the `MATERIALIZED_VIEW_REFRESH` cadence. `MaterializedViewRefreshWorker` is
 * exported for the same reason `ReportJobWorker` is — `WorkersModule` registers it
 * alongside every other worker, keeping the enable/disable switch and the scheduler
 * registration in one place.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ReportJob, ReportSchema, MaterializedView]),
    TenancyModule,
  ],
  controllers: [ReportSchemasController, ReportJobsController],
  providers: [
    ReportQueryValidator,
    ReportQueryBuilder,
    ReportJobService,
    ReportSchemasService,
    ReportJobsService,
    MaterializedViewRefreshService,
    ReportJobWorker,
    MaterializedViewRefreshWorker,
  ],
  exports: [
    ReportQueryValidator,
    ReportQueryBuilder,
    ReportJobService,
    ReportSchemasService,
    ReportJobsService,
    MaterializedViewRefreshService,
    ReportJobWorker,
    MaterializedViewRefreshWorker,
    TypeOrmModule,
  ],
})
export class ReportsModule {}
