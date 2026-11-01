import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MeasurementsController } from './measurements.controller';
import { MeasurementLogsService } from '../services/measurement-logs.service';
import { CreateMeasurementDto } from '../dto/create-measurement.dto';
import { ListMeasurementsDto } from '../dto/list-measurements.dto';
import { MeasurementType } from '../entities/measurement-log.entity';
import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';

describe('MeasurementsController', () => {
  let controller: MeasurementsController;
  let service: MeasurementLogsService;

  const memberId = '11111111-1111-4111-8111-111111111111';

  const validDto: CreateMeasurementDto = {
    measurement_type: MeasurementType.WEIGHT,
    value: 72.5,
    unit: 'kg',
    measured_at: '2026-09-15T10:00:00Z',
    measured_by: undefined,
    notes: undefined,
  };

  const query: ListMeasurementsDto = {
    member_id: 'member-1',
    page: 1,
    limit: 20,
  };

  /**
   * The same pipe configuration as `src/main.ts`. Running the body through it
   * reproduces the production order: validation happens BEFORE the handler, so
   * the controller can only work with a body that already passed validation.
   */
  const globalValidationPipe = new ValidationPipe({ whitelist: true, transform: true });

  function validateBody(body: unknown): Promise<CreateMeasurementDto> {
    return globalValidationPipe.transform(body, {
      type: 'body',
      metatype: CreateMeasurementDto,
    }) as Promise<CreateMeasurementDto>;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeasurementsController],
      providers: [
        {
          provide: MeasurementLogsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'meas-1', organization_id: 'org-1', ...validDto }),
            findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
          },
        },
      ],
    }).compile();

    controller = module.get<MeasurementsController>(MeasurementsController);
    service = module.get(MeasurementLogsService);
  });

  it('POST /v1/members/:memberId/measurements passes the route memberId separately from the body', async () => {
    await controller.create(memberId, validDto);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(memberId, validDto);

    const [, body] = (service.create as jest.Mock).mock.calls[0];
    expect(body).not.toHaveProperty('member_id');
  });

  it('GET /v1/members/:memberId/measurements delegates to service.findAll with memberId bound', async () => {
    await controller.findAll(memberId, query);

    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(service.findAll).toHaveBeenCalledWith(expect.objectContaining({ member_id: memberId }));
  });

  it('requires measurement:create on POST', () => {
    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, MeasurementsController.prototype.create);
    expect(metadata).toEqual([{ resource: 'measurement', action: 'create' }]);
  });

  it('requires measurement:read on GET', () => {
    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, MeasurementsController.prototype.findAll);
    expect(metadata).toEqual([{ resource: 'measurement', action: 'read' }]);
  });

  describe('request body contract (global ValidationPipe shape)', () => {
    it('accepts a body that omits member_id and uses the URL member id', async () => {
      const validated = await validateBody({ ...validDto });
      await controller.create(memberId, validated);

      expect(service.create).toHaveBeenCalledWith(
        memberId,
        expect.objectContaining({
          measurement_type: MeasurementType.WEIGHT,
          value: 72.5,
          unit: 'kg',
          measured_at: '2026-09-15T10:00:00Z',
        }),
      );
    });

    it('preserves the existing optional measurement fields', async () => {
      const measuredBy = '33333333-3333-4333-8333-333333333333';
      const validated = await validateBody({
        ...validDto,
        measured_by: measuredBy,
        notes: 'steady progress',
      });

      expect(validated).toMatchObject({
        measured_by: measuredBy,
        notes: 'steady progress',
      });
    });

    it('strips a client-supplied body member_id so it cannot compete with the URL', async () => {
      const foreignMemberId = '22222222-2222-4222-8222-222222222222';
      const validated = await validateBody({ ...validDto, member_id: foreignMemberId });

      expect(validated).not.toHaveProperty('member_id');

      await controller.create(memberId, validated);

      expect(service.create).toHaveBeenCalledTimes(1);
      expect((service.create as jest.Mock).mock.calls[0][0]).toBe(memberId);
      const [, body] = (service.create as jest.Mock).mock.calls[0];
      expect(body).not.toHaveProperty('member_id');
    });

    it('still rejects invalid existing measurement fields', async () => {
      await expect(validateBody({ ...validDto, unit: 'stone' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(validateBody({ ...validDto, measured_at: undefined })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        validateBody({ ...validDto, measurement_type: 'height' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(validateBody({ ...validDto, value: undefined })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
