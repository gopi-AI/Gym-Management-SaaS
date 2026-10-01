import { IsBoolean, IsDateString, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierDto { @IsString() name!: string; @IsOptional() @IsString() contact_person?: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() address?: string; }
export class CreateInventoryItemDto { @IsUUID() branch_id!: string; @IsString() name!: string; @IsString() sku!: string; @IsOptional() @IsString() barcode?: string; @IsOptional() @IsString() unit?: string; @IsOptional() @IsNumber() @Min(0) selling_price?: number; }
export class PurchaseOrderLineDto { @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity_ordered!: number; @IsNumber() @Min(0) unit_cost!: number; }
export class CreatePurchaseOrderDto { @IsUUID() branch_id!: string; @IsUUID() supplier_id!: string; @IsOptional() @IsDateString() expected_delivery?: string; @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto) items!: PurchaseOrderLineDto[]; }
export class ReceivePurchaseOrderDto { @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items!: ReceiveLineDto[]; }
export class ReceiveLineDto { @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity!: number; @IsNumber() @Min(0) unit_cost!: number; @IsOptional() @IsString() lot_number?: string; @IsOptional() @IsDateString() expiry_date?: string; }
export class ConsumeStockDto { @IsUUID() branch_id!: string; @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity!: number; @IsOptional() @IsUUID() reference_id?: string; @IsOptional() @IsString() reference_type?: string; }

/**
 * Partial update for `PATCH /v1/inventory/items/:id`. Every property is optional
 * and mirrors a writable column on `InventoryItem` — `organization_id` and
 * `branch_id` are deliberately absent: an item is not re-homed through an update,
 * because `INVENTORY_LOTS`/`INVENTORY_TRANSACTIONS` rows already reference it in
 * its current branch, and the `(organization_id, branch_id, sku)` unique index
 * makes a move a silent collision risk. `ValidationPipe` runs `whitelist: true`
 * (`src/main.ts`), so any other key a client sends is stripped before it reaches
 * the service.
 */
export class UpdateInventoryItemDto { @IsOptional() @IsString() name?: string; @IsOptional() @IsString() sku?: string; @IsOptional() @IsString() barcode?: string; @IsOptional() @IsString() unit?: string; @IsOptional() @IsNumber() @Min(0) selling_price?: number; @IsOptional() @IsBoolean() is_active?: boolean; }

/**
 * Query for `GET /v1/inventory/items` (branch-scoped). `branch_id` is REQUIRED:
 * inventory reads are branch-scoped, so a caller must name a branch it is
 * authorized for (validated by `requireBranchAccess`). A missing or non-UUID
 * `branch_id` is rejected by the global `ValidationPipe` (`whitelist: true`,
 * `src/main.ts`) with a 400.
 */
export class QueryInventoryItemDto { @IsUUID() branch_id!: string; }

/**
 * Query for `GET /v1/inventory/stock` (branch-scoped). `branch_id` is REQUIRED
 * for the same reason as `QueryInventoryItemDto`; the matview carries its own
 * `branch_id`, so the filter is a direct predicate.
 */
export class QueryInventoryStockDto { @IsUUID() branch_id!: string; }

/**
 * Query for `GET /v1/inventory/purchase-orders` (branch-scoped, OI-2). `branch_id`
 * is REQUIRED for the same reason as `QueryInventoryItemDto` — purchase-order
 * reads are branch-scoped, and `INVENTORY_PURCHASE_ORDERS` carries its own
 * indexed `branch_id`, so the filter is a direct predicate. A missing or
 * non-UUID `branch_id` is rejected by the global `ValidationPipe`
 * (`whitelist: true`, `src/main.ts`) with a 400.
 */
export class QueryPurchaseOrderDto { @IsUUID() branch_id!: string; }

/**
 * Query for `GET /v1/inventory/lots` (paginated, branch-scoped). `branch_id` is
 * REQUIRED. `INVENTORY_LOTS` has no `branch_id` column (`inventory-lot.entity.ts`),
 * so the branch predicate is applied by joining the row's item
 * (`INVENTORY_LOTS.inventory_item_id = INVENTORY_ITEMS.id`) and requiring that
 * item to belong to the caller's organization and the requested branch. The
 * direct `organization_id` predicate is kept as well. `inventory_item_id` remains
 * an optional extra filter. `page`/`limit` follow `QueryMembershipPlanDto`.
 */
export class QueryInventoryLotDto { @IsUUID() branch_id!: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1; @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20; @IsOptional() @IsUUID() inventory_item_id?: string; }