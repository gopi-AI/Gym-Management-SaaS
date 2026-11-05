'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import {
  ApiError,
  useCopyDayTemplate,
  useCreateDayTemplate,
  useCreateExercise,
  useCreatePlanTemplate,
  useCreateWorkoutAssignment,
  useDayTemplate,
  useDayTemplates,
  useExercises,
  usePlanTemplate,
  usePlanTemplates,
  useSetDayTemplateExercises,
  useSetPlanTemplateDays,
  useUpdateExercise,
  useUploadExerciseMedia,
  type DayTemplateExerciseInput,
  type ExerciseSection,
  type PlanTemplateDayInput,
} from '@/lib';

const SECTIONS: ExerciseSection[] = [
  'warmup',
  'strength',
  'cardio',
  'stretch',
  'recovery',
];

interface EditorRow {
  exercise_id: string;
  section: ExerciseSection;
  sets: string;
  reps: string;
}

interface PlanSlot {
  day_template_id: string; // '' or 'rest' or a day-template id
  day_label: string;
  is_optional: boolean;
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Trainer workout-composition page (P2-05).
 *
 * Exercise library, reusable day templates, reusable weekly plan templates and
 * member assignment. Templates are snapshotted on assignment, so editing them
 * here changes FUTURE assignments only.
 */
function WorkoutsContent() {
  const [exerciseSearch, setExerciseSearch] = React.useState('');
  const [exerciseName, setExerciseName] = React.useState('');
  const [exerciseCategory, setExerciseCategory] = React.useState('');
  const [exerciseMuscle, setExerciseMuscle] = React.useState('');
  const [exerciseEquipment, setExerciseEquipment] = React.useState('');

  const exercisesQuery = useExercises({
    search: exerciseSearch || undefined,
  });
  const createExercise = useCreateExercise();
  const updateExercise = useUpdateExercise();
  const uploadMedia = useUploadExerciseMedia();

  const dayTemplatesQuery = useDayTemplates();
  const createDayTemplate = useCreateDayTemplate();
  const [dayTemplateName, setDayTemplateName] = React.useState('');
  const [dayTemplateDuration, setDayTemplateDuration] = React.useState('');
  const [selectedDayTemplateId, setSelectedDayTemplateId] = React.useState('');
  const dayTemplateQuery = useDayTemplate(selectedDayTemplateId, {
    enabled: Boolean(selectedDayTemplateId),
  });
  const setDayTemplateExercises = useSetDayTemplateExercises();
  const copyDayTemplate = useCopyDayTemplate();
  const [editorRows, setEditorRows] = React.useState<EditorRow[]>([]);
  const loadedTemplateId = React.useRef('');

  const planTemplatesQuery = usePlanTemplates();
  const createPlanTemplate = useCreatePlanTemplate();
  const [planTemplateName, setPlanTemplateName] = React.useState('');
  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = React.useState('');
  const planTemplateQuery = usePlanTemplate(selectedPlanTemplateId, {
    enabled: Boolean(selectedPlanTemplateId),
  });
  const setPlanTemplateDays = useSetPlanTemplateDays();
  const [planSlots, setPlanSlots] = React.useState<PlanSlot[]>([
    { day_template_id: '', day_label: '', is_optional: false },
  ]);
  const loadedPlanTemplateId = React.useRef('');

  const createAssignment = useCreateWorkoutAssignment();
  const [assignmentMemberId, setAssignmentMemberId] = React.useState('');
  const [assignmentPlanId, setAssignmentPlanId] = React.useState('');
  const [assignmentStart, setAssignmentStart] = React.useState('');
  const [assignmentLogging, setAssignmentLogging] = React.useState<
    'simple' | 'detailed'
  >('simple');
  const [assignmentNotes, setAssignmentNotes] = React.useState('');

  React.useEffect(() => {
    const template = dayTemplateQuery.data;
    if (!template || loadedTemplateId.current === template.id) return;
    loadedTemplateId.current = template.id;
    setEditorRows(
      (template.exercises ?? []).map((row) => ({
        exercise_id: row.exercise_id,
        section: row.section,
        sets: row.sets != null ? String(row.sets) : '',
        reps: row.reps != null ? String(row.reps) : '',
      })),
    );
  }, [dayTemplateQuery.data]);

  React.useEffect(() => {
    const template = planTemplateQuery.data;
    if (!template || loadedPlanTemplateId.current === template.id) return;
    loadedPlanTemplateId.current = template.id;
    const days = (template.days ?? []).slice().sort((a, b) => a.day_order - b.day_order);
    setPlanSlots(
      days.length === 0
        ? [{ day_template_id: '', day_label: '', is_optional: false }]
        : days.map((day) => ({
            day_template_id: day.is_rest_day
              ? 'rest'
              : (day.day_template_id ?? ''),
            day_label: day.day_label ?? '',
            is_optional: day.is_optional,
          })),
    );
  }, [planTemplateQuery.data]);

  const exercises = exercisesQuery.data ?? [];
  const dayTemplates = dayTemplatesQuery.data ?? [];
  const planTemplates = planTemplatesQuery.data ?? [];

  const handleCreateExercise = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!exerciseName.trim()) return;
    createExercise.mutate(
      {
        name: exerciseName.trim(),
        category: exerciseCategory || undefined,
        muscle_group: exerciseMuscle || undefined,
        equipment_needed: exerciseEquipment || undefined,
      },
      {
        onSuccess: () => {
          setExerciseName('');
          setExerciseCategory('');
          setExerciseMuscle('');
          setExerciseEquipment('');
        },
      },
    );
  };

  const handleCreateDayTemplate = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (!dayTemplateName.trim()) return;
    createDayTemplate.mutate(
      {
        name: dayTemplateName.trim(),
        estimated_duration_minutes: numberOrUndefined(dayTemplateDuration),
      },
      {
        onSuccess: (template) => {
          setDayTemplateName('');
          setDayTemplateDuration('');
          setSelectedDayTemplateId(template.id);
        },
      },
    );
  };

  const handleSaveDayTemplate = (): void => {
    if (!selectedDayTemplateId) return;
    const payload: DayTemplateExerciseInput[] = editorRows
      .filter((row) => row.exercise_id)
      .map((row, index) => ({
        exercise_id: row.exercise_id,
        section: row.section,
        sets: numberOrUndefined(row.sets),
        reps: numberOrUndefined(row.reps),
        sort_order: index + 1,
      }));
    setDayTemplateExercises.mutate({
      id: selectedDayTemplateId,
      exercises: payload,
    });
  };

  const handleCreatePlanTemplate = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (!planTemplateName.trim()) return;
    createPlanTemplate.mutate(
      { name: planTemplateName.trim() },
      {
        onSuccess: (template) => {
          setPlanTemplateName('');
          setSelectedPlanTemplateId(template.id);
        },
      },
    );
  };

  const handleSavePlanTemplate = (): void => {
    if (!selectedPlanTemplateId) return;
    const days: PlanTemplateDayInput[] = [];
    planSlots.forEach((slot, index) => {
      const isRest = slot.day_template_id === 'rest';
      if (!isRest && !slot.day_template_id) return;
      days.push({
        day_order: index + 1,
        day_template_id: isRest ? undefined : slot.day_template_id,
        day_label: slot.day_label || undefined,
        is_rest_day: isRest,
        is_optional: isRest ? false : slot.is_optional,
      });
    });
    setPlanTemplateDays.mutate({ id: selectedPlanTemplateId, days });
  };

  const handleCreateAssignment = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (!assignmentMemberId.trim() || !assignmentPlanId || !assignmentStart) {
      return;
    }
    createAssignment.mutate(
      {
        memberId: assignmentMemberId.trim(),
        payload: {
          plan_template_id: assignmentPlanId,
          start_date: assignmentStart,
          logging_mode: assignmentLogging,
          notes: assignmentNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setAssignmentNotes('');
        },
      },
    );
  };

  const actionError = (error: unknown): string =>
    error instanceof ApiError ? error.message : 'The request failed.';

  return (
    <AppLayout title="Workouts" pretitle="Management" pageMenu="workouts">
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Exercise library</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="row g-2 align-items-end mb-3" onSubmit={handleCreateExercise}>
            <div className="col-md-4">
              <label className="form-label" htmlFor="exercise-name">
                Name
              </label>
              <input
                id="exercise-name"
                className="form-control"
                value={exerciseName}
                onChange={(event) => setExerciseName(event.target.value)}
                required
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="exercise-category">
                Category
              </label>
              <input
                id="exercise-category"
                className="form-control"
                value={exerciseCategory}
                onChange={(event) => setExerciseCategory(event.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="exercise-muscle">
                Muscle group
              </label>
              <input
                id="exercise-muscle"
                className="form-control"
                value={exerciseMuscle}
                onChange={(event) => setExerciseMuscle(event.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="exercise-equipment">
                Equipment
              </label>
              <input
                id="exercise-equipment"
                className="form-control"
                value={exerciseEquipment}
                onChange={(event) => setExerciseEquipment(event.target.value)}
              />
            </div>
            <div className="col-auto">
              <Button type="submit" variant="primary" disabled={createExercise.isPending}>
                Add exercise
              </Button>
            </div>
          </form>
          {createExercise.isError && (
            <Alert type="danger">{actionError(createExercise.error)}</Alert>
          )}
          {uploadMedia.isError && (
            <Alert type="danger">{actionError(uploadMedia.error)}</Alert>
          )}

          <input
            className="form-control mb-2"
            placeholder="Search exercises…"
            value={exerciseSearch}
            onChange={(event) => setExerciseSearch(event.target.value)}
          />

          {exercises.length === 0 ? (
            <Empty title="No exercises" description="Add the first exercise to the library." />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Category</Th>
                  <Th>Muscle group</Th>
                  <Th>Equipment</Th>
                  <Th>Media</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </THeadRow>
              </THead>
              <TBody>
                {exercises.map((exercise) => (
                  <TBodyRow key={exercise.id}>
                    <Td>{exercise.name}</Td>
                    <Td>{exercise.category ?? '—'}</Td>
                    <Td>{exercise.muscle_group ?? '—'}</Td>
                    <Td>{exercise.equipment_needed ?? '—'}</Td>
                    <Td>
                      {exercise.image_key ? 'Image ' : ''}
                      {exercise.gif_key ? 'GIF ' : ''}
                      {exercise.video_url ? 'Video' : ''}
                      {!exercise.image_key && !exercise.gif_key && !exercise.video_url
                        ? '—'
                        : ''}
                    </Td>
                    <Td>
                      <Badge color={exercise.is_active ? 'green' : 'secondary'}>
                        {exercise.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td>
                      <input
                        type="file"
                        accept="image/*"
                        aria-label={`Upload image for ${exercise.name}`}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            uploadMedia.mutate({
                              id: exercise.id,
                              mediaType: 'image',
                              file,
                            });
                          }
                          event.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="ms-2"
                        onClick={() =>
                          updateExercise.mutate({
                            id: exercise.id,
                            payload: { is_active: !exercise.is_active },
                          })
                        }
                      >
                        {exercise.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Workout-day templates</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="row g-2 align-items-end mb-3" onSubmit={handleCreateDayTemplate}>
            <div className="col-md-5">
              <label className="form-label" htmlFor="day-template-name">
                Name
              </label>
              <input
                id="day-template-name"
                className="form-control"
                value={dayTemplateName}
                onChange={(event) => setDayTemplateName(event.target.value)}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="day-template-duration">
                Estimated minutes
              </label>
              <input
                id="day-template-duration"
                type="number"
                min={1}
                className="form-control"
                value={dayTemplateDuration}
                onChange={(event) => setDayTemplateDuration(event.target.value)}
              />
            </div>
            <div className="col-auto">
              <Button type="submit" variant="primary" disabled={createDayTemplate.isPending}>
                Create day template
              </Button>
            </div>
          </form>

          {dayTemplates.length === 0 ? (
            <Empty
              title="No day templates"
              description="Create a reusable workout day first."
            />
          ) : (
            <Table responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Duration</Th>
                  <Th>Actions</Th>
                </THeadRow>
              </THead>
              <TBody>
                {dayTemplates.map((template) => (
                  <TBodyRow key={template.id}>
                    <Td>{template.name}</Td>
                    <Td>
                      {template.estimated_duration_minutes != null
                        ? `${template.estimated_duration_minutes} min`
                        : '—'}
                    </Td>
                    <Td>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelectedDayTemplateId(template.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="ms-2"
                        onClick={() =>
                          copyDayTemplate.mutate({
                            id: template.id,
                            name: `${template.name} (copy)`,
                          })
                        }
                      >
                        Copy
                      </Button>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {selectedDayTemplateId && dayTemplateQuery.data && (
            <div className="mt-3" data-testid="day-template-editor">
              <h4 className="card-title">
                Composing: {dayTemplateQuery.data.name}
              </h4>
              {editorRows.map((row, index) => (
                <div className="row g-2 align-items-end mb-2" key={`${row.exercise_id}-${index}`}>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor={`row-exercise-${index}`}>
                      Exercise
                    </label>
                    <select
                      id={`row-exercise-${index}`}
                      className="form-select"
                      value={row.exercise_id}
                      onChange={(event) =>
                        setEditorRows((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, exercise_id: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Select an exercise</option>
                      {exercises.map((exercise) => (
                        <option key={exercise.id} value={exercise.id}>
                          {exercise.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label" htmlFor={`row-section-${index}`}>
                      Section
                    </label>
                    <select
                      id={`row-section-${index}`}
                      className="form-select"
                      value={row.section}
                      onChange={(event) =>
                        setEditorRows((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  section: event.target.value as ExerciseSection,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      {SECTIONS.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label" htmlFor={`row-sets-${index}`}>
                      Sets
                    </label>
                    <input
                      id={`row-sets-${index}`}
                      type="number"
                      min={0}
                      className="form-control"
                      value={row.sets}
                      onChange={(event) =>
                        setEditorRows((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, sets: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label" htmlFor={`row-reps-${index}`}>
                      Reps
                    </label>
                    <input
                      id={`row-reps-${index}`}
                      type="number"
                      min={0}
                      className="form-control"
                      value={row.reps}
                      onChange={(event) =>
                        setEditorRows((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, reps: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="col-auto">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        setEditorRows((rows) => rows.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="me-2"
                onClick={() =>
                  setEditorRows((rows) => [
                    ...rows,
                    {
                      exercise_id: exercises[0]?.id ?? '',
                      section: 'strength',
                      sets: '3',
                      reps: '10',
                    },
                  ])
                }
                disabled={exercises.length === 0}
              >
                Add exercise row
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSaveDayTemplate}
                disabled={setDayTemplateExercises.isPending}
              >
                Save composition
              </Button>
              {setDayTemplateExercises.isError && (
                <Alert type="danger" className="mt-2">
                  {actionError(setDayTemplateExercises.error)}
                </Alert>
              )}
              {setDayTemplateExercises.isSuccess && (
                <Alert type="success" className="mt-2">
                  Day template saved. Existing assignments were not changed.
                </Alert>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Weekly plan templates</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="row g-2 align-items-end mb-3" onSubmit={handleCreatePlanTemplate}>
            <div className="col-md-6">
              <label className="form-label" htmlFor="plan-template-name">
                Name
              </label>
              <input
                id="plan-template-name"
                className="form-control"
                value={planTemplateName}
                onChange={(event) => setPlanTemplateName(event.target.value)}
                required
              />
            </div>
            <div className="col-auto">
              <Button type="submit" variant="primary" disabled={createPlanTemplate.isPending}>
                Create plan template
              </Button>
            </div>
          </form>

          {planTemplates.length === 0 ? (
            <Empty
              title="No plan templates"
              description="Create a weekly plan template after composing day templates."
            />
          ) : (
            <Table responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Description</Th>
                  <Th>Actions</Th>
                </THeadRow>
              </THead>
              <TBody>
                {planTemplates.map((template) => (
                  <TBodyRow key={template.id}>
                    <Td>{template.name}</Td>
                    <Td>{template.description ?? '—'}</Td>
                    <Td>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelectedPlanTemplateId(template.id)}
                      >
                        Edit days
                      </Button>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {selectedPlanTemplateId && planTemplateQuery.data && (
            <div className="mt-3" data-testid="plan-template-editor">
              <h4 className="card-title">
                Sequence: {planTemplateQuery.data.name}
              </h4>
              <p className="text-secondary small">
                The order is a rolling sequence, not a weekday calendar. Rest slots are
                display-only and are excluded from progress.
              </p>
              {planSlots.map((slot, index) => (
                <div className="row g-2 align-items-end mb-2" key={`slot-${index}`}>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor={`slot-${index}`}>
                      Day {index + 1}
                    </label>
                    <select
                      id={`slot-${index}`}
                      className="form-select"
                      value={slot.day_template_id}
                      onChange={(event) =>
                        setPlanSlots((slots) =>
                          slots.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, day_template_id: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">None</option>
                      <option value="rest">Rest</option>
                      {dayTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" htmlFor={`slot-label-${index}`}>
                      Label
                    </label>
                    <input
                      id={`slot-label-${index}`}
                      className="form-control"
                      value={slot.day_label}
                      onChange={(event) =>
                        setPlanSlots((slots) =>
                          slots.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, day_label: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-check mt-4">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={slot.is_optional}
                        disabled={slot.day_template_id === 'rest'}
                        onChange={(event) =>
                          setPlanSlots((slots) =>
                            slots.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, is_optional: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="form-check-label">Optional day</span>
                    </label>
                  </div>
                  <div className="col-auto">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        setPlanSlots((slots) =>
                          slots.length === 1
                            ? slots
                            : slots.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="me-2"
                onClick={() =>
                  setPlanSlots((slots) => [
                    ...slots,
                    { day_template_id: '', day_label: '', is_optional: false },
                  ])
                }
              >
                Add day
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSavePlanTemplate}
                disabled={setPlanTemplateDays.isPending}
              >
                Save sequence
              </Button>
              {setPlanTemplateDays.isError && (
                <Alert type="danger" className="mt-2">
                  {actionError(setPlanTemplateDays.error)}
                </Alert>
              )}
              {setPlanTemplateDays.isSuccess && (
                <Alert type="success" className="mt-2">
                  Plan template saved. Existing assignments were not changed.
                </Alert>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign a plan to a member</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="row g-2 align-items-end" onSubmit={handleCreateAssignment}>
            <div className="col-md-4">
              <label className="form-label" htmlFor="assign-member">
                Member id
              </label>
              <input
                id="assign-member"
                className="form-control"
                value={assignmentMemberId}
                onChange={(event) => setAssignmentMemberId(event.target.value)}
                placeholder="UUID from the member page"
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="assign-plan">
                Plan template
              </label>
              <select
                id="assign-plan"
                className="form-select"
                value={assignmentPlanId}
                onChange={(event) => setAssignmentPlanId(event.target.value)}
                required
              >
                <option value="">Select a plan</option>
                {planTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="assign-start">
                Start date
              </label>
              <input
                id="assign-start"
                type="date"
                className="form-control"
                value={assignmentStart}
                onChange={(event) => setAssignmentStart(event.target.value)}
                required
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="assign-logging">
                Logging
              </label>
              <select
                id="assign-logging"
                className="form-select"
                value={assignmentLogging}
                onChange={(event) =>
                  setAssignmentLogging(event.target.value as 'simple' | 'detailed')
                }
              >
                <option value="simple">Simple (regular member)</option>
                <option value="detailed">Detailed (PT member)</option>
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="assign-notes">
                Notes
              </label>
              <input
                id="assign-notes"
                className="form-control"
                value={assignmentNotes}
                onChange={(event) => setAssignmentNotes(event.target.value)}
              />
            </div>
            <div className="col-auto">
              <Button type="submit" variant="primary" disabled={createAssignment.isPending}>
                Assign plan
              </Button>
            </div>
          </form>
          {createAssignment.isError && (
            <Alert type="danger" className="mt-2">
              {actionError(createAssignment.error)}
            </Alert>
          )}
          {createAssignment.isSuccess && (
            <Alert type="success" className="mt-2">
              Plan assigned. This member&apos;s composition is now snapshotted.
            </Alert>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function WorkoutsPage() {
  return (
    <AuthGuard>
      <WorkoutsContent />
    </AuthGuard>
  );
}
