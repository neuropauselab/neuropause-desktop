/**
 * P3.0 Increment 1 — Enterprise API router (pure) tests.
 * Path matching with params, list-control parsing, and cursor pagination + sorting.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  matchRoute,
  normalizePath,
  paginateAndSort,
  parseListControls,
} from './apiRouter';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';

describe('normalizePath', () => {
  it('adds a leading slash, drops a trailing slash + query string', () => {
    expect(normalizePath('modules/')).toBe('/modules');
    expect(normalizePath('/modules/x/records?limit=5')).toBe('/modules/x/records');
    expect(normalizePath('/')).toBe('/');
  });
});

describe('matchRoute', () => {
  it('matches static + parameterized paths and extracts params', () => {
    const list = matchRoute(ENTERPRISE_API_ROUTES, 'GET', '/modules/finance-invoices/records');
    expect(list?.route.channel && 'channel' in list.route).toBe(true);
    expect(list?.params).toEqual({ moduleId: 'finance-invoices' });

    const one = matchRoute(ENTERPRISE_API_ROUTES, 'GET', '/modules/crm-leads/records/lead_9');
    expect(one?.params).toEqual({ moduleId: 'crm-leads', id: 'lead_9' });

    const action = matchRoute(ENTERPRISE_API_ROUTES, 'POST', '/modules/crm-leads/records/lead_9/actions/convert');
    expect(action?.params).toEqual({ moduleId: 'crm-leads', id: 'lead_9', action: 'convert' });
  });

  it('respects the HTTP method and returns null for unknown routes', () => {
    expect(matchRoute(ENTERPRISE_API_ROUTES, 'DELETE', '/modules')).toBeNull();
    expect(matchRoute(ENTERPRISE_API_ROUTES, 'GET', '/nope/nope')).toBeNull();
  });

  it('does not confuse /records with /records/:id', () => {
    const collection = matchRoute(ENTERPRISE_API_ROUTES, 'POST', '/modules/x/records');
    expect(collection?.params).toEqual({ moduleId: 'x' });
    expect('channel' in (collection?.route ?? {})).toBe(true);
  });
});

describe('parseListControls', () => {
  it('defaults, clamps, and reads sort/order/cursor', () => {
    expect(parseListControls({})).toEqual({ limit: 50, cursor: null, sort: null, order: 'desc' });
    expect(parseListControls({ limit: 9999 }).limit).toBe(200); // clamped
    expect(parseListControls({ limit: 0 }).limit).toBe(1);
    expect(parseListControls({ sort: 'title', order: 'asc', cursor: 'abc' })).toEqual({
      limit: 50, cursor: 'abc', sort: 'title', order: 'asc',
    });
  });
});

describe('paginateAndSort', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, fields: { amount: (i * 3) % 7 } }));

  it('cursor-paginates and reports total + nextCursor', () => {
    const p1 = paginateAndSort(items, { limit: 3, cursor: null, sort: null, order: 'desc' });
    expect(p1.data).toHaveLength(3);
    expect(p1.total).toBe(7);
    expect(p1.limit).toBe(3);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = paginateAndSort(items, { limit: 3, cursor: p1.nextCursor, sort: null, order: 'desc' });
    expect(p2.data.map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);

    const p3 = paginateAndSort(items, { limit: 3, cursor: p2.nextCursor, sort: null, order: 'desc' });
    expect(p3.data).toHaveLength(1);
    expect(p3.nextCursor).toBeNull(); // end of the list
  });

  it('sorts by a nested fields.* key', () => {
    const asc = paginateAndSort(items, { limit: 7, cursor: null, sort: 'fields.amount', order: 'asc' });
    const amounts = asc.data.map((r) => r.fields.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it('round-trips the cursor', () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor('not-base64-@@')).toBe(0);
  });
});
