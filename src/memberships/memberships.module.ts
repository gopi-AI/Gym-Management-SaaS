import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembershipPlan } from './entities/membership-plan.entity';
import { Membership } from './entities/membership.entity';
import { MembershipHistory } from './entities/membership-history.entity';
import { MembershipPlansService } from './services/membership-plans.service';
import { MembershipsService } from './services/memberships.service';
import { MembershipPlansController } from './controllers/membership-plans.controller';
import { MembershipsController } from './controllers/memberships.controller';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MembershipPlan, Membership, MembershipHistory]),
    OutboxModule,
    TenancyModule,
    // A membership sale generates its invoice inside the same transaction as
    // the membership write (no duplicated purchase flow).
    FinanceModule,
  ],
  controllers: [MembershipPlansController, MembershipsController],
  providers: [MembershipPlansService, MembershipsService],
  exports: [MembershipPlansService, MembershipsService],
})
export class MembershipsModule {}
