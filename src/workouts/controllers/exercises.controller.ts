import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { ExerciseLibraryService } from '../services/exercise-library.service';
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { CreateExerciseDto } from '../dto/create-exercise.dto';
import { UpdateExerciseDto } from '../dto/update-exercise.dto';
import { ListExercisesDto } from '../dto/list-exercises.dto';
import { SetExerciseVideoDto } from '../dto/set-exercise-video.dto';
import { UploadExerciseMediaDto } from '../dto/upload-exercise-media.dto';
import {
  EXERCISE_MEDIA_TYPES,
  ExerciseMediaType,
} from '../workouts.constants';

/**
 * Exercise library (P2-05).
 *
 * Browse/search, create/edit, and optional image/GIF/YouTube media. Every route
 * is organization-scoped from the authorized request context; no route accepts
 * an organization id in the body.
 */
@Controller('v1/workouts/exercises')
export class ExercisesController {
  constructor(
    private readonly exerciseLibrary: ExerciseLibraryService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-read' })
  async findAll(@Query() query: ListExercisesDto) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.findAll(organizationId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async create(@Body() dto: CreateExerciseDto) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.create(organizationId, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.findOne(organizationId, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.update(organizationId, id, dto);
  }

  @Post(':id/media')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { storage: require('multer').memoryStorage() }),
  )
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async uploadMedia(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UploadExerciseMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.uploadMedia(
      organizationId,
      id,
      dto.media_type,
      file,
    );
  }

  @Delete(':id/media/:mediaType')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async removeMedia(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('mediaType', new ParseEnumPipe(EXERCISE_MEDIA_TYPES))
    mediaType: ExerciseMediaType,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.removeMedia(organizationId, id, mediaType);
  }

  @Put(':id/video')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async setVideo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetExerciseVideoDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.setVideo(organizationId, id, dto.video_url);
  }

  @Delete(':id/video')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'exercise-manage' })
  async clearVideo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.clearVideo(organizationId, id);
  }
}
