import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { InventoryService } from '../services/inventory.service';
import { ConsumeStockDto, CreateInventoryItemDto, CreatePurchaseOrderDto, CreateSupplierDto, ReceivePurchaseOrderDto } from '../dto/inventory.dto';

@Controller('v1/inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('suppliers') @RequirePermissions({ resource: 'inventory', action: 'read' }) listSuppliers() { return this.service.listSuppliers(); }
  @Post('suppliers') @RequirePermissions({ resource: 'inventory', action: 'create' }) createSupplier(@Body() dto: CreateSupplierDto) { return this.service.createSupplier(dto); }
  @Get('items') @RequirePermissions({ resource: 'inventory', action: 'read' }) listItems(@Query('branch_id') branchId?: string) { return this.service.listItems(branchId); }
  @Post('items') @RequirePermissions({ resource: 'inventory', action: 'create' }) createItem(@Body() dto: CreateInventoryItemDto) { return this.service.createItem(dto); }
  @Get('purchase-orders') @RequirePermissions({ resource: 'inventory', action: 'read' }) listPurchaseOrders() { return this.service.listPurchaseOrders(); }
  @Post('purchase-orders') @RequirePermissions({ resource: 'inventory', action: 'create' }) createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) { return this.service.createPurchaseOrder(dto); }
  @Post('purchase-orders/:id/receive') @RequirePermissions({ resource: 'inventory', action: 'receive' }) receive(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ReceivePurchaseOrderDto) { return this.service.receivePurchaseOrder(id, dto); }
  @Get('stock') @RequirePermissions({ resource: 'inventory', action: 'read' }) stock(@Query('branch_id') branchId?: string) { return this.service.stock(branchId); }
  @Post('transactions/consume') @RequirePermissions({ resource: 'inventory', action: 'update' }) consume(@Body() dto: ConsumeStockDto) { return this.service.consumeStock(dto); }
}