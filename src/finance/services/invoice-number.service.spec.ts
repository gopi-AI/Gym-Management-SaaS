import { DataSource, EntityManager, Repository } from 'typeorm';
import { InvoiceNumberService } from './invoice-number.service';
import { InvoiceNumberCounter } from '../entities/invoice-number-counter.entity';

/**
 * The invoice-number scheme, pinned down.
 *
 * `InvoiceNumberService` allocates from
 * `FINANCE_INVOICE_NUMBER_COUNTERS`, which has a UNIQUE index on
 * `organization_id` alone — i.e. ONE counter row per organization. The store
 * below mirrors that: a map keyed by `organization_id`, so a test that passes
 * would fail immediately if the service ever shared one counter across tenants.
 */
describe('InvoiceNumberService', () => {
  let counters: Map<string, InvoiceNumberCounter>;
  let counterRepository: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };
  let service: InvoiceNumberService;

  beforeEach(() => {
    counters = new Map();

    counterRepository = {
      findOne: jest.fn(async ({ where }: { where: { organization_id: string } }) => {
        return counters.get(where.organization_id) ?? null;
      }),
      create: jest.fn((row: Partial<InvoiceNumberCounter>) => ({
        id: `counter-${row.organization_id}`,
        ...row,
      })),
      save: jest.fn(async (row: InvoiceNumberCounter) => {
        counters.set(row.organization_id, row);
        return row;
      }),
    };

    dataSource = {
      transaction: jest.fn(
        async (callback: (manager: EntityManager) => Promise<unknown>) =>
          callback({
            getRepository: () => counterRepository,
          } as unknown as EntityManager),
      ),
    };

    service = new InvoiceNumberService(
      counterRepository as unknown as Repository<InvoiceNumberCounter>,
      dataSource as unknown as DataSource,
    );
  });

  it('issues INV-000001, INV-000002, ... independently per organization', async () => {
    const orgA = [
      await service.nextInvoiceNumber('org-a'),
      await service.nextInvoiceNumber('org-a'),
      await service.nextInvoiceNumber('org-a'),
    ];
    const orgB = [
      await service.nextInvoiceNumber('org-b'),
      await service.nextInvoiceNumber('org-b'),
    ];
    const orgCFirst = await service.nextInvoiceNumber('org-c');

    // Printed on purpose: this is the evidence for the reported scheme.
    console.log(`[invoice-number] org-a -> ${orgA.join(', ')}`);
    console.log(`[invoice-number] org-b -> ${orgB.join(', ')}`);
    console.log(`[invoice-number] org-c -> ${orgCFirst}`);

    expect(orgA).toEqual(['INV-000001', 'INV-000002', 'INV-000003']);
    // NOT a global sequence: org-b and org-c each restart at 1 instead of
    // continuing org-a's counter (which would have been 4, 5, 6).
    expect(orgB).toEqual(['INV-000001', 'INV-000002']);
    expect(orgCFirst).toBe('INV-000001');

    expect([...counters.keys()].sort()).toEqual(['org-a', 'org-b', 'org-c']);
    expect(counters.get('org-a')!.last_invoice_number).toBe(3);
    expect(counters.get('org-b')!.last_invoice_number).toBe(2);
    expect(counters.get('org-c')!.last_invoice_number).toBe(1);
  });

  it('locks the organization counter row for update inside a transaction', async () => {
    await service.nextInvoiceNumber('org-a');

    expect(counterRepository.findOne).toHaveBeenCalledWith({
      where: { organization_id: 'org-a' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // the row is created on first use and then incremented
    expect(counterRepository.create).toHaveBeenCalledWith({
      organization_id: 'org-a',
      last_invoice_number: 0,
    });
    expect(counters.get('org-a')!.last_invoice_number).toBe(1);
  });

  it("allocates on the caller's transaction when a manager is supplied", async () => {
    const manager = {
      getRepository: jest.fn(() => counterRepository),
    } as unknown as EntityManager;

    await service.nextInvoiceNumber('org-a', manager);

    expect(manager.getRepository).toHaveBeenCalledWith(InvoiceNumberCounter);
    // the caller owns the transaction, so the service must not open its own
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(counters.get('org-a')!.last_invoice_number).toBe(1);
  });

  it('keeps growing past six digits instead of truncating (pads, never clips)', async () => {
    counters.set('org-a', {
      id: 'counter-org-a',
      organization_id: 'org-a',
      last_invoice_number: 999_999,
    });

    expect(await service.nextInvoiceNumber('org-a')).toBe('INV-1000000');
  });
});
