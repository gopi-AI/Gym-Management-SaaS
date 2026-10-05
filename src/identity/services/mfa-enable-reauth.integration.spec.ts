/**
 * MFA re-authentication before a stored secret is replaced — real Postgres.
 *
 * WHY THIS EXISTS ALONGSIDE A UNIT SPEC
 * The rule under test (owner ruling 2026-10-05: with MFA already enabled, a new
 * secret may only be generated/stored after the CURRENT TOTP verifies) is a
 * property of the ROW, not of a return value: the failure cases must leave
 * `IDENTITY_MFA_SECRETS.secret` byte-identical to what was there before. A
 * mocked repository would hand the service whatever the test wants and could
 * not show that. Every assertion below is therefore made through a SECOND READ
 * of the table.
 *
 * NO DATABASE OBJECT IS MOCKED — no DataSource, EntityManager or repository
 * stand-in. `EncryptionService` is the real one, constructed with a fixed test
 * key; the TOTP codes are real codes computed with `speakeasy` from the seeded
 * secret.
 *
 * CHARACTERIZATION, NOT A NEW GUARANTEE: `verifyTotp` accepts any code inside
 * its ±1 step window (30 s). A code that was already used is therefore accepted
 * again while it remains current — that is existing behaviour, unchanged here.
 * The last case pins it so a future change to it is a deliberate one.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 DB_HOST=… DB_PORT=… DB_USERNAME=… DB_PASSWORD=… \
 *     DB_DATABASE=<throwaway> npx jest src/identity/services/mfa-enable-reauth.integration
 * The database must already be migrated, and jest does not load `.env`. Without
 * `RUN_DB_INTEGRATION=1` the block reports as SKIPPED. Every row this spec
 * writes is deleted in `afterAll`.
 */
import { randomUUID } from 'crypto';
import { In } from 'typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as speakeasy from 'speakeasy';
import { MfaService } from './mfa.service';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityMfaSecret } from '../entities/identity-mfa-secrets.entity';
import { EncryptionService } from '../../shared/crypto/encryption.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const MFA_KEY = 'mfa-enable-reauth-integration-key';

