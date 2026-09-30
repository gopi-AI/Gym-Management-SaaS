import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';

/**
 * Shared object-storage infrastructure for member documents.
 *
 * @Global-scoped so any module can inject `S3Service` without importing this
 * module individually — the single storage dependency, provided once. Every
 * consumer already goes through the service (the local-filesystem branch in
 * non-production, AWS S3 in production), so there is no per-feature duplicate.
 *
 * Configuration is read directly from `process.env` inside `S3Service`
 * (`S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`) rather than through
 * `ConfigService`; see `.env.example`.
 */
@Global()
@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}