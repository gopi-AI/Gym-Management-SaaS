import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Member360Service } from './member-360.service';
import { MembersService } from './members.service';
import { MeasurementLogsService } from './measurement-logs.service';
import { ConsentsService } from './consents.service';
import { DocumentsService } from './documents.service';
import { MembershipsService } from '../../memberships/services/memberships.service';
import { AttendanceService } from '../../attendance/services/attendance.service';
import { PtEnrollmentsService } from '../../pt/services/pt-enrollments.service';
import { WorkoutsService } from '../../workouts/services/workouts.service';
import { DietService } from '../../diet/services/diet.service';
import { PTEnrollmentStatus } from '../../pt/entities/pt-enrollment-status.enum';

// ---------------------------------------------------------------------------
// Provider mocks (pure unit-test stubs — no repository access)
// ---------------------------------------------------------------------------
function mockProvider<T extends Record<string, jest.Mock>>(
  methods: (keyof T)[],
): T {
  const obj = {} as T;
  for (const m of methods) {
    obj[m] = jest.fn() as any;
  }
  return obj;
}

type MockMembersService = Record<'findOne' | 'getProfile', jest.Mock>;
type MockMembershipsService = Record<'findByMember', jest.Mock>;
type MockAttendanceService = Record<
  'getMemberSummaryForHeader' | 'getMemberAttendanceStreak',
  jest.Mock
>;
type MockPtEnrollmentsService = Record<'findAll', jest.Mock>;
type MockWorkoutsService = Record<'findAllAssignments', jest.Mock>;
type MockDietService = Record<'findAllAssignments', jest.Mock>;
type MockMeasurementLogsService = Record<'findAll', jest.Mock>;
type MockConsentsService = Record<'findAll', jest.Mock>;
type MockDocumentsService = Record<'findAll', jest.Mock>;

interface Mocks {
  membersService: MockMembersService;
  membershipsService: MockMembershipsService;
  attendanceService: MockAttendanceService;
  ptEnrollmentsService: MockPtEnrollmentsService;
  workoutsService: MockWorkoutsService;
  dietService: MockDietService;
  measurementLogsService: MockMeasurementLogsService;
  consentsService: MockConsentsService;
  documentsService: MockDocumentsService;
}

function createMocks(): Mocks {
  return {
    membersService: mockProvider<MockMembersService>(['findOne', 'getProfile']),
    membershipsService: mockProvider<MockMembershipsService>(['findByMember']),
    attendanceService: mockProvider<MockAttendanceService>([
      'getMemberSummaryForHeader',
      'getMemberAttendanceStreak',
    ]),
    ptEnrollmentsService: mockProvider<MockPtEnrollmentsService>(['findAll']),
    workoutsService: mockProvider<MockWorkoutsService>(['findAllAssignments']),
    dietService: mockProvider<MockDietService>(['findAllAssignments']),
    measurementLogsService: mockProvider<MockMeasurementLogsService>(['findAll']),
    consentsService: mockProvider<MockConsentsService>(['findAll']),
    documentsService: mockProvider<MockDocumentsService>(['findAll']),
  };
}

async function buildService(mocks: Mocks): Promise<Member360Service> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      Member360Service,
      { provide: MembersService, useValue: mocks.membersService },
      { provide: MeasurementLogsService, useValue: mocks.measurementLogsService },
      { provide: ConsentsService, useValue: mocks.consentsService },
      { provide: DocumentsService, useValue: mocks.documentsService },
      { provide: MembershipsService, useValue: mocks.membershipsService },
      { provide: AttendanceService, useValue: mocks.attendanceService },
      { provide: PtEnrollmentsService, useValue: mocks.ptEnrollmentsService },
      { provide: WorkoutsService, useValue: mocks.workoutsService },
      { provide: DietService, useValue: mocks.dietService },
    ],
  }).compile();

  return module.get(Member360Service);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const memberFixture = {
  id: 'm-1',
  local_id: 42,
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '+1234567890',
  organization_id: 'org-1',
};

const profileFixture = {
  id: 'profile-1',
  member_id: 'm-1',
  weight: '75.5',
  body_fat: '18.0',
  height: '170',
};

