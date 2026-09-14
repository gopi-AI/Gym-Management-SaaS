import { Controller, Get, Post, Delete, Body, Param, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { MemberIdentifiersService } from '../services/member-identifiers.service';
import { CreateMemberIdentifierDto } from '../dto/create-member-identifier.dto';

@Controller('v1/members/:memberId/identifiers')
export class MemberIdentifiersController {
  constructor(private readonly identifiersService: MemberIdentifiersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string) {
    return this.identifiersService.findAllByMember(memberId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: CreateMemberIdentifierDto,
  ) {
    return this.identifiersService.create(memberId, dto);
  }

  @Delete(':identifierId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('identifierId', new ParseUUIDPipe({ version: '4' })) identifierId: string,
  ) {
    await this.identifiersService.remove(memberId, identifierId);
  }
}