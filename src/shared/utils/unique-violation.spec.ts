import { UNIQUE_VIOLATION_CODE, isUniqueViolation } from './unique-violation';

/**
 * DEF-10: the shared `23505` detector.
 *
 * The seven service specs that used to host a private copy still pin their own
 * module's behaviour (a 409, an idempotent replay) and are unchanged. This file
 * pins the DETECTOR itself, including the one property the host specs never
 * exercised: which of the two candidate codes wins when an error carries both.
 */
describe('isUniqueViolation', () => {
  it('reads the SQLSTATE the driver hangs on the wrapped error (TypeORM shape)', () => {
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
  });

  it('also accepts an error carrying the code at the top level', () => {
    // The service specs' doubles use this simpler shape.
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('does not treat another SQLSTATE as a unique violation', () => {
    // 23503 is a foreign-key failure and 23514 a CHECK failure; both reach the
    // same catch blocks and must NOT be translated into a 409 or a replay.
    expect(isUniqueViolation({ driverError: { code: '23503' } })).toBe(false);
    expect(isUniqueViolation({ driverError: { code: '23514' } })).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('prefers driverError.code over a top-level code', () => {
    // The precedence the seven copies shared. The host specs exercise the two
    // candidates only in separate calls, so nothing there would notice the
    // order being swapped — and swapping it changes the answer in exactly these
    // two cases: a real SQLSTATE wins over a wrapper's code, never the reverse.
    expect(isUniqueViolation({ code: '23503', driverError: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23505', driverError: { code: '23503' } })).toBe(false);
  });

  it('is false for anything that is not a coded error', () => {
    // A non-object, a bare string, and an error object with no code at all all
    // reach the callers' catch blocks too.
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
    expect(isUniqueViolation({ driverError: {} })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });

  it('names the SQLSTATE it detects', () => {
    expect(UNIQUE_VIOLATION_CODE).toBe('23505');
  });
});
