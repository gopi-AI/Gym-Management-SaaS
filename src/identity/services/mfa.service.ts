import { Injectable } from '@nestjs/common';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityMfaSecret } from '../entities/identity-mfa-secrets.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EncryptionService } from '../../shared/crypto/encryption.service';
import * as speakeasy from 'speakeasy';

@Injectable()
export class MfaService {
  constructor(
    @InjectRepository(IdentityUser)
    private readonly userRepository: Repository<IdentityUser>,
    @InjectRepository(IdentityMfaSecret)
    private readonly mfaSecretRepository: Repository<IdentityMfaSecret>,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Generate a new TOTP secret for a user.
   * Returns the base32 secret and a provisioning URI for QR code generation.
   * The secret is NOT stored yet - the caller must verify the OTP first before enabling MFA.
   */
  async generateSecret(userId: string): Promise<{
    secret: string;
    provisioningUri: string;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const speakeasyResult = speakeasy.generateSecret({
      length: 20,
    });

    const secret = speakeasyResult.base32;
    // speakeasy v2 API: `otpauthURL` (there is no `provisioningUri`). The
    // secret is already base32, so `encoding: 'base32'` must be passed
    // explicitly to avoid re-encoding the base32 string.
    const provisioningUri = speakeasy.otpauthURL({
      secret: secret,
      encoding: 'base32',
      issuer: 'Gym Management SaaS',
      label: user.email,
    });

    return { secret, provisioningUri };
  }

  /**
   * Store the MFA secret for a user after successful verification.
   * Should only be called after the user successfully verifies a newly generated OTP.
   */
  async storeSecret(userId: string, secret: string): Promise<IdentityMfaSecret> {
    // Check if user already has an MFA secret
    const existingSecret = await this.mfaSecretRepository.findOne({
      where: { user_id: userId },
    });

    // Encrypt the secret before persisting (AES-256-GCM).
    const encrypted = this.encryptionService.encrypt(secret);

    if (existingSecret) {
      // Update existing secret
      existingSecret.secret = encrypted;
      return this.mfaSecretRepository.save(existingSecret);
    }

    // Create new secret record
    const mfaSecret = this.mfaSecretRepository.create({
      user_id: userId,
      secret: encrypted,
    });

    return this.mfaSecretRepository.save(mfaSecret);
  }

  /**
   * Verify a TOTP code against the user's stored secret.
   * Returns true if the code is valid within the clock skew window.
   */
  async verifyTotp(userId: string, otpCode: string): Promise<boolean> {
    // Find the user's MFA secret
    const mfaSecret = await this.mfaSecretRepository.findOne({
      where: { user_id: userId },
    });

    if (!mfaSecret || !mfaSecret.secret) {
      return false;
    }

    // Decrypt the secret before performing TOTP verification.
    let plaintextSecret: string;
    try {
      plaintextSecret = this.encryptionService.decrypt(mfaSecret.secret);
    } catch {
      return false;
    }

    // Verify the TOTP code with a 1-step (30-second) clock skew window
    const verified = speakeasy.totp.verify({
      secret: plaintextSecret,
      encoding: 'base32',
      token: otpCode,
      window: 1, // Allow ±1 step (30 seconds) clock skew
    });

    return verified;
  }

  /**
   * Check if MFA is enabled for a user.
   */
  async isMfaEnabled(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return false;
    }

    return user.is_mfa_enabled === true;
  }

  /**
   * Enable MFA for a user after successful OTP verification.
   * This should only be called after the user verifies the enrollment OTP.
   */
  async enableMfa(userId: string): Promise<void> {
    await this.userRepository.update(userId, { is_mfa_enabled: true });
  }

  /**
   * Disable MFA for a user. Requires successful TOTP verification first.
   * This is a placeholder - the actual verification would happen in the controller.
   */
  async disableMfa(userId: string, otpCode: string): Promise<boolean> {
    const isValid = await this.verifyTotp(userId, otpCode);
    if (isValid) {
      await this.userRepository.update(userId, { is_mfa_enabled: false });
      // Also optionally clear the MFA secret
      await this.mfaSecretRepository.delete({ user_id: userId });
      return true;
    }
    return false;
  }
}
