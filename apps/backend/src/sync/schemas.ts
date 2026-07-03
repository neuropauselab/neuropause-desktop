import { z } from 'zod';

const SyncEntityTypeSchema = z.enum([
  'organization',
  'membership',
  'workspace_settings',
  'connected_account',
  'connector_config',
  'org_prefs',
]);

const SyncChangeSchema = z.object({
  entityType: SyncEntityTypeSchema,
  entityId: z.string().min(1).max(256),
  orgId: z.string(), // present in the shape; overridden to the route org server-side
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  deleted: z.boolean(),
  data: z.unknown(),
});

export const SyncPushBody = z.object({
  deviceId: z.string().min(1).max(128),
  changes: z.array(SyncChangeSchema).max(500),
});

export const SyncPullQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  deviceId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /** Comma-separated entity types; parsed and filtered in the handler. */
  entityTypes: z.string().optional(),
});
