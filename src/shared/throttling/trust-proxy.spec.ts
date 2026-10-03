import { parseTrustProxy } from './trust-proxy';

/**
 * DEF-07 Q5. `TRUST_PROXY` decides what `req.ip` means, and every per-IP
 * throttle is keyed on it, so both directions matter: unset must mean "trust
 * nothing" (an `X-Forwarded-For` header cannot then reset a counter), and a
 * malformed value must fail the boot rather than be ignored.
 */
describe('parseTrustProxy', () => {
  it.each([undefined, null, '', '   '])('trusts nothing for %p', (raw) => {
    expect(parseTrustProxy(raw)).toBeUndefined();
  });

  it.each([
    ['1', 1],
    ['3', 3],
  ])('parses the hop count %s', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });

  it('parses a comma-separated subnet list, trimming each entry', () => {
    expect(parseTrustProxy('127.0.0.1, 10.0.0.0/8 ,192.168.0.0/16')).toEqual([
      '127.0.0.1',
      '10.0.0.0/8',
      '192.168.0.0/16',
    ]);
  });

  it('accepts IPv6 addresses and subnets', () => {
    expect(parseTrustProxy('::1,fd00::/8')).toEqual(['::1', 'fd00::/8']);
  });

  it('accepts the Express keywords', () => {
    expect(parseTrustProxy('loopback,linklocal,uniquelocal')).toEqual([
      'loopback',
      'linklocal',
      'uniquelocal',
    ]);
  });

  it.each([
    ['nope'],
    ['999.1.1.1'],
    ['10.0.0.0/33'],
    ['fd00::/129'],
    ['1.2.3.4/8/9'],
    ['10.0.0.0/'],
  ])('rejects the malformed value %s', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow();
  });
});
