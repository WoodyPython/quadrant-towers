import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname.length > 0
      );
    } catch {
      return false;
    }
  }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  BUILD_ID: z.string().trim().min(1).max(128).default('local'),
});

export function parseEnvironment(input: Record<string, unknown>) {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  }
  return result.data;
}
export type Environment = ReturnType<typeof parseEnvironment>;
