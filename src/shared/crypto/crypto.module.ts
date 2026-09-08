import { Module, Global } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/**
 * Global crypto infrastructure (at-rest encryption, hashing helpers).
 * Provided once, globally; no per-feature duplicates.
 */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
