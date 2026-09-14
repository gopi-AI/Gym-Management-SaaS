import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Payment } from './entities/payment.entity';
import { InvoiceNumberCounter } from './entities/invoice-number-counter.entity';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { PaymentRetryService } from './services/payment-retry.service';
import { PAYMENT_GATEWAY, PaymentGatewayPort, UnavailablePaymentGateway } from './services/payment-gateway.port';
import { InvoicesController } from './controllers/invoices.controller';
import { PaymentsController } from './controllers/payments.controller';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { OutboxService } from '../shared/outbox/outbox.service';

/**
 * Wiring verification for the finance feature module.
 *
 * The providers are assembled exactly as `finance.module.ts` declares them (the
 * same approach the memberships module spec uses), because the registry's
 * external dependencies (tenant context, outbox, the TypeORM connection) cannot
 * be booted in a unit test. The property worth pinning down is that
 * `PAYMENT_GATEWAY` resolves to the Phase 1 no-provider implementation, since a
 * missing or mis-bound token would break the payment retry worker at runtime
 * rather than at compile time.
 */
describe('FinanceModule wiring', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forFeature([Invoice, InvoiceItem, Payment, InvoiceNumberCounter]),
      ],
      controllers: [InvoicesController, PaymentsController],
      providers: [
        InvoiceNumberService,
        InvoicesService,
        PaymentsService,
        PaymentRetryService,
        UnavailablePaymentGateway,
        { provide: PAYMENT_GATEWAY, useExisting: UnavailablePaymentGateway },
        { provide: TenantContextService, useValue: {} },
        { provide: OutboxService, useValue: {} },
        { provide: getDataSourceToken(), useValue: {} },
      ],
    })
      .overrideProvider(getRepositoryToken(Invoice))
      .useValue({})
      .overrideProvider(getRepositoryToken(InvoiceItem))
      .useValue({})
      .overrideProvider(getRepositoryToken(Payment))
      .useValue({})
      .overrideProvider(getRepositoryToken(InvoiceNumberCounter))
      .useValue({})
      .compile();
  });

  it('provides every finance service', () => {
    expect(module.get(InvoiceNumberService)).toBeDefined();
    expect(module.get(InvoicesService)).toBeDefined();
    expect(module.get(PaymentsService)).toBeDefined();
    expect(module.get(PaymentRetryService)).toBeDefined();
  });

  it('provides both finance controllers', () => {
    expect(module.get(InvoicesController)).toBeDefined();
    expect(module.get(PaymentsController)).toBeDefined();
  });

  it('binds PAYMENT_GATEWAY to the not-configured Phase 1 gateway', () => {
    const gateway = module.get<PaymentGatewayPort>(PAYMENT_GATEWAY);

    expect(gateway).toBeInstanceOf(UnavailablePaymentGateway);
    // The retry worker relies on this flag to avoid failing pending payments
    // against a provider that does not exist yet.
    expect(gateway.isConfigured).toBe(false);
  });
});
