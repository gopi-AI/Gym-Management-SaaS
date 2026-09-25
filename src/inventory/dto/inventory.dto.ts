import { IsDateString, IsEmail, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierDto { @IsString() name!: string; @IsOptional() @IsString() contact_person?: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() address?: string; }
export class CreateInventoryItemDto { @IsUUID() branch_id!: string; @IsString() name!: string; @IsString() sku!: string; @IsOptional() @IsString() barcode?: string; @IsOptional() @IsString() unit?: string; @IsOptional() @IsNumber() @Min(0) selling_price?: number; }
export class PurchaseOrderLineDto { @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity_ordered!: number; @IsNumber() @Min(0) unit_cost!: number; }
export class CreatePurchaseOrderDto { @IsUUID() branch_id!: string; @IsUUID() supplier_id!: string; @IsOptional() @IsDateString() expected_delivery?: string; @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto) items!: PurchaseOrderLineDto[]; }
export class ReceivePurchaseOrderDto { @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items!: ReceiveLineDto[]; }
export class ReceiveLineDto { @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity!: number; @IsNumber() @Min(0) unit_cost!: number; @IsOptional() @IsString() lot_number?: string; @IsOptional() @IsDateString() expiry_date?: string; }
export class ConsumeStockDto { @IsUUID() branch_id!: string; @IsUUID() inventory_item_id!: string; @IsNumber() @Min(0.0001) quantity!: number; @IsOptional() @IsUUID() reference_id?: string; @IsOptional() @IsString() reference_type?: string; }