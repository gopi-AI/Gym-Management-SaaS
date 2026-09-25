import { Test, TestingModule } from '@nestjs/testing';
import { PaymentRetryService } from './payment-retry.service';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from './payment-gateway.port';
import { PAYMENT_RETRY_DEFAULTS } from '../finance.constants';

/**
 * Behavioral verification of the payment retry use case.
 *
 * The property that matters most: with NO provider configured (the Phase 1
 * reality) the worker must not touch a single pending payment — a run reports
 * `gateway_not_configured` and leaves the retry schedule intact for the day a
 * provider is bound to `PAYMENT_GATEWAY`. Once a provider exists, one failing
 * attempt must not abort the rest of the batch.
 */
describe('PaymentRetryService', () => {
  let service: PaymentRetryService;
  let mockPaymentsService: Record<string, jest.Mock>;

  const duePayment = { id: 'payment-1', status: 'pending' } as never;

  const buildGateway = (overrides: Partial<PaymentGatewayPort> = {}): PaymentGatewayPort => ({
    isConfigured: true,
    attempt: jest.fn().mockResolvedValue({ succeeded: true, transactionId: 'txn-1' }),
    charge: jest.fn().mockResolvedValue({ succeeded: true, transactionId: 'txn-1' }),
    refund: jest.fn().mockResolvedValue({ succeeded: true, transactionId: 'refund-1' }),
    ...overrides,
  });

  const buildService = async (gateway: PaymentGatewayPort): Promise<void> => {
    mockPaymentsService = {
      findDueRetries: jest.fn().mockResolvedValue([duePayment]),
      attemptWithSavedMethod: jest.fn().mockResolvedValue({
        status: 'succeeded',
        retryCount: 1,
        exhausted: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentRetryService,
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
      ],
    }).compile();

    service = module.get<PaymentRetryService>(PaymentRetryService);
  };

  it('does nothing at all while no payment gateway is configured', async () => {
    await buildService(buildGateway({ isConfigured: false }));

    const result = await service.retryDuePayments();

    expect(result).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      rescheduled: 0,
      skippedReason: 'gateway_not_configured',
    });
    expect(mockPaymentsService.findDueRetries).not.toHaveBeenCalled();
    expect(mockPaymentsService.attemptWithSavedMethod).not.toHaveBeenCalled();
  });

  it('charges every due payment and counts settled attempts', async () => {
    await buildService(buildGateway());
    mockPaymentsService.attemptWithSavedMethod.mockResolvedValue({
      status: 'succeeded',
      retryCount: 1,
      exhausted: false,
    });

    const result = await service.retryDuePayments();

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, rescheduled: 0 });
    expect(mockPaymentsService.findDueRetries).toHaveBeenCalledWith(
      expect.any(Date),
      PAYMENT_RETRY_DEFAULTS.BATCH_SIZE,
    );
    expect(mockPaymentsService.attemptWithSavedMethod).toHaveBeenCalledWith(
      duePayment,
      expect.any(Date),
      PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS,
    );
  });

  it('reports a rescheduled attempt as rescheduled, not as a failure', async () => {
    await buildService(buildGateway());
    mockPaymentsService.attemptWithSavedMethod.mockResolvedValue({
      status: 'pending',
      retryCount: 1,
      exhausted: false,
    });

    const result = await service.retryDuePayments();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 0, rescheduled: 1 });
  });

  it('counts an exhausted payment as failed', async () => {
    await buildService(buildGateway());
    mockPaymentsService.attemptWithSavedMethod.mockResolvedValue({
      status: 'failed',
      retryCount: PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS,
      exhausted: true,
    });

    const result = await service.retryDuePayments();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, rescheduled: 0 });
  });

  it('keeps processing the batch when one payment throws', async () => {
    const second = { id: 'payment-2', status: 'pending' } as never;
    const gateway = buildGateway();
    await buildService(gateway);
    mockPaymentsService.findDueRetries.mockResolvedValue([duePayment, second]);
    mockPaymentsService.attemptWithSavedMethod
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'succeeded', retryCount: 1, exhausted: false });

    const result = await service.retryDuePayments();

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(mockPaymentsService.attemptWithSavedMethod).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit limit and maxAttempts', async () => {
    await buildService(buildGateway());

    await service.retryDuePayments({ limit: 5, maxAttempts: 1 });

    expect(mockPaymentsService.findDueRetries).toHaveBeenCalledWith(expect.any(Date), 5);
    expect(mockPaymentsService.attemptWithSavedMethod).toHaveBeenCalledWith(
      duePayment,
      expect.any(Date),
      1,
    );
  });
});
