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
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
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
const A2_ITEM_SKU = 'ORG-A-B2-SKU';
const B_ITEM_SKU = 'ORG-B-SKU-BBB';
const A_LOT_NUMBER = 'ORG-A-LOT-111';
const A2_LOT_NUMBER = 'ORG-A-B2-LOT';
const A_DANGLING_LOT_NUMBER = 'ORG-A-DANGLING-LOT';
const B_LOT_NUMBER = 'ORG-B-LOT-222';
const A_SUPPLIER = 'Org A Supplies';
const B_SUPPLIER = 'Org B Supplies';

describeIntegration('InventoryService tenant isolation (real Postgres)', () => {
  let dataSource: DataSource;
  let service: InventoryService;
  let currentOrg: string;
  // Purchase orders this suite creates through the service. `INVENTORY_PURCHASE_ORDER_ITEMS`
  // has NO foreign key on `po_id` (`1788965263264-CreateInventorySchema.ts`), so deleting a
  // PO does NOT cascade to its lines: they are tracked here and swept explicitly, otherwise
  // the later item delete would be blocked by lines still pointing at those items.
  const createdPoIds: string[] = [];

  // `requireBranchAccess` is implemented against the real DB — the same predicate
  // `TenantContextService` uses (the branch must exist, be active and belong to the
  // authorized organization). That makes the branch-scoping tests real rather than
  // mock-driven: a branch of the caller's org resolves; a branch from another org
  // raises the 403 the service propagates.
  const tenant = {
    getCurrentOrganizationId: jest.fn(async () => currentOrg),
    requireBranchAccess: jest.fn(async (orgId: string, branchId: string) => {
      const branch = await dataSource.getRepository(Branch).findOne({ where: { id: branchId, organization_id: orgId, is_active: true } });
      if (!branch) throw new ForbiddenException('Access to this branch is not allowed');
      return branch;
    }),
  } as unknown as TenantContextService;

  const ids = {
    orgA: randomUUID(), orgB: randomUUID(),
    branchA: randomUUID(), branchA2: randomUUID(), branchB: randomUUID(),
    supplierA: randomUUID(), supplierB: randomUUID(),
    itemA: randomUUID(), itemA2: randomUUID(), itemA_b2: randomUUID(), itemB: randomUUID(),
    lotA: randomUUID(), lotA_b2: randomUUID(), lotDanglingA: randomUUID(), lotB: randomUUID(),
    poA: randomUUID(), poA_b2: randomUUID(), poB: randomUUID(),
    poLineA: randomUUID(), poLineA_b2: randomUUID(), poLineB: randomUUID(),
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
    await branches.save({ id: ids.branchA2, organization_id: ids.orgA, name: 'A Second', address: '2 A Street', phone: '+10000000003' });
    await branches.save({ id: ids.branchB, organization_id: ids.orgB, name: 'B Main', address: '1 B Street', phone: '+10000000002' });

    const suppliers = dataSource.getRepository(InventorySupplier);
    await suppliers.save({ id: ids.supplierA, organization_id: ids.orgA, name: A_SUPPLIER });
    await suppliers.save({ id: ids.supplierB, organization_id: ids.orgB, name: B_SUPPLIER });

    const items = dataSource.getRepository(InventoryItem);
    await items.save({ id: ids.itemA, organization_id: ids.orgA, branch_id: ids.branchA, name: 'Org A Widget', sku: A_ITEM_SKU, unit: 'unit', selling_price: '10.00' });
    await items.save({ id: ids.itemA2, organization_id: ids.orgA, branch_id: ids.branchA, name: 'Org A Widget 2', sku: A_ITEM2_SKU, unit: 'unit', selling_price: '15.00' });
    await items.save({ id: ids.itemA_b2, organization_id: ids.orgA, branch_id: ids.branchA2, name: 'Org A Second-Branch Widget', sku: A2_ITEM_SKU, unit: 'unit', selling_price: '11.00' });
    await items.save({ id: ids.itemB, organization_id: ids.orgB, branch_id: ids.branchB, name: 'Org B Widget', sku: B_ITEM_SKU, unit: 'unit', selling_price: '20.00' });

    const lots = dataSource.getRepository(InventoryLot);
    await lots.save({ id: ids.lotA, organization_id: ids.orgA, inventory_item_id: ids.itemA, lot_number: A_LOT_NUMBER, quantity: '5.0000', unit_cost: '10.00', received_at: new Date('2026-01-01T00:00:00.000Z') });
    await lots.save({ id: ids.lotA_b2, organization_id: ids.orgA, inventory_item_id: ids.itemA_b2, lot_number: A2_LOT_NUMBER, quantity: '9.0000', unit_cost: '11.00', received_at: new Date('2026-01-01T00:00:00.000Z') });
    // A deliberately inconsistent row: org A's lot pointing at ORG B's item. The FK
    // permits it (no org in the FK), so it exists to prove the join's
    // `item.organization_id = lot.organization_id` condition keeps it out of any
    // result — a leak would surface as A_DANGLING_LOT_NUMBER.
    await lots.save({ id: ids.lotDanglingA, organization_id: ids.orgA, inventory_item_id: ids.itemB, lot_number: A_DANGLING_LOT_NUMBER, quantity: '1.0000', unit_cost: '1.00', received_at: new Date('2026-01-01T00:00:00.000Z') });
    await lots.save({ id: ids.lotB, organization_id: ids.orgB, inventory_item_id: ids.itemB, lot_number: B_LOT_NUMBER, quantity: '7.0000', unit_cost: '20.00', received_at: new Date('2026-01-01T00:00:00.000Z') });

    const orders = dataSource.getRepository(InventoryPurchaseOrder);
    const order = { order_date: new Date('2026-01-01T00:00:00.000Z'), total_amount: '50.00', status: 'open' };
    await orders.save({ id: ids.poA, organization_id: ids.orgA, branch_id: ids.branchA, supplier_id: ids.supplierA, ...order });
    await orders.save({ id: ids.poA_b2, organization_id: ids.orgA, branch_id: ids.branchA2, supplier_id: ids.supplierA, ...order });
    await orders.save({ id: ids.poB, organization_id: ids.orgB, branch_id: ids.branchB, supplier_id: ids.supplierB, ...order });

    const lines = dataSource.getRepository(InventoryPurchaseOrderItem);
    await lines.save({ id: ids.poLineA, po_id: ids.poA, inventory_item_id: ids.itemA, quantity_ordered: '5.0000', quantity_received: '0.0000', unit_cost: '10.00' });
    await lines.save({ id: ids.poLineA_b2, po_id: ids.poA_b2, inventory_item_id: ids.itemA_b2, quantity_ordered: '3.0000', quantity_received: '0.0000', unit_cost: '11.00' });
    await lines.save({ id: ids.poLineB, po_id: ids.poB, inventory_item_id: ids.itemB, quantity_ordered: '2.0000', quantity_received: '0.0000', unit_cost: '20.00' });

    // `GET stock` reads MV_INVENTORY_STOCK_LEVELS, so seed one movement per A branch
    // and refresh it — that is what lets the stock test prove the branch filter.
    const transactions = dataSource.getRepository(InventoryTransaction);
    const movement = { transaction_type: 'adjustment', reference_id: null, reference_type: null, transaction_date: new Date('2026-01-01T00:00:00.000Z') };
    await transactions.save({ id: randomUUID(), organization_id: ids.orgA, branch_id: ids.branchA, inventory_item_id: ids.itemA, quantity: '5.0000', unit_cost: '10.00', ...movement });
    await transactions.save({ id: randomUUID(), organization_id: ids.orgA, branch_id: ids.branchA2, inventory_item_id: ids.itemA_b2, quantity: '9.0000', unit_cost: '11.00', ...movement });
    await dataSource.query('REFRESH MATERIALIZED VIEW "MV_INVENTORY_STOCK_LEVELS"');

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
    await dataSource.getRepository(InventoryPurchaseOrderItem).delete({ po_id: In([ids.poA, ids.poA_b2, ids.poB, ...createdPoIds]) });
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

  it("lists only the requested branch's lots — never another branch's or another org's", async () => {
    const branchA = await service.listLots({ branch_id: ids.branchA, page: 1, limit: 20 });
    // Branch A's own lot only: the second-branch lot AND the cross-org dangling lot
    // (org A's lot pointing at org B's item) are both excluded.
    expect(branchA.data.map((lot) => lot.lot_number)).toEqual([A_LOT_NUMBER]);
    expect(branchA.data.map((lot) => lot.id)).not.toContain(ids.lotA_b2);
    expect(branchA.data.map((lot) => lot.id)).not.toContain(ids.lotDanglingA);

    const branchA2 = await service.listLots({ branch_id: ids.branchA2, page: 1, limit: 20 });
    expect(branchA2.data.map((lot) => lot.lot_number)).toEqual([A2_LOT_NUMBER]);
    expect(branchA2.data.map((lot) => lot.id)).not.toContain(ids.lotA);

    const filtered = await service.listLots({ branch_id: ids.branchA, page: 1, limit: 20, inventory_item_id: ids.itemA });
    expect(filtered.data.map((lot) => lot.id)).toEqual([ids.lotA]);

    // Another org's branch is not authorized -> 403.
    await expect(service.listLots({ branch_id: ids.branchB, page: 1, limit: 20 })).rejects.toBeInstanceOf(ForbiddenException);
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

  // --- Batch 8d: duplicate-value write paths ----------------------------------
  it('maps a duplicate SKU on CREATE to a 409 and writes no row', async () => {
    const repo = dataSource.getRepository(InventoryItem);
    const before = await repo.count({ where: { organization_id: ids.orgA, branch_id: ids.branchA } });
    // Org A already owns `itemA` with this sku in the SAME branch, so the unique
    // index UQ_inventory_items_org_branch_sku refuses the INSERT (SQLSTATE 23505).
    await expect(service.createItem({ branch_id: ids.branchA, name: 'Dup', sku: A_ITEM_SKU } as never)).rejects.toBeInstanceOf(ConflictException);
    const after = await repo.count({ where: { organization_id: ids.orgA, branch_id: ids.branchA } });
    expect(after).toBe(before);
  });

  it('allows the SAME sku in a different org and in a different branch of the same org', async () => {
    // The key is (organization_id, branch_id, sku), so the 409 is scoped to that
    // key and not to the sku globally.
    currentOrg = ids.orgB;
    const otherOrg = await service.createItem({ branch_id: ids.branchB, name: 'B reuses an A sku', sku: A_ITEM_SKU } as never);
    expect(otherOrg).toMatchObject({ organization_id: ids.orgB, branch_id: ids.branchB, sku: A_ITEM_SKU });

    currentOrg = ids.orgA;
    const otherBranch = await service.createItem({ branch_id: ids.branchA2, name: 'A2 reuses an A sku', sku: A_ITEM_SKU } as never);
    expect(otherBranch).toMatchObject({ organization_id: ids.orgA, branch_id: ids.branchA2, sku: A_ITEM_SKU });

    // Restore the seeded fixture: other tests assert exact per-branch contents.
    await dataSource.getRepository(InventoryItem).delete({ id: In([otherOrg.id, otherBranch.id]) });
  });

  it('rejects duplicate inventory_item_id lines with a 400 and creates no purchase order', async () => {
    const repo = dataSource.getRepository(InventoryPurchaseOrder);
    const before = await repo.count({ where: { organization_id: ids.orgA } });
    await expect(service.createPurchaseOrder({ branch_id: ids.branchA, supplier_id: ids.supplierA, items: [{ inventory_item_id: ids.itemA, quantity_ordered: 1, unit_cost: 5 }, { inventory_item_id: ids.itemA, quantity_ordered: 2, unit_cost: 6 }] } as never)).rejects.toBeInstanceOf(BadRequestException);
    // The check runs BEFORE the transaction, so no 23505 ever reaches the driver and
    // there is nothing to roll back — the PO table is untouched.
    const after = await repo.count({ where: { organization_id: ids.orgA } });
    expect(after).toBe(before);
  });

  it('creates a purchase order when the lines reference distinct items', async () => {
    const order = await service.createPurchaseOrder({ branch_id: ids.branchA, supplier_id: ids.supplierA, items: [{ inventory_item_id: ids.itemA, quantity_ordered: 1, unit_cost: 5 }, { inventory_item_id: ids.itemA2, quantity_ordered: 2, unit_cost: 6 }] } as never);
    createdPoIds.push(order.id);
    expect(order).toMatchObject({ organization_id: ids.orgA, branch_id: ids.branchA, supplier_id: ids.supplierA, status: 'open' });
    const lines = await dataSource.getRepository(InventoryPurchaseOrderItem).find({ where: { po_id: order.id } });
    expect(lines.map((line) => line.inventory_item_id).sort()).toEqual([ids.itemA, ids.itemA2].sort());
  });

  // --- OI-1: branch-scoped reads ------------------------------------------------
  it('allows a by-id item read in another branch of the SAME org (requireBranchAccess admits any active org branch)', async () => {
    // Documented reality: `requireBranchAccess` has no per-user branch scope, so a
    // second branch of the caller's own org is authorized — this is a 200, not a 403.
    const other = await service.getItem(ids.itemA_b2);
    expect(other).toMatchObject({ id: ids.itemA_b2, organization_id: ids.orgA, branch_id: ids.branchA2 });
  });

  it('returns a purchase order in another branch of the same org', async () => {
    const own = await service.getPurchaseOrder(ids.poA_b2);
    expect(own.order).toMatchObject({ id: ids.poA_b2, organization_id: ids.orgA, branch_id: ids.branchA2 });
    expect(own.items.map((line) => line.id)).toEqual([ids.poLineA_b2]);
  });

  it('lists only the requested branch of items, and 403s a branch from another org', async () => {
    const a = await service.listItems(ids.branchA);
    expect(a.map((i) => i.sku).sort()).toEqual([A_ITEM_SKU, A_ITEM2_SKU].sort());
    const a2 = await service.listItems(ids.branchA2);
    expect(a2.map((i) => i.sku)).toEqual([A2_ITEM_SKU]);
    expect(a2.map((i) => i.id)).not.toContain(ids.itemA);
    await expect(service.listItems(ids.branchB)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns only the requested branch of stock, and 403s a branch from another org', async () => {
    const a = (await service.stock(ids.branchA)) as Array<{ inventory_item_id: string; branch_id: string }>;
    expect(a.map((r) => r.inventory_item_id)).toEqual([ids.itemA]);
    expect(a.every((r) => r.branch_id === ids.branchA)).toBe(true);
    expect(a.map((r) => r.inventory_item_id)).not.toContain(ids.itemA_b2);

    const a2 = (await service.stock(ids.branchA2)) as Array<{ inventory_item_id: string }>;
    expect(a2.map((r) => r.inventory_item_id)).toEqual([ids.itemA_b2]);

    await expect(service.stock(ids.branchB)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
