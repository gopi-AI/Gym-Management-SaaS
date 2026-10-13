import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { PtTabController } from './pt-tab.controller';

describe('PtTabController', () => {
  const memberId = '11111111-1111-4111-8111-111111111111';

  it('composes enrollments, sessions and per-assignment workout progress, all scoped by memberId', async () => {
    const enrollments = [{ id: 'enrollment-1', member_id: memberId }];
    const sessions = [{ id: 'session-1', member_id: memberId }];
    const assignments = [
      { id: 'assignment-1' },
      { id: 'assignment-2' },
    ];
    const progressByAssignment: Record<string, { completed: number; prescribed: number; percentage: number }> = {
      'assignment-1': { completed: 2, prescribed: 4, percentage: 50 },
      'assignment-2': { completed: 0, prescribed: 0, percentage: 0 },
    };

    const findAllEnrollments = jest.fn().mockResolvedValue(enrollments);
    const findAllSessions = jest.fn().mockResolvedValue(sessions);
    const findAllAssignments = jest.fn().mockResolvedValue(assignments);
    const getAssignmentProgress = jest
      .fn()
      .mockImplementation((assignmentId: string) => Promise.resolve(progressByAssignment[assignmentId]));

    const controller = new PtTabController(
      { findAll: findAllEnrollments } as never,
      { findAll: findAllSessions } as never,
      { findAllAssignments, getAssignmentProgress } as never,
    );

    const result = await controller.getPt(memberId);

    expect(findAllEnrollments).toHaveBeenCalledWith({ member_id: memberId });
    expect(findAllSessions).toHaveBeenCalledWith({ member_id: memberId });
    expect(findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(getAssignmentProgress).toHaveBeenCalledWith('assignment-1');
    expect(getAssignmentProgress).toHaveBeenCalledWith('assignment-2');

    expect(result).toEqual({
      enrollments,
      sessions,
      workoutProgress: [
        { assignment: assignments[0], progress: progressByAssignment['assignment-1'] },
        { assignment: assignments[1], progress: progressByAssignment['assignment-2'] },
      ],
    });
  });

  it('requires pt:read and workout:assignment-read', () => {
    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, PtTabController.prototype.getPt);
    expect(metadata).toEqual([
      { resource: 'pt', action: 'read' },
      { resource: 'workout', action: 'assignment-read' },
    ]);
  });

  it('returns an empty workoutProgress array when the member has no assignments', async () => {
    const findAllEnrollments = jest.fn().mockResolvedValue([]);
    const findAllSessions = jest.fn().mockResolvedValue([]);
    const findAllAssignments = jest.fn().mockResolvedValue([]);
    const getAssignmentProgress = jest.fn();

    const controller = new PtTabController(
      { findAll: findAllEnrollments } as never,
      { findAll: findAllSessions } as never,
      { findAllAssignments, getAssignmentProgress } as never,
    );

    const result = await controller.getPt(memberId);

    expect(getAssignmentProgress).not.toHaveBeenCalled();
    expect(result.workoutProgress).toEqual([]);
  });
});
