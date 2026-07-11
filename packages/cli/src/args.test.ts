import { describe, expect, it } from 'vitest';
import { parseArgs, queryFromFlags } from './args';

describe('parseArgs', () => {
  it('separates positionals from flags in all three forms', () => {
    expect(parseArgs(['records', 'crm', 'search', 'acme', '--limit', '10', '--status=active', '--json'])).toEqual({
      positionals: ['records', 'crm', 'search', 'acme'],
      flags: { limit: '10', status: 'active', json: true },
    });
  });

  it('treats a flag before another flag or at the end as boolean', () => {
    expect(parseArgs(['--verbose', '--out'])).toEqual({ positionals: [], flags: { verbose: true, out: true } });
  });

  it('is empty for no args', () => {
    expect(parseArgs([])).toEqual({ positionals: [], flags: {} });
  });
});

describe('queryFromFlags', () => {
  it('coerces numeric strings, keeps booleans + strings, drops omitted control flags', () => {
    expect(queryFromFlags({ limit: '25', order: 'desc', latest: true, 'base-url': 'x' }, ['base-url'])).toEqual({
      limit: 25,
      order: 'desc',
      latest: true,
    });
  });

  it('leaves non-numeric ids as strings', () => {
    expect(queryFromFlags({ q: '12ab', windowDays: '7' })).toEqual({ q: '12ab', windowDays: 7 });
  });
});
