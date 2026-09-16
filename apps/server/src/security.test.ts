import type { IncomingMessage } from 'node:http';
import { expect, it } from 'vitest';
import { clientIp, RateLimiter } from './security.js';

it('refills rejected buckets and bounds memory without resetting attacker limits', () => {
  const limits = new RateLimiter(2);
  expect(limits.allow('a', 60, 1, 0)).toBe(true);
  expect(limits.allow('a', 60, 1, 500)).toBe(false);
  expect(limits.allow('a', 60, 1, 1000)).toBe(true);
  expect(limits.allow('b', 60, 1, 1000)).toBe(true);
  expect(limits.allow('c', 60, 1, 1000)).toBe(false);
  expect(limits.allow('c', 60, 1, 122000)).toBe(true);
});
it('ignores forged forwarding headers unless explicitly configured for Railway', () => {
  const request = {
    headers: { 'x-real-ip': '203.0.113.4', 'x-forwarded-for': '198.51.100.9' },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
  } as unknown as IncomingMessage;
  expect(clientIp(request, false)).toBe('127.0.0.1');
  expect(clientIp(request, true)).toBe('203.0.113.4');
  request.headers['x-real-ip'] = '203.0.113.4, 198.51.100.9';
  expect(clientIp(request, true)).toBe('127.0.0.1');
});
