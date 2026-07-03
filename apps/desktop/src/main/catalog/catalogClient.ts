/**
 * Typed client for the NeuroPause Store API. Like the auth backend client, this
 * runs exclusively in the main process — the renderer never calls :4000. Public
 * catalog reads work anonymously; library/install endpoints attach the access
 * token from the auth service (refreshing transparently when needed).
 */
import type {
  CollectionDto,
  FeaturedEntry,
  InstallationDto,
  Paginated,
  ReleaseArtifact,
  ReviewDto,
  StoreAppCard,
  StoreAppDetail,
  StoreSearchParams,
  TagSummary,
  UpdateCheck,
  CategorySummary,
} from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';

export class CatalogError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
    this.code = code;
  }
}

interface RequestInit2 {
  method?: string;
  body?: unknown;
  /** When true, a valid access token is required (401 if unavailable). */
  auth?: boolean;
  query?: Record<string, string | number | boolean | string[] | undefined>;
}

function buildQuery(query?: RequestInit2['query']): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function storeRequest<T>(path: string, init: RequestInit2 = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  // Attach a token for authed calls (required) or opportunistically otherwise.
  const token = await authService.getValidAccessToken();
  if (init.auth && !token) {
    throw new CatalogError(401, 'not_authenticated', 'Sign in to continue.');
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${config.backendUrl}/store${path}${buildQuery(init.query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new CatalogError(0, 'network_error', (err as Error).message || 'Network request failed');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: { code?: string; message?: string } };
    throw new CatalogError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return json as T;
}

type Items<T> = { items: T[] };

export const catalogClient = {
  /* discovery */
  featured: () => storeRequest<Items<FeaturedEntry>>('/featured'),
  collections: () => storeRequest<Items<CollectionDto>>('/collections'),
  collection: (slug: string) => storeRequest<CollectionDto>(`/collections/${slug}`),
  sections: (key: string, page?: number, pageSize?: number) =>
    storeRequest<Paginated<StoreAppCard>>(`/sections/${key}`, { query: { page, pageSize } }),
  search: (params: StoreSearchParams) =>
    storeRequest<Paginated<StoreAppCard>>('/apps', {
      query: {
        q: params.q,
        category: params.category,
        tags: params.tags,
        pricing: params.pricing,
        type: params.type,
        openSource: params.openSource,
        verified: params.verified,
        sort: params.sort,
        page: params.page,
        pageSize: params.pageSize,
      },
    }),
  app: (slug: string) => storeRequest<StoreAppDetail>(`/apps/${slug}`),
  reviews: (slug: string, page?: number, pageSize?: number) =>
    storeRequest<Paginated<ReviewDto>>(`/apps/${slug}/reviews`, { query: { page, pageSize } }),
  developer: (slug: string) => storeRequest<unknown>(`/developers/${slug}`),
  categories: () => storeRequest<Items<CategorySummary>>('/categories'),
  tags: () => storeRequest<Items<TagSummary>>('/tags'),

  /* library (auth) */
  bookmarks: () => storeRequest<Items<StoreAppCard>>('/me/bookmarks', { auth: true }),
  addBookmark: (slug: string) =>
    storeRequest<{ bookmarked: boolean }>(`/apps/${slug}/bookmark`, { method: 'PUT', auth: true }),
  removeBookmark: (slug: string) =>
    storeRequest<{ bookmarked: boolean }>(`/apps/${slug}/bookmark`, {
      method: 'DELETE',
      auth: true,
    }),
  installations: () => storeRequest<Items<InstallationDto>>('/me/installations', { auth: true }),
  recentlyUsed: () => storeRequest<Items<InstallationDto>>('/me/recently-used', { auth: true }),
  recommendations: () => storeRequest<Items<StoreAppCard>>('/me/recommendations', { auth: true }),
  submitReview: (slug: string, body: { rating: number; title?: string; body?: string }) =>
    storeRequest<ReviewDto>(`/apps/${slug}/reviews`, { method: 'POST', body, auth: true }),

  /* install / launch / update (auth) — used by NPS + runtime */
  install: (
    slug: string,
    body: { channel?: string; grantedPermissions: string[]; installLocation?: string },
  ) =>
    storeRequest<{ installation: InstallationDto; artifact: ReleaseArtifact | null }>(
      `/apps/${slug}/install`,
      { method: 'POST', body, auth: true },
    ),
  uninstall: (slug: string) =>
    storeRequest<{ uninstalled: boolean }>(`/apps/${slug}/uninstall`, {
      method: 'POST',
      auth: true,
    }),
  recordLaunch: (installationId: string) =>
    storeRequest<InstallationDto>(`/installations/${installationId}/launch`, {
      method: 'POST',
      auth: true,
    }),
  checkUpdate: (slug: string) =>
    storeRequest<UpdateCheck>(`/apps/${slug}/updates`, { auth: true }),
  download: (slug: string, channel: string) =>
    storeRequest<ReleaseArtifact>(`/apps/${slug}/download`, {
      method: 'POST',
      body: { channel },
      auth: true,
    }),
};
