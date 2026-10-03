import { isIP } from 'net';

/**
 * `TRUST_PROXY` parsing (DEF-07 ruling Q5).
 *
 * Express's `trust proxy` setting decides what `req.ip` means, and every per-IP
 * throttle is keyed on it. Unset, Express trusts nothing and `req.ip` is the
 * socket address — which is correct for the shipped docker-compose shape, where
 * the API is exposed directly, and is what makes an `X-Forwarded-For` header
 * unable to reset a counter. Behind a reverse proxy the setting MUST be
 * configured, or every request carries the proxy's address and the per-IP limits
 * collapse into a single global limit.
 *
 * Accepted values:
 *   - unset / empty           -> trust nothing (`undefined`)
 *   - an integer `n`          -> trust the `n` closest hops
 *   - a comma-separated list  -> IPs, CIDR subnets, or Express's own keywords
 *     (`loopback`, `linklocal`, `uniquelocal`), passed through as an array
 *
 * Anything else throws, so a typo fails the boot (`validateEnv`) instead of
 * silently leaving the app trusting the wrong address.
 */
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

export function parseTrustProxy(raw: unknown): number | string[] | undefined {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (value === '') return undefined;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 0) throw new Error(`TRUST_PROXY hop count must not be negative (received "${value}").`);
    return hops;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  for (const part of parts) {
    if (KEYWORDS.has(part.toLowerCase())) continue;
    const [address, prefix, ...rest] = part.split('/');
    if (rest.length > 0) {
      throw new Error(`TRUST_PROXY entry "${part}" has more than one "/" — expected an IP or CIDR subnet.`);
    }
    const family = isIP(address);
    if (family === 0) {
      throw new Error(
        `TRUST_PROXY entry "${part}" is not an IP, a CIDR subnet, or one of ${[...KEYWORDS].join(', ')}.`,
      );
    }
    if (prefix !== undefined) {
      const max = family === 4 ? 32 : 128;
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits > max) {
        throw new Error(`TRUST_PROXY entry "${part}" has an invalid prefix (expected 0..${max}).`);
      }
    }
  }
  return parts;
}
