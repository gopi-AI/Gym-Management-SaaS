import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { DietTabController } from './diet-tab.controller';

/**
 * Controller-level spec for the diet tab route (P2-06).
 *
 * The route layer is responsible for exactly three things, and this spec covers
 * each of them:
 *   1. the `diet:plan-read` permission gate,
 *   2. delegating the member's data to `DietService`, keyed on the route's
 *      `memberId` (never a client-supplied id),
 *   3. the `dailyTotals` date window — a trailing 30 days by default, plus the
 *      optional `startDate` / `endDate` query params.
 *
 * The aggregation maths itself (null-macro exclusion, adherence) is covered by
 * `diet.service.spec.ts` and is not duplicated here.
 */
describe('DietTabController', () => {
  const memberId = '11111111-1111-4111-8111-111111111111';

  // A fixed "today" so the default window is deterministic. Noon UTC, matching
  // the convention already used in attendance.service.spec.ts.
  const TODAY = '2026-10-16';
  const THIRTY_DAYS_BEFORE_TODAY = '2026-09-16';

  const dietPlans = [{ id: 'assignment-1', member_id: memberId }];
  const nutritionLogs = [{ id: 'log-1', member_id: memberId }];
  const dailyTotals = [
    {
      log_date: '2026-10-15',
      totalCalories: 1800,
      totalProteinG: 150,
      totalCarbsG: 120,
      totalFatG: 60,
      mealsMissingMacros: 0,
      totalMeals: 3,
      adherencePct: 100,
    },
  ];

  function buildController() {
    const service = {
      findAllAssignments: jest.fn().mockResolvedValue(dietPlans),
      findAllLogs: jest.fn().mockResolvedValue(nutritionLogs),
      getDailyTotals: jest.fn().mockResolvedValue(dailyTotals),
    };
    return { service, controller: new DietTabController(service as never) };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires diet:plan-read', () => {
    const metadata = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DietTabController.prototype.getDiet,
    );
    expect(metadata).toEqual([{ resource: 'diet', action: 'plan-read' }]);
  });

  it('delegates plans, logs and daily totals to DietService, bound to the route memberId', async () => {
    const { service, controller } = buildController();

    const result = await controller.getDiet(memberId, {});

    expect(service.findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(service.findAllLogs).toHaveBeenCalledWith(memberId);
    expect(service.getDailyTotals).toHaveBeenCalledWith(
      memberId,
      THIRTY_DAYS_BEFORE_TODAY,
      TODAY,
    );

    expect(result).toEqual({ dietPlans, nutritionLogs, dailyTotals });
  });

  it('defaults the dailyTotals window to the trailing 30 days when no date range is supplied', async () => {
    const { service, controller } = buildController();

    await controller.getDiet(memberId, {});

    expect(service.getDailyTotals).toHaveBeenCalledTimes(1);
    expect(service.getDailyTotals).toHaveBeenCalledWith(
      memberId,
      THIRTY_DAYS_BEFORE_TODAY,
      TODAY,
    );
  });

  it('uses an explicit endDate as the window end while startDate still defaults to 30 days back', async () => {
    const { service, controller } = buildController();

    await controller.getDiet(memberId, { endDate: '2026-10-10' });

    expect(service.getDailyTotals).toHaveBeenCalledWith(
      memberId,
      THIRTY_DAYS_BEFORE_TODAY,
      '2026-10-10',
    );
  });

  it('uses an explicit startDate verbatim (no 30-day shift) with default endDate', async () => {
    const { service, controller } = buildController();

    await controller.getDiet(memberId, { startDate: '2026-09-06' });

    expect(service.getDailyTotals).toHaveBeenCalledWith(
      memberId,
      '2026-09-06',
      TODAY,
    );
  });

  it('uses explicit startDate and endDate verbatim (no 30-day shift)', async () => {
    const { service, controller } = buildController();

    await controller.getDiet(memberId, {
      startDate: '2026-09-06',
      endDate: '2026-10-10',
    });

    expect(service.getDailyTotals).toHaveBeenCalledWith(
      memberId,
      '2026-09-06',
      '2026-10-10',
    );
  });

  it('returns empty collections when the member has no diet data', async () => {
    const service = {
      findAllAssignments: jest.fn().mockResolvedValue([]),
      findAllLogs: jest.fn().mockResolvedValue([]),
      getDailyTotals: jest.fn().mockResolvedValue([]),
    };
    const controller = new DietTabController(service as never);

    const result = await controller.getDiet(memberId, {});

    expect(result).toEqual({ dietPlans: [], nutritionLogs: [], dailyTotals: [] });
  });
});
