/**
 * Generic retryable JSON HTTP (V8.2 Part 1). Error-agnostic: callers inject a
 * `mapError` so each service (embedding, Qdrant, …) surfaces its own structured
 * error type while sharing one implementation of timeout + backoff. This is the
 * single retry/timeout primitive the semantic backend uses.
 *
 * (Follow-up: the increment-1 `embeddingHttp` predates this and should be migrated
 * to delegate here — noted in Known Limitations to keep increment 1 stable.)
 */
import type { FetchFn, HttpRequestInit } from '../embedding/embeddingTypes';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type HttpFailureKind = 'http' | 'timeout' | 'network';

export interface HttpPolicy {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
}

export interface HttpFailure {
  kind: HttpFailureKind;
  url: string;
  status?: number;
  detail?: string;
  cause?: unknown;
}

/** The mapped error must report whether it's retryable so the loop can decide. */
export interface RetryableError extends Error {
  retryable: boolean;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function httpJson<E extends RetryableError>(
  fetchFn: FetchFn,
  method: HttpMethod,
  url: string,
  body: unknown | undefined,
  headers: Record<string, string>,
  policy: HttpPolicy,
  mapError: (failure: HttpFailure) => E,
): Promise<unknown> {
  let lastError: E | undefined;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const hasBody = method !== 'GET';
      const init = {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        // undici forbids a body on GET — only include it for methods that carry one.
        ...(hasBody ? { body: body === undefined ? '' : JSON.stringify(body) } : {}),
        signal: controller.signal,
      } as unknown as HttpRequestInit;
      const res = await fetchFn(url, init);
      if (!res.ok) {
        const detail = await safeText(res);
        throw mapError({ kind: 'http', url, status: res.status, detail });
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      lastError = normalize(err, url, mapError);
      if (!lastError.retryable || attempt === policy.retries) throw lastError;
      await delay(policy.backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? mapError({ kind: 'network', url, detail: 'unknown failure' });
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function normalize<E extends RetryableError>(
  err: unknown,
  url: string,
  mapError: (failure: HttpFailure) => E,
): E {
  // Already a mapped error from the !res.ok path.
  if (err instanceof Error && 'retryable' in err) return err as E;
  const e = err as { name?: string; message?: string } | undefined;
  if (e?.name === 'AbortError') return mapError({ kind: 'timeout', url, cause: err });
  return mapError({ kind: 'network', url, detail: e?.message, cause: err });
}
