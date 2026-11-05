import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkoutTemplatesService } from './workout-templates.service';
import { WorkoutDayTemplate } from '../entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from '../entities/workout-day-template-exercise.entity';
import { WorkoutPlanTemplate } from '../entities/workout-plan-template.entity';
import { WorkoutPlanTemplateDay } from '../entities/workout-plan-template-day.entity';
import { Exercise } from '../entities/exercise.entity';

describe('WorkoutTemplatesService', () => {
  const orgId = 'org-1';
  let service: WorkoutTemplatesService;
  let dayTemplateRepo: Record<string, jest.Mock>;
  let dayExerciseRepo: Record<string, jest.Mock>;
  let planTemplateRepo: Record<string, jest.Mock>;
  let planDayRepo: Record<string, jest.Mock>;
  let exerciseRepo: Record<string, jest.Mock>;
  let manager: EntityManager;
  let managerDayTemplateRepo: Record<string, jest.Mock>;
  let managerDayExerciseRepo: Record<string, jest.Mock>;
  let managerPlanDayRepo: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };

  const sourceTemplate = {
    id: 'source-template',
    organization_id: orgId,
    name: 'Push',
    description: 'chest and shoulders',
    estimated_duration_minutes: 60,
    is_active: true,
  } as WorkoutDayTemplate;

  const sourceRows = [
    {
      id: 'row-1',
      day_template_id: 'source-template',
      exercise_id: 'ex-1',
      section: 'warmup',
      sets: 2,
      reps: 15,
      weight_template: null,
      rest_seconds: 30,
      duration_seconds: null,
      distance_meters: null,
      instructions: 'easy',
      sort_order: 1,
    },
    {
      id: 'row-2',
      day_template_id: 'source-template',
      exercise_id: 'ex-2',
      section: 'strength',
      sets: 3,
      reps: 12,
      weight_template: 60,
      rest_seconds: 90,
      duration_seconds: null,
      distance_meters: null,
      instructions: 'controlled',
      sort_order: 2,
    },
  ];

  beforeEach(() => {
    dayTemplateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'new-template', ...input })),
    };
    dayExerciseRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    planTemplateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'plan-1', ...input })),
    };
    planDayRepo = { find: jest.fn().mockResolvedValue([]) };
    exerciseRepo = { find: jest.fn().mockResolvedValue([]) };

    managerDayTemplateRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'copy-template', ...input })),
    };
    managerDayExerciseRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    managerPlanDayRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    manager = {
      getRepository: jest.fn((target: unknown) => {
        if (target === WorkoutDayTemplate) return managerDayTemplateRepo;
        if (target === WorkoutDayTemplateExercise) return managerDayExerciseRepo;
        if (target === WorkoutPlanTemplateDay) return managerPlanDayRepo;
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => cb(manager)),
    };

    service = new WorkoutTemplatesService(
      dayTemplateRepo as never,
      dayExerciseRepo as never,
      planTemplateRepo as never,
      planDayRepo as never,
      exerciseRepo as never,
      dataSource as never,
    );
  });

  describe('copyDayTemplate', () => {
    it('creates an independent copy with new rows and every prescription field', async () => {
      dayTemplateRepo.findOne.mockResolvedValue(sourceTemplate);
      dayExerciseRepo.find.mockResolvedValue(sourceRows);
      dayTemplateRepo.findOne
        .mockResolvedValueOnce(sourceTemplate)
        .mockResolvedValueOnce({ ...sourceTemplate, id: 'copy-template' });
      dayExerciseRepo.find
        .mockResolvedValueOnce(sourceRows)
        .mockResolvedValueOnce(sourceRows.map((row) => ({ ...row, id: 'copy-row' })));

      const copy = await service.copyDayTemplate(
        orgId,
        'source-template',
        { name: 'Push copy' },
      );

      expect(managerDayTemplateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          name: 'Push copy',
          description: 'chest and shoulders',
          estimated_duration_minutes: 60,
        }),
      );
      expect(managerDayExerciseRepo.create).toHaveBeenCalledTimes(2);
      expect(managerDayExerciseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          day_template_id: 'copy-template',
          exercise_id: 'ex-2',
          section: 'strength',
          sets: 3,
          reps: 12,
          weight_template: 60,
          rest_seconds: 90,
          instructions: 'controlled',
          sort_order: 2,
        }),
      );
      expect(copy.id).toBe('copy-template');
      expect(managerDayExerciseRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('setDayTemplateExercises', () => {
    it('validates every exercise belongs to the organization before replacing rows', async () => {
      dayTemplateRepo.findOne.mockResolvedValue(sourceTemplate);
      exerciseRepo.find.mockResolvedValue([{ id: 'ex-1' }]);

      await expect(
        service.setDayTemplateExercises(orgId, 'source-template', {
          exercises: [
            {
              exercise_id: 'ex-1',
              sort_order: 1,
            },
            {
              exercise_id: 'foreign-exercise',
              sort_order: 2,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('replaces the composition transactionally', async () => {
      dayTemplateRepo.findOne.mockResolvedValue(sourceTemplate);
      exerciseRepo.find.mockResolvedValue([{ id: 'ex-1' }]);
      dayExerciseRepo.find.mockResolvedValue([]);

      await service.setDayTemplateExercises(orgId, 'source-template', {
        exercises: [
          {
            exercise_id: 'ex-1',
            section: 'warmup' as never,
            sets: 2,
            reps: 15,
            sort_order: 1,
          },
        ],
      });

      expect(managerDayExerciseRepo.delete).toHaveBeenCalledWith({
        day_template_id: 'source-template',
      });
      expect(managerDayExerciseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          day_template_id: 'source-template',
          exercise_id: 'ex-1',
          section: 'warmup',
          sets: 2,
          reps: 15,
          sort_order: 1,
        }),
      );
    });
  });

  describe('setPlanTemplateDays', () => {
    beforeEach(() => {
      planTemplateRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        organization_id: orgId,
        name: 'Weekly',
      });
    });

    it('rejects duplicate day_order values before touching the database', async () => {
      await expect(
        service.setPlanTemplateDays(orgId, 'plan-1', {
          days: [
            { day_order: 1, day_template_id: 'dt-1' },
            { day_order: 1, day_template_id: 'dt-2' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a rest day that references a day template', async () => {
      await expect(
        service.setPlanTemplateDays(orgId, 'plan-1', {
          days: [
            {
              day_order: 1,
              day_template_id: 'dt-1',
              is_rest_day: true,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a training day without a day template', async () => {
      await expect(
        service.setPlanTemplateDays(orgId, 'plan-1', {
          days: [{ day_order: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a repeated composition, an optional day and a rest marker', async () => {
      dayTemplateRepo.find.mockResolvedValue([
        { id: 'dt-1', organization_id: orgId, is_active: true },
      ]);

      await service.setPlanTemplateDays(orgId, 'plan-1', {
        days: [
          { day_order: 1, day_template_id: 'dt-1', day_label: 'Push' },
          { day_order: 2, day_template_id: 'dt-1', day_label: 'Push variation' },
          {
            day_order: 3,
            day_template_id: 'dt-1',
            day_label: 'Optional legs',
            is_optional: true,
          },
          { day_order: 4, is_rest_day: true, day_label: 'Rest' },
        ],
      });

      expect(managerPlanDayRepo.create).toHaveBeenCalledTimes(4);
      expect(managerPlanDayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_template_id: 'plan-1',
          day_order: 3,
          is_optional: true,
        }),
      );
      expect(managerPlanDayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_template_id: 'plan-1',
          day_order: 4,
          is_rest_day: true,
          day_template_id: null,
        }),
      );
    });

    it('rejects a day template from another organization', async () => {
      dayTemplateRepo.find.mockResolvedValue([]);

      await expect(
        service.setPlanTemplateDays(orgId, 'plan-1', {
          days: [{ day_order: 1, day_template_id: 'foreign-day' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  it('sorts plan-template days by day_order on read', async () => {
    planTemplateRepo.findOne.mockResolvedValue({
      id: 'plan-1',
      organization_id: orgId,
      name: 'Weekly',
      days: [
        { id: 'd3', day_order: 3 },
        { id: 'd1', day_order: 1 },
        { id: 'd2', day_order: 2 },
      ],
    });

    const detail = await service.getPlanTemplate(orgId, 'plan-1');

    expect(detail.days.map((day) => day.id)).toEqual(['d1', 'd2', 'd3']);
  });
});
