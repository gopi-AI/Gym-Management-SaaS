import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryLot } from '../entities/inventory-lot.entity';
import { InventoryPurchaseOrder } from '../entities/inventory-purchase-order.entity';
import { InventoryPurchaseOrderItem } from '../entities/inventory-purchase-order-item.entity';
import { InventoryTransaction } from '../entities/inventory-transaction.entity';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  const repo = () => ({ find: jest.fn(), findOne: jest.fn(), findOneBy: jest.fn(), createQueryBuilder: jest.fn(), create: jest.fn((value) => value), save: jest.fn((value) => Promise.resolve(value)), update: jest.fn() });
  let service: InventoryService; let items: any; let lots: any; let transactions: any; let suppliers: any; let orders: any; let orderItems: any; let manager: any; let tenant: any; let outbox: any; let dataSource: any;
  beforeEach(() => {
    items = repo(); lots = repo(); transactions = repo(); suppliers = repo(); orders = repo(); orderItems = repo();
    manager = { getRepository: jest.fn((entity) => ({ [InventoryItem.name]: items, [InventoryLot.name]: lots, [InventoryTransaction.name]: transactions, [InventoryPurchaseOrder.name]: orders, [InventoryPurchaseOrderItem.name]: orderItems }[entity.name] ?? repo())), query: jest.fn() };
    tenant = { getCurrentOrganizationId: jest.fn().mockResolvedValue('org-a'), requireBranchAccess: jest.fn().mockResolvedValue(undefined) };
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
  it('rejects cross-branch consumption even when the item exists elsewhere', async () => { items.findOne.mockResolvedValue(null); await expect(service.consumeStock({ branch_id: 'branch-b', inventory_item_id: 'item-a', quantity: 1 })).rejects.toThrow(ForbiddenException); expect(lots.createQueryBuilder).not.toHaveBeenCalled(); });
});