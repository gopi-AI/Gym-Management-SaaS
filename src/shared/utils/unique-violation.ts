/**
 * DEF-10: the one `23505` (unique-constraint violation) detector.
 *
 * TypeORM surfaces a Postgres unique violation as a `QueryFailedError` whose
 * SQLSTATE rides on `driverError.code`; the plain `{ code }` shape is what the
 * service specs and the driver's own error type hand in. Seven services each
 * carried a private copy of this test — the same two-line body with a local
 * `UNIQUE_VIOLATION_CODE` constant, differing only in formatting — because the
 * original six were deferred out of the `DEF-02` fix as a cross-module refactor.
 * This is that test, in one place.
 *
 * What a `23505` MEANS is deliberately not this helper's business. Every caller
 * already knows which index its own statement can collide on, and each maps the
 * violation to its own outcome — a module's own 409, or an idempotent replay of
 * the row the winner wrote. This answers only "was this a unique-constraint
 * violation at all", so that no caller has to re-derive it.
 */

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
export const UNIQUE_VIOLATION_CODE = '23505';

/**
 * True when `error` is a Postgres unique-constraint violation.
 *
 * `driverError.code` is read FIRST and wins whenever it is present: it is the
 * driver's own SQLSTATE, while a top-level `code` is the fallback for shapes
 * that carry only that (the service specs' simpler doubles). Reading them the
 * other way round would answer with a wrapper's code rather than the database's
 * whenever the two disagree.
 */
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; driverError?: { code?: string } };
  return (candidate?.driverError?.code ?? candidate?.code) === UNIQUE_VIOLATION_CODE;
}
