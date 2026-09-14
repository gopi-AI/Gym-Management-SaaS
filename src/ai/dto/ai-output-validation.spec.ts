import {
  AiOutputValidationError,
  isPlainObject,
  readNumber,
  readString,
} from './ai-output-validation';

/**
 * The shared untrusted-output contract.
 *
 * Both AI use cases delegate here, so these are the container's strictest
 * guarantees: no type coercion, no out-of-range numbers, no empty required
 * prose, and always a single error type with the audit taxonomy code
 * (`AI_MALFORMED_RESPONSE`).
 */
describe('AI shared output-validation contract', () => {
  it('owns exactly one error class carrying the AI_MALFORMED_RESPONSE code', () => {
    const error = new AiOutputValidationError('bad output');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AiOutputValidationError');
    expect(error.code).toBe('AI_MALFORMED_RESPONSE');
  });

  it('isPlainObject accepts only non-null, non-array objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('{}')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
  });

  it('readNumber rejects non-numbers, non-finite values and out-of-range values', () => {
    expect(readNumber({ value: 0.5 }, 'value', 0, 1)).toBe(0.5);
    expect(readNumber({ value: 0 }, 'value', 0, 1)).toBe(0);
    expect(readNumber({ value: 1 }, 'value', 0, 1)).toBe(1);

    for (const value of ['0.5', 1.01, -0.01, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) {
      expect(() => readNumber({ value }, 'value', 0, 1)).toThrow(AiOutputValidationError);
    }
  });

  it('readString trims, bounds the length and rejects empty required text', () => {
    expect(readString({ s: '  hello  ' }, 's', 10)).toBe('hello');
    expect(readString({ s: 'abcdefghijklmno' }, 's', 5)).toBe('abcde');
    expect(readString({ s: '   ' }, 's', 10, true)).toBe('');
    expect(readString({ s: '' }, 's', 10, true)).toBe('');

    for (const value of ['', '   ', 42, null, undefined, ['a']]) {
      expect(() => readString({ s: value }, 's', 10)).toThrow(AiOutputValidationError);
    }
  });

  it('never leaks a raw value into the error message beyond the field name', () => {
    let message = '';
    try {
      readNumber({ summary: 'secret-content' }, 'summary', 0, 1);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('summary');
    expect(message).not.toContain('secret-content');
  });
});
