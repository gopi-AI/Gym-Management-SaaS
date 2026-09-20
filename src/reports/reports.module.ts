import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportJob } from './entities/report-job.entity';
import { ReportSchema } from './entities/report-schema.entity';
import { MaterializedView } from './entities/materialized-view.entity';
import { ReportQueryValidator } from './services/report-query-validator.service';
import { ReportQueryBuilder } from './services/report-query-builder.service';
import { ReportJobService } from './services/report-job.service';
import { ReportJobWorker } from './workers/report-job.worker';

/**
 * Reports: the report executor (P6-02/P6-03).
 *
 * Phase A's `ReportQueryValidator` + `ReportQueryBuilder` and Phase B's
 * `ReportJobService` + `ReportJobWorker` live here. No controllers yet — §4.x's routes
 * are not part of either phase.
 *
 * `ReportJobWorker` is exported so `WorkersModule` can register it the same way it
 * registers every other worker (it imports domain modules and lists their workers),
 * keeping the enable/disable switch and the scheduler registration in one place.
 *
 * `MaterializedView` is registered because §3.3's registry entity belongs to this
 * domain and §7.4's refresh work will need it; nothing in Phase A/B reads it yet.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReportJob, ReportSchema, MaterializedView])],
  providers: [ReportQueryValidator, ReportQueryBuilder, ReportJobService, ReportJobWorker],
  exports: [
    ReportQueryValidator,
    ReportQueryBuilder,
    ReportJobService,
    ReportJobWorker,
    TypeOrmModule,
  ],
})
export class ReportsModule {}
