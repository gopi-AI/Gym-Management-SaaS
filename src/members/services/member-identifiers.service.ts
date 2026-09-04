import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberIdentifier } from '../entities/member-identifier.entity';
import { CreateMemberIdentifierDto } from '../dto/create-member-identifier.dto';
import { MembersService } from './members.service';

@Injectable()
export class MemberIdentifiersService {
  constructor(
    @InjectRepository(MemberIdentifier)
    private readonly identifierRepository: Repository<MemberIdentifier>,
    private readonly membersService: MembersService,
  ) {}

  async findAllByMember(memberId: string): Promise<MemberIdentifier[]> {
    await this.membersService.findOne(memberId);
    return this.identifierRepository.find({
      where: { member_id: memberId },
      order: { identifier_type: 'ASC' },
    });
  }

  async create(memberId: string, dto: CreateMemberIdentifierDto): Promise<MemberIdentifier> {
    await this.membersService.findOne(memberId);
    const identifier = this.identifierRepository.create({
      member_id: memberId,
      identifier_type: dto.identifier_type,
      identifier_value: dto.identifier_value,
      is_primary: dto.is_primary ?? false,
    });
    return this.identifierRepository.save(identifier);
  }

  async remove(memberId: string, identifierId: string): Promise<void> {
    await this.membersService.findOne(memberId);
    const result = await this.identifierRepository.delete({ id: identifierId, member_id: memberId });
    if (result.affected === 0) {
      throw new NotFoundException('Identifier not found');
    }
  }
}