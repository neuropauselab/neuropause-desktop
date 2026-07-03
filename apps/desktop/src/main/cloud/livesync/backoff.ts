/**
 * Retry backoff and error classification for the sync engine. Pure and
 * deterministic so it is straightforward to unit-test; the scheduler layers timing
 * (and any jitter) on top.
 */

export interface BackoffOptions {
  baseMs: number;
  capMs: number;
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 1_000, capMs: 60_000, factor: 2 };

/** Exponential backoff for a 1-based attempt number; 0 for non-positive attempts. */
export function computeBackoff(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  if (attempt <= 0) return 0;
  const raw = opts.baseMs * Math.pow(opts.factor, attempt - 1);
  return Math.min(opts.capMs, Math.round(raw));
}

export type SyncErrorKind = 'network' | 'server' | 'client' | 'unknown';

function causeText(cause: unknown): string {
  if (!cause) return '';
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return '';
  }
}

/**
 * Classify an error to decide retry + offline behaviour. An explicit `kind:'network'`
 * or a transport failure with no HTTP status means the server was unreachable
 * (offline). A 5xx is a retryable server error; a 4xx is a client error that
 * retrying won't fix.
 */
export function classifyError(err: unknown): SyncErrorKind {
  const e = err as { status?: number; kind?: string; cause?: unknown };
  if (e?.kind === 'network') return 'network';
  if (typeof e?.status === 'number') {
    if (e.status >= 500) return 'server';
    if (e.status >= 400) return 'client';
    return 'unknown';
  }
  const text = `${err instanceof Error ? err.message : ''} ${causeText(e?.cause)}`.toLowerCase();
  if (/network|fetch failed|econnrefused|enotfound|etimedout|timeout|socket|offline/.test(text)) {
    return 'network';
  }
  return 'unknown';
}

/** Whether a sync should be retried after an error of this kind. */
export function isRetryable(kind: SyncErrorKind): boolean {
  return kind === 'network' || kind === 'server';
}
