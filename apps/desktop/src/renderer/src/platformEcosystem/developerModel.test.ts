/**
 * Developer Experience lens tests — Platform Ecosystem workspace (Phase 5).
 *
 * Non-vacuous: a populated input must surface real key/usage/route stats and rows; an empty input
 * must be an honest empty state with the architectural gaps + reuse link persisting; the analytics
 * are real-but-empty-until-traffic (honest zero); and the p95 latency tone follows a real boundary.
 */
import { describe, it, expect } from 'vitest';
import { summarizeDeveloper, P95_BUDGET_MS, type DeveloperInput } from './developerModel';

const stat = (lens: ReturnType<typeof summarizeDeveloper>, label: string) =>
  lens.stats.find((s) => s.label === label);
const group = (lens: ReturnType<typeof summarizeDeveloper>, title: string) =>
  lens.groups.find((g) => g.title === title);
const row = (g: ReturnType<typeof group>, label: string) => g?.rows.find((r) => r.label === label);

const GAP_CAPABILITIES = [
  'Project templates / scaffolding',
  'Plugin-author test/debug harness',
  'Package (.npkg) producer',
  'authorization_code OAuth for developer apps',
];

describe('summarizeDeveloper', () => {
  it('(a) populated input surfaces real key, usage, route, and OAuth signals', () => {
    // 3 keys (2 active, 1 revoked, 2 ever-used); 100 requests (90 allowed / 10 denied, of which
    // 4 rate-limited + 3 unauthorized); gateway p95 320 ms; 2 OAuth apps; 5 public routes.
    const input: DeveloperInput = {
      keys: [
        { name: 'ci', revokedAt: null, lastUsedAt: '2026-07-01T00:00:00Z' },
        { name: 'prod', revokedAt: null, lastUsedAt: '2026-07-10T00:00:00Z' },
        { name: 'old', revokedAt: '2026-06-01T00:00:00Z', lastUsedAt: null },
      ],
      analytics: {
        windowDays: 30,
        requests: 100,
        allowed: 90,
        denied: 10,
        rateLimited: 4,
        unauthorized: 3,
        p95LatencyMs: 320,
        topRoutes: [
          { route: '/v1/records', requests: 60 },
          { route: '/v1/modules', requests: 40 },
        ],
      },
      apps: [
        { name: 'partner-a', grantTypes: ['client_credentials'] },
        { name: 'partner-b', grantTypes: ['authorization_code', 'client_credentials'] },
      ],
      routes: [
        { method: 'GET', path: '/v1/records', scope: 'records:read' },
        { method: 'POST', path: '/v1/records', scope: 'records:write' },
        { method: 'GET', path: '/v1/modules', scope: 'modules:read' },
        { method: 'GET', path: '/v1/keys', scope: 'keys:read' },
        { method: 'GET', path: '/v1/usage', scope: 'usage:read' },
      ],
    };

    const lens = summarizeDeveloper(input);

    // API keys headline: real count + active/revoked split; activeShare 2/3 -> orange.
    const keysStat = stat(lens, 'API keys');
    expect(keysStat?.value).toBe('3');
    expect(keysStat?.tone).toBe('orange');
    expect(keysStat?.hint).toContain('2 active');
    expect(keysStat?.hint).toContain('1 revoked');

    // Developer requests: real total; tone = allowed share (90% -> green).
    const reqStat = stat(lens, 'Developer requests');
    expect(reqStat?.value).toBe('100');
    expect(reqStat?.tone).toBe('green');
    expect(reqStat?.hint).toContain('90% allowed');

    // p95 latency: real value, health-inverted tone (320 ms is elevated but under the 500 ms budget).
    const p95Stat = stat(lens, 'p95 latency');
    expect(p95Stat?.value).toBe('320ms');
    expect(p95Stat?.tone).toBe('orange');

    // API routes: real REST-surface count.
    expect(stat(lens, 'API routes')?.value).toBe('5');

    // Wired-surface group: keys, OAuth apps, routes + the OpenAPI/API Explorer reference note.
    const wired = group(lens, 'Developer platform (real, wired)');
    expect(row(wired, 'API keys')?.sub).toContain('2 active');
    expect(row(wired, 'API keys')?.sub).toContain('2 used');
    expect(row(wired, 'OAuth applications')?.value).toBe('2');
    expect(row(wired, 'OAuth applications')?.sub).toContain('client_credentials');
    expect(row(wired, 'Public API routes')?.value).toBe('5');
    expect(wired?.note).toContain('OpenAPI');
    expect(wired?.note).toContain('Developer Portal');

    // Gateway-usage group: real decision breakdown + latency + top route.
    const usage = group(lens, 'Gateway usage (real)');
    expect(row(usage, 'Requests')?.value).toBe('100');
    expect(row(usage, 'Allowed')?.value).toBe('90 (90%)');
    expect(row(usage, 'Allowed')?.tone).toBe('green');
    const deniedRow = row(usage, 'Denied');
    expect(deniedRow?.value).toBe('10 (10%)');
    expect(deniedRow?.tone).toBe('green'); // 10% denied is low risk
    expect(deniedRow?.sub).toContain('4 rate-limited');
    expect(deniedRow?.sub).toContain('3 unauthorized');
    expect(row(usage, 'p95 latency')?.value).toBe('320ms');
    expect(row(usage, 'Top route')?.value).toBe('60');
    expect(row(usage, 'Top route')?.sub).toBe('/v1/records');
    expect(usage?.note).toContain('usage ledger');

    // Honesty + reuse are always present.
    expect(lens.gaps.map((g) => g.capability)).toEqual(GAP_CAPABILITIES);
    expect(lens.links?.map((l) => l.section)).toEqual(['developer']);
    expect(lens.links?.[0].label).toBe('Developer Portal');
  });

  it('(b) empty input is an honest empty state — no stats/groups, gaps + link persist', () => {
    const empty = summarizeDeveloper({});
    expect(empty.stats).toEqual([]);
    expect(empty.groups).toEqual([]);
    // Architectural gaps are truths independent of data.
    expect(empty.gaps.map((g) => g.capability)).toEqual(GAP_CAPABILITIES);
    // Each gap names the real architecture it would require.
    expect(empty.gaps.every((g) => g.requires.length > 0)).toBe(true);
    // The reuse link persists so the operator can still reach the canonical surface.
    expect(empty.links).toHaveLength(1);
    expect(empty.links?.[0]).toMatchObject({ label: 'Developer Portal', section: 'developer' });
  });

  it('(c) real-but-empty analytics is an honest zero — no fabricated latency/percentages', () => {
    const lens = summarizeDeveloper({
      analytics: {
        windowDays: 30,
        requests: 0,
        allowed: 0,
        denied: 0,
        rateLimited: 0,
        unauthorized: 0,
        p95LatencyMs: 0,
        topRoutes: [],
      },
    });

    // The zero shows through honestly...
    const reqStat = stat(lens, 'Developer requests');
    expect(reqStat?.value).toBe('0');
    expect(reqStat?.tone).toBe('gray');
    expect(reqStat?.hint).toContain('no developer traffic yet');

    // ...but no fabricated latency or allowed/denied breakdown is shown at zero traffic.
    expect(stat(lens, 'p95 latency')).toBeUndefined();
    const usage = group(lens, 'Gateway usage (real)');
    expect(row(usage, 'Requests')?.value).toBe('0');
    expect(row(usage, 'Allowed')).toBeUndefined();
    expect(row(usage, 'Denied')).toBeUndefined();
    expect(row(usage, 'p95 latency')).toBeUndefined();
    expect(usage?.note).toContain('empty until developer requests flow');

    // No wired-surface group (no keys/apps/routes), but gaps + link still persist.
    expect(group(lens, 'Developer platform (real, wired)')).toBeUndefined();
    expect(lens.gaps).toHaveLength(4);
    expect(lens.links).toHaveLength(1);
  });

  it('(d) p95 latency tone follows the 500 ms budget boundary; revoked-only keys read red', () => {
    expect(P95_BUDGET_MS).toBe(500);

    const p95ToneAt = (ms: number) =>
      stat(summarizeDeveloper({ analytics: { requests: 1, allowed: 1, denied: 0, p95LatencyMs: ms } }), 'p95 latency')
        ?.tone;

    expect(p95ToneAt(250)).toBe('green'); // == budget/2, not over -> green
    expect(p95ToneAt(400)).toBe('orange'); // > budget/2, <= budget -> orange
    expect(p95ToneAt(600)).toBe('red'); // > budget -> red

    // A high denied share flips the Denied row to a risk tone (health inverted).
    const risky = summarizeDeveloper({
      analytics: { windowDays: 7, requests: 10, allowed: 2, denied: 8, rateLimited: 5, unauthorized: 3, p95LatencyMs: 120 },
    });
    expect(row(group(risky, 'Gateway usage (real)'), 'Denied')?.tone).toBe('red'); // 80% denied -> high risk
    expect(row(group(risky, 'Gateway usage (real)'), 'Allowed')?.tone).toBe('red'); // 20% allowed -> unhealthy (complement of denied)

    // All keys revoked -> activeShare 0 -> red (no usable key posture).
    const revoked = summarizeDeveloper({ keys: [{ revokedAt: '2026-01-01T00:00:00Z' }, { revokedAt: '2026-02-01T00:00:00Z' }] });
    expect(stat(revoked, 'API keys')?.tone).toBe('red');
    expect(stat(revoked, 'API keys')?.hint).toContain('0 active');
  });
});
