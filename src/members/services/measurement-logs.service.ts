import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, FindOptionsWhere, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { MeasurementLog, MeasurementType } from '../entities/measurement-log.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { CreateMeasurementDto } from '../dto/create-measurement.dto';
import { ListMeasurementsDto } from '../dto/list-measurements.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

@Injectable()
export class MeasurementLogsService {
  constructor(
    @InjectRepository(MeasurementLog)
    private readonly measurementLogRepository: Repository<MeasurementLog>,
    @InjectRepository(MemberProfile)
    private readonly memberProfileRepository: Repository<MemberProfile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  private static validateValue(type: MeasurementType, value: number, unit: string): void {
    switch (type) {
      case MeasurementType.WEIGHT:
        if (unit !== 'kg' && unit !== 'lb') {
          throw new BadRequestException('Weight must use unit "kg" or "lb"');
        }
        if (value < 1 || value > 500) {
          throw new BadRequestException('Weight must be between 1 and 500');
        }
        break;
      case MeasurementType.BODY_FAT:
        if (unit !== '%') {
          throw new BadRequestException('Body fat must use unit "%"');
        }
        if (value < 2 || value > 70) {
          throw new BadRequestException('Body fat % must be between 2 and 70');
        }
        break;
      case MeasurementType.CHEST:
      case MeasurementType.WAIST:
      case MeasurementType.HIP:
        if (unit !== 'cm' && unit !== 'in') {
          throw new BadRequestException('Chest/waist/hip must use unit "cm" or "in"');
        }
        if (value < 20 || value > 300) {
          throw new BadRequestException('Chest/waist/hip must be between 20 and 300');
        }
        break;
      case MeasurementType.ARM:
      case MeasurementType.THIGH:
      case MeasurementType.CALF:
        if (unit !== 'cm' && unit !== 'in') {
          throw new BadRequestException('Arm/thigh/calf must use unit "cm" or "in"');
        }
        if (value < 5 || value > 150) {
          throw new BadRequestException('Arm/thigh/calf must be between 5 and 150');
        }
        break;
    }
  }

  /**
   * Single legal write path for measurement logs.
   * Dual-writes MeasurementLog + MemberProfile inside one DB transaction.
   */
  async create(dto: CreateMeasurementDto): Promise<MeasurementLog> {
    const organizationId = await this.getOrganizationId();
    const type = dto.measurement_type;

    if (type !== MeasurementType.WEIGHT && type !== MeasurementType.BODY_FAT) {
      throw new BadRequestException(
        `Measurement type "${type}" is reserved and cannot be logged in Phase 2`,
      );
    }

    MeasurementLogsService.validateValue(type, dto.value, dto.unit);

    return this.dataSource.transaction(async (manager) => {
      const mlRepo = manager.getRepository(MeasurementLog);
      const measurement = mlRepo.create({
        organization_id: organizationId,
        member_id: dto.member_id,
        measurement_type: type,
        value: dto.value,
        unit: dto.unit,
        measured_at: new Date(dto.measured_at),
        measured_by: dto.measured_by ?? null,
        notes: dto.notes ?? null,
      });
      const saved = await mlRepo.save(measurement);

      const mpRepo = manager.getRepository(MemberProfile);
      const profile = await mpRepo.findOne({ where: { member_id: dto.member_id } });
      if (!profile) {
        throw new NotFoundException('Member profile not found');
      }

      const profileField = type === MeasurementType.WEIGHT ? 'weight' : 'body_fat';
      await mpRepo.update({ member_id: dto.member_id }, { [profileField]: String(dto.value) });
      return saved;
    });
  }

  async findAll(query: ListMeasurementsDto): Promise<{
    data: MeasurementLog[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<MeasurementLog> = {
      organization_id: organizationId,
      member_id: query.member_id,
    };

    if (query.measurement_type) {
      where.measurement_type = query.measurement_type;
    }

    if (query.date_from && query.date_to) {
      where.measured_at = Between(new Date(query.date_from), new Date(query.date_to));
    } else if (query.date_from) {
      where.measured_at = MoreThanOrEqual(new Date(query.date_from));
    } else if (query.date_to) {
      where.measured_at = LessThanOrEqual(new Date(query.date_to));
    }

    const [data, total] = await this.measurementLogRepository.findAndCount({
      where,
      order: { measured_at: 'DESC' },
      take: limit,
      skip,
    });

    return { data, total, page, limit };
  }
}
