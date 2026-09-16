import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import {
  PROTOCOL_VERSION,
  healthSchema,
  versionSchema,
} from '@quadrant/protocol';
import type { Environment } from './env.js';

interface AppOptions {
  environment: Environment;
  ready: () => Promise<boolean>;
  closeDatabase: () => Promise<void>;
  staticRoot?: string;
}

export async function buildApp(options: AppOptions) {
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
  app.get('/health/live', async () => healthSchema.parse({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    let ready = false;
    try {
      ready = await options.ready();
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
      !/^\/(api|health|assets)(\/|$)/.test(path) &&
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
