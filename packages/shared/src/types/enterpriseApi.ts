/**
 * Enterprise REST API — public request/response shapes (P3.0, Increment 1).
 *
 * These are the transport-neutral shapes of the production REST API. Every route
 * maps a REST request onto an EXISTING enterprise handler (records CRUD, search,
 * summaries, actions, graph, timeline, context, …) — there is no parallel business
 * logic. The gateway (auth / scope / rate / quota / version + audit) that the
 * Ecosystem Platform already ships is reused unchanged; this layer adds the route
 * table + dispatch + list envelope on top of it.
 *
 * Types-only, so the SDK, the OpenAPI generator (Increment 2), and the main-process
 * dispatcher all share one definition.
 */
import type { ApiScope, ApiVersion } from './ecosystem';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const API_METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** A public REST request routed through the enterprise gateway. */
export interface EnterpriseApiRequest {
  method: ApiMethod;
  /** Resource path under the version prefix, e.g. `/modules/finance-invoices/records`. */
  path: string;
  version?: ApiVersion;
  /** Bearer API key (the gateway resolves it to a developer + scopes). */
  apiKey?: string | null;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** The envelope every enterprise API response carries. */
export interface EnterpriseApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  /** Present on success. */
  data?: T;
  /** Present on failure — a clean, caller-safe message. */
  error?: string;
  /** Response headers (rate/quota/version), lower-cased keys. */
  headers: Record<string, string>;
}

/**
 * A page of list results. Offset/cursor pagination + sorting are applied by the API
 * layer over an existing list handler's array (presentation only — the handler still
 * owns retrieval + filtering).
 */
export interface ApiListPage<T = unknown> {
  data: T[];
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null;
  /** Total matching items before pagination. */
  total: number;
  /** The effective page size. */
  limit: number;
}

/** Standard list controls parsed from the query string. */
export interface ApiListControls {
  limit: number;
  cursor: string | null;
  /** Field to sort by (applied to the record's top-level or `fields.*`). */
  sort: string | null;
  order: 'asc' | 'desc';
}

/** A documented query-string parameter a route accepts. */
export interface ApiQueryParam {
  name: string;
  type: 'string' | 'integer' | 'boolean';
  description: string;
  enum?: string[];
}

/**
 * Static description of one route — drives the API index endpoint and the OpenAPI
 * generation in Increment 2. Kept free of any main-process/channel detail so it is
 * safe to expose publicly.
 */
export interface ApiRouteInfo {
  method: ApiMethod;
  /** Path template with `:params`, e.g. `/modules/:moduleId/records/:id`. */
  path: string;
  /** The API-key scope required to call it. */
  scope: ApiScope;
  /** One-line human summary. */
  summary: string;
  /** True when the success payload is an {@link ApiListPage}. */
  list: boolean;
  /** Query params this route reads (beyond the standard list controls). */
  query?: ApiQueryParam[];
}