const activeMembershipFixture = {
  id: 'mem-1',
  member_id: 'm-1',
  organization_id: 'org-1',
  status: 'active',
  plan_id: 'plan-1',
  start_date: '2025-01-01',
  end_date: '2026-06-01',
  created_at: new Date(),
  updated_at: new Date(),
};
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Member360Service', () => {
  let service: Member360Service;
  let mocks: Mocks;

  beforeEach(async () => {
    mocks = createMocks();
    service = await buildService(mocks);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getHeader (P2-01)', () => {
    it('should return aggregated header with all sections populated', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(profileFixture);
      mocks.membershipsService.findByMember.mockResolvedValue({
        data: [activeMembershipFixture], total: 1, page: 1, limit: 20,
      });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({
        todayCheckedIn: true,
        lastCheckIn: '2026-09-15T08:30:00Z',
      });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);

      const result = await service.getHeader('m-1');

      expect(result.member).toEqual({
        id: 'm-1', localId: 42, firstName: 'Jane', lastName: 'Doe',
        photo: null, email: 'jane@example.com', phone: '+1234567890',
      });
      expect(result.membership).toEqual({
        status: 'active', planId: 'plan-1', endDate: '2026-06-01',
        daysRemaining: expect.any(Number),
      });
      expect(result.accessStatus).toEqual({
        today: 'granted', lastCheckIn: '2026-09-15T08:30:00Z',
      });
      expect(result.currentMeasurements).toEqual({
        weight: '75.5', bodyFat: '18.0', height: '170',
      });
      expect(result.quickActions).not.toContain('check_in');
      expect(result.quickActions).toContain('log_workout');
      expect(result.quickActions).toContain('log_meal');
    });

    it('should return 404 when member does not belong to caller org', async () => {
      mocks.membersService.findOne.mockRejectedValue(
        new NotFoundException('Member not found'),
      );
      await expect(service.getHeader('cross-org-id')).rejects.toThrow(NotFoundException);
    });

    it('should handle null profile (no measurements cached)', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);

      const result = await service.getHeader('m-1');
      expect(result.currentMeasurements).toEqual({ weight: null, bodyFat: null, height: null });
      expect(result.membership).toBeNull();
      expect(result.quickActions).toEqual(expect.arrayContaining(['book_pt', 'log_workout', 'log_meal']));
    });

    it('should handle attendance service failure gracefully', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockRejectedValue(new Error('DB down'));
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);

      const result = await service.getHeader('m-1');
      expect(result.accessStatus).toEqual({ today: 'not_checked_in', lastCheckIn: null });
    });
  });

  describe('quick actions (Q26)', () => {
    it('should show "check_in" when not checked in today and has active membership', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [activeMembershipFixture], total: 1, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: '2026-09-14T08:30:00Z' });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).toContain('check_in');
    });

    it('should NOT show "check_in" when already checked in today', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [activeMembershipFixture], total: 1, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: true, lastCheckIn: '2026-09-16T07:00:00Z' });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).not.toContain('check_in');
    });

    it('should show "renew" when membership expires ≤30 days', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const expiringDate = future.toISOString().split('T')[0];
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [{ ...activeMembershipFixture, end_date: expiringDate }], total: 1, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).toContain('renew');
    });

    it('should NOT show "renew" when membership expires >30 days', async () => {
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 1);
      const futureDate = farFuture.toISOString().split('T')[0];
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [{ ...activeMembershipFixture, end_date: futureDate }], total: 1, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).not.toContain('renew');
    });

    it('should show "book_pt" when no PT enrollment exists', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).toContain('book_pt');
    });

    it('should show "book_pt" when active PT enrollment has remaining sessions', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([{ id: 'pt-enr-1', member_id: 'm-1', status: PTEnrollmentStatus.ACTIVE, sessions_remaining: 5, sessions_used: 5 }]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).toContain('book_pt');
    });
it('should NOT show "book_pt" when active PT enrollment has 0 remaining sessions', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([{ id: 'pt-enr-2', member_id: 'm-1', status: PTEnrollmentStatus.ACTIVE, sessions_remaining: 0, sessions_used: 10 }]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).not.toContain('book_pt');
      expect(result.quickActions).toContain('log_workout');
      expect(result.quickActions).toContain('log_meal');
    });

    it('should always show "log_workout" and "log_meal"', async () => {
      mocks.membersService.findOne.mockResolvedValue(memberFixture);
      mocks.membersService.getProfile.mockResolvedValue(null);
      mocks.membershipsService.findByMember.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      mocks.attendanceService.getMemberSummaryForHeader.mockResolvedValue({ todayCheckedIn: false, lastCheckIn: null });
      mocks.ptEnrollmentsService.findAll.mockResolvedValue([]);
      const result = await service.getHeader('m-1');
      expect(result.quickActions).toContain('log_workout');
      expect(result.quickActions).toContain('log_meal');
    });
  });

  describe('org-scoping', () => {
    it('should propagate NotFoundException from MembersService.findOne for cross-org access', async () => {
      mocks.membersService.findOne.mockRejectedValue(new NotFoundException('Member not found in this organization'));
      await expect(service.getHeader('other-org-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('structural: no direct repository access', () => {
    it('should not have any injectRepository decorators or repository fields', () => {
      const serviceSource = Member360Service.toString();
      expect(serviceSource).not.toContain('InjectRepository');
      expect(serviceSource).not.toContain('Repository<');
    });
  });
});