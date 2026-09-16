import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const versionSchema = z.object({
  buildId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});
export const healthSchema = z.object({ status: z.enum(['ok', 'unavailable']) });
export type ServiceVersion = z.infer<typeof versionSchema>;
