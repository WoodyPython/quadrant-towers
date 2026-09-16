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
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173',
    )
    .transform((s) => s.split(',').map((s) => s.trim()))
    .pipe(
      z
        .array(
          z.url().refine((s) => {
            try {
              const u = new URL(s);
              return ['http:', 'https:'].includes(u.protocol) && u.origin === s;
            } catch {
              return false;
            }
          }),
        )
        .min(1),
    ),
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
