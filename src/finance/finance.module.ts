import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { MembersModule } from '../members/members.module';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { TaxRate } from './entities/tax-rate.entity';
import { TaxLine } from './entities/tax-line.entity';
import { InvoiceDiscount } from './entities/invoice-discount.entity';
import { Payment } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { CreditNote } from './entities/credit-note.entity';
import { InvoiceNumberCounter } from './entities/invoice-number-counter.entity';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicesService } from './services/invoices.service';
import { TaxRatesService } from './services/tax-rates.service';
import { PaymentsService } from './services/payments.service';
import { RefundsService } from './services/refunds.service';
import { CreditNotesService } from './services/credit-notes.service';
import { PaymentRetryService } from './services/payment-retry.service';
import { LedgerService } from './services/ledger.service';
import { PAYMENT_GATEWAY, UnavailablePaymentGateway } from './services/payment-gateway.port';
import { StripePaymentGatewayAdapter } from './services/stripe-payment-gateway.adapter';
import { GatewayWebhookService } from './services/gateway-webhook.service';
import { WebhookEventProcessor } from './services/webhook-event.processor';
import { PaymentMethodsService } from './services/payment-methods.service';
import { DunningAttempt } from './entities/dunning-attempt.entity';
import { DunningService } from './services/dunning.service';
import { InvoicesController } from './controllers/invoices.controller';
import { TaxRatesController } from './controllers/tax-rates.controller';
import { PaymentsController } from './controllers/payments.controller';
import { RefundsController } from './controllers/refunds.controller';
import { CreditNotesController } from './controllers/credit-notes.controller';
import { MemberOutstandingBalanceController } from './controllers/member-outstanding-balance.controller';
import { FinancialReportsController } from './controllers/financial-reports.controller';
import { GatewayWebhookController } from './controllers/gateway-webhook.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';

/**
 * Finance (Phase 1): invoices, payments and the payment-retry use case.
 * (Phase 3 / P3-01): the financial ledger read model — see `LedgerService`.
 * (Phase 3 / P3-04): tax handling — `TaxRatesService` + `TaxRatesController`, and
 * tax resolution inside `InvoicesService.persistInvoice`. Discounts are NOT here:
 * they were split out of P3-04 into P3-04b.
 * (Phase 3 / P3-02): refunds and credit notes — `RefundsService` +
 * `CreditNotesService`. Both are intra-module: §13 requires no new import for
 * them, and `PAYMENT_GATEWAY` is deliberately NOT used by refunds in P3-02.
 *
 * `PAYMENT_GATEWAY` is bound to `UnavailablePaymentGateway` because Phase 1 has
 * no payment provider — money is taken at the desk and recorded directly as a
 * succeeded payment. Phase 3 swaps this single binding for a real provider; no
 * other change is needed in the retry code path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceItem,
      Payment,
      InvoiceNumberCounter,
      TaxRate,
      TaxLine,
      InvoiceDiscount,
      Refund,
      CreditNote,
      WebhookEvent,
      PaymentMethod,
      DunningAttempt,
    ]),
    OutboxModule,
    TenancyModule,
    // P3-01: `GET /v1/members/{id}/outstanding-balance` must validate the member
    // through MembersService rather than by re-querying MEMBERS_MEMBERS, so the
    // endpoint lives in finance but the member rule stays owned by members.
    //
    // forwardRef is REQUIRED, not defensive: MembersModule imports
    // MembershipsModule, which imports this module, so a plain import would
    // close the cycle Finance -> Members -> Memberships -> Finance and the
    // module scanner would refuse it. (`docs/phase3-scoping-plan.md` §13 lists
    // this edge without the forwardRef; that is corrected in the docs, not
    // papered over here.)
    forwardRef(() => MembersModule),
  ],
  controllers: [
    InvoicesController,
    TaxRatesController,
    PaymentsController,
    RefundsController,
    CreditNotesController,
    MemberOutstandingBalanceController,
    FinancialReportsController,
    GatewayWebhookController,
    PaymentMethodsController,
  ],
  providers: [
    InvoiceNumberService,
    InvoicesService,
    TaxRatesService,
    PaymentsService,
    RefundsService,
    CreditNotesService,
    PaymentRetryService,
    LedgerService,
    UnavailablePaymentGateway,
    StripePaymentGatewayAdapter,
    GatewayWebhookService,
    WebhookEventProcessor,
    PaymentMethodsService,
    DunningService,
    { provide: PAYMENT_GATEWAY, useFactory: (stripe: StripePaymentGatewayAdapter) => stripe.isConfigured ? stripe : new UnavailablePaymentGateway(), inject: [StripePaymentGatewayAdapter] },
  ],
  // InvoicesService/PaymentsService are exported because a membership sale
  // generates its invoice inside the membership transaction (MembershipsModule).
  // TaxRatesService is exported so a later task (P3-04b discounts, §5 recurring
  // billing) can resolve rates without re-implementing the in-force rule.
  // RefundsService/CreditNotesService are exported so P3-03 (gateway-initiated
  // refunds) and P3-06 (commission clawback) can build on them rather than
  // re-implementing the balance invariants.
  exports: [
    InvoiceNumberService,
    InvoicesService,
    TaxRatesService,
    PaymentsService,
    RefundsService,
    CreditNotesService,
    PaymentRetryService,
    LedgerService,
    PaymentMethodsService,
    DunningService,
    WebhookEventProcessor,
    TypeOrmModule,
  ],
})
export class FinanceModule {}