describeIntegration('MfaService.startEnrollment re-authentication (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<IdentityUser>;
  let secrets: Repository<IdentityMfaSecret>;
  let encryption: EncryptionService;
  let service: MfaService;
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same glob as `src/data-source.ts`, so this spec cannot drift from the
      // entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    users = dataSource.getRepository(IdentityUser);
    secrets = dataSource.getRepository(IdentityMfaSecret);
    encryption = new EncryptionService(
      new ConfigService({ MFA_ENCRYPTION_KEY: MFA_KEY }),
    );
    service = new MfaService(users, secrets, encryption);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    if (seededUserIds.length) {
      await secrets.delete({ user_id: In(seededUserIds) });
      await users.delete(seededUserIds);
    }
    await dataSource.destroy();
  });

  /** Seed one user, optionally already holding an encrypted secret. */
  async function seedUser(opts: {
    mfaEnabled: boolean;
    storedSecret?: string;
  }): Promise<{ userId: string; storedSecret?: string }> {
    const user = await users.save(
      users.create({
        email: `mfa-reauth-${randomUUID()}@example.test`,
        password_hash: 'not-a-real-hash',
        first_name: 'Mfa',
        last_name: 'Reauth',
        is_active: true,
        is_mfa_enabled: opts.mfaEnabled,
      }),
    );
    seededUserIds.push(user.id);

    if (opts.storedSecret) {
      await secrets.save(
        secrets.create({
          user_id: user.id,
          secret: encryption.encrypt(opts.storedSecret),
        }),
      );
    }

    return { userId: user.id, storedSecret: opts.storedSecret };
  }

  /** SECOND READ: the ciphertext as it stands in the table right now. */
  async function readStoredCiphertext(userId: string): Promise<string | undefined> {
    const row = await secrets.findOne({ where: { user_id: userId } });
    return row?.secret;
  }

  /** SECOND READ: the flag as it stands in the table right now. */
  async function readMfaEnabled(userId: string): Promise<boolean> {
    const row = await users.findOne({ where: { id: userId } });
    return row?.is_mfa_enabled === true;
  }

  const currentCode = (secret: string): string =>
    speakeasy.totp({ secret, encoding: 'base32' });

  const codeAt = (secret: string, offsetSeconds: number): string =>
    speakeasy.totp({
      secret,
      encoding: 'base32',
      time: Math.floor(Date.now() / 1000) + offsetSeconds,
    });

  /**
   * A code that is definitely NOT valid for this secret right now: the window
   * accepts three specific values (±1 step), and the first six-digit string
   * outside that set is chosen deterministically.
   */
  function definitelyWrongCode(secret: string): string {
    const accepted = new Set([
      codeAt(secret, -30),
      currentCode(secret),
      codeAt(secret, 30),
    ]);
    for (let n = 0; n < 1000; n += 1) {
      const candidate = String(n).padStart(6, '0');
      if (!accepted.has(candidate)) return candidate;
    }
    throw new Error('no wrong code found');
  }

  describe('MFA already enabled', () => {
    it('refuses with no code and leaves the stored secret unchanged', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: true, storedSecret: seededSecret });
      const before = await readStoredCiphertext(userId);

      const result = await service.startEnrollment(userId);

      expect(result).toBeNull();
      expect(await readStoredCiphertext(userId)).toBe(before);
      expect(await readMfaEnabled(userId)).toBe(true);
    });

    it('refuses a wrong code and leaves the stored secret unchanged', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: true, storedSecret: seededSecret });
      const before = await readStoredCiphertext(userId);

      const result = await service.startEnrollment(
        userId,
        definitelyWrongCode(seededSecret),
      );

      expect(result).toBeNull();
      expect(await readStoredCiphertext(userId)).toBe(before);
      expect(await readMfaEnabled(userId)).toBe(true);
    });

    it('replaces the secret when the current code verifies', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: true, storedSecret: seededSecret });
      const before = await readStoredCiphertext(userId);

      const result = await service.startEnrollment(userId, currentCode(seededSecret));

      expect(result).not.toBeNull();
      const stored = await readStoredCiphertext(userId);
      expect(stored).not.toBe(before);
      // The stored row must be the NEW secret the caller was handed.
      expect(encryption.decrypt(stored as string)).toBe(result?.secret);
      expect(await readMfaEnabled(userId)).toBe(true);
    });

    it('accepts a code from inside the ±1 step window (existing verifyTotp semantics)', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: true, storedSecret: seededSecret });

      const result = await service.startEnrollment(userId, codeAt(seededSecret, -30));

      expect(result).not.toBeNull();
    });

    it('accepts the SAME code twice from verifyTotp (characterization, not a guarantee)', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: true, storedSecret: seededSecret });
      const code = currentCode(seededSecret);

      // Existing `verifyTotp` keeps no one-time-use record: the same current code
      // verifies repeatedly. This task deliberately did NOT add replay tracking,
      // and these two lines exist so that adding it becomes a deliberate change.
      expect(await service.verifyTotp(userId, code)).toBe(true);
      expect(await service.verifyTotp(userId, code)).toBe(true);

      // Within `startEnrollment` a replay is moot in any case: a successful call
      // ROTATES the secret, so the code that was just used no longer matches what
      // is stored afterwards.
      const rotated = await service.startEnrollment(userId, code);
      expect(rotated).not.toBeNull();
      // The secret was rotated: what is stored now is the NEW secret, and it is
      // not the one the just-used code was computed from.
      expect(
        encryption.decrypt((await readStoredCiphertext(userId)) as string),
      ).toBe(rotated?.secret);
      expect(rotated?.secret).not.toBe(seededSecret);
    });
  });

  describe('MFA not enabled (the ruled, accepted gap)', () => {
    it('enrolls with no code and stores a new secret without enabling MFA', async () => {
      const { userId } = await seedUser({ mfaEnabled: false });

      const result = await service.startEnrollment(userId);

      expect(result).not.toBeNull();
      const stored = await readStoredCiphertext(userId);
      expect(encryption.decrypt(stored as string)).toBe(result?.secret);
      // Enabling is `mfa-verify`'s job — enrollment only stores.
      expect(await readMfaEnabled(userId)).toBe(false);
    });

    it('replaces a stored-but-unverified secret with no code (reachable state: enrollment that never verified)', async () => {
      const seededSecret = speakeasy.generateSecret({ length: 20 }).base32;
      const { userId } = await seedUser({ mfaEnabled: false, storedSecret: seededSecret });
      const before = await readStoredCiphertext(userId);

      const result = await service.startEnrollment(userId);

      expect(result).not.toBeNull();
      expect(await readStoredCiphertext(userId)).not.toBe(before);
      expect(await readMfaEnabled(userId)).toBe(false);
    });
  });
});
