import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';
import { OutboxPoller } from './outbox.poller';

/**
 * Shared outbox infrastructure.
 *
 * Extracted from the per-feature modules so that the transactional outbox has a
 * SINGLE provider instance shared by every writer (members, memberships,
 * attendance, finance) and by the background workers that drain it. Feature
 * modules import this module instead of re-registering `OutboxEntity` /
 * `OutboxService` themselves, which previously produced one outbox service (and
 * one poller) per feature module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEntity])],
  providers: [OutboxService, OutboxPoller],
  exports: [OutboxService, OutboxPoller, TypeOrmModule],
})
export class OutboxModule {}
