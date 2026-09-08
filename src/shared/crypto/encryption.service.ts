import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export const ENCRYPTED_VALUE_PREFIX = 'v1';

/**
 * Application-level encryption for sensitive values at rest (AES-256-GCM).
 *
 * - The key comes exclusively from configuration (MFA_ENCRYPTION_KEY).
 *   It is a base64-encoded 32-byte key, or any non-empty secret that is
 *   deterministically stretched to 32 bytes via SHA-256.
 * - Ciphertext format: `v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>`.
 * - Production MUST provide MFA_ENCRYPTION_KEY; dev derives a clearly-marked
 *   deterministic dev key so local development does not hard-fail, while
 *   production hard-fails (enforced in app.module.ts / validateEnv).
 *
 * This service is stateless and reusable for any at-rest secret.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer | null = null;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('MFA_ENCRYPTION_KEY', '').trim();
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (!raw) {
      if (isProduction) {
        // Fail closed: never persist secrets unencrypted in production.
        throw new Error(
          'MFA_ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32',
        );
      }
      // Development-only deterministic fallback (NOT used in production).
      this.key = createHash('sha256').update('dev-only-mfa-encryption-key').digest();
      return;
    }

    const fromBase64 = Buffer.from(raw, 'base64');
    if (fromBase64.length === 32) {
      this.key = fromBase64;
    } else {
      // Stretch arbitrary secrets to exactly 32 bytes.
      this.key = createHash('sha256').update(raw).digest();
    }
  }

  /** Encrypt a plaintext value. Returns `v1:iv:tag:ciphertext` (all base64). */
  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new Error('EncryptionService not initialized');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      ENCRYPTED_VALUE_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /** Decrypt a value produced by {@link encrypt}. Throws on tampering. */
  decrypt(encrypted: string): string {
    if (!this.key) {
      throw new Error('EncryptionService not initialized');
    }
    const parts = encrypted.split(':');
    if (parts.length !== 4 || parts[0] !== ENCRYPTED_VALUE_PREFIX) {
      throw new Error('Malformed encrypted value');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /** True when the value looks like it was produced by this service. */
  isEncrypted(value: string): boolean {
    return value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`);
  }
}
