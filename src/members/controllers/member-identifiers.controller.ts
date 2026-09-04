import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { MemberIdentifiersService } from '../services/member-identifiers.service';
import { CreateMemberIdentifierDto } from '../dto/create-member-identifier.dto';

@Controller('v1/members/:memberId/identifiers')
export class MemberIdentifiersController {
  constructor(private readonly identifiersService: MemberIdentifiersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Param('memberId') memberId: string) {
    return this.identifiersService.findAllByMember(memberId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Param('memberId') memberId: string, @Body() dto: CreateMemberIdentifierDto) {
    return this.identifiersService.create(memberId, dto);
  }

  @Delete(':identifierId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('memberId') memberId: string, @Param('identifierId') identifierId: string) {
    await this.identifiersService.remove(memberId, identifierId);
  }
}