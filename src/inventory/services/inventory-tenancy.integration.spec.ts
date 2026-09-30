/**
 * Cross-tenant regression for the inventory endpoints added by Batch 8b
 * (T2.1–T2.4): `GET /v1/inventory/items/:id`, `PATCH /v1/inventory/items/:id`,
 * `GET /v1/inventory/lots` and `GET /v1/inventory/purchase-orders/:id`.
 *
 * WHY THIS EXISTS ALONGSIDE THE MOCKED SPEC NEXT TO IT
 * `inventory.service.spec.ts` asserts the `where` predicates, but a mock hands
 * the service whatever the test wants — so it cannot see a query that actually
 * returns another organization's rows. This spec drives the real
 * `InventoryService` against a migrated schema and re-reads the rows, so a
 * missing org predicate surfaces as a concrete foreign value (a B-side SKU or
 * lot number) rather than a count that happens to match.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/inventory/services/inventory-tenancy.integration
 * The database is selected exactly as `src/data-source.ts` selects it and MUST
 * already be migrated, with the same variables exported:
 *   DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *   DB_DATABASE=<scratch> npm run migration:run
 * Jest does not load `.env` (jest.config.js declares no setupFiles), so pass all
 * five explicitly: with only `DB_DATABASE` set, `src/data-source.ts` falls back
 * to `localhost:5432 postgres/postgres`, and every test fails from `beforeAll`
 * with `Ident authentication failed for user "postgres"` (SQLSTATE 28000) on any
 * Postgres that does not accept those defaults. Without `RUN_DB_INTEGRATION=1`
 * the block reports as SKIPPED, so the hermetic `npm test` never needs a database.
 *
 * Point it at a THROWAWAY database. Every row it writes belongs to one of two
 * freshly generated organizations and is deleted in `afterAll`, but the clean-up
 * is a courtesy, not a substitute for an isolated schema.
 */
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryLot } from '../entities/inventory-lot.entity';
import { InventoryTransaction } from '../entities/inventory-transaction.entity';
import { InventorySupplier } from '../entities/inventory-supplier.entity';
import { InventoryPurchaseOrder } from '../entities/inventory-purchase-order.entity';
import { InventoryPurchaseOrderItem } from '../entities/inventory-purchase-order-item.entity';
import { UpdateInventoryItemDto } from '../dto/inventory.dto';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

// Distinct, greppable values so a leak is visible in the assertion itself.
const A_ITEM_SKU = 'ORG-A-SKU-AAA';
const A_ITEM2_SKU = 'ORG-A-SKU-AAA2';
const B_ITEM_SKU = 'ORG-B-SKU-BBB';
const A_LOT_NUMBER = 'ORG-A-LOT-111';
const B_LOT_NUMBER = 'ORG-B-LOT-222';
const A_SUPPLIER = 'Org A Supplies';
const B_SUPPLIER = 'Org B Supplies';

