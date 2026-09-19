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

export interface RefundIssuedPayload {
  refundId: string;
  paymentId: string;
  /** Denormalised from the refunded payment — a refund has no invoice of its own. */
  invoiceId: string;
  amount: string;
  reason: string;
  /** ISO-8601 timestamp. */
  refundDate: string;
  status: string;
}

export interface CreditNoteIssuedPayload {
  creditNoteId: string;
  invoiceId: string;
  /** Tax reversal: what the credit note removed, per part (§15 Q5 ruling). */
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  reason: string;
  /** ISO-8601 timestamp. */
  issuedDate: string;
  status: string;
}

export type InvoiceCreatedEvent = EventEnvelope<InvoiceCreatedPayload>;
export type PaymentSucceededEvent = EventEnvelope<PaymentSucceededPayload>;
export type PaymentFailedEvent = EventEnvelope<PaymentFailedPayload>;
export type RefundIssuedEvent = EventEnvelope<RefundIssuedPayload>;
export type CreditNoteIssuedEvent = EventEnvelope<CreditNoteIssuedPayload>;

export type FinanceEvent =
  | InvoiceCreatedEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | RefundIssuedEvent
  | CreditNoteIssuedEvent;

export const FINANCE_EVENT_TYPES = {
  INVOICE_CREATED: 'InvoiceCreated',
  PAYMENT_SUCCEEDED: 'PaymentSucceeded',
  PAYMENT_FAILED: 'PaymentFailed',
  REFUND_ISSUED: 'RefundIssued',
  CREDIT_NOTE_ISSUED: 'CreditNoteIssued',
} as const;
