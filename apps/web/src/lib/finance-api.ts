/**
 * Finance API endpoints (invoices + payments).
 *
 * Mirrors the backend controllers:
 *   - InvoicesController  @Controller('v1/invoices')
 *   - PaymentsController  @Controller('v1')
 *
 * `amount_paid` and `outstanding_amount` are computed by the server from the
 * succeeded payments of an invoice; the client never derives a balance itself.
 */

import { api } from './api';
import type {
  CreateInvoiceRequest,
  Invoice,
  InvoiceDetail,
  InvoiceListItem,
  Paginated,
  Payment,
  QueryInvoiceParams,
  QueryPaymentParams,
  RecordPaymentRequest,
} from './types';

export const invoicesApi = {
  list: (params: QueryInvoiceParams = {}) =>
    api.get<Paginated<InvoiceListItem>>('/v1/invoices', {
      query: {
        page: params.page,
        limit: params.limit,
        status: params.status,
        member_id: params.member_id,
        membership_id: params.membership_id,
        branch_id: params.branch_id,
        from: params.from,
        to: params.to,
        outstanding_only: params.outstanding_only,
      },
    }),

  get: (id: string) => api.get<InvoiceDetail>(`/v1/invoices/${id}`),

  create: (payload: CreateInvoiceRequest) => api.post<InvoiceDetail>('/v1/invoices', payload),

  void: (id: string) => api.post<Invoice>(`/v1/invoices/${id}/void`),
};

export const paymentsApi = {
  list: (params: QueryPaymentParams = {}) =>
    api.get<Paginated<Payment>>('/v1/payments', {
      query: {
        page: params.page,
        limit: params.limit,
        invoice_id: params.invoice_id,
        member_id: params.member_id,
        branch_id: params.branch_id,
        status: params.status,
      },
    }),

  get: (id: string) => api.get<Payment>(`/v1/payments/${id}`),

  /** Record a payment against an invoice (manual front-desk recording). */
  record: (invoiceId: string, payload: RecordPaymentRequest) =>
    api.post<Payment>(`/v1/invoices/${invoiceId}/payments`, payload),
};