describeIntegration('InventoryService tenant isolation (real Postgres)', () => {
  let dataSource: DataSource;
  let service: InventoryService;
  let currentOrg: string;

  // A real branch lookup is out of scope: the subject of this suite is the org
  // predicate on each query, which the service reads from the tenant context.
  // `requireBranchAccess` is a no-op so a same-org write proceeds and a
  // cross-org write is stopped by the org predicate, not by the branch mock.
  const tenant = {
    getCurrentOrganizationId: jest.fn(async () => currentOrg),
    requireBranchAccess: jest.fn(async () => undefined),
  } as unknown as TenantContextService;

  const ids = {
    orgA: randomUUID(), orgB: randomUUID(),
    branchA: randomUUID(), branchB: randomUUID(),
    supplierA: randomUUID(), supplierB: randomUUID(),
    itemA: randomUUID(), itemA2: randomUUID(), itemB: randomUUID(),
    lotA: randomUUID(), lotB: randomUUID(),
    poA: randomUUID(), poB: randomUUID(),
    poLineA: randomUUID(), poLineB: randomUUID(),
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same glob as `src/data-source.ts`, so this spec can never drift from the
      // entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    const organizations = dataSource.getRepository(Organization);
    await organizations.save({ id: ids.orgA, name: 'Inventory Isolation A', timezone: 'UTC', locale: 'en-US', currency: 'USD' });
    await organizations.save({ id: ids.orgB, name: 'Inventory Isolation B', timezone: 'UTC', locale: 'en-US', currency: 'USD' });

    const branches = dataSource.getRepository(Branch);
    await branches.save({ id: ids.branchA, organization_id: ids.orgA, name: 'A Main', address: '1 A Street', phone: '+10000000001' });
    await branches.save({ id: ids.branchB, organization_id: ids.orgB, name: 'B Main', address: '1 B Street', phone: '+10000000002' });

    const suppliers = dataSource.getRepository(InventorySupplier);
    await suppliers.save({ id: ids.supplierA, organization_id: ids.orgA, name: A_SUPPLIER });
    await suppliers.save({ id: ids.supplierB, organization_id: ids.orgB, name: B_SUPPLIER });

    const items = dataSource.getRepository(InventoryItem);
    await items.save({ id: ids.itemA, organization_id: ids.orgA, branch_id: ids.branchA, name: 'Org A Widget', sku: A_ITEM_SKU, unit: 'unit', selling_price: '10.00' });
    await items.save({ id: ids.itemA2, organization_id: ids.orgA, branch_id: ids.branchA, name: 'Org A Widget 2', sku: A_ITEM2_SKU, unit: 'unit', selling_price: '15.00' });
    await items.save({ id: ids.itemB, organization_id: ids.orgB, branch_id: ids.branchB, name: 'Org B Widget', sku: B_ITEM_SKU, unit: 'unit', selling_price: '20.00' });

    const lots = dataSource.getRepository(InventoryLot);
    await lots.save({ id: ids.lotA, organization_id: ids.orgA, inventory_item_id: ids.itemA, lot_number: A_LOT_NUMBER, quantity: '5.0000', unit_cost: '10.00', received_at: new Date('2026-01-01T00:00:00.000Z') });
    await lots.save({ id: ids.lotB, organization_id: ids.orgB, inventory_item_id: ids.itemB, lot_number: B_LOT_NUMBER, quantity: '7.0000', unit_cost: '20.00', received_at: new Date('2026-01-01T00:00:00.000Z') });

    const orders = dataSource.getRepository(InventoryPurchaseOrder);
    const order = { order_date: new Date('2026-01-01T00:00:00.000Z'), total_amount: '50.00', status: 'open' };
    await orders.save({ id: ids.poA, organization_id: ids.orgA, branch_id: ids.branchA, supplier_id: ids.supplierA, ...order });
    await orders.save({ id: ids.poB, organization_id: ids.orgB, branch_id: ids.branchB, supplier_id: ids.supplierB, ...order });

    const lines = dataSource.getRepository(InventoryPurchaseOrderItem);
    await lines.save({ id: ids.poLineA, po_id: ids.poA, inventory_item_id: ids.itemA, quantity_ordered: '5.0000', quantity_received: '0.0000', unit_cost: '10.00' });
    await lines.save({ id: ids.poLineB, po_id: ids.poB, inventory_item_id: ids.itemB, quantity_ordered: '2.0000', quantity_received: '0.0000', unit_cost: '20.00' });

    // No path under test emits an event, so a stub outbox keeps this suite off
    // the OUTBOX table entirely.
    const outbox = { saveEventEnvelope: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
    service = new InventoryService(
      dataSource.getRepository(InventoryItem),
      dataSource.getRepository(InventoryLot),
      dataSource.getRepository(InventoryTransaction),
      dataSource.getRepository(InventorySupplier),
      dataSource.getRepository(InventoryPurchaseOrder),
      dataSource.getRepository(InventoryPurchaseOrderItem),
      dataSource,
      tenant,
      outbox,
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const orgFilter = In([ids.orgA, ids.orgB]);
    // Children first. Every seeded row carries one of this suite's two org ids,
    // so this sweep can never touch pre-existing data.
    await dataSource.getRepository(InventoryPurchaseOrderItem).delete({ po_id: In([ids.poA, ids.poB]) });
    await dataSource.getRepository(InventoryLot).delete({ organization_id: orgFilter });
    await dataSource.getRepository(InventoryTransaction).delete({ organization_id: orgFilter });
    await dataSource.getRepository(InventoryPurchaseOrder).delete({ organization_id: orgFilter });
    await dataSource.getRepository(InventoryItem).delete({ organization_id: orgFilter });
    await dataSource.getRepository(InventorySupplier).delete({ organization_id: orgFilter });
    await dataSource.getRepository(Branch).delete({ organization_id: orgFilter });
    await dataSource.getRepository(Organization).delete({ id: orgFilter });
    await dataSource.destroy();
  }, 30000);

  beforeEach(() => { currentOrg = ids.orgA; });

  it("returns org A's own item and hides org B's", async () => {
    const own = await service.getItem(ids.itemA);
    expect(own).toMatchObject({ id: ids.itemA, organization_id: ids.orgA, sku: A_ITEM_SKU });

    await expect(service.getItem(ids.itemB)).rejects.toThrow(NotFoundException);

    // The refusal is a read, not a delete: B's row is still exactly B's.
    const bRow = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemB });
    expect(bRow).toMatchObject({ organization_id: ids.orgB, sku: B_ITEM_SKU });
  });

  it("lists only org A's lots, never B's, and filters by item within the org", async () => {
    const all = await service.listLots({ page: 1, limit: 20 });
    expect(all.data.map((lot) => lot.lot_number)).toEqual([A_LOT_NUMBER]);
    expect(all.data.map((lot) => lot.organization_id)).toEqual([ids.orgA]);
    expect(all.data.map((lot) => lot.id)).not.toContain(ids.lotB);

    const filtered = await service.listLots({ page: 1, limit: 20, inventory_item_id: ids.itemA });
    expect(filtered.data.map((lot) => lot.id)).toEqual([ids.lotA]);

    // B's item id matches no lot inside org A.
    const crossItem = await service.listLots({ page: 1, limit: 20, inventory_item_id: ids.itemB });
    expect(crossItem.data).toEqual([]);
  });

  it("returns org A's purchase order with its lines and hides org B's", async () => {
    const own = await service.getPurchaseOrder(ids.poA);
    expect(own.order).toMatchObject({ id: ids.poA, organization_id: ids.orgA, branch_id: ids.branchA });
    expect(own.items.map((line) => line.id)).toEqual([ids.poLineA]);

    await expect(service.getPurchaseOrder(ids.poB)).rejects.toThrow(NotFoundException);
  });

  it("refuses to update another org's item and leaves that row untouched", async () => {
    const before = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemB });

    await expect(service.updateItem(ids.itemB, { name: 'Hijacked by A' } as never)).rejects.toThrow(NotFoundException);

    const after = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemB });
    // Byte-identical, not merely "not obviously changed": every column is compared.
    expect(after).toEqual(before);
    expect(after.name).toBe('Org B Widget');
  });

  it("updates only the whitelisted fields of the caller's own item", async () => {
    const updated = await service.updateItem(ids.itemA, { name: 'Org A Widget renamed', selling_price: 12.5 } as never);
    expect(updated).toMatchObject({ id: ids.itemA, organization_id: ids.orgA, branch_id: ids.branchA, sku: A_ITEM_SKU, name: 'Org A Widget renamed', selling_price: '12.50' });

    const reread = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemA });
    expect(reread.name).toBe('Org A Widget renamed');
    expect(reread.organization_id).toBe(ids.orgA);
  });

  it('a PATCH body carrying organization_id / quantity / an unknown key cannot move or restock the row', async () => {
    const body = { name: 'Pipe Test Widget', organization_id: ids.orgB, branch_id: ids.branchB, quantity: 999, quantity_on_hand: 1234, made_up_field: 'x' };

    // The DTO setup itself: with the same pipe config as `src/main.ts`
    // (`whitelist: true`), only declared, optional fields survive.
    const piped = await new ValidationPipe({ whitelist: true, transform: true }).transform(body, {
      type: 'body',
      metatype: UpdateInventoryItemDto,
    });
    expect(Object.keys(piped).sort()).toEqual(['name']);

    // Even a body that bypasses the pipe (a raw object) cannot re-home the item.
    await service.updateItem(ids.itemA, body as never);

    const reread = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemA });
    expect(reread.organization_id).toBe(ids.orgA);
    expect(reread.branch_id).toBe(ids.branchA);
    expect(reread.name).toBe('Pipe Test Widget');
    expect(reread).not.toHaveProperty('quantity');
  });

  it("maps a duplicate SKU on PATCH to a 409 and leaves the row's sku unchanged", async () => {
    // Org A already owns `itemA2` with this sku in the SAME branch, so the unique
    // index UQ_inventory_items_org_branch_sku refuses the UPDATE (SQLSTATE 23505).
    await expect(service.updateItem(ids.itemA, { sku: A_ITEM2_SKU } as never)).rejects.toBeInstanceOf(ConflictException);

    // The failed UPDATE rolled back: itemA keeps its own sku.
    const reread = await dataSource.getRepository(InventoryItem).findOneByOrFail({ id: ids.itemA });
    expect(reread.sku).toBe(A_ITEM_SKU);
  });
});
