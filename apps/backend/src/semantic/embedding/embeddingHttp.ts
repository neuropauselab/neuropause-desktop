/**
 * Shared HTTP execution for embedding providers (V8.2 Part 1): one place for
 * timeout, retry-with-backoff, and mapping every failure onto a structured
 * {@link EmbeddingError}. Providers call `postJson` and never deal with raw
 * fetch/AbortController or untyped throws.
 */
import { EmbeddingError, type FetchFn, type HttpRequestInit } from './embeddingTypes';

export interface RequestPolicy {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * POST JSON with a per-attempt timeout and exponential backoff on retryable
 * failures (network/timeout, and 429/5xx). Non-retryable provider errors (4xx)
 * fail fast. Returns the parsed JSON body.
 */
export async function postJson(
  fetchFn: FetchFn,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  policy: RequestPolicy,
): Promise<unknown> {
  let lastError: EmbeddingError | undefined;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const init: HttpRequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      const res = await fetchFn(url, init);
      if (!res.ok) {
        const detail = await safeText(res);
        const retryable = res.status === 429 || res.status >= 500;
        throw new EmbeddingError('provider_error', `HTTP ${res.status} from ${url}: ${detail}`, {
          status: res.status,
          retryable,
        });
      }
      return await res.json();
    } catch (err) {
      lastError = toEmbeddingError(err, url);
      if (!lastError.retryable || attempt === policy.retries) throw lastError;
      await delay(policy.backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw lastError ?? new EmbeddingError('provider_error', `Request to ${url} failed`);
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function toEmbeddingError(err: unknown, url: string): EmbeddingError {
  if (err instanceof EmbeddingError) return err;
  const e = err as { name?: string; message?: string } | undefined;
  if (e?.name === 'AbortError') {
    return new EmbeddingError('provider_timeout', `Request to ${url} timed out`, { cause: err, retryable: true });
  }
  return new EmbeddingError('provider_unavailable', `Request to ${url} failed: ${e?.message ?? 'network error'}`, {
    cause: err,
    retryable: true,
  });
}
