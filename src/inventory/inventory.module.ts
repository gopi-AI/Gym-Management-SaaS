import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { InventoryItem } from './entities/inventory-item.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventorySupplier } from './entities/inventory-supplier.entity';
import { InventoryPurchaseOrder } from './entities/inventory-purchase-order.entity';
import { InventoryPurchaseOrderItem } from './entities/inventory-purchase-order-item.entity';
import { InventoryService } from './services/inventory.service';
import { InventoryController } from './controllers/inventory.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem, InventoryLot, InventoryTransaction, InventorySupplier, InventoryPurchaseOrder, InventoryPurchaseOrderItem]), TenancyModule, OutboxModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}