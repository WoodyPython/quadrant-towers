import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import {
  PROTOCOL_VERSION,
  healthSchema,
  versionSchema,
} from '@quadrant/protocol';
import type { Environment } from './env.js';
import { Multiplayer, type Clock } from './multiplayer/server.js';
import type { Store } from './multiplayer/store.js';
import { clientIp, RateLimiter, securityHeaders } from './security.js';

interface AppOptions {
  environment: Environment;
  ready: () => Promise<boolean>;
  closeDatabase: () => Promise<void>;
  staticRoot?: string;
  store?: Store;
  clock?: Clock;
}

export async function buildApp(options: AppOptions) {
  const limits = new RateLimiter();
  const app = Fastify({
    logger: {
      level: options.environment.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url.split('?')[0] ?? '/',
          remoteAddress: request.ip,
        }),
      },
    },
    genReqId: () => randomUUID(),
  });
  app.addHook('onClose', options.closeDatabase);
  app.addHook('onRequest', async (request, reply) => {
    reply.headers(
      securityHeaders(options.environment.NODE_ENV === 'production'),
    );
    if (!request.url.startsWith('/assets/'))
      reply.header('Cache-Control', 'no-store');
    if (
      !request.url.startsWith('/health/') &&
      options.environment.RATE_LIMITS &&
      !limits.allow(
        clientIp(request.raw, options.environment.TRUST_RAILWAY_PROXY),
        600,
        120,
      )
    ) {
      return reply.code(429).header('Retry-After', '1').send({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Wait a moment and try again.',
      });
    }
  });
  const multiplayer = options.store
    ? new Multiplayer({
        httpServer: app.server,
        store: options.store,
        origins: options.environment.ALLOWED_ORIGINS,
        rateLimits: options.environment.RATE_LIMITS,
        railwayProxy: options.environment.TRUST_RAILWAY_PROXY,
        ...(options.clock ? { clock: options.clock } : {}),
        log: (fields, message) => app.log.info(fields, message),
      })
    : undefined;
  if (multiplayer) {
    app.addHook('onReady', async () => {
      if (await options.ready()) await multiplayer.recover();
    });
    // Close upgraded connections before Fastify waits for HTTP connections to drain.
    app.addHook('preClose', async () => multiplayer.close());
  }
  app.get('/health/live', async () => healthSchema.parse({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    let ready = false;
    try {
      ready = (await options.ready()) && (!multiplayer || multiplayer.ready());
    } catch {
      /* Report only safe availability status. */
    }
    return reply
      .code(ready ? 200 : 503)
      .send(healthSchema.parse({ status: ready ? 'ok' : 'unavailable' }));
  });
  app.get('/api/version', async () =>
    versionSchema.parse({
      buildId: options.environment.BUILD_ID,
      protocolVersion: PROTOCOL_VERSION,
    }),
  );
  app.setErrorHandler((_error, request, reply) => {
    request.log.error({ requestId: request.id }, 'Request failed');
    void reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'The service could not complete this request.',
    });
  });
  if (options.staticRoot)
    await app.register(staticFiles, {
      root: options.staticRoot,
      wildcard: false,
    });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (
      options.staticRoot &&
      request.method === 'GET' &&
      !/^\/(api|health|assets|socket\.io)(\/|$)/.test(path) &&
      request.headers.accept?.includes('text/html')
    ) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(404)
      .send({ code: 'NOT_FOUND', message: 'Route not found.' });
  });
  return app;
}
