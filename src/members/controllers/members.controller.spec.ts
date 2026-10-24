import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ListMembersDto } from '../dto/list-members.dto';

describe('MembersController ValidationPipe integration for ListMembersDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  describe('sort_by validation', () => {
    it('rejects invalid sort_by column', async () => {
      await expect(
        pipe.transform(
          { sort_by: 'email' },
          { type: 'query', metatype: ListMembersDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid sort_by with valid sort_dir', async () => {
      await expect(
        pipe.transform(
          { sort_by: 'phone', sort_dir: 'asc' },
          { type: 'query', metatype: ListMembersDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid sort_by values (sort_dir undefined until service applies default)', async () => {
      const validColumns = ['created_at', 'first_name', 'last_name', 'local_id'];
      for (const column of validColumns) {
        const result = await pipe.transform(
          { sort_by: column },
          { type: 'query', metatype: ListMembersDto },
        );
        expect(result.sort_by).toBe(column);
        // ValidationPipe does not apply service-level defaults; sort_dir remains undefined
        expect(result.sort_dir).toBeUndefined();
      }
    });
  });

  describe('sort_dir validation', () => {
    it('rejects invalid sort_dir value', async () => {
      await expect(
        pipe.transform(
          { sort_dir: 'ascending' },
          { type: 'query', metatype: ListMembersDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects uppercase sort_dir (case-sensitive)', async () => {
      await expect(
        pipe.transform(
          { sort_by: 'first_name', sort_dir: 'DESC' },
          { type: 'query', metatype: ListMembersDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid sort_dir values (sort_by undefined until service applies default)', async () => {
      const resultAsc = await pipe.transform(
        { sort_dir: 'asc' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(resultAsc.sort_dir).toBe('asc');
      expect(resultAsc.sort_by).toBeUndefined(); // service applies 'created_at' default

      const resultDesc = await pipe.transform(
        { sort_dir: 'desc' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(resultDesc.sort_dir).toBe('desc');
      expect(resultDesc.sort_by).toBeUndefined();
    });
  });

  describe('combined valid sort_by and sort_dir', () => {
    it('accepts valid sort_by and sort_dir together', async () => {
      const result = await pipe.transform(
        { sort_by: 'first_name', sort_dir: 'desc' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(result.sort_by).toBe('first_name');
      expect(result.sort_dir).toBe('desc');
    });

    it('accepts valid sort_by alone (sort_dir undefined until service applies default)', async () => {
      const result = await pipe.transform(
        { sort_by: 'last_name' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(result.sort_by).toBe('last_name');
      expect(result.sort_dir).toBeUndefined();
    });

    it('accepts valid sort_dir alone (sort_by undefined until service applies default)', async () => {
      const result = await pipe.transform(
        { sort_dir: 'desc' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(result.sort_by).toBeUndefined();
      expect(result.sort_dir).toBe('desc');
    });
  });

  describe('whitelist behavior', () => {
    it('strips unknown properties', async () => {
      const result = await pipe.transform(
        { sort_by: 'first_name', unknown_field: 'should be stripped' },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(result.sort_by).toBe('first_name');
      expect((result as Record<string, unknown>).unknown_field).toBeUndefined();
    });

    it('preserves all valid DTO properties', async () => {
      const result = await pipe.transform(
        {
          page: 2,
          limit: 10,
          search: 'john',
          branch_id: 'branch-1',
          sort_by: 'local_id',
          sort_dir: 'asc',
        },
        { type: 'query', metatype: ListMembersDto },
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.search).toBe('john');
      expect(result.branch_id).toBe('branch-1');
      expect(result.sort_by).toBe('local_id');
      expect(result.sort_dir).toBe('asc');
    });
  });
});