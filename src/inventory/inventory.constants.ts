export const INVENTORY_EVENT_TYPES = {
  ITEM_CREATED: 'InventoryItemCreated',
  STOCK_UPDATED: 'InventoryStockUpdated',
  ITEM_SOLD: 'InventoryItemSold',
  PURCHASE_ORDER_RECEIVED: 'PurchaseOrderReceived',
} as const;

export const INVENTORY_EVENT_VERSION = 'v1';
export const INVENTORY_TRANSACTION_TYPES = {
  RECEIPT: 'receipt',
  SALE: 'sale',
  ADJUSTMENT: 'adjustment',
  RETURN: 'return',
} as const;
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[keyof typeof INVENTORY_TRANSACTION_TYPES];