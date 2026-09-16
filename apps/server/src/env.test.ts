import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env.js';

const base = { DATABASE_URL: 'postgresql://user:secret@localhost/test' };
describe('environment validation', () => {
  it('requires explicit HTTPS origins and rate limits in production', () => {
    expect(() => parseEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(
      'ALLOWED_ORIGINS',
    );
    expect(() =>
      parseEnvironment({
        ...base,
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow('ALLOWED_ORIGINS');
    expect(
      parseEnvironment({
        ...base,
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://game.example',
      }).RATE_LIMITS,
    ).toBe(true);
  });
  it('uses defaults and coerces a valid port', () => {
    expect(parseEnvironment({ ...base, PORT: '4000' })).toMatchObject({
      PORT: 4000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
    });
  });
  it.each([
    { DATABASE_URL: 'https://example.com' },
    { DATABASE_URL: 'not a URL' },
    { DATABASE_URL: 'postgresql:///database' },
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: 'no' },
    { NODE_ENV: 'preview' },
    { LOG_LEVEL: 'verbose' },
    { HOST: '' },
    { BUILD_ID: '' },
    { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'https://example.com/path' },
    { ALLOWED_ORIGINS: 'https://example.com,' },
  ])('rejects invalid configuration %j', (invalid) => {
    expect(() => parseEnvironment({ ...base, ...invalid })).toThrow(
      'Invalid environment variables',
    );
  });
  it('requires a database URL and never prints its contents', () => {
    expect(() => parseEnvironment({})).toThrow('DATABASE_URL');
    expect(() => parseEnvironment({ DATABASE_URL: 'invalid:secret' })).toThrow(
      /^Invalid environment variables: DATABASE_URL$/,
    );
  });
});
