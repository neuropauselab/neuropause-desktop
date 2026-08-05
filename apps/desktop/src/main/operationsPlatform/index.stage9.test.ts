/**
 * Phase 6 Stage 9 — the composition root: EXACTLY six read-only eops:*
 * channels (requireAuth + autonomousops:read — zero mutation surface), the
 * 3 s TTL cache, the async continuity path with the HONEST snapshot fallback
 * for the sync assistant port, the operations-watch source (governed ITEMS
 * from critical/high recommendations, deduped), the Stage 8 seam (null-safe),
 * failure isolation, and dispose().
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel } from '@neuropause/shared';
import { initOperationsPlatform, type OperationsPlatformDeps } from './index';

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

interface Harness {
  deps: OperationsPlatformDeps;
  sources: string[];
  produceWatch: () => Promise<unknown>;
  setNow: (ms: number) => void;
  statReads: () => number;
}

function mkDeps(over: Partial<OperationsPlatformDeps> = {}): Harness {
  let nowMs = T0;
  let statReads = 0;
  const sources: string[] = [];
  let produce: () => unknown = () => null;
  const deps: OperationsPlatformDeps = {
    insightReport: () => null,
    executionStats: () => {
      statReads += 1;
      return { active: 1, queued: 2, completed: 10, failed: 1, successRate: 0.95, averageRuntimeMs: 1500 };
    },
    queuedJobsTotal: () => 3,
    awaitingApprovals: () => [{ id: 'j1', createdAt: new Date(T0 - 3_600_000).toISOString() }],
    bottlenecks: () => [],
    automationMonitor: () => ({ running: 0, completed: 10, failed: 1, paused: 0 }),
    automationErrorRules: () => 0,
    connectors: () => [{ id: 'slack', name: 'Slack', configured: true, health: 'healthy' }],
    aiState: () => 'ready',
    executiveKpis: () => [{ key: 'org-health', label: 'Org health', display: '82', value: 82, band: 'healthy' }],
    processKpis: () => null,
    minedProcesses: () => [],
    units: () => [
      { id: 'u-ops', name: 'Operations', leadUserId: null },
      { id: 'u-it', name: 'IT', leadUserId: null },
      { id: 'u-ai', name: 'AI Team', leadUserId: null },
      { id: 'u-pe', name: 'Product & Engineering', leadUserId: null },
      { id: 'u-biz', name: 'Business', leadUserId: null },
    ],
    users: () => [],
    compliance: () => [{ ruleId: 'r1', ruleName: 'R1', severity: 'critical', status: 'pass' }],
    enabledChains: () => 1,
    workforceHealth: () => ({ healthy: 2, degraded: 0, unhealthy: 0, unknown: 0 }),
    systemHealth: () => ({ score: 90, level: 'good' }),
    healthHistory: () => [],
    validationSummary: () => ({ totalRuns: 3, certifies: 2, latestCertification: 'release-candidate' }),
    drPosture: () => ({ haEnabled: false, multiRegion: false, rpoTargetSeconds: 300, rtoTargetSeconds: 3600, lastDrillAt: null, score: 40 }),
    drReplicas: () => [],
    drValidations: () => [],
    localBackups: () => Promise.resolve([]),
    supervisor: () => ({ recoveryCount: 0, recentFailures: 0 }),
    knowledgeMatch: null,
    automationPlatform: null,
    registerSource: (source) => {
      sources.push(source.key);
      produce = () => source.produce();
    },
    now: () => nowMs,
    ...over,
  };
  return {
    deps,
    sources,
    produceWatch: async () => produce(),
    setNow: (ms) => {
      nowMs = ms;
    },
    statReads: () => statReads,
  };
}

describe('the IPC surface (D-9) — six read-only channels, zero mutation', () => {
  it('registers EXACTLY the six eops:* channels, all requireAuth + autonomousops:read', () => {
    const p = initOperationsPlatform(mkDeps().deps);
    expect(p.handlers.map((d) => d.channel).sort()).toEqual(
      [
        IpcChannel.EopsCatalog,
        IpcChannel.EopsHealth,
        IpcChannel.EopsReadiness,
        IpcChannel.EopsIncidents,
        IpcChannel.EopsContinuity,
        IpcChannel.EopsDashboard,
      ].sort(),
    );
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('eops:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      expect(d.permission, String(d.channel)).toBe('autonomousops:read');
    }
  });

  it('no channel name implies mutation or execution', () => {
    const p = initOperationsPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel|convert/);
    }
  });

  it('the readiness handler returns readiness + SLA + processes together', async () => {
    const p = initOperationsPlatform(mkDeps().deps);
    const h = p.handlers.find((d) => d.channel === IpcChannel.EopsReadiness)!.handler;
    const resp = (await h({})) as { readiness: { dimensions: unknown[] }; sla: { totals: { targets: number } }; processes: { totals: { registered: number } } };
    expect(resp.readiness.dimensions).toHaveLength(7);
    expect(resp.sla.totals.targets).toBe(9);
    expect(resp.processes.totals.registered).toBe(4);
  });
});

describe('the 3 s TTL cache', () => {
  it('reuses the computed catalog within the TTL and recomputes after it', () => {
    const h = mkDeps();
    const p = initOperationsPlatform(h.deps);
    const a = p.catalog();
    expect(p.catalog()).toBe(a);
    const before = h.statReads();
    h.setNow(T0 + 3_100);
    expect(p.catalog()).not.toBe(a);
    expect(h.statReads()).toBeGreaterThan(before);
  });
});

describe('continuity — the one async composition, snapshot-honest', () => {
  it('composes the async view (local backups awaited) and caches it', async () => {
    const h = mkDeps({ localBackups: () => Promise.resolve([{ createdAt: '2026-07-01T00:00:00.000Z', valid: true }]) });
    const p = initOperationsPlatform(h.deps);
    const v = await p.continuity();
    expect(v.localBackups).toEqual({ count: 1, lastAt: '2026-07-01T00:00:00.000Z', lastValid: true });
    expect(await p.continuity()).toBe(v); // TTL cache
  });

  it('a rejecting backup read isolates into unavailable — never fabricated', async () => {
    const p = initOperationsPlatform(mkDeps({ localBackups: () => Promise.reject(new Error('disk gone')) }).deps);
    const v = await p.continuity();
    expect(v.localBackups).toBeNull();
    expect(v.unavailable.some((u) => u.system === 'local-backups' && u.reason.includes('disk gone'))).toBe(true);
  });

  it('the dashboard awaits continuity and carries the three disclosures', async () => {
    const p = initOperationsPlatform(mkDeps().deps);
    const d = await p.dashboard();
    expect(d.disclosures).toHaveLength(3);
    expect(d.catalog.services).toBe(7);
    expect(d.continuity.localBackups).toBe(0);
  });
});

describe('the operations-watch delivery source (items, never actions)', () => {
  it('registers exactly one source and produces governed items for high recommendations, deduped', async () => {
    // Breach an SLA (engine error → ai-engine-ready breached + ai not-ready) to produce high recs.
    const h = mkDeps({ aiState: () => 'error' });
    initOperationsPlatform(h.deps);
    expect(h.sources).toEqual(['operations-watch']);
    const items = (await h.produceWatch()) as { id: string; governance?: { evidence: string[]; recommendedAction: string } }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id.startsWith('eops:opsrec:')).toBe(true);
      expect(item.governance?.evidence.length).toBeGreaterThan(0);
      expect(item.governance?.recommendedAction.length).toBeGreaterThan(0);
    }
    // Dedupe: the same recommendations are not re-delivered on the next fire.
    expect(((await h.produceWatch()) as unknown[]).length).toBe(0);
  });

  it('with everything healthy the source produces nothing (no noise)', async () => {
    const h = mkDeps();
    initOperationsPlatform(h.deps);
    const items = (await h.produceWatch()) as unknown[];
    // Only medium recs exist at most (no local backups → medium) — never high noise.
    expect(items.length).toBe(0);
  });
});

describe('the assistant port (sync, snapshot-backed)', () => {
  it('answers the ten questions and returns null for everything else', () => {
    const p = initOperationsPlatform(mkDeps().deps);
    const r = p.answerQuestion('Operations status, please', new Date(T0).toISOString());
    expect(r?.kind).toBe('intelligence');
    expect(p.answerQuestion('draft an email', new Date(T0).toISOString())).toBeNull();
  });

  it('before any continuity read resolves, the continuity answer declares the miss honestly', () => {
    // A never-resolving backup read keeps the snapshot empty.
    const p = initOperationsPlatform(mkDeps({ localBackups: () => new Promise(() => {}) }).deps);
    const r = p.answerQuestion('What is our business continuity posture?', new Date(T0).toISOString());
    const text = r!.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('unavailable this read');
  });
});

describe('the Stage 8 seam (D-2) + failure isolation', () => {
  it('a null automation-platform port composes cleanly; a live one adds the evidence trail', () => {
    const withoutSeam = initOperationsPlatform(mkDeps().deps);
    const row = withoutSeam.catalog().entries.find((e) => e.serviceId === 'automation-rules')!;
    expect(row.evidence.some((e) => e.startsWith('automation-platform-catalog'))).toBe(false);
    const withSeam = initOperationsPlatform(mkDeps({ automationPlatform: () => ({ entries: 42, findings: 3 }) }).deps);
    const row2 = withSeam.catalog().entries.find((e) => e.serviceId === 'automation-rules')!;
    expect(row2.evidence).toContain('automation-platform-catalog:42');
  });

  it('a throwing read becomes an explicit unavailable entry — never a fabricated value', () => {
    const p = initOperationsPlatform(
      mkDeps({
        executionStats: () => {
          throw new Error('engine offline');
        },
      }).deps,
    );
    const c = p.catalog();
    expect(c.unavailable.some((u) => u.system === 'executions' && u.reason === 'engine offline')).toBe(true);
    expect(c.entries.find((e) => e.serviceId === 'execution-runtime')!.state).toBe('unknown');
  });
});
