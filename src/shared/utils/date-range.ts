/**
 * Date-range bound helpers shared by the API's list filters.
 *
 * List endpoints accept date-only bounds (`YYYY-MM-DD`) as well as full
 * timestamps. A date-only bound must be interpreted as a whole day: comparing
 * `to=2026-01-31` against a `timestamptz` column as midnight would silently
 * exclude everything that happened on the 31st.
 */

/** True for the `YYYY-MM-DD` form. */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Lower bound of a range: start of day for a date-only value. */
export function startOfRange(value: string): Date {
  const parsed = new Date(value);
  if (isDateOnly(value)) {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

/** Upper bound of a range: end of day for a date-only value. */
export function endOfRange(value: string): Date {
  const parsed = new Date(value);
  if (isDateOnly(value)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
}
