import { Test, TestingModule } from '@nestjs/testing';
import { MeasurementsController } from './measurements.controller';
import { MeasurementLogsService } from '../services/measurement-logs.service';
import { CreateMeasurementDto } from '../dto/create-measurement.dto';
import { ListMeasurementsDto } from '../dto/list-measurements.dto';
import { MeasurementType } from '../entities/measurement-log.entity';
import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';

describe('MeasurementsController', () => {
  let controller: MeasurementsController;
  let service: MeasurementLogsService;

  const validDto: CreateMeasurementDto = {
    member_id: 'member-1',
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

  it('POST /v1/members/:memberId/measurements delegates to service.create with memberId bound', async () => {
    const memberId = '11111111-1111-4111-8111-111111111111';
    await controller.create(memberId, validDto);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ member_id: memberId }));
  });

  it('GET /v1/members/:memberId/measurements delegates to service.findAll with memberId bound', async () => {
    const memberId = '11111111-1111-4111-8111-111111111111';
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
});
