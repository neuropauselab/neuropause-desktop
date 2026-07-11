/**
 * Pure routing + list presentation for the Enterprise REST API (P3.0).
 *
 * Path-pattern matching (`/modules/:moduleId/records/:id`), list controls parsing
 * (limit / cursor / sort / order), and cursor pagination + sorting applied over an
 * existing list handler's array. All pure — no I/O, no singletons — so it unit-tests
 * directly. Pagination/sorting are presentation only: the handler still owns
 * retrieval and filtering.
 */
import type { ApiListControls, ApiListPage } from '@neuropause/shared';
import type { ApiRoute, RouteContext } from './types';

/** Strip a query string + trailing slash and guarantee a leading slash. */
export function normalizePath(p: string): string {
  let s = (p.split('?')[0] ?? '').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const ap = path.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i += 1) {
    const seg = pp[i];
    if (seg.startsWith(':')) {
      let v: string;
      try {
        v = decodeURIComponent(ap[i]);
      } catch {
        v = ap[i];
      }
      if (!v) return null;
      params[seg.slice(1)] = v;
    } else if (seg !== ap[i]) {
      return null;
    }
  }
  return params;
}

/** Match a method+path against the route table. Pure. */
export function matchRoute(
  routes: ApiRoute[],
  method: string,
  rawPath: string,
): { route: ApiRoute; params: Record<string, string> } | null {
  const path = normalizePath(rawPath);
  const m = method.toUpperCase();
  for (const route of routes) {
    if (route.method !== m) continue;
    const params = matchPattern(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export function parseListControls(
  query: Record<string, string | number | boolean | undefined>,
): ApiListControls {
  return {
    limit: clampInt(query.limit, 1, 200, 50),
    cursor: typeof query.cursor === 'string' && query.cursor ? query.cursor : null,
    sort: typeof query.sort === 'string' && query.sort ? query.sort : null,
    order: query.order === 'asc' ? 'asc' : 'desc',
  };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function fieldValue(rec: unknown, field: string): unknown {
  if (rec === null || typeof rec !== 'object') return undefined;
  const obj = rec as Record<string, unknown>;
  if (field.startsWith('fields.')) {
    const f = obj.fields;
    return f && typeof f === 'object' ? (f as Record<string, unknown>)[field.slice(7)] : undefined;
  }
  return obj[field];
}

function sortByField<T>(items: T[], field: string, order: 'asc' | 'desc'): T[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = fieldValue(a, field);
    const bv = fieldValue(b, field);
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1; // nulls last
    if (bv === undefined || bv === null) return -1;
    return (av < bv ? -1 : 1) * dir;
  });
}

/** Sort (optional) + cursor-paginate an array into the public list envelope. Pure. */
export function paginateAndSort<T>(items: T[], controls: ApiListControls): ApiListPage<T> {
  const sorted = controls.sort ? sortByField(items, controls.sort, controls.order) : items;
  const offset = decodeCursor(controls.cursor);
  const slice = sorted.slice(offset, offset + controls.limit);
  const nextOffset = offset + slice.length;
  const nextCursor = nextOffset < sorted.length ? encodeCursor(nextOffset) : null;
  return { data: slice, nextCursor, total: sorted.length, limit: controls.limit };
}

export type { RouteContext };
