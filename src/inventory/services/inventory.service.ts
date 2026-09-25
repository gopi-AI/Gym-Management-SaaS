import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryLot } from '../entities/inventory-lot.entity';
import { InventoryTransaction } from '../entities/inventory-transaction.entity';
import { InventorySupplier } from '../entities/inventory-supplier.entity';
import { InventoryPurchaseOrder } from '../entities/inventory-purchase-order.entity';
import { InventoryPurchaseOrderItem } from '../entities/inventory-purchase-order-item.entity';
import { INVENTORY_EVENT_TYPES, INVENTORY_EVENT_VERSION, INVENTORY_TRANSACTION_TYPES } from '../inventory.constants';
import { ConsumeStockDto, CreateInventoryItemDto, CreatePurchaseOrderDto, CreateSupplierDto, ReceivePurchaseOrderDto } from '../dto/inventory.dto';

const n = (value: string | number | null | undefined) => Number(value ?? 0);
const money = (value: number) => value.toFixed(2);

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem) private readonly items: Repository<InventoryItem>,
    @InjectRepository(InventoryLot) private readonly lots: Repository<InventoryLot>,
    @InjectRepository(InventoryTransaction) private readonly transactions: Repository<InventoryTransaction>,
    @InjectRepository(InventorySupplier) private readonly suppliers: Repository<InventorySupplier>,
    @InjectRepository(InventoryPurchaseOrder) private readonly orders: Repository<InventoryPurchaseOrder>,
    @InjectRepository(InventoryPurchaseOrderItem) private readonly orderItems: Repository<InventoryPurchaseOrderItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenant: TenantContextService,
    private readonly outbox: OutboxService,
  ) {}

  private async org(): Promise<string> { const id = await this.tenant.getCurrentOrganizationId(); if (!id) throw new ForbiddenException('Organization context required'); return id; }
  private async branch(org: string, id: string): Promise<void> { await this.tenant.requireBranchAccess(org, id); }

  async listSuppliers(): Promise<InventorySupplier[]> { return this.suppliers.find({ where: { organization_id: await this.org() }, order: { name: 'ASC' } }); }
  async createSupplier(dto: CreateSupplierDto): Promise<InventorySupplier> { return this.suppliers.save(this.suppliers.create({ ...dto, organization_id: await this.org() })); }
  async listItems(branchId?: string): Promise<InventoryItem[]> { const org = await this.org(); if (branchId) await this.branch(org, branchId); return this.items.find({ where: { organization_id: org, ...(branchId ? { branch_id: branchId } : {}) }, order: { name: 'ASC' } }); }
  async createItem(dto: CreateInventoryItemDto): Promise<InventoryItem> { const org = await this.org(); await this.branch(org, dto.branch_id); const item = await this.items.save(this.items.create({ organization_id: org, branch_id: dto.branch_id, name: dto.name, sku: dto.sku, barcode: dto.barcode, unit: dto.unit, selling_price: dto.selling_price === undefined ? null : money(dto.selling_price) })); await this.outbox.saveEventEnvelope(INVENTORY_EVENT_TYPES.ITEM_CREATED, INVENTORY_EVENT_VERSION, org, { inventoryItemId: item.id, organizationId: org, branchId: item.branch_id, name: item.name, sku: item.sku }); return item; }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto): Promise<InventoryPurchaseOrder> {
    const org = await this.org(); await this.branch(org, dto.branch_id);
    const supplier = await this.suppliers.findOne({ where: { id: dto.supplier_id, organization_id: org } }); if (!supplier) throw new NotFoundException('Supplier not found');
    if (!dto.items?.length) throw new BadRequestException('At least one purchase-order line is required');
    for (const line of dto.items) { const item = await this.items.findOne({ where: { id: line.inventory_item_id, organization_id: org, branch_id: dto.branch_id } }); if (!item) throw new ForbiddenException('Item is not in the authorized branch'); }
    const total = dto.items.reduce((sum, line) => sum + line.quantity_ordered * line.unit_cost, 0);
    return this.dataSource.transaction(async manager => {
      const order = await manager.getRepository(InventoryPurchaseOrder).save(manager.getRepository(InventoryPurchaseOrder).create({ organization_id: org, branch_id: dto.branch_id, supplier_id: dto.supplier_id, expected_delivery: dto.expected_delivery ? new Date(dto.expected_delivery) : null, order_date: new Date(), total_amount: money(total), status: 'open' }));
      await manager.getRepository(InventoryPurchaseOrderItem).save(dto.items.map(line => manager.getRepository(InventoryPurchaseOrderItem).create({ po_id: order.id, ...line, quantity_ordered: String(line.quantity_ordered), unit_cost: money(line.unit_cost), quantity_received: '0' })));
      return order;
    });
  }

  async listPurchaseOrders(): Promise<InventoryPurchaseOrder[]> { return this.orders.find({ where: { organization_id: await this.org() }, order: { order_date: 'DESC' } }); }
  async receivePurchaseOrder(id: string, dto: ReceivePurchaseOrderDto): Promise<InventoryPurchaseOrder> {
    const org = await this.org();
    return this.dataSource.transaction(async manager => {
      const orderRepo = manager.getRepository(InventoryPurchaseOrder); const itemRepo = manager.getRepository(InventoryPurchaseOrderItem); const lotRepo = manager.getRepository(InventoryLot); const txRepo = manager.getRepository(InventoryTransaction);
      const order = await orderRepo.findOne({ where: { id, organization_id: org }, lock: { mode: 'pessimistic_write' } }); if (!order) throw new NotFoundException('Purchase order not found'); await this.branch(org, order.branch_id);
      const lines = await itemRepo.find({ where: { po_id: id } });
      for (const received of dto.items) {
        const line = lines.find(x => x.inventory_item_id === received.inventory_item_id); if (!line) throw new BadRequestException('Receipt line is not on the purchase order');
        const remaining = n(line.quantity_ordered) - n(line.quantity_received); if (received.quantity > remaining) throw new BadRequestException('Receipt exceeds ordered quantity');
        const lot = await lotRepo.save(lotRepo.create({ organization_id: org, inventory_item_id: received.inventory_item_id, lot_number: received.lot_number ?? null, expiry_date: received.expiry_date ? new Date(received.expiry_date) : null, quantity: String(received.quantity), unit_cost: money(received.unit_cost), received_at: new Date() }));
        const tx = await txRepo.save(txRepo.create({ organization_id: org, branch_id: order.branch_id, inventory_item_id: received.inventory_item_id, transaction_type: INVENTORY_TRANSACTION_TYPES.RECEIPT, quantity: String(received.quantity), unit_cost: money(received.unit_cost), reference_id: order.id, reference_type: 'purchase_order', transaction_date: new Date() }));
        line.quantity_received = String(n(line.quantity_received) + received.quantity); await itemRepo.save(line);
        await this.outbox.saveEventEnvelope(INVENTORY_EVENT_TYPES.STOCK_UPDATED, INVENTORY_EVENT_VERSION, org, { inventoryItemId: received.inventory_item_id, organizationId: org, branchId: order.branch_id, transactionId: tx.id, transactionType: 'receipt', quantity: String(received.quantity), quantityOnHand: 'derived' }, undefined, undefined, manager); void lot;
      }
      order.status = lines.every(x => n(x.quantity_received) >= n(x.quantity_ordered)) ? 'received' : 'partially_received'; const saved = await orderRepo.save(order); await manager.query(`REFRESH MATERIALIZED VIEW "MV_INVENTORY_STOCK_LEVELS"`); return saved;
    });
  }

  async stock(branchId?: string): Promise<unknown[]> { const org = await this.org(); if (branchId) await this.branch(org, branchId); return this.dataSource.query(`SELECT s.organization_id,s.branch_id,s.inventory_item_id,i.name,i.sku,s.quantity_on_hand,s.transaction_value FROM "MV_INVENTORY_STOCK_LEVELS" s JOIN "INVENTORY_ITEMS" i ON i.id=s.inventory_item_id AND i.organization_id=s.organization_id WHERE s.organization_id=$1 ${branchId ? 'AND s.branch_id=$2' : ''} ORDER BY i.name`, branchId ? [org, branchId] : [org]); }

  async consumeStock(dto: ConsumeStockDto): Promise<{ transaction: InventoryTransaction; costOfGoodsSold: string }> {
    const org = await this.org(); await this.branch(org, dto.branch_id);
    return this.dataSource.transaction(async manager => {
      const item = await manager.getRepository(InventoryItem).findOne({ where: { id: dto.inventory_item_id, organization_id: org, branch_id: dto.branch_id } }); if (!item) throw new ForbiddenException('Item is not in the authorized branch');
      const lotRows = await manager.getRepository(InventoryLot).createQueryBuilder('lot').setLock('pessimistic_write').where('lot.organization_id = :org AND lot.inventory_item_id = :item AND lot.quantity > 0', { org, item: item.id }).orderBy('lot.received_at', 'ASC').addOrderBy('lot.id', 'ASC').getMany();
      const fifo = InventoryService.consumeFifo(lotRows.map(lot => ({ id: lot.id, quantity: n(lot.quantity), unit_cost: n(lot.unit_cost) })), dto.quantity);
      const lotRepo = manager.getRepository(InventoryLot); for (const layer of fifo.layers) await lotRepo.update(layer.id, { quantity: String(layer.quantity) });
      const transaction = await manager.getRepository(InventoryTransaction).save(manager.getRepository(InventoryTransaction).create({ organization_id: org, branch_id: dto.branch_id, inventory_item_id: item.id, transaction_type: INVENTORY_TRANSACTION_TYPES.SALE, quantity: String(-dto.quantity), unit_cost: money(fifo.cogs / dto.quantity), reference_id: dto.reference_id ?? null, reference_type: dto.reference_type ?? 'sale', transaction_date: new Date() }));
      await this.outbox.saveEventEnvelope(INVENTORY_EVENT_TYPES.ITEM_SOLD, INVENTORY_EVENT_VERSION, org, { inventoryItemId: item.id, organizationId: org, branchId: dto.branch_id, quantity: String(dto.quantity), costOfGoodsSold: money(fifo.cogs) }, undefined, undefined, manager);
      await manager.query(`REFRESH MATERIALIZED VIEW "MV_INVENTORY_STOCK_LEVELS"`);
      return { transaction, costOfGoodsSold: money(fifo.cogs) };
    });
  }

  /** FIFO helper used by sale flows and unit-tested independently of HTTP. */
  static consumeFifo(layers: Array<{ id: string; quantity: number; unit_cost: number }>, quantity: number): { layers: Array<{ id: string; quantity: number; unit_cost: number }>; cogs: number } {
    if (quantity <= 0) throw new BadRequestException('Quantity must be positive'); const result = layers.map(x => ({ ...x })); let remaining = quantity; let cogs = 0;
    for (const layer of result) { if (!remaining) break; const used = Math.min(layer.quantity, remaining); layer.quantity -= used; remaining -= used; cogs += used * layer.unit_cost; }
    if (remaining > 0) throw new BadRequestException('Insufficient stock'); return { layers: result, cogs: Number(cogs.toFixed(2)) };
  }
}