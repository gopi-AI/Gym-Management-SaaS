import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { MfaEnableDto } from '../dto/mfa-enable.dto';

/**
 * `POST /v1/auth/mfa-enable` — the HTTP shape of the re-authentication rule.
 *
 * The rule itself (a valid current TOTP is required before an ENABLED user's
 * secret is replaced) lives in `MfaService.startEnrollment` and is proven
 * against real Postgres in `mfa-enable-reauth.integration.spec.ts`. What this
 * spec pins is the contract on top of it: a refused enrollment answers the SAME
 * exception type and status as `mfa-disable`'s bad-code path — 401 — and the
 * message names neither the stored secret nor the MFA state.
 *
 * The service is a plain stand-in object, not a mocked database: nothing here
 * touches a repository (this controller has none).
 */
describe('AuthController.enableMfa — refusal answers 401', () => {
  function buildController(startEnrollment: jest.Mock): AuthController {
    return new AuthController({
      mfaService: { startEnrollment },
    } as unknown as AuthService);
  }

  it('answers 401 with an uninformative message when the service refuses', async () => {
    const controller = buildController(jest.fn().mockResolvedValue(null));

    const error = await controller
      .enableMfa({ userId: 'user-1' }, { otpCode: '123456' } as MfaEnableDto)
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(UnauthorizedException);
    // Same status as mfa-disable's bad-code path.
    expect((error as UnauthorizedException).getStatus()).toBe(401);

    const message = (error as UnauthorizedException).message;
    expect(message).toBe('Invalid TOTP code');
    // Must not disclose the stored secret or the enabled/disabled state.
    expect(message).not.toMatch(/enabled|disabled|secret/i);
  });

  it('returns the enrollment when the service allows it, passing the caller and code through', async () => {
    const enrollment = { secret: 'NEWSECRET', provisioningUri: 'otpauth://x' };
    const startEnrollment = jest.fn().mockResolvedValue(enrollment);
    const controller = buildController(startEnrollment);

    const result = await controller.enableMfa(
      { userId: 'user-1' },
      { otpCode: '654321' } as MfaEnableDto,
    );

    expect(result).toEqual(enrollment);
    expect(startEnrollment).toHaveBeenCalledWith('user-1', '654321');
  });

  it('passes an omitted code through as undefined (first-time enrollment path)', async () => {
    const enrollment = { secret: 'NEWSECRET', provisioningUri: 'otpauth://x' };
    const startEnrollment = jest.fn().mockResolvedValue(enrollment);
    const controller = buildController(startEnrollment);

    await controller.enableMfa({ userId: 'user-2' }, {} as MfaEnableDto);

    expect(startEnrollment).toHaveBeenCalledWith('user-2', undefined);
  });
});
