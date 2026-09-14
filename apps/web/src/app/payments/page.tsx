'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { PageItem, Pagination } from '@/components/ui/Pagination';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import {
  ApiError,
  useInvoices,
  useMembers,
  usePayments,
  useRecordPayment,
  useVoidInvoice,
  type InvoiceListItem,
  type InvoiceStatus,
  type PaymentMethod,
} from '@/lib';

const PAGE_SIZE = 20;

const INVOICE_STATUS_COLOR: Record<string, string> = {
  draft: 'secondary',
  sent: 'blue',
  partially_paid: 'warning',
  paid: 'green',
  void: 'secondary',
};

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'other'];

/** Voidable only while nothing has been collected (the API enforces this too). */
function isVoidable(invoice: InvoiceListItem): boolean {
  return (
    (invoice.status === 'draft' || invoice.status === 'sent') &&
    Number(invoice.amount_paid) === 0
  );
}

function money(value: string | number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/**
 * Invoices + payments (front-desk money).
 *
 * The outstanding balance shown here is the server's (`outstanding_amount`),
 * derived from succeeded payments — the screen never computes a balance of its
 * own, so a stale page can never suggest a wrong amount is still owed.
 */
function PaymentsContent() {
  const [memberId, setMemberId] = React.useState('');
  const [status, setStatus] = React.useState<InvoiceStatus | ''>('');
  const [outstandingOnly, setOutstandingOnly] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<InvoiceListItem | null>(null);

  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [transactionId, setTransactionId] = React.useState('');
  const [notice, setNotice] = React.useState<{
    type: 'success' | 'danger';
    message: string;
  } | null>(null);

  const { data: membersData } = useMembers({ limit: 200 });
  const {
    data: invoicesData,
    isLoading: invoicesLoading,
    isFetching: invoicesFetching,
    error: invoicesError,
  } = useInvoices({
    page,
    limit: PAGE_SIZE,
    member_id: memberId || undefined,
    status: status || undefined,
    // A specific status filter already answers "what is outstanding?".
    outstanding_only: status ? undefined : outstandingOnly,
  });
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({ limit: 10 });

  const members = membersData?.data ?? [];
  const invoices = invoicesData?.data ?? [];
  const total = invoicesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const payments = paymentsData?.data ?? [];

  const memberName = React.useMemo(() => {
    const index = new Map(members.map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
    return (id: string) => index.get(id) ?? id;
  }, [members]);

  const recordPayment = useRecordPayment({
    onSuccess: (payment) => {
      setNotice({
        type: 'success',
        message: `Recorded ${money(payment.amount)} (${payment.payment_method}).`,
      });
      setSelected(null);
      setAmount('');
      setTransactionId('');
    },
    onError: (error) => {
      setNotice({
        type: 'danger',
        message: error instanceof ApiError ? error.message : 'Failed to record the payment.',
      });
    },
  });

  const voidInvoice = useVoidInvoice({
    onSuccess: () => {
      setNotice({ type: 'success', message: 'Invoice voided.' });
      setSelected(null);
    },
    onError: (error) => {
      setNotice({
        type: 'danger',
        message: error instanceof ApiError ? error.message : 'Failed to void the invoice.',
      });
    },
  });

  const openPaymentForm = (invoice: InvoiceListItem) => {
    setNotice(null);
    setSelected(invoice);
    // Prefill with what is actually still owed.
    setAmount(invoice.outstanding_amount);
    setMethod('cash');
    setTransactionId('');
  };

  const handleRecordPayment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setNotice({ type: 'danger', message: 'Enter an amount greater than zero.' });
      return;
    }

    recordPayment.mutate({
      invoiceId: selected.id,
      payload: {
        amount: parsed,
        payment_method: method,
        transaction_id: transactionId || undefined,
        // One key per submission: a double click or a retried request cannot
        // charge the member twice.
        idempotency_key: `desk:${selected.id}:${crypto.randomUUID()}`,
      },
    });
  };

  return (
    <AppLayout
      title="Payments"
      pretitle="Finance"
      pageMenu="payments"
      description="Invoices and the money collected against them. Balances are computed from recorded payments."
    >
      {notice && (
        <Alert type={notice.type} dismissible onClose={() => setNotice(null)} className="mb-3">
          {notice.message}
        </Alert>
      )}

      <div className="row row-cards">
        <div className={selected ? 'col-lg-7' : 'col-12'}>
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="row g-2 align-items-end mb-3">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="filter-member">
                    Member
                  </label>
                  <select
                    id="filter-member"
                    className="form-select"
                    value={memberId}
                    onChange={(e) => {
                      setMemberId(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All members</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.first_name} {m.last_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="filter-status">
                    Status
                  </label>
                  <select
                    id="filter-status"
                    className="form-select"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as InvoiceStatus | '');
                      setPage(1);
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="partially_paid">Partially paid</option>
                    <option value="paid">Paid</option>
                    <option value="void">Void</option>
                  </select>
                </div>
                <div className="col-md-4">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="filter-outstanding"
                      checked={outstandingOnly}
                      disabled={Boolean(status)}
                      onChange={(e) => {
                        setOutstandingOnly(e.target.checked);
                        setPage(1);
                      }}
                    />
                    <label className="form-check-label" htmlFor="filter-outstanding">
                      Outstanding only
                    </label>
                  </div>
                </div>
              </div>

              {invoicesError && (
                <Alert type="danger" className="mb-3">
                  {invoicesError instanceof ApiError
                    ? invoicesError.message
                    : 'Failed to load invoices.'}
                </Alert>
              )}

              {invoicesLoading ? (
                <Empty title="Loading invoices…" description="Fetching the invoice ledger." />
              ) : invoices.length === 0 ? (
                <Empty
                  title="No invoices found"
                  description="A membership sale generates its invoice automatically."
                />
              ) : (
                <Table striped hover responsive cardTable nowrap>
                  <THead>
                    <THeadRow>
                      <Th>Invoice</Th>
                      <Th>Member</Th>
                      <Th>Issued</Th>
                      <Th>Total</Th>
                      <Th>Paid</Th>
                      <Th>Outstanding</Th>
                      <Th>Status</Th>
                      <Th />
                    </THeadRow>
                  </THead>
                  <TBody>
                    {invoices.map((invoice) => (
                      <TBodyRow key={invoice.id}>
                        <Td>{invoice.invoice_number}</Td>
                        <Td>{memberName(invoice.member_id)}</Td>
                        <Td>{formatDate(invoice.invoice_date)}</Td>
                        <Td>{money(invoice.total_amount)}</Td>
                        <Td>{money(invoice.amount_paid)}</Td>
                        <Td>{money(invoice.outstanding_amount)}</Td>
                        <Td>
                          <Badge color={INVOICE_STATUS_COLOR[invoice.status] ?? 'secondary'}>
                            {invoice.status}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="btn-list flex-nowrap">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={Number(invoice.outstanding_amount) <= 0}
                              onClick={() => openPaymentForm(invoice)}
                            >
                              Record payment
                            </Button>
                            {isVoidable(invoice) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={voidInvoice.isPending}
                                onClick={() => {
                                  setNotice(null);
                                  voidInvoice.mutate(invoice.id);
                                }}
                              >
                                Void
                              </Button>
                            )}
                          </div>
                        </Td>
                      </TBodyRow>
                    ))}
                  </TBody>
                </Table>
              )}

              {total > 0 && (
                <div className="d-flex align-items-center mt-3">
                  <div className="text-secondary">
                    {invoicesFetching ? 'Loading…' : `${total} invoice${total === 1 ? '' : 's'}`}
                  </div>
                  <div className="ms-auto">
                    <Pagination>
                      <PageItem
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        ‹
                      </PageItem>
                      <PageItem active>{page}</PageItem>
                      <PageItem disabled>of {totalPages}</PageItem>
                      <PageItem
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-label="Next page"
                      >
                        ›
                      </PageItem>
                    </Pagination>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {selected && (
          <div className="col-lg-5">
            <Card>
              <CardHeader>
                <CardTitle>Record a payment</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="mb-3">
                  <div className="text-secondary">Invoice</div>
                  <div className="fw-bold">{selected.invoice_number}</div>
                  <div className="text-secondary">{memberName(selected.member_id)}</div>
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <div className="text-secondary">Total</div>
                    <div>{money(selected.total_amount)}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-secondary">Outstanding</div>
                    <div className="fw-bold">{money(selected.outstanding_amount)}</div>
                  </div>
                </div>

                <form onSubmit={handleRecordPayment} className="row g-3">
                  <div className="col-12">
                    <label className="form-label" htmlFor="payment-amount">
                      Amount *
                    </label>
                    <input
                      id="payment-amount"
                      className="form-control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label" htmlFor="payment-method">
                      Method *
                    </label>
                    <select
                      id="payment-method"
                      className="form-select"
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    >
                      {PAYMENT_METHODS.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label" htmlFor="payment-transaction">
                      Transaction reference
                    </label>
                    <input
                      id="payment-transaction"
                      className="form-control"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      placeholder="Card terminal / bank reference (optional)"
                    />
                  </div>
                  <div className="col-12">
                    <div className="btn-list">
                      <Button type="submit" variant="primary" disabled={recordPayment.isPending}>
                        {recordPayment.isPending ? 'Recording…' : 'Record payment'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setSelected(null);
                          setAmount('');
                          setTransactionId('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </form>

                <p className="text-secondary mt-3 mb-0">
                  A payment can never exceed the outstanding balance, and the invoice is settled
                  automatically once it is fully paid.
                </p>
              </CardBody>
            </Card>
          </div>
        )}
      </div>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Recent payments</CardTitle>
        </CardHeader>
        <CardBody>
          {paymentsLoading ? (
            <Empty title="Loading payments…" description="Fetching recent payments." />
          ) : payments.length === 0 ? (
            <Empty title="No payments yet" description="Recorded payments appear here." />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Received</Th>
                  <Th>Member</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th>Status</Th>
                </THeadRow>
              </THead>
              <TBody>
                {payments.map((payment) => (
                  <TBodyRow key={payment.id}>
                    <Td>{formatDate(payment.payment_date)}</Td>
                    <Td>{memberName(payment.member_id)}</Td>
                    <Td>{money(payment.amount)}</Td>
                    <Td>{payment.payment_method}</Td>
                    <Td className="text-secondary">{payment.transaction_id ?? '—'}</Td>
                    <Td>
                      <Badge color={payment.status === 'succeeded' ? 'green' : 'secondary'}>
                        {payment.status}
                      </Badge>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function PaymentsPage() {
  return (
    <AuthGuard>
      <PaymentsContent />
    </AuthGuard>
  );
}
