/**
 * Small shared helpers for the built-in adapters: timestamp conversions, GitHub
 * Link-header paging detection, a typed JSON cursor codec (adapters encode their
 * own pagination + incremental state in the opaque cursor string), and text
 * trimming for titles/bodies.
 */

export function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function firstLine(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return truncate(line, max) ?? '';
}

/** True if a GitHub `Link` header advertises a next page. */
export function hasNextLink(linkHeader: string | undefined): boolean {
  return !!linkHeader && /rel="next"/.test(linkHeader);
}

/** Slack `ts` ("1609459200.000400") → ISO. */
export function slackTsToIso(ts: string | undefined): string {
  const seconds = ts ? Number.parseFloat(ts) : 0;
  return new Date((Number.isFinite(seconds) ? seconds : 0) * 1000).toISOString();
}

/** Unix seconds → ISO. */
export function unixToIso(seconds: number | undefined): string {
  return new Date((seconds ?? 0) * 1000).toISOString();
}

export function parseJsonCursor<T>(cursor: string | null): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(cursor) as T;
  } catch {
    return null;
  }
}

export function toJsonCursor(value: unknown): string {
  return JSON.stringify(value);
}

/** Pick the later of two ISO strings (either may be null). */
export function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
