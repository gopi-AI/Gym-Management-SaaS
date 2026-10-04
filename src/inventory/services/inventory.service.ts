import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
import { ConsumeStockDto, CreateInventoryItemDto, CreatePurchaseOrderDto, CreateSupplierDto, QueryInventoryLotDto, ReceivePurchaseOrderDto, UpdateInventoryItemDto } from '../dto/inventory.dto';
import { isUniqueViolation } from '../../shared/utils/unique-violation';

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

  /**
   * Authorized organization for the current request — the same shape every other
   * tenant module uses (`InvoicesService.resolveAuthorizedOrg` etc.). Reading
   * `getCurrentOrganizationId()` alone is NOT sufficient: `TenantContextInterceptor`
   * records only the *requested* organization (`X-Organization-Id`), and the
   * authorized `organizationId` stays unset until a require/validate call
   * establishes it. Falling back to `requireOrganizationAccess(requested)` is
   * what authorizes the request; without it every route here answers 403.
   */
  private async org(): Promise<string> {
    const currentOrgId = await this.tenant.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenant.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenant.requireOrganizationAccess(requestedOrgId);
  }
  private async branch(org: string, id: string): Promise<void> { await this.tenant.requireBranchAccess(org, id); }

  async listSuppliers(): Promise<InventorySupplier[]> { return this.suppliers.find({ where: { organization_id: await this.org() }, order: { name: 'ASC' } }); }
  async createSupplier(dto: CreateSupplierDto): Promise<InventorySupplier> { return this.suppliers.save(this.suppliers.create({ ...dto, organization_id: await this.org() })); }
  async listItems(branchId: string): Promise<InventoryItem[]> { const org = await this.org(); await this.branch(org, branchId); return this.items.find({ where: { organization_id: org, branch_id: branchId }, order: { name: 'ASC' } }); }
  async createItem(dto: CreateInventoryItemDto): Promise<InventoryItem> {
    const org = await this.org(); await this.branch(org, dto.branch_id);
    let item: InventoryItem;
    try {
      item = await this.items.save(this.items.create({ organization_id: org, branch_id: dto.branch_id, name: dto.name, sku: dto.sku, barcode: dto.barcode, unit: dto.unit, selling_price: dto.selling_price === undefined ? null : money(dto.selling_price) }));
    } catch (error) {
      // A 23505 on this INSERT can only be UQ_inventory_items_org_branch_sku: the
      // PK is database-generated and FK failures are 23503. Map it to the module's
      // own 409 — the wording updateItem() already returns — instead of an
      // unhandled QueryFailedError (500). The outbox write stays OUTSIDE this try:
      // its own unique key is not this collision and must not be reported as one.
      if (isUniqueViolation(error)) {
        throw new ConflictException('An inventory item with this SKU already exists in this branch');
      }
      throw error;
    }
    await this.outbox.saveEventEnvelope(INVENTORY_EVENT_TYPES.ITEM_CREATED, INVENTORY_EVENT_VERSION, org, { inventoryItemId: item.id, organizationId: org, branchId: item.branch_id, name: item.name, sku: item.sku });
    return item;
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto): Promise<InventoryPurchaseOrder> {
    const org = await this.org(); await this.branch(org, dto.branch_id);
    const supplier = await this.suppliers.findOne({ where: { id: dto.supplier_id, organization_id: org } }); if (!supplier) throw new NotFoundException('Supplier not found');
    if (!dto.items?.length) throw new BadRequestException('At least one purchase-order line is required');
    // `INVENTORY_PURCHASE_ORDER_ITEMS` carries a UNIQUE key on (po_id, inventory_item_id)
    // and no organization_id, so a repeated item id in ONE body would abort the line
    // INSERT with a 23505 and roll the whole transaction back. Reject the shape before
    // the transaction opens — a request error, not a database-error path.
    const seenItemIds = new Set<string>();
    for (const line of dto.items) { if (seenItemIds.has(line.inventory_item_id)) throw new BadRequestException('Duplicate inventory_item_id in items'); seenItemIds.add(line.inventory_item_id); }
    for (const line of dto.items) { const item = await this.items.findOne({ where: { id: line.inventory_item_id, organization_id: org, branch_id: dto.branch_id } }); if (!item) throw new ForbiddenException('Item is not in the authorized branch'); }
    const total = dto.items.reduce((sum, line) => sum + line.quantity_ordered * line.unit_cost, 0);
    return this.dataSource.transaction(async manager => {
      const order = await manager.getRepository(InventoryPurchaseOrder).save(manager.getRepository(InventoryPurchaseOrder).create({ organization_id: org, branch_id: dto.branch_id, supplier_id: dto.supplier_id, expected_delivery: dto.expected_delivery ? new Date(dto.expected_delivery) : null, order_date: new Date(), total_amount: money(total), status: 'open' }));
      await manager.getRepository(InventoryPurchaseOrderItem).save(dto.items.map(line => manager.getRepository(InventoryPurchaseOrderItem).create({ po_id: order.id, ...line, quantity_ordered: String(line.quantity_ordered), unit_cost: money(line.unit_cost), quantity_received: '0' })));
      return order;
    });
  }

  /**
   * Branch-scoped purchase-order list (OI-2, owner ruling 2026-10-01): the same
   * shape as `listItems()` — the caller must name a branch it is authorized for,
   * and the query carries the branch predicate. `INVENTORY_PURCHASE_ORDERS` has
   * its own indexed `branch_id`, so no join is required.
   */
  async listPurchaseOrders(branchId: string): Promise<InventoryPurchaseOrder[]> { const org = await this.org(); await this.branch(org, branchId); return this.orders.find({ where: { organization_id: org, branch_id: branchId }, order: { order_date: 'DESC' } }); }
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

  async stock(branchId: string): Promise<unknown[]> { const org = await this.org(); await this.branch(org, branchId); return this.dataSource.query(`SELECT s.organization_id,s.branch_id,s.inventory_item_id,i.name,i.sku,s.quantity_on_hand,s.transaction_value FROM "MV_INVENTORY_STOCK_LEVELS" s JOIN "INVENTORY_ITEMS" i ON i.id=s.inventory_item_id AND i.organization_id=s.organization_id WHERE s.organization_id=$1 AND s.branch_id=$2 ORDER BY i.name`, [org, branchId]); }

  /**
   * Single item, org- AND branch-scoped (OI-1). The row is loaded org-scoped
   * first, then its own branch is cross-checked with `requireBranchAccess` — the
   * same shape `updateItem()` uses. A missing id or another organization's id is a
   * 404 (the org predicate hides it); an item in a branch the caller may not access
   * is a 403.
   */
  async getItem(id: string): Promise<InventoryItem> {
    const org = await this.org();
    const item = await this.items.findOne({ where: { id, organization_id: org } });
    if (!item) throw new NotFoundException('Inventory item not found');
    await this.branch(org, item.branch_id);
    return item;
  }

  /**
   * Partial update. Each field is assigned individually rather than spread from
   * the DTO (`.clinerules` §3), so a column added to `InventoryItem` later is not
   * silently writable by a client-supplied key, and the row cannot be re-homed to
   * another organization or branch (see `UpdateInventoryItemDto`).
   *
   * Unlike `getItem()`, this WRITE cross-checks the row's own branch — the same
   * shape `receivePurchaseOrder()` uses after loading its order.
   */
  async updateItem(id: string, dto: UpdateInventoryItemDto): Promise<InventoryItem> {
    const org = await this.org();
    const item = await this.items.findOne({ where: { id, organization_id: org } });
    if (!item) throw new NotFoundException('Inventory item not found');
    await this.branch(org, item.branch_id);
    if (dto.name !== undefined) item.name = dto.name;
    if (dto.sku !== undefined) item.sku = dto.sku;
    if (dto.barcode !== undefined) item.barcode = dto.barcode;
    if (dto.unit !== undefined) item.unit = dto.unit;
    if (dto.selling_price !== undefined) item.selling_price = money(dto.selling_price);
    if (dto.is_active !== undefined) item.is_active = dto.is_active;
    try {
      return await this.items.save(item);
    } catch (error) {
      // A 23505 on this UPDATE can only be UQ_inventory_items_org_branch_sku: the
      // `id` is given (the row was just loaded) and FK failures are 23503. Map it
      // to the module's own 409 instead of an unhandled QueryFailedError (500).
      if (isUniqueViolation(error)) {
        throw new ConflictException('An inventory item with this SKU already exists in this branch');
      }
      throw error;
    }
  }

  /**
   * Paginated, branch-scoped lot listing (OI-1). `INVENTORY_LOTS` carries
   * `organization_id` (`inventory-lot.entity.ts:7`) so tenancy stays a direct
   * predicate, but it has NO `branch_id`, so the branch predicate is applied by
   * joining the row's item (`INVENTORY_LOTS.inventory_item_id = INVENTORY_ITEMS.id`)
   * and matching that item's `branch_id` — with the item's `organization_id`
   * pinned to the lot's, exactly as `memberships.service.ts:444` joins an invoice
   * item. Ordered oldest-receipt-first (the FIFO order `IDX_inventory_lots_fifo`
   * indexes).
   */
  async listLots(query: QueryInventoryLotDto): Promise<{ data: InventoryLot[]; total: number; page: number; limit: number }> {
    const org = await this.org(); await this.branch(org, query.branch_id);
    const page = query.page || 1; const limit = query.limit || 20;
    const qb = this.lots.createQueryBuilder('lot')
      .innerJoin(InventoryItem, 'item', 'item.id = lot.inventory_item_id AND item.organization_id = lot.organization_id')
      .where('lot.organization_id = :org AND item.branch_id = :branch', { org, branch: query.branch_id });
    if (query.inventory_item_id !== undefined) qb.andWhere('lot.inventory_item_id = :itemId', { itemId: query.inventory_item_id });
    const [data, total] = await qb.orderBy('lot.received_at', 'ASC').addOrderBy('lot.id', 'ASC').take(limit).skip((page - 1) * limit).getManyAndCount();
    return { data, total, page, limit };
  }

  /**
   * Purchase order with its lines, org- AND branch-scoped (OI-1). The order is
   * loaded org-scoped first, its own branch is cross-checked, and the lines are
   * then read by `po_id`, exactly as `receivePurchaseOrder()` does:
   * `INVENTORY_PURCHASE_ORDER_ITEMS` has no `organization_id` of its own, so the
   * already-authorized parent is what makes the child read safe. Missing or
   * other-organization id -> 404; an unauthorized branch -> 403.
   */
  async getPurchaseOrder(id: string): Promise<{ order: InventoryPurchaseOrder; items: InventoryPurchaseOrderItem[] }> {
    const org = await this.org();
    const order = await this.orders.findOne({ where: { id, organization_id: org } });
    if (!order) throw new NotFoundException('Purchase order not found');
    await this.branch(org, order.branch_id);
    const items = await this.orderItems.find({ where: { po_id: order.id } });
    return { order, items };
  }

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