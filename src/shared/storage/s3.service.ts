import { Injectable } from '@nestjs/common';

/**
 * Minimal S3 abstraction wrapping S3 operations for member document uploads.
 *
 * Key convention (per Q25): `orgs/{orgId}/members/{memberId}/documents/{uuid}/{filename}`
 *
 * Design decision — S3/DB atomicity:
 *   Order: S3 upload FIRST, DB insert SECOND.
 *   On DB failure: best-effort S3 object deletion, then re-throw.
 *   Rationale: an orphan S3 object (S3 succeeds, DB fails, cleanup fails) is
 *   acceptable — it is unreferenced data with zero integrity impact. A DB row
 *   pointing to a nonexistent S3 object (DB succeeds, S3 fails) would be a data
 *   integrity violation. See the atomicity test for the failure-mode verification.
 */
@Injectable()
export class S3Service {
  /**
   * Upload a buffer to S3 at the given key with the given content type.
   *
   * In test/development environments without real S3, this implementation writes
   * to the local filesystem under a configurable upload root.
   */
  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; etag: string }> {
    // In development: write to local filesystem
    if (process.env.NODE_ENV !== 'production') {
      const fs = await import('fs/promises');
      const path = await import('path');
      const uploadRoot = process.env.S3_LOCAL_ROOT || './uploads';
      const filePath = path.join(uploadRoot, key);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body);

      return { key, etag: `local-${Date.now()}` };
    }

    // Production: use AWS S3 SDK
    const { S3Client, PutObjectCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const bucket = process.env.S3_DOCUMENTS_BUCKET || 'gym-documents';

    const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    const result = await client.send(command);
    return { key, etag: result.ETag ?? 'unknown' };
  }

  /**
   * Delete an object from S3. Used for best-effort cleanup when the DB write
   * fails after a successful upload. Errors are logged but not propagated —
   * the original DB error is the one the caller cares about.
   */
  async delete(key: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      const fs = await import('fs/promises');
      const path = await import('path');
      const uploadRoot = process.env.S3_LOCAL_ROOT || './uploads';
      const filePath = path.join(uploadRoot, key);

      try {
        await fs.unlink(filePath);
      } catch {
        // Best-effort: file may not exist
      }
      return;
    }

    const { S3Client, DeleteObjectCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const bucket = process.env.S3_DOCUMENTS_BUCKET || 'gym-documents';
    const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });

    try {
      await client.send(command);
    } catch {
      // Best-effort cleanup — swallow S3 errors so the original DB error
      // propagates to the caller unchanged.
    }
  }

  /**
   * Build an S3 key following the Q25 naming convention.
   */
  buildKey(
    organizationId: string,
    memberId: string,
    uuid: string,
    fileName: string,
  ): string {
    return `orgs/${organizationId}/members/${memberId}/documents/${uuid}/${fileName}`;
  }
}