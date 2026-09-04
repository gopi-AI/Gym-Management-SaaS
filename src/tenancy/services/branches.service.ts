import { Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { OrganizationsService } from './organizations.service';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async findAll(): Promise<Branch[]> {
    return this.branchRepository.find({
      where: { is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Branch | null> {
    return this.branchRepository.findOne({
      where: { id, is_active: true },
    });
  }

  async create(dto: CreateBranchDto): Promise<Branch> {
    // Validate organization exists
    await this.organizationsService.findOne(dto.organization_id);
    
    const branch = this.branchRepository.create({
      ...dto,
      is_active: dto.is_active ?? true,
    });
    return this.branchRepository.save(branch);
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch | null> {
    await this.branchRepository.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.branchRepository.update(id, { is_active: false });
  }
}