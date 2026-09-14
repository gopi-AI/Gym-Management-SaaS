import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InvoiceNumberCounter } from '../entities/invoice-number-counter.entity';

/**
 * Issuer of per-organization sequential invoice numbers.
 *
 * Mirrors `src/members/services/local-id.service.ts`: the counter row is locked
 * (`pessimistic_write`) for the duration of the surrounding transaction so two
 * concurrent sales can never be issued the same number. The
 * `(organization_id, invoice_number)` unique index is the final backstop.
 *
 * `nextInvoiceNumber` accepts the caller's `EntityManager` so the number is
 * allocated on the SAME connection/transaction as the invoice insert — the
 * counter increment and the invoice commit (or roll back) together.
 */
@Injectable()
export class InvoiceNumberService {
  constructor(
    @InjectRepository(InvoiceNumberCounter)
    private readonly counterRepository: Repository<InvoiceNumberCounter>,
    private readonly dataSource: DataSource,
  ) {}

  async nextInvoiceNumber(organizationId: string, manager?: EntityManager): Promise<string> {
    const sequence = await this.nextSequence(organizationId, manager);
    return `INV-${String(sequence).padStart(6, '0')}`;
  }

  private async nextSequence(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const allocate = async (entityManager: EntityManager): Promise<number> => {
      const repo = entityManager.getRepository(InvoiceNumberCounter);

      let counter = await repo.findOne({
        where: { organization_id: organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!counter) {
        counter = repo.create({
          organization_id: organizationId,
          last_invoice_number: 0,
        });
        counter = await repo.save(counter);
      }

      counter.last_invoice_number += 1;
      await repo.save(counter);
      return counter.last_invoice_number;
    };

    return manager
      ? allocate(manager)
      : this.dataSource.transaction((entityManager) => allocate(entityManager));
  }
}
