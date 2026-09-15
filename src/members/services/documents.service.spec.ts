import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { MemberDocument } from '../entities/member-document.entity';
import { DocumentType } from '../entities/document-type.enum';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { S3Service } from '../../shared/storage/s3.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockDocumentRepo: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockS3Service: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const memberId = 'member-uuid-1';

  const uploadDto = {
    document_type: DocumentType.MEDICAL_REPORT,
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 1024,
  };

  const fileBuffer = Buffer.from('fake-file-content');

  beforeEach(async () => {
    mockDocumentRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'doc-1', ...dto })),
      save: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockS3Service = {
      upload: jest.fn().mockResolvedValue({ key: 's3-key-1', etag: 'etag-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      buildKey: jest.fn().mockImplementation(
        (o, m, u, f) => `orgs/${o}/members/${m}/documents/${u}/${f}`,
      ),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getRepositoryToken(MemberDocument), useValue: mockDocumentRepo },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: S3Service, useValue: mockS3Service },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });
// --------------------------------------------------------------------------
  // S3/DB atomicity (the real cross-system risk)
  // --------------------------------------------------------------------------

  describe('S3/DB atomicity (the real cross-system risk)', () => {
    it('uploads to S3 FIRST, then inserts DB row', async () => {
      const order: string[] = [];
      mockS3Service.upload.mockImplementation(async () => {
        order.push('s3-upload');
        return { key: 'key-1', etag: 'etag-1' };
      });
      mockDocumentRepo.save.mockImplementation(async (doc) => {
        order.push('db-insert');
        return { id: 'doc-1', ...doc };
      });

      await service.upload(memberId, uploadDto, fileBuffer);

      expect(order).toEqual(['s3-upload', 'db-insert']);
    });

    it('does best-effort S3 cleanup when DB insert fails', async () => {
      mockS3Service.delete.mockClear();

      // Capture the exact S3 key the service builds for the upload
      const builtKey = 'orgs/org-123/members/member-uuid-1/documents/uuid-abc/report.pdf';
      mockS3Service.buildKey.mockReturnValue(builtKey);

      // Simulate a DB save failure
      mockDocumentRepo.save.mockImplementation(() =>
        Promise.reject(new Error('DB_INSERT_FAILED')),
      );

      // delete is a no-op mock (resolves) so we can assert ON it afterwards
      mockS3Service.delete.mockResolvedValue(undefined);

      // The original DB error must still propagate to the caller
      await expect(
        service.upload(memberId, uploadDto, fileBuffer),
      ).rejects.toThrow('DB_INSERT_FAILED');

      // THE MEANINGFUL ASSERTION: cleanup actually happened, with the exact key
      expect(mockS3Service.delete).toHaveBeenCalledTimes(1);
      expect(mockS3Service.delete).toHaveBeenCalledWith(builtKey);
    });

    it('does NOT mask the original DB error if S3 cleanup itself fails', async () => {
      mockS3Service.buildKey.mockReturnValue(
        'orgs/org-123/members/member-uuid-1/documents/uuid-abc/report.pdf',
      );

      mockDocumentRepo.save.mockImplementation(() =>
        Promise.reject(new Error('DB_INSERT_FAILED')),
      );

      // S3 cleanup itself fails
      mockS3Service.delete.mockRejectedValue(new Error('S3_DELETE_FAILED'));

      // Even though cleanup fails, the ORIGINAL DB error must still reach the caller
      await expect(
        service.upload(memberId, uploadDto, fileBuffer),
      ).rejects.toThrow('DB_INSERT_FAILED');
    });

    it('does NOT try to save a DB row if S3 upload fails', async () => {
      mockS3Service.upload.mockRejectedValue(new Error('S3_UPLOAD_FAILED'));

      await expect(
        service.upload(memberId, uploadDto, fileBuffer),
      ).rejects.toThrow('S3_UPLOAD_FAILED');

      expect(mockDocumentRepo.save).not.toHaveBeenCalled();
      expect(mockS3Service.delete).not.toHaveBeenCalled();
    });

    it('uses the Q25 key convention orgs/{orgId}/members/{memberId}/documents/{uuid}/{fileName}', async () => {
      mockS3Service.buildKey.mockReturnValue(
        `orgs/${orgId}/members/${memberId}/documents/uuid-abc/report.pdf`,
      );

      await service.upload(memberId, uploadDto, fileBuffer);

      expect(mockS3Service.buildKey).toHaveBeenCalledWith(
        orgId,
        memberId,
        expect.any(String),
        uploadDto.file_name,
      );
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          s3_key: `orgs/${orgId}/members/${memberId}/documents/uuid-abc/report.pdf`,
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Document/consent independence
  // --------------------------------------------------------------------------

  describe('document/consent independence', () => {
    it('can upload a document with no linked consent (no implicit consent creation)', async () => {
      const result = await service.upload(memberId, uploadDto, fileBuffer);

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: memberId,
          document_type: DocumentType.MEDICAL_REPORT,
          file_name: 'report.pdf',
        }),
      );
      expect(result).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // findAll / findOne / softDelete
  // --------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns active documents for a member scoped to org', async () => {
      const mockDocs = [
        { id: 'd1', member_id: memberId, document_type: DocumentType.PHOTO } as MemberDocument,
      ];
      mockDocumentRepo.find.mockResolvedValue(mockDocs);

      const result = await service.findAll(memberId);
      expect(result).toHaveLength(1);
      expect(mockDocumentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: orgId, member_id: memberId, is_active: true },
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('soft-deletes a document (is_active = false)', async () => {
      mockDocumentRepo.update.mockResolvedValue({ affected: 1 });

      await service.softDelete(memberId, 'doc-1');
      expect(mockDocumentRepo.update).toHaveBeenCalledWith(
        { id: 'doc-1', organization_id: orgId, member_id: memberId, is_active: true },
        { is_active: false },
      );
    });

    it('throws NotFoundException when document does not exist', async () => {
      mockDocumentRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.softDelete(memberId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});