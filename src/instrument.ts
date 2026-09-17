/**
 * Sentry bootstrapping.
 *
 * IMPORTANT: This module must be imported FIRST in `main.ts` so Sentry's
 * auto-instrumentation patches every subsequent module load.
 *
 * It is intentionally tolerant of a missing `SENTRY_DSN`: when unset, Sentry
 * is not initialized and the application runs normally (every call to the SDK becomes a
 * no-op). See `.env.example` — the DSN is a secret and must never be committed.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn && dsn.length > 0) {
  Sentry.init({
    dsn,
    // Environment may be unset locally; defaulting to "development" keeps local
    // runs out of any production Sentry project.
    environment: process.env.NODE_ENV ?? 'development',
    // Sentry's built-in PII scrubbing (enabled by default) strips common
    // sensitive patterns (credit-card numbers, emails, auth headers) before sending.
    // This app additionally carries member health/measurement and payment data, so we
    // leave default scrubbing ON and do not add any keys that would re-introduce
    // those fields.
    sendDefaultPii: false,
  });
} else {
  // No DSN configured — Sentry stays disabled. This is the expected quiet path for
  // local development and CI (see .env.example for where to obtain a DSN).
  // Logging is not available here because we're outside the Nest lifecycle; a
  // clear message is emitted via the bootstrap logger in main.ts instead.
}
