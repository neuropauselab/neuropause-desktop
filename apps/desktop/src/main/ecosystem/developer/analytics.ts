/**
 * Developer analytics — pure aggregation over the usage ledger. No I/O, no
 * electron; given a window of UsageRecords it produces the analytics view the
 * portal renders.
 */
import type { DeveloperAnalytics, UsageRecord } from '@neuropause/shared';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function computeAnalytics(developerId: string, usage: UsageRecord[], windowDays: number, now: number): DeveloperAnalytics {
  const total = usage.length;
  const errors = usage.filter((u) => u.status >= 400).length;
  const latencies = usage.map((u) => u.latencyMs);
  const computeUnits = usage.reduce((n, u) => n + u.computeUnits, 0);

  // by day (oldest → newest, filling gaps)
  const dayMap = new Map<string, { requests: number; errors: number }>();
  for (let d = windowDays - 1; d >= 0; d -= 1) {
    const key = dayKey(new Date(now - d * 86_400_000).toISOString());
    dayMap.set(key, { requests: 0, errors: 0 });
  }
  for (const u of usage) {
    const e = dayMap.get(dayKey(u.at));
    if (e) {
      e.requests += 1;
      if (u.status >= 400) e.errors += 1;
    }
  }
  const byDay = [...dayMap.entries()].map(([date, v]) => ({ date, ...v }));

  // by route
  const routeMap = new Map<string, { requests: number; errors: number }>();
  for (const u of usage) {
    const key = `${u.method} ${u.path}`;
    const e = routeMap.get(key) ?? { requests: 0, errors: 0 };
    e.requests += 1;
    if (u.status >= 400) e.errors += 1;
    routeMap.set(key, e);
  }
  const byRoute = [...routeMap.entries()]
    .map(([route, v]) => ({ route, requests: v.requests, errorRate: v.requests > 0 ? v.errors / v.requests : 0 }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 8);

  // status histogram
  const statusMap = new Map<number, number>();
  for (const u of usage) statusMap.set(u.status, (statusMap.get(u.status) ?? 0) + 1);
  const topStatuses = [...statusMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    developerId,
    windowDays,
    totalRequests: total,
    errorRequests: errors,
    errorRate: total > 0 ? errors / total : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    computeUnits,
    byDay,
    byRoute,
    topStatuses,
  };
}
