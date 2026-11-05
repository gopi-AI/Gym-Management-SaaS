import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Exercise } from '../entities/exercise.entity';
import { CreateExerciseDto } from '../dto/create-exercise.dto';
import { UpdateExerciseDto } from '../dto/update-exercise.dto';
import { ListExercisesDto } from '../dto/list-exercises.dto';
import {
  EXERCISE_GIF_MIME_TYPES,
  EXERCISE_IMAGE_MIME_TYPES,
  EXERCISE_MEDIA_MAX_BYTES,
  EXERCISE_MEDIA_TYPES,
  ExerciseMediaType,
} from '../workouts.constants';
import { S3Service } from '../../shared/storage/s3.service';

/**
 * Organization-scoped exercise library.
 *
 * Every read and write carries `organization_id` from the authorized request
 * context. Media is uploaded through the existing `S3Service`; the stored value
 * is always the key returned by that service, never a client-supplied path.
 */
@Injectable()
export class ExerciseLibraryService {
  constructor(
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    private readonly s3Service: S3Service,
  ) {}

  async create(organizationId: string, dto: CreateExerciseDto): Promise<Exercise> {
    const exercise = this.exerciseRepository.create({
      organization_id: organizationId,
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category ?? null,
      muscle_group: dto.muscle_group ?? null,
      equipment_needed: dto.equipment_needed ?? null,
      is_active: dto.is_active ?? true,
    });
    return this.exerciseRepository.save(exercise);
  }

  /**
   * Browse/search the library.
   *
   * Active exercises are the default view; `?is_active=false` explicitly
   * requests the inactive set. The boolean transform follows the DEF-01 fix
   * (`@Type(() => Boolean)` would invert it).
   */
  async findAll(
    organizationId: string,
    query: ListExercisesDto = {},
  ): Promise<Exercise[]> {
    const qb = this.exerciseRepository
      .createQueryBuilder('exercise')
      .where('exercise.organization_id = :organizationId', { organizationId })
      .andWhere('exercise.is_active = :isActive', {
        isActive: query.is_active ?? true,
      });

    if (query.category) {
      qb.andWhere('exercise.category = :category', { category: query.category });
    }

    if (query.search) {
      qb.andWhere(
        '(exercise.name ILIKE :search OR exercise.description ILIKE :search OR exercise.muscle_group ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    return qb.orderBy('exercise.name', 'ASC').getMany();
  }

  async findOne(organizationId: string, id: string): Promise<Exercise> {
    const exercise = await this.exerciseRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }
    return exercise;
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateExerciseDto,
  ): Promise<Exercise> {
    const exercise = await this.findOne(organizationId, id);

    if (dto.name !== undefined) exercise.name = dto.name;
    if (dto.description !== undefined) exercise.description = dto.description;
    if (dto.category !== undefined) exercise.category = dto.category;
    if (dto.muscle_group !== undefined) exercise.muscle_group = dto.muscle_group;
    if (dto.equipment_needed !== undefined) {
      exercise.equipment_needed = dto.equipment_needed;
    }
    if (dto.is_active !== undefined) exercise.is_active = dto.is_active;

    return this.exerciseRepository.save(exercise);
  }

  async setVideo(
    organizationId: string,
    id: string,
    videoUrl: string,
  ): Promise<Exercise> {
    const exercise = await this.findOne(organizationId, id);
    exercise.video_url = videoUrl;
    return this.exerciseRepository.save(exercise);
  }

  async clearVideo(organizationId: string, id: string): Promise<Exercise> {
    const exercise = await this.findOne(organizationId, id);
    exercise.video_url = null;
    return this.exerciseRepository.save(exercise);
  }

  /**
   * Upload (or replace) an exercise image/GIF.
   *
   * Validation happens before any S3 write: the MIME type must match the slot
   * and the file must be within the shared size limit. Upload order is S3 first,
   * DB second, with best-effort object cleanup if the DB write fails (the same
   * rule as member documents).
   */
  async uploadMedia(
    organizationId: string,
    exerciseId: string,
    mediaType: ExerciseMediaType,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<Exercise> {
    const exercise = await this.findOne(organizationId, exerciseId);
    const allowed =
      mediaType === EXERCISE_MEDIA_TYPES.GIF
        ? EXERCISE_GIF_MIME_TYPES
        : EXERCISE_IMAGE_MIME_TYPES;

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported ${mediaType} MIME type "${file.mimetype}". Allowed: ${allowed.join(', ')}`,
      );
    }
    if (file.size > EXERCISE_MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${EXERCISE_MEDIA_MAX_BYTES} byte limit`,
      );
    }

    const safeFileName = this.sanitiseFileName(file.originalname);
    const key = this.s3Service.buildExerciseMediaKey(
      organizationId,
      exerciseId,
      randomUUID(),
      safeFileName,
    );

    await this.s3Service.upload(key, file.buffer, file.mimetype);

    const patch =
      mediaType === EXERCISE_MEDIA_TYPES.GIF
        ? { gif_key: key, gif_mime_type: file.mimetype }
        : { image_key: key, image_mime_type: file.mimetype };

    try {
      await this.exerciseRepository.update(
        { id: exerciseId, organization_id: organizationId },
        patch,
      );
    } catch (error) {
      await this.s3Service.delete(key);
      throw error;
    }

    const updated = await this.findOne(organizationId, exerciseId);
    // Best-effort removal of a replaced object; the DB now points at the new key.
    if (
      mediaType === EXERCISE_MEDIA_TYPES.GIF
        ? exercise.gif_key && exercise.gif_key !== key
        : exercise.image_key && exercise.image_key !== key
    ) {
      await this.s3Service.delete(
        mediaType === EXERCISE_MEDIA_TYPES.GIF
          ? (exercise.gif_key as string)
          : (exercise.image_key as string),
      );
    }
    return updated;
  }

  /** Remove an exercise media slot (DB first, then best-effort object delete). */
  async removeMedia(
    organizationId: string,
    exerciseId: string,
    mediaType: ExerciseMediaType,
  ): Promise<Exercise> {
    const exercise = await this.findOne(organizationId, exerciseId);
    const key =
      mediaType === EXERCISE_MEDIA_TYPES.GIF ? exercise.gif_key : exercise.image_key;

    const patch =
      mediaType === EXERCISE_MEDIA_TYPES.GIF
        ? { gif_key: null, gif_mime_type: null }
        : { image_key: null, image_mime_type: null };

    await this.exerciseRepository.update(
      { id: exerciseId, organization_id: organizationId },
      patch,
    );
    if (key) {
      await this.s3Service.delete(key);
    }
    return this.findOne(organizationId, exerciseId);
  }

  /** Strip directories and characters that could escape the generated key. */
  private sanitiseFileName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? 'file';
    const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
    return cleaned.length > 0 ? cleaned : 'file';
  }
}
