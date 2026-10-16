import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { WorkoutsTabController } from './workouts-tab.controller';

describe('WorkoutsTabController', () => {
  const memberId = '11111111-1111-4111-8111-111111111111';

  it('delegates to findAllAssignments and findAllExercises, returning { assignments, exercises }', async () => {
    const assignments = [{ id: 'assignment-1' }, { id: 'assignment-2' }];
    const exercises = [{ id: 'exercise-1' }, { id: 'exercise-2' }];

    const findAllAssignments = jest.fn().mockResolvedValue(assignments);
    const findAllExercises = jest.fn().mockResolvedValue(exercises);

    const controller = new WorkoutsTabController({
      findAllAssignments,
      findAllExercises,
    } as never);

    const result = await controller.getWorkouts(memberId);

    expect(findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(findAllExercises).toHaveBeenCalled();

    expect(result).toEqual({
      assignments,
      exercises,
    });
  });

  it('requires workout:assignment-read and workout:exercise-read', () => {
    const metadata = Reflect.getMetadata(
      PERMISSIONS_KEY,
      WorkoutsTabController.prototype.getWorkouts,
    );
    expect(metadata).toEqual([
      { resource: 'workout', action: 'assignment-read' },
      { resource: 'workout', action: 'exercise-read' },
    ]);
  });

  it('returns empty assignments and exercises when the member has none', async () => {
    const findAllAssignments = jest.fn().mockResolvedValue([]);
    const findAllExercises = jest.fn().mockResolvedValue([]);

    const controller = new WorkoutsTabController({
      findAllAssignments,
      findAllExercises,
    } as never);

    const result = await controller.getWorkouts(memberId);

    expect(findAllAssignments).toHaveBeenCalledWith(memberId);
    expect(findAllExercises).toHaveBeenCalled();

    expect(result).toEqual({ assignments: [], exercises: [] });
  });
});