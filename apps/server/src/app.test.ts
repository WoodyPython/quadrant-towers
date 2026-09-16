import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthSchema, versionSchema } from '@quadrant/protocol';
import { buildApp } from './app.js';
import { parseEnvironment } from './env.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(ready = async () => true) {
  const closeDatabase = vi.fn(async () => {});
  const app = await buildApp({
    environment: parseEnvironment({
      DATABASE_URL: 'postgres://localhost/test',
      LOG_LEVEL: 'silent',
      BUILD_ID: 'test-build',
    }),
    ready,
    closeDatabase,
  });
  apps.push(app);
  return { app, closeDatabase };
}
describe('service API', () => {
  it('returns validated health and version responses', async () => {
    const { app } = await setup();
    for (const url of ['/health/live', '/health/ready']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(healthSchema.parse(response.json())).toEqual({ status: 'ok' });
    }
    expect(
      versionSchema.parse((await app.inject('/api/version')).json()),
    ).toEqual({ buildId: 'test-build', protocolVersion: 1 });
  });
  it.each([
    async () => false,
    async () => {
      throw new Error('postgres://secret');
    },
  ])('keeps liveness up when readiness fails', async (ready) => {
    const { app } = await setup(ready);
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
  it('returns safe JSON errors', async () => {
    const { app } = await setup();
    app.get('/fail', () => {
      throw new Error('private credential');
    });
    const failed = await app.inject('/fail');
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('private credential');
    const missing = await app.inject({
      url: '/api/missing',
      headers: { accept: 'text/html' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');
  });
  it('closes the database when the server closes', async () => {
    const { app, closeDatabase } = await setup();
    await app.ready();
    await app.close();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});
