import { EventEnvelope } from './event-envelope';

/**
 * Finance domain events.
 *
 * `InvoiceCreated.v1`, `PaymentSucceeded.v1` and `PaymentFailed.v1` mirror the
 * payloads documented in `docs/event-contracts.md` (§Finance Events) exactly.
 */

export interface InvoiceLineItemPayload {
  description: string;
  quantity: string; // Decimal as string for precision
  unitPrice: string;
  lineTotal: string;
  taxCode?: string;
}

export interface InvoiceCreatedPayload {
  invoiceId: string;
  memberId: string;
  invoiceNumber: string;
  /** ISO-8601 timestamp. */
  issueDate: string;
  /** ISO-8601 timestamp. */
  dueDate: string;
  totalAmount: string;
  lineItems: InvoiceLineItemPayload[];
}

export interface PaymentSucceededPayload {
  paymentId: string;
  invoiceId: string;
  amount: string;
  paymentMethod: string;
  transactionId?: string;
  /** ISO-8601 timestamp. */
  paymentDate: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  invoiceId: string;
  amount: string;
  failureReason: string;
  failureCode: string;
  /** ISO-8601 timestamp. */
  paymentDate: string;
}

export type InvoiceCreatedEvent = EventEnvelope<InvoiceCreatedPayload>;
export type PaymentSucceededEvent = EventEnvelope<PaymentSucceededPayload>;
export type PaymentFailedEvent = EventEnvelope<PaymentFailedPayload>;

export type FinanceEvent =
  | InvoiceCreatedEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent;

export const FINANCE_EVENT_TYPES = {
  INVOICE_CREATED: 'InvoiceCreated',
  PAYMENT_SUCCEEDED: 'PaymentSucceeded',
  PAYMENT_FAILED: 'PaymentFailed',
} as const;
