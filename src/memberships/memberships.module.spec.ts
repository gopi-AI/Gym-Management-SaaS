import { ModuleMetadata } from '@nestjs/common/interfaces';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MembershipPlan } from './entities/membership-plan.entity';
import { Membership } from './entities/membership.entity';
import { MembershipHistory } from './entities/membership-history.entity';
import { MembershipPlansService } from './services/membership-plans.service';
import { MembershipPlansController } from './controllers/membership-plans.controller';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { TypeOrmModule } from '@nestjs/typeorm';

describe('MembershipsModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forFeature([MembershipPlan, Membership, MembershipHistory]),
      ],
      controllers: [MembershipPlansController],
      providers: [
        MembershipPlansService,
        { provide: TenantContextService, useValue: {} },
      ],
    })
      .overrideProvider(getRepositoryToken(MembershipPlan))
      .useValue({})
      .overrideProvider(getRepositoryToken(Membership))
      .useValue({})
      .overrideProvider(getRepositoryToken(MembershipHistory))
      .useValue({})
      .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide MembershipPlansService', () => {
    const service = module.get<MembershipPlansService>(MembershipPlansService);
    expect(service).toBeDefined();
  });

  it('should provide MembershipPlansController', () => {
    const controller = module.get<MembershipPlansController>(MembershipPlansController);
    expect(controller).toBeDefined();
  });
});
