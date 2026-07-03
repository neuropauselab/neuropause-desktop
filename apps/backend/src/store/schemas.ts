import { z } from 'zod';
import { PERMISSION_KEYS } from '@neuropause/shared';

/** Coerce common truthy/falsy query-string spellings into a boolean. */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const appType = z.enum([
  'web',
  'desktop_plugin',
  'electron',
  'native',
  'ai_agent',
  'mcp_server',
  'automation',
]);

const pricingKind = z.enum(['free', 'freemium', 'paid', 'subscription', 'enterprise']);

const sort = z.enum([
  'relevance',
  'trending',
  'installs',
  'rating',
  'newest',
  'updated',
  'name',
]);

/** GET /store/apps — advanced search, filters, sorting, pagination. */
export const SearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(64).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    ),
  pricing: pricingKind.optional(),
  type: appType.optional(),
  openSource: boolish.optional(),
  verified: boolish.optional(),
  sort: sort.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** Shared pagination for reviews and other list endpoints. */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** POST /store/apps/:slug/reviews */
export const ReviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).optional(),
});
export type ReviewBody = z.infer<typeof ReviewBodySchema>;

/** POST /store/apps/:slug/install */
export const InstallBodySchema = z.object({
  channel: z.string().trim().max(32).default('stable'),
  grantedPermissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).default([]),
  installLocation: z.string().trim().max(512).optional(),
});
export type InstallBody = z.infer<typeof InstallBodySchema>;

/** POST /store/apps/:slug/download */
export const DownloadBodySchema = z.object({
  channel: z.string().trim().max(32).default('stable'),
});
export type DownloadBody = z.infer<typeof DownloadBodySchema>;
