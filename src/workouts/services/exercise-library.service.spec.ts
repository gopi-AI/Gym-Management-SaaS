import { BadRequestException } from '@nestjs/common';
import { ExerciseLibraryService } from './exercise-library.service';
import { S3Service } from '../../shared/storage/s3.service';
import { Exercise } from '../entities/exercise.entity';
import {
  EXERCISE_MEDIA_MAX_BYTES,
  YOUTUBE_URL_PATTERN,
} from '../workouts.constants';

describe('ExerciseLibraryService', () => {
  const orgId = 'org-1';
  let service: ExerciseLibraryService;
  let exerciseRepo: Record<string, jest.Mock>;
  let s3: Record<string, jest.Mock>;

  const exerciseFixture = {
    id: 'exercise-1',
    organization_id: orgId,
    name: 'Bench Press',
    description: null,
    category: null,
    muscle_group: null,
    equipment_needed: null,
    image_key: null,
    gif_key: null,
    is_active: true,
  } as unknown as Exercise;

  beforeEach(() => {
    exerciseRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'exercise-1', ...input })),
      findOne: jest.fn().mockResolvedValue(exerciseFixture),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };
    s3 = {
      buildExerciseMediaKey: jest.fn(
        (org, exerciseId, uuid, fileName) =>
          `orgs/${org}/workouts/exercises/${exerciseId}/${uuid}/${fileName}`,
      ),
      upload: jest.fn().mockResolvedValue({ key: 'k', etag: 'e' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new ExerciseLibraryService(
      exerciseRepo as never,
      s3 as unknown as S3Service,
    );
  });

  it('creates an exercise in the authorized organization, never from the body', async () => {
    await service.create(orgId, {
      name: 'Squat',
      description: 'barbell back squat',
    });

    expect(exerciseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: orgId,
        name: 'Squat',
      }),
    );
  });

  it('defaults the browse view to active exercises and applies the search filter', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    exerciseRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findAll(orgId, { search: 'bench' });

    expect(qb.andWhere).toHaveBeenCalledWith('exercise.is_active = :isActive', {
      isActive: true,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE'),
      { search: '%bench%' },
    );
  });

  it('rejects an unsupported media MIME type before any S3 write', async () => {
    await expect(
      service.uploadMedia(orgId, 'exercise-1', 'image', {
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(s3.upload).not.toHaveBeenCalled();
  });

  it('rejects a file above the shared size limit before any S3 write', async () => {
    await expect(
      service.uploadMedia(orgId, 'exercise-1', 'image', {
        originalname: 'x.png',
        mimetype: 'image/png',
        size: EXERCISE_MEDIA_MAX_BYTES + 1,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(s3.upload).not.toHaveBeenCalled();
  });

  it('uploads first, stores the returned key second, and sanitises the filename', async () => {
    exerciseRepo.findOne
      .mockResolvedValueOnce(exerciseFixture)
      .mockResolvedValueOnce({
        ...exerciseFixture,
        image_key: 'orgs/org-1/workouts/exercises/exercise-1/u/x.png',
      });

    await service.uploadMedia(orgId, 'exercise-1', 'image', {
      originalname: '../../evil name.png',
      mimetype: 'image/png',
      size: 10,
      buffer: Buffer.from('x'),
    });

    expect(s3.buildExerciseMediaKey).toHaveBeenCalledWith(
      orgId,
      'exercise-1',
      expect.any(String),
      'evil_name.png',
    );
    expect(s3.upload).toHaveBeenCalledTimes(1);
    expect(exerciseRepo.update).toHaveBeenCalledWith(
      { id: 'exercise-1', organization_id: orgId },
      expect.objectContaining({ image_mime_type: 'image/png' }),
    );
  });

  it('cleans up the uploaded object when the DB update fails', async () => {
    exerciseRepo.update.mockRejectedValue(new Error('db down'));

    await expect(
      service.uploadMedia(orgId, 'exercise-1', 'gif', {
        originalname: 'demo.gif',
        mimetype: 'image/gif',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toThrow('db down');

    expect(s3.upload).toHaveBeenCalledTimes(1);
    expect(s3.delete).toHaveBeenCalledWith(expect.stringContaining('/demo.gif'));
  });

  it('removes the media slot from the row before deleting the object', async () => {
    exerciseRepo.findOne.mockResolvedValue({
      ...exerciseFixture,
      image_key: 'old-key',
    });

    await service.removeMedia(orgId, 'exercise-1', 'image');

    const updateOrder = exerciseRepo.update.mock.invocationCallOrder[0];
    const deleteOrder = s3.delete.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
    expect(exerciseRepo.update).toHaveBeenCalledWith(
      { id: 'exercise-1', organization_id: orgId },
      { image_key: null, image_mime_type: null },
    );
  });

  it('accepts only canonical YouTube video URLs', () => {
    expect(YOUTUBE_URL_PATTERN.test('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(
      YOUTUBE_URL_PATTERN.test('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBe(true);
    expect(YOUTUBE_URL_PATTERN.test('https://example.com/watch?v=abc')).toBe(
      false,
    );
    expect(
      YOUTUBE_URL_PATTERN.test('https://youtube.com/watch?v=short'),
    ).toBe(false);
  });
});
