/**
 * Shared incremental-sync primitives for the built-in adapters (P5 — Increment 1).
 *
 * Two production patterns recur across every real provider, and they used to be
 * copy-pasted into each adapter. They live here now so every adapter shares one
 * tested implementation. These are *helpers*, not a second sync engine — an adapter
 * still returns a plain `SyncPage` and the orchestrator drives paging/cursoring
 * exactly as before; nothing in the engine changes.
 *
 *   • Conditional requests (ETag / If-None-Match). GitHub answers a resource whose
 *     head is unchanged with `304 Not Modified`, which costs NO primary-rate-limit
 *     budget. `conditionalGet` turns that 304 into a first-class "not modified"
 *     result so an adapter can skip re-walking an unchanged list instead of paying
 *     for it. (The transport already passes a 304 through untouched — it is neither
 *     an auth, rate-limit, nor 4xx/5xx error — so this composes with the existing
 *     `HttpClient`.)
 *
 *   • Delta/sync-token expiry. Providers that hand out an opaque incremental token
 *     (Microsoft Graph `@odata.deltaLink`, Google Calendar `syncToken`, Gmail
 *     `historyId`) reject an expired one with `410 Gone` (or `404`). `isExpiredCursorError`
 *     is the shared predicate an adapter uses to fall back to a bounded full resync
 *     exactly once, replacing the hand-rolled `err instanceof HttpError && err.status === 410`
 *     check that previously lived in entra.ts and googleCalendar.ts.
 */
import { HttpError, type HttpClient, type HttpRequestOptions } from '../http';

/** Result of a conditional GET. `notModified` is true when the server answered `304`. */
export interface ConditionalResult<T> {
  notModified: boolean;
  status: number;
  /** Parsed body, or `null` on a 304 (no body) / empty response. */
  data: T | null;
  /** The validator to persist for next time — the response `ETag` on a 200, the one we sent on a 304. */
  etag: string | null;
  headers: Record<string, string>;
}

/**
 * GET `url`, sending `If-None-Match: <etag>` when `etag` is set. A `304 Not Modified`
 * comes back as `{ notModified: true, data: null }` (and, on GitHub, costs no rate-limit
 * budget) rather than being mistaken for a genuinely empty result; any other 2xx returns
 * the parsed body plus the response `ETag` to persist for the next run.
 */
export async function conditionalGet<T>(
  http: HttpClient,
  url: string,
  etag: string | null | undefined,
  opts?: HttpRequestOptions,
): Promise<ConditionalResult<T>> {
  const headers = { ...(opts?.headers ?? {}), ...(etag ? { 'If-None-Match': etag } : {}) };
  const resp = await http.getJson<T>(url, { ...opts, headers });
  if (resp.status === 304) {
    return { notModified: true, status: 304, data: null, etag: etag ?? null, headers: resp.headers };
  }
  return {
    notModified: false,
    status: resp.status,
    data: resp.data,
    etag: resp.headers['etag'] ?? null,
    headers: resp.headers,
  };
}

/**
 * True when `err` means an incremental (delta / sync) token was rejected as expired and the
 * resource must fall back to a full resync. Microsoft Graph delta and Google Calendar `syncToken`
 * signal this with `410 Gone`; Gmail's `historyId` signals it with `404 Not Found`. Pass the exact
 * status(es) a provider uses — defaults to `[410]`, the common case, so existing callers keep their
 * precise behavior.
 */
export function isExpiredCursorError(err: unknown, statuses: readonly number[] = [410]): boolean {
  return err instanceof HttpError && statuses.includes(err.status);
}
