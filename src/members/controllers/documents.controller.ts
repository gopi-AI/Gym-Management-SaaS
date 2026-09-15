import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  Delete,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from '../services/documents.service';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

@Controller('v1/members')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
  ) {}

  @Post(':memberId/documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { storage: require('multer').memoryStorage() }))
  @RequirePermissions({ resource: 'member', action: 'document-upload' })
  async upload(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) {
      return Promise.reject(
        Object.assign(new Error('file is required'), { response: { message: 'File is required' } }),
      );
    }

    return this.documentsService.upload(
      memberId,
      {
        document_type: dto.document_type,
        file_name: file.originalname,
        mime_type: file.mimetype,
        file_size_bytes: file.size,
      },
      file.buffer,
    );
  }

  @Get(':memberId/documents')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'document-read' })
  async findAll(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    return this.documentsService.findAll(memberId);
  }

  @Get(':memberId/documents/:documentId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'document-read' })
  async findOne(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ) {
    return this.documentsService.findOne(memberId, documentId);
  }

  @Delete(':memberId/documents/:documentId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'document-delete' })
  async softDelete(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ) {
    await this.documentsService.softDelete(memberId, documentId);
    return { success: true };
  }
}