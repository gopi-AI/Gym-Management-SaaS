import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEntity } from './outbox.entity';

/**
 * Structural mirror of the `EventEnvelope` contract defined in
 * `packages/contracts/src/events/event-envelope.ts`.
 *
 * The backend is intentionally decoupled from the contracts package at build
 * time (rootDir = ./src, packages are excluded from the main tsconfig), so the
 * envelope shape is declared here and MUST stay in lockstep with the contract.
 */
export interface OutboxEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: string;
  organizationId: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEntity)
    private readonly outboxRepository: Repository<OutboxEntity>,
  ) {}

  async findUnprocessedEvents(): Promise<OutboxEntity[]> {
    return this.outboxRepository.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Atomically claim a batch of unprocessed events for a worker.
   * Only events that are not already locked (or whose lock has expired)
   * are claimed, preventing duplicate processing across workers.
   */
  async claimNextBatch(
    limit: number,
    lockDurationMs: number,
    workerId: string,
  ): Promise<OutboxEntity[]> {
    const lockExpiry = new Date(Date.now() + lockDurationMs);
    const now = new Date();

    const candidates = await this.outboxRepository
      .createQueryBuilder('outbox')
      .where('outbox.processed = :processed', { processed: false })
      .andWhere('(outbox.lockedAt IS NULL OR outbox.lockedAt < :now)', { now })
      .orderBy('outbox.createdAt', 'ASC')
      .limit(limit)
      .getMany();

    if (candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((c) => c.id);

    // Claim the events only if they are still unprocessed and unlocked.
    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({ lockedAt: lockExpiry, lockedBy: workerId })
      .where('id IN (:...ids)', { ids })
      .andWhere('processed = :processed', { processed: false })
      .execute();

    // Re-fetch only the events this worker successfully claimed.
    return this.outboxRepository
      .createQueryBuilder('outbox')
      .where('outbox.id IN (:...ids)', { ids })
      .andWhere('outbox.lockedBy = :workerId', { workerId })
      .getMany();
  }

  async markAsProcessed(id: string): Promise<void> {
    await this.outboxRepository.update(id, {
      processed: true,
      lockedAt: null,
      lockedBy: null,
    });
  }

  async markAsFailed(id: string): Promise<void> {
    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({
        attempts: () => 'attempts + 1',
        lockedAt: null,
        lockedBy: null,
      })
      .where('id = :id', { id })
      .execute();
  }

  /**
   * Persist a legacy inner-payload event.
   *
   * `manager` MUST be supplied by every caller that already holds an open
   * transaction (e.g. membership/member writes): the event row then travels on
   * the SAME transaction/connection as the domain write, so it commits and
   * rolls back with it. Writing through the ambient repository instead commits
   * the event independently, leaving an orphan event when the domain
   * transaction rolls back (proven by the atomicity verification harness).
   */
  async saveEvent(
    eventType: string,
    payload: string,
    correlationId: string,
    manager?: EntityManager,
  ): Promise<OutboxEntity> {
    const repository = manager ? manager.getRepository(OutboxEntity) : this.outboxRepository;
    const event = repository.create({
      eventType,
      payload,
      correlationId,
      processed: false,
    });
    return repository.save(event);
  }

  /**
   * Persist a full `EventEnvelope` (see `packages/contracts/src/events/event-envelope.ts`).
   *
   * The complete, serialized envelope — including the contract-required
   * `eventId`, `eventVersion`, `organizationId` and `occurredAt` — is stored in
   * the `payload` column so the persisted representation satisfies the current
   * `EventEnvelope` contract. `eventType` and `correlationId` columns are kept
   * in sync (denormalized) so existing poller/claim queries continue to work.
   *
   * `organizationId` MUST be derived from the authorized organization context by
   * the caller; it is never accepted from client input by this method.
   *
   * `manager` MUST be supplied by callers inside an open transaction so the
   * envelope is written on the same transaction/connection as the domain write
   * (see `saveEvent`).
   */
  async saveEventEnvelope<TPayload extends Record<string, unknown>>(
    eventType: string,
    eventVersion: string,
    organizationId: string,
    payload: TPayload,
    correlationId?: string,
    causationId?: string,
    manager?: EntityManager,
  ): Promise<OutboxEntity> {
    const envelope: OutboxEventEnvelope<TPayload> = {
      eventId: crypto.randomUUID(),
      eventType,
      eventVersion,
      organizationId,
      occurredAt: new Date().toISOString(),
      correlationId: correlationId || crypto.randomUUID(),
      payload,
    };
    if (causationId) {
      envelope.causationId = causationId;
    }
    const repository = manager ? manager.getRepository(OutboxEntity) : this.outboxRepository;
    const event = repository.create({
      eventType,
      payload: JSON.stringify(envelope),
      correlationId: envelope.correlationId,
      processed: false,
    });
    return repository.save(event);
  }
}