import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** Enable only behind Railway's HTTP edge, never a public TCP proxy. */
export function clientIp(request: IncomingMessage, railway: boolean): string {
  const address = railway ? request.headers['x-real-ip'] : undefined;
  const ip =
    typeof address === 'string' && isIP(address)
      ? address
      : (request.socket.remoteAddress ?? 'unknown');
  return ip.replace(/^::ffff:/, '');
}

/** Bounded token buckets. At capacity, reject new keys rather than evicting limits. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private swept = 0;
  constructor(private readonly maxKeys = 20_000) {}
  allow(key: string, perMinute: number, burst: number, now = Date.now()) {
    if (now - this.swept >= 60_000) {
      for (const [key, bucket] of this.buckets)
        if (now - bucket.at >= 120_000) this.buckets.delete(key);
      this.swept = now;
    }
    const previous = this.buckets.get(key);
    if (!previous && this.buckets.size >= this.maxKeys) return false;
    const tokens = previous
      ? Math.min(
          burst,
          previous.tokens +
            (Math.max(0, now - previous.at) * perMinute) / 60_000,
        )
      : burst;
    this.buckets.set(key, {
      tokens: tokens >= 1 ? tokens - 1 : tokens,
      at: now,
    });
    return tokens >= 1;
  }
}

export function securityHeaders(production: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
