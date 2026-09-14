import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Payment } from './entities/payment.entity';
import { InvoiceNumberCounter } from './entities/invoice-number-counter.entity';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { PaymentRetryService } from './services/payment-retry.service';
import { PAYMENT_GATEWAY, UnavailablePaymentGateway } from './services/payment-gateway.port';
import { InvoicesController } from './controllers/invoices.controller';
import { PaymentsController } from './controllers/payments.controller';

/**
 * Finance (Phase 1): invoices, payments and the payment-retry use case.
 *
 * `PAYMENT_GATEWAY` is bound to `UnavailablePaymentGateway` because Phase 1 has
 * no payment provider — money is taken at the desk and recorded directly as a
 * succeeded payment. Phase 3 swaps this single binding for a real provider; no
 * other change is needed in the retry code path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, Payment, InvoiceNumberCounter]),
    OutboxModule,
    TenancyModule,
  ],
  controllers: [InvoicesController, PaymentsController],
  providers: [
    InvoiceNumberService,
    InvoicesService,
    PaymentsService,
    PaymentRetryService,
    UnavailablePaymentGateway,
    { provide: PAYMENT_GATEWAY, useExisting: UnavailablePaymentGateway },
  ],
  // InvoicesService/PaymentsService are exported because a membership sale
  // generates its invoice inside the membership transaction (MembershipsModule).
  exports: [
    InvoiceNumberService,
    InvoicesService,
    PaymentsService,
    PaymentRetryService,
    TypeOrmModule,
  ],
})
export class FinanceModule {}
