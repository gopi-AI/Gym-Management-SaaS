import { EventEnvelope } from './event-envelope';

export interface InventoryItemCreatedPayload {
  inventoryItemId: string;
  organizationId: string;
  branchId: string;
  name: string;
  sku: string;
}

export interface InventoryStockUpdatedPayload {
  inventoryItemId: string;
  organizationId: string;
  branchId: string;
  transactionId: string;
  transactionType: string;
  quantity: string;
  quantityOnHand: string;
}

export interface InventoryItemSoldPayload {
  inventoryItemId: string;
  organizationId: string;
  branchId: string;
  quantity: string;
  costOfGoodsSold: string;
}

export interface PurchaseOrderReceivedPayload {
  purchaseOrderId: string;
  organizationId: string;
  branchId: string;
  receivedAt: string;
  lineItems: Array<{ inventoryItemId: string; quantity: string; unitCost: string }>;
}

export type InventoryItemCreatedEvent = EventEnvelope<InventoryItemCreatedPayload>;
export type InventoryStockUpdatedEvent = EventEnvelope<InventoryStockUpdatedPayload>;
export type InventoryItemSoldEvent = EventEnvelope<InventoryItemSoldPayload>;
export type PurchaseOrderReceivedEvent = EventEnvelope<PurchaseOrderReceivedPayload>;

export type InventoryEvent =
  | InventoryItemCreatedEvent
  | InventoryStockUpdatedEvent
  | InventoryItemSoldEvent
  | PurchaseOrderReceivedEvent;

export const INVENTORY_EVENT_TYPES = {
  ITEM_CREATED: 'InventoryItemCreated',
  STOCK_UPDATED: 'InventoryStockUpdated',
  ITEM_SOLD: 'InventoryItemSold',
  PURCHASE_ORDER_RECEIVED: 'PurchaseOrderReceived',
} as const;