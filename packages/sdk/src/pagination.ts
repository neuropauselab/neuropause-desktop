/**
 * Pagination + streaming helpers (P3.0, Increment 5).
 *
 * List endpoints return an `ApiListPage<T>` with a `nextCursor`. `paginate` turns a
 * page-fetching closure into an async iterator over items (transparently following
 * the cursor); `collect` drains it into an array. `stream` is an alias that makes the
 * "stream every record" intent explicit.
 */
import type { ApiListPage } from '@neuropause/shared';

export type PageFetcher<T> = (cursor: string | null) => Promise<ApiListPage<T>>;

/** Iterate every item across all pages, following `nextCursor`. */
export async function* paginate<T>(fetchPage: PageFetcher<T>): AsyncGenerator<T, void, unknown> {
  let cursor: string | null = null;
  let guard = 0;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.data) yield item;
    cursor = page.nextCursor;
    guard += 1;
    if (guard > 100_000) break; // safety valve against a misbehaving cursor
  } while (cursor);
}

/** Drain every page into a single array. */
export async function collect<T>(fetchPage: PageFetcher<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of paginate(fetchPage)) out.push(item);
  return out;
}

/** Alias for {@link paginate} — reads as "stream every record". */
export const stream = paginate;
