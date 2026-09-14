import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEvent } from './entities/attendance-event.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceAccessDecision } from './entities/attendance-access-decision.entity';
import { AttendanceService } from './services/attendance.service';
import { AttendanceController } from './controllers/attendance.controller';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { OutboxService } from '../shared/outbox/outbox.service';
import { MembershipsService } from '../memberships/services/memberships.service';

/**
 * Wiring verification for the attendance feature module.
 *
 * The providers are assembled exactly as `attendance.module.ts` declares them.
 * The dependency worth pinning down is `MembershipsService`: attendance owns no
 * membership rules, it reads eligibility from the module that owns the state
 * machine, so a missing import would be a runtime DI failure.
 */
describe('AttendanceModule wiring', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forFeature([AttendanceEvent, AttendanceRecord, AttendanceAccessDecision]),
      ],
      controllers: [AttendanceController],
      providers: [
        AttendanceService,
        { provide: TenantContextService, useValue: {} },
        { provide: OutboxService, useValue: {} },
        { provide: MembershipsService, useValue: { getCheckInEligibility: jest.fn() } },
        { provide: getDataSourceToken(), useValue: {} },
      ],
    })
      .overrideProvider(getRepositoryToken(AttendanceEvent))
      .useValue({})
      .overrideProvider(getRepositoryToken(AttendanceRecord))
      .useValue({})
      .overrideProvider(getRepositoryToken(AttendanceAccessDecision))
      .useValue({})
      .compile();
  });

  it('provides the attendance service and controller', () => {
    expect(module.get(AttendanceService)).toBeDefined();
    expect(module.get(AttendanceController)).toBeDefined();
  });
});
