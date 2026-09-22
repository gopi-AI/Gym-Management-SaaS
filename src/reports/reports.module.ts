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
import { ReportSchemasController } from './controllers/report-schemas.controller';
import { ReportJobsController } from './controllers/report-jobs.controller';
import { ReportJobWorker } from './workers/report-job.worker';

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
 * domain and §7.4's refresh work will need it; piece 1 does not read it.
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
    ReportJobWorker,
  ],
  exports: [
    ReportQueryValidator,
    ReportQueryBuilder,
    ReportJobService,
    ReportSchemasService,
    ReportJobsService,
    ReportJobWorker,
    TypeOrmModule,
  ],
})
export class ReportsModule {}
