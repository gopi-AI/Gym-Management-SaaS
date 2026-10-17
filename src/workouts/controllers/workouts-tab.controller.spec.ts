import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { WorkoutsTabController } from './workouts-tab.controller';

describe('WorkoutsTabController', () => {
  const memberId = '11111111-1111-4111-8111-111111111111';

  const progress = { completed: 3, prescribed: 4, percentage: 75 };

  it('delegates to findAllAssignments, findAllSessions and findAllExercises, returning progress per assignment', async () => {
    const assignments = [{ id: 'assignment-1' }, { id: 'assignment-2' }];
    const sessions = [{ id: 'session-1' }];
    const exercises = [{ id: 'exercise-1' }, { id: 'exercise-2' }];

    const findAllAssignments = jest.fn().mockResolvedValue(assignments);
    const findAllSessions = jest.fn().mockResolvedValue(sessions);
    const findAllExercises = jest.fn().mockResolvedValue(exercises);
    const getAssignmentProgress = jest.fn().mockResolvedValue(progress);

    const controller = new WorkoutsTabController({
      findAllAssignments,
      findAllSessions,
      findAllExercises,
      getAssignmentProgress,
    } as never);

    const result = await controller.getWorkouts(memberId);

    expect(findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(findAllSessions).toHaveBeenCalledWith(memberId);
    expect(findAllExercises).toHaveBeenCalled();
    expect(getAssignmentProgress).toHaveBeenCalledWith('assignment-1');
    expect(getAssignmentProgress).toHaveBeenCalledWith('assignment-2');

    expect(result).toEqual({
      assignments: [
        { id: 'assignment-1', progress },
        { id: 'assignment-2', progress },
      ],
      sessions,
      exercises,
    });
  });

  it('requires workout:assignment-read, workout:exercise-read and workout:session-read', () => {
    const metadata = Reflect.getMetadata(
      PERMISSIONS_KEY,
      WorkoutsTabController.prototype.getWorkouts,
    );
    expect(metadata).toEqual([
      { resource: 'workout', action: 'assignment-read' },
      { resource: 'workout', action: 'exercise-read' },
      { resource: 'workout', action: 'session-read' },
    ]);
  });

  it('returns empty assignments, sessions and exercises when the member has none', async () => {
    const findAllAssignments = jest.fn().mockResolvedValue([]);
    const findAllSessions = jest.fn().mockResolvedValue([]);
    const findAllExercises = jest.fn().mockResolvedValue([]);
    const getAssignmentProgress = jest.fn();

    const controller = new WorkoutsTabController({
      findAllAssignments,
      findAllSessions,
      findAllExercises,
      getAssignmentProgress,
    } as never);

    const result = await controller.getWorkouts(memberId);

    expect(findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(findAllSessions).toHaveBeenCalledWith(memberId);
    expect(findAllExercises).toHaveBeenCalled();
    // No assignments means no per-assignment progress lookup.
    expect(getAssignmentProgress).not.toHaveBeenCalled();

    expect(result).toEqual({
      assignments: [],
      sessions: [],
      exercises: [],
    });
  });
});
