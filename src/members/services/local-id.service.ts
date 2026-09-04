import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LocalIdCounter } from '../entities/local-id-counter.entity';

@Injectable()
export class LocalIdService {
  constructor(
    @InjectRepository(LocalIdCounter)
    private readonly counterRepository: Repository<LocalIdCounter>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Generate the next unique local_id for a given organization.
   * Uses a transaction with row-level locking to prevent race conditions.
   */
  async nextLocalId(organizationId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(LocalIdCounter);

      let counter = await repo.findOne({
        where: { organization_id: organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!counter) {
        counter = repo.create({
          organization_id: organizationId,
          last_local_id: 0,
        });
        counter = await repo.save(counter);
      }

      counter.last_local_id += 1;
      await repo.save(counter);

      return counter.last_local_id;
    });
  }
}