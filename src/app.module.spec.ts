import { validateEnv } from './app.module';

describe('validateEnv — production configuration guard', () => {
  // Baseline production config that should always pass (all required secrets set).
  const validProduction = (overrides: Record<string, unknown> = {}) =>
    validateEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-very-secure-secret-not-the-dev-default',
      JWT_REFRESH_SECRET: 'another-secure-secret-not-the-dev-default',
      MFA_ENCRYPTION_KEY: 'secure-base64-key-for-mfa-encryption-here',
      ...overrides,
    });

  describe('core secrets', () => {
    it('passes with all required production secrets set', () => {
      const result = validProduction();
      expect(result.NODE_ENV).toBe('production');
    });

    it('rejects missing JWT_SECRET', () => {
      expect(() =>
        validateEnv({ NODE_ENV: 'production' }),
      ).toThrow(/JWT_SECRET.*must be set/);
    });

    it('rejects dev-default JWT_SECRET', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev-secret-change-me',
        }),
      ).toThrow(/JWT_SECRET.*must be set/);
    });

    it('rejects missing JWT_REFRESH_SECRET', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'real-secret',
        }),
      ).toThrow(/JWT_REFRESH_SECRET.*must be set/);
    });

    it('rejects missing MFA_ENCRYPTION_KEY', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'real-secret',
          JWT_REFRESH_SECRET: 'real-refresh-secret',
        }),
      ).toThrow(/MFA_ENCRYPTION_KEY.*must be set/);
    });
  });

  describe('AI production guards (AI_ENABLED=true)', () => {
    describe('AI_PROVIDER=mock is rejected', () => {
      it('throws when AI_PROVIDER is exactly "mock"', () => {
        expect(() =>
          validProduction({ AI_ENABLED: 'true', AI_PROVIDER: 'mock' }),
        ).toThrow(/AI_PROVIDER=mock must not be used in production/);
      });

      it('throws for case-insensitive variants', () => {
        expect(() =>
          validProduction({ AI_ENABLED: 'true', AI_PROVIDER: 'Mock' }),
        ).toThrow(/AI_PROVIDER=mock must not be used in production/);
      });

      it('throws for whitespace-padded "mock"', () => {
        expect(() =>
          validProduction({ AI_ENABLED: 'true', AI_PROVIDER: '  mock  ' }),
        ).toThrow(/AI_PROVIDER=mock must not be used in production/);
      });
    });

    describe('AI_PROVIDER=openai requires an API key', () => {
      it('rejects missing AI_API_KEY', () => {
        expect(() =>
          validProduction({
            AI_ENABLED: 'true',
            AI_PROVIDER: 'openai',
          }),
        ).toThrow(/AI_API_KEY must be set.*AI_ENABLED=true.*AI_PROVIDER=openai/);
      });

      it('passes with a real key', () => {
        const result = validProduction({
          AI_ENABLED: 'true',
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'sk-real-key',
        });
        expect(result).toBeDefined();
      });
    });

    describe('cost-limit enforceability (unpriceable model)', () => {
      it('rejects an unpriced model with a positive cost limit', () => {
        expect(() =>
          validProduction({
            AI_ENABLED: 'true',
            AI_PROVIDER: 'openai',
            AI_API_KEY: 'sk-real-key',
            AI_MODEL: 'unknown-gpt-x',
            AI_COST_LIMIT_MONTHLY_USD: '50',
          }),
        ).toThrow(/has no server-side price.*AI_COST_LIMIT_MONTHLY_USD/);
      });

      it('passes when cost limit is explicitly 0 (disabled)', () => {
        // Operator accepts the risk — the unpriced model can run.
        const result = validProduction({
          AI_ENABLED: 'true',
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'sk-real-key',
          AI_MODEL: 'unknown-gpt-x',
          AI_COST_LIMIT_MONTHLY_USD: '0',
        });
        expect(result.NODE_ENV).toBe('production');
      });

      it('passes for a priced model with valid cost limit', () => {
        const result = validProduction({
          AI_ENABLED: 'true',
          AI_PROVIDER: 'openai',
          AI_API_KEY: 'sk-real-key',
          AI_MODEL: 'gpt-4o',
          AI_COST_LIMIT_MONTHLY_USD: '50',
        });
        expect(result.NODE_ENV).toBe('production');
      });
    });

    it('does not validate AI config when AI_ENABLED is not "true"', () => {
      // Missing AI_API_KEY should NOT throw when AI is disabled.
      expect(() =>
        validProduction({ AI_ENABLED: 'false' }),
      ).not.toThrow();
    });
  });

  describe('non-production environments are not blocked', () => {
    it('passes for development with no secrets', () => {
      const result = validateEnv({
        NODE_ENV: 'development',
      });
      expect(result.NODE_ENV).toBe('development');
    });

    it('passes for test', () => {
      const result = validateEnv({
        NODE_ENV: 'test',
      });
      expect(result.NODE_ENV).toBe('test');
    });
  });
});