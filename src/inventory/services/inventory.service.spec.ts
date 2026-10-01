import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryLot } from '../entities/inventory-lot.entity';
import { InventoryPurchaseOrder } from '../entities/inventory-purchase-order.entity';
import { InventoryPurchaseOrderItem } from '../entities/inventory-purchase-order-item.entity';
import { InventoryTransaction } from '../entities/inventory-transaction.entity';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  const repo = () => ({ find: jest.fn(), findOne: jest.fn(), findOneBy: jest.fn(), findAndCount: jest.fn(), createQueryBuilder: jest.fn(), create: jest.fn((value) => value), save: jest.fn((value) => Promise.resolve(value)), update: jest.fn() });
  let service: InventoryService; let items: any; let lots: any; let transactions: any; let suppliers: any; let orders: any; let orderItems: any; let manager: any; let tenant: any; let outbox: any; let dataSource: any;
  beforeEach(() => {
    items = repo(); lots = repo(); transactions = repo(); suppliers = repo(); orders = repo(); orderItems = repo();
    manager = { getRepository: jest.fn((entity) => ({ [InventoryItem.name]: items, [InventoryLot.name]: lots, [InventoryTransaction.name]: transactions, [InventoryPurchaseOrder.name]: orders, [InventoryPurchaseOrderItem.name]: orderItems }[entity.name] ?? repo())), query: jest.fn() };
    tenant = { getCurrentOrganizationId: jest.fn().mockResolvedValue('org-a'), getRequestedOrganizationId: jest.fn().mockResolvedValue(null), requireOrganizationAccess: jest.fn(async (id) => id), requireBranchAccess: jest.fn().mockResolvedValue(undefined) };
    outbox = { saveEventEnvelope: jest.fn().mockResolvedValue(undefined) }; dataSource = { transaction: jest.fn((callback) => callback(manager)), query: jest.fn() };
    service = new InventoryService(items, lots, transactions, suppliers, orders, orderItems, dataSource, tenant, outbox);
  });
  it('consumes three FIFO layers oldest-cost-first and calculates exact COGS', () => {
    const result = InventoryService.consumeFifo([{ id: 'oldest', quantity: 2, unit_cost: 10 }, { id: 'middle', quantity: 3, unit_cost: 12.5 }, { id: 'newest', quantity: 10, unit_cost: 20 }], 7);
    expect(result.cogs).toBe(97.5); expect(result.layers).toEqual([{ id: 'oldest', quantity: 0, unit_cost: 10 }, { id: 'middle', quantity: 0, unit_cost: 12.5 }, { id: 'newest', quantity: 8, unit_cost: 20 }]);
  });
  it('rejects consumption larger than available layers', () => { expect(() => InventoryService.consumeFifo([{ id: 'one', quantity: 1, unit_cost: 5 }], 2)).toThrow(BadRequestException); });
  it('consumes authorized stock through the transaction path and writes FIFO COGS', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a' });
    const queryBuilder = { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([{ id: 'lot-1', quantity: '2', unit_cost: '10' }, { id: 'lot-2', quantity: '3', unit_cost: '12.50' }, { id: 'lot-3', quantity: '10', unit_cost: '20' }]) };
    lots.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder); transactions.create.mockImplementation((value: any) => ({ id: 'tx-1', ...value })); transactions.save.mockResolvedValue({ id: 'tx-1', quantity: '-7', unit_cost: '15.36' });
    const result = await service.consumeStock({ branch_id: 'branch-a', inventory_item_id: 'item-a', quantity: 7 });
    expect(lots.update).toHaveBeenCalledWith('lot-1', { quantity: '0' }); expect(lots.update).toHaveBeenCalledWith('lot-2', { quantity: '0' }); expect(lots.update).toHaveBeenCalledWith('lot-3', { quantity: '8' });
    expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'org-a', branch_id: 'branch-a', quantity: '-7', unit_cost: '13.93' })); expect(result.costOfGoodsSold).toBe('97.50'); expect(manager.query).toHaveBeenCalledWith('REFRESH MATERIALIZED VIEW "MV_INVENTORY_STOCK_LEVELS"');
    expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'org-a', expect.objectContaining({ costOfGoodsSold: '97.50' }), undefined, undefined, manager);
  });
  it('derives stock per branch and does not query branch B for branch A', async () => { dataSource.query.mockResolvedValue([{ branch_id: 'branch-a', quantity_on_hand: '3' }]); await expect(service.stock('branch-a')).resolves.toEqual([{ branch_id: 'branch-a', quantity_on_hand: '3' }]); expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('AND s.branch_id=$2'), ['org-a', 'branch-a']); expect(dataSource.query).not.toHaveBeenCalledWith(expect.anything(), ['org-a', 'branch-b']); });
  it('receives a PO by creating a lot and transaction and updating received quantity', async () => {
    orders.findOne.mockResolvedValue({ id: 'po-1', organization_id: 'org-a', branch_id: 'branch-a', status: 'open' }); orderItems.find.mockResolvedValue([{ id: 'line-1', po_id: 'po-1', inventory_item_id: 'item-a', quantity_ordered: '5', quantity_received: '0' }]); lots.save.mockResolvedValue({ id: 'lot-1' }); transactions.save.mockResolvedValue({ id: 'tx-1' }); orders.save.mockImplementation(async (value: any) => value);
    await service.receivePurchaseOrder('po-1', { items: [{ inventory_item_id: 'item-a', quantity: 5, unit_cost: 10, lot_number: 'LOT-A' }] });
    expect(lots.save).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'org-a', inventory_item_id: 'item-a', quantity: '5', unit_cost: '10.00', lot_number: 'LOT-A' })); expect(transactions.save).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'org-a', branch_id: 'branch-a', inventory_item_id: 'item-a', quantity: '5', unit_cost: '10.00' })); expect(orderItems.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-1', quantity_received: '5' })); expect(orders.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'received' })); expect(manager.query).toHaveBeenCalledWith('REFRESH MATERIALIZED VIEW "MV_INVENTORY_STOCK_LEVELS"');
  });
  it('rejects cross-organization reads and writes', async () => { await service.listItems('branch-a'); expect(items.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-a', branch_id: 'branch-a' }) })); tenant.requireBranchAccess.mockRejectedValue(new ForbiddenException()); await expect(service.listItems('branch-b')).rejects.toThrow(ForbiddenException); await expect(service.createItem({ branch_id: 'branch-b', name: 'Other', sku: 'OTHER' })).rejects.toThrow(ForbiddenException); });
  it('authorizes the REQUESTED organization when no context is established yet (the HTTP path)', async () => {
    // TenantContextInterceptor records only the requested organization; the
    // authorized organizationId is set by requireOrganizationAccess. Without the
    // fallback every inventory route answers 403 over real HTTP.
    tenant.getCurrentOrganizationId.mockResolvedValue(null);
    tenant.getRequestedOrganizationId.mockResolvedValue('org-a');
    items.find.mockResolvedValue([]);
    await service.listItems('branch-a');
    expect(tenant.requireOrganizationAccess).toHaveBeenCalledWith('org-a');
  });
  it('refuses when there is neither an authorized nor a requested organization', async () => {
    tenant.getCurrentOrganizationId.mockResolvedValue(null);
    tenant.getRequestedOrganizationId.mockResolvedValue(null);
    await expect(service.listSuppliers()).rejects.toThrow(ForbiddenException);
    expect(tenant.requireOrganizationAccess).not.toHaveBeenCalled();
  });
  it('rejects cross-branch consumption even when the item exists elsewhere', async () => { items.findOne.mockResolvedValue(null); await expect(service.consumeStock({ branch_id: 'branch-b', inventory_item_id: 'item-a', quantity: 1 })).rejects.toThrow(ForbiddenException); expect(lots.createQueryBuilder).not.toHaveBeenCalled(); });

  // --- T2.1 GET /v1/inventory/items/:id
  it('gets a single item scoped to the organization', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', sku: 'SKU-A' });
    await expect(service.getItem('item-a')).resolves.toMatchObject({ id: 'item-a', organization_id: 'org-a' });
    expect(items.findOne).toHaveBeenCalledWith({ where: { id: 'item-a', organization_id: 'org-a' } });
  });
  it('returns the same 404 for a missing and a cross-organization item', async () => {
    items.findOne.mockResolvedValue(null);
    await expect(service.getItem('item-b')).rejects.toThrow(NotFoundException);
    await expect(service.updateItem('item-b', { name: 'X' } as never)).rejects.toThrow(NotFoundException);
  });

  // --- T2.2 PATCH /v1/inventory/items/:id
  it('updates only the whitelisted fields of the caller\'s own item and cross-checks the branch', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', name: 'Old', sku: 'SKU-A', selling_price: '5.00' });
    const result = await service.updateItem('item-a', { name: 'New', selling_price: 12.5 } as never);
    expect(tenant.requireBranchAccess).toHaveBeenCalledWith('org-a', 'branch-a');
    expect(result).toMatchObject({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', name: 'New', sku: 'SKU-A', selling_price: '12.50' });
  });
  it('ignores non-whitelisted keys, so PATCH can never re-home an item or write stock', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', name: 'Old' });
    const result = await service.updateItem('item-a', { organization_id: 'org-b', branch_id: 'branch-b', id: 'evil', created_at: '2000-01-01', quantity: 999, name: 'New' } as never);
    expect(result).toMatchObject({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', name: 'New' });
    expect(items.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a' }));
  });

  it('scopes the update lookup to the organization', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', name: 'Old' });
    await service.updateItem('item-a', { name: 'New' } as never);
    expect(items.findOne).toHaveBeenCalledWith({ where: { id: 'item-a', organization_id: 'org-a' } });
  });
  it('maps a duplicate SKU on update to a 409 instead of an unhandled driver error', async () => {
    // `UQ_inventory_items_org_branch_sku` (organization_id, branch_id, sku) is the
    // only unique source on this UPDATE, so a 23505 here is that collision.
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a', sku: 'TAKEN' });
    items.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(service.updateItem('item-a', { sku: 'TAKEN' } as never)).rejects.toBeInstanceOf(ConflictException);
  });
  it('does not swallow a non-unique save error as a 409', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-a' });
    const fk = { driverError: { code: '23503' } };
    items.save.mockRejectedValue(fk);
    await expect(service.updateItem('item-a', { name: 'X' } as never)).rejects.toBe(fk);
  });

  // --- Batch 8d: 23505 on CREATE (UQ_inventory_items_org_branch_sku)
  it('maps a duplicate SKU on create to a 409 instead of an unhandled driver error', async () => {
    // `UQ_inventory_items_org_branch_sku` (organization_id, branch_id, sku) is the
    // only unique source on this INSERT: the PK is database-generated and an FK
    // failure is 23503 — so a 23505 here is that collision and nothing else.
    items.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(service.createItem({ branch_id: 'branch-a', name: 'Dup', sku: 'TAKEN' })).rejects.toBeInstanceOf(ConflictException);
    // The conflict is raised at the INSERT, so no event is queued for a row that
    // was never written.
    expect(outbox.saveEventEnvelope).not.toHaveBeenCalled();
  });
  it('does not swallow a non-unique create error as a 409', async () => {
    const fk = { driverError: { code: '23503' } };
    items.save.mockRejectedValue(fk);
    await expect(service.createItem({ branch_id: 'branch-a', name: 'X', sku: 'NEW' })).rejects.toBe(fk);
  });

  // --- Batch 8d: duplicate PO lines are rejected before the transaction opens
  it('rejects duplicate inventory_item_id lines before the transaction opens', async () => {
    suppliers.findOne.mockResolvedValue({ id: 'sup-a', organization_id: 'org-a' });
    await expect(service.createPurchaseOrder({ branch_id: 'branch-a', supplier_id: 'sup-a', items: [{ inventory_item_id: 'item-a', quantity_ordered: 1, unit_cost: 5 }, { inventory_item_id: 'item-a', quantity_ordered: 2, unit_cost: 6 }] })).rejects.toBeInstanceOf(BadRequestException);
    // A request-shape check, not a database-error path: nothing was opened.
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(orderItems.save).not.toHaveBeenCalled();
  });

  // --- GET /v1/inventory/lots (branch-scoped, OI-1)
  it('lists lots branch-scoped via a join on the item, oldest receipt first', async () => {
    const qb = { innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'lot-a', organization_id: 'org-a' }], 1]) };
    lots.createQueryBuilder = jest.fn().mockReturnValue(qb);
    const result = await service.listLots({ branch_id: 'branch-a', page: 2, limit: 10, inventory_item_id: 'item-a' });
    expect(tenant.requireBranchAccess).toHaveBeenCalledWith('org-a', 'branch-a');
    expect(lots.createQueryBuilder).toHaveBeenCalledWith('lot');
    expect(qb.innerJoin).toHaveBeenCalledWith(InventoryItem, 'item', 'item.id = lot.inventory_item_id AND item.organization_id = lot.organization_id');
    expect(qb.where).toHaveBeenCalledWith('lot.organization_id = :org AND item.branch_id = :branch', { org: 'org-a', branch: 'branch-a' });
    expect(qb.andWhere).toHaveBeenCalledWith('lot.inventory_item_id = :itemId', { itemId: 'item-a' });
    expect(qb.take).toHaveBeenCalledWith(10); expect(qb.skip).toHaveBeenCalledWith(10);
    expect(result).toEqual({ data: [{ id: 'lot-a', organization_id: 'org-a' }], total: 1, page: 2, limit: 10 });
  });

  // --- OI-2 GET /v1/inventory/purchase-orders (branch-scoped list)
  it('lists purchase orders branch-scoped, cross-checking the branch', async () => {
    orders.find.mockResolvedValue([{ id: 'po-a', organization_id: 'org-a', branch_id: 'branch-a' }]);
    await expect(service.listPurchaseOrders('branch-a')).resolves.toEqual([{ id: 'po-a', organization_id: 'org-a', branch_id: 'branch-a' }]);
    expect(tenant.requireBranchAccess).toHaveBeenCalledWith('org-a', 'branch-a');
    expect(orders.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-a', branch_id: 'branch-a' }) }));
  });
  it("refuses a purchase-order list for a branch the caller cannot access", async () => {
    tenant.requireBranchAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.listPurchaseOrders('branch-b')).rejects.toThrow(ForbiddenException);
    expect(orders.find).not.toHaveBeenCalled();
  });

  // --- T2.4 GET /v1/inventory/purchase-orders/:id
  it('gets a purchase order with its lines, org-scoped on the parent', async () => {
    orders.findOne.mockResolvedValue({ id: 'po-1', organization_id: 'org-a', branch_id: 'branch-a' });
    orderItems.find.mockResolvedValue([{ id: 'line-1', po_id: 'po-1' }]);
    await expect(service.getPurchaseOrder('po-1')).resolves.toEqual({ order: { id: 'po-1', organization_id: 'org-a', branch_id: 'branch-a' }, items: [{ id: 'line-1', po_id: 'po-1' }] });
    expect(orders.findOne).toHaveBeenCalledWith({ where: { id: 'po-1', organization_id: 'org-a' } });
    expect(orderItems.find).toHaveBeenCalledWith({ where: { po_id: 'po-1' } });
  });
  it('returns the same 404 for a missing and a cross-organization purchase order and reads no lines', async () => {
    orders.findOne.mockResolvedValue(null);
    await expect(service.getPurchaseOrder('po-x')).rejects.toThrow(NotFoundException);
    expect(orderItems.find).not.toHaveBeenCalled();
  });

  // --- OI-1 by-id branch cross-check (a caller not authorized for the row's branch)
  it('rejects a by-id item read when the row resides in a branch the caller cannot access', async () => {
    items.findOne.mockResolvedValue({ id: 'item-a', organization_id: 'org-a', branch_id: 'branch-x' });
    tenant.requireBranchAccess.mockRejectedValue(new ForbiddenException('Access to this branch is not allowed'));
    await expect(service.getItem('item-a')).rejects.toThrow(ForbiddenException);
    expect(tenant.requireBranchAccess).toHaveBeenCalledWith('org-a', 'branch-x');
  });
  it('rejects a by-id purchase-order read when the row resides in a branch the caller cannot access', async () => {
    orders.findOne.mockResolvedValue({ id: 'po-1', organization_id: 'org-a', branch_id: 'branch-x' });
    tenant.requireBranchAccess.mockRejectedValue(new ForbiddenException('Access to this branch is not allowed'));
    await expect(service.getPurchaseOrder('po-1')).rejects.toThrow(ForbiddenException);
    expect(tenant.requireBranchAccess).toHaveBeenCalledWith('org-a', 'branch-x');
    expect(orderItems.find).not.toHaveBeenCalled();
  });
});