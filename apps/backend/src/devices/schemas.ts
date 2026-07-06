/**
 * Request body schemas for the devices API, validated via the shared
 * validateBody middleware (same pattern as organizations/schemas.ts).
 */
import { z } from 'zod';

export const RegisterDeviceBody = z
  .object({
    orgId: z.string().uuid(),
    deviceId: z.string().min(1).max(200),
    name: z.string().min(1).max(120),
    platform: z.string().min(1).max(40),
    os: z.string().min(1).max(40),
    arch: z.string().min(1).max(40),
    appVersion: z.string().min(1).max(40),
  })
  .strict();

export const HeartbeatBody = z
  .object({
    orgId: z.string().uuid(),
    appVersion: z.string().min(1).max(40),
  })
  .strict();

export const OrgScopeBody = z.object({ orgId: z.string().uuid() }).strict();
