/** AI Sandbox — Sandbox Core (S1): store tests (persistence + registry/versioning/status/artifacts/datasets). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunResult, SandboxReport } from '@neuropause/shared';
import { SandboxWorkspaceStore } from './workspaceStore';
import { SandboxScenarioStore } from './scenarioStore';
import { SandboxExecutionStore } from './executionStore';
import { SandboxArtifactStore } from './artifactStore';
import { SandboxDatasetStore } from './datasetStore';

let seq = 0;
function tmp(prefix: string): string {
  seq += 1;
  return join(tmpdir(), `sb-${prefix}-${Date.now()}-${seq}.json`);
}
const NOW = () => 1_700_000_000_000;

describe('SandboxWorkspaceStore', () => {
  it('creates, ensures a default, updates, deletes, and persists', async () => {
    const path = tmp('ws');
    const s = new SandboxWorkspaceStore(path, NOW);
    const def = s.ensureDefault();
    expect(def.name).toBe('Default');
    expect(s.ensureDefault().id).toBe(def.id); // idempotent
    const w = s.create({ name: 'QA', settings: { maxConcurrency: 4 } });
    expect(w.settings.maxConcurrency).toBe(4);
    expect(w.settings.defaultTimeoutMs).toBeGreaterThan(0); // filled from defaults
    s.update(w.id, { name: 'QA-2' });
    await s.flush();

    const reloaded = new SandboxWorkspaceStore(path, NOW);
    await reloaded.load();
    expect(reloaded.count()).toBe(2);
    expect(reloaded.get(w.id)?.name).toBe('QA-2');
    expect(reloaded.delete(w.id)).toBe(true);
  });
});

describe('SandboxScenarioStore', () => {
  it('enforces unique keys, versions immutably, dedupes, and merges metadata', async () => {
    const path = tmp('sc');
    const s = new SandboxScenarioStore(path, NOW);
    const sc = s.create({ workspaceId: 'w1', key: 'checkout', name: 'Checkout', metadata: { tags: ['smoke'] } });
    expect(() => s.create({ workspaceId: 'w1', key: 'checkout', name: 'Dup' })).toThrow(/already exists/);
    // different workspace, same key is fine
    expect(s.create({ workspaceId: 'w2', key: 'checkout', name: 'Other' })).toBeTruthy();

    const v1 = s.createVersion(sc.id, { steps: 1 }, 'first');
    expect(v1?.version).toBe(1);
    const v2 = s.createVersion(sc.id, { steps: 2 }, 'second');
    expect(v2?.version).toBe(2);
    // identical spec dedupes to head (no v3)
    expect(s.createVersion(sc.id, { steps: 2 })?.version).toBe(2);
    expect(s.versions(sc.id)).toHaveLength(2);
    expect(s.get(sc.id)?.latestVersion).toBe(2);
    expect(s.get(sc.id)?.versionCount).toBe(2);

    s.update(sc.id, { metadata: { owner: 'qa@x' } });
    expect(s.get(sc.id)?.metadata).toMatchObject({ tags: ['smoke'], owner: 'qa@x' }); // merge, not replace

    s.archive(sc.id, true);
    expect(s.list({ workspaceId: 'w1' })).toHaveLength(0);
    expect(s.list({ workspaceId: 'w1', includeArchived: true })).toHaveLength(1);

    await s.flush();
    const reloaded = new SandboxScenarioStore(path, NOW);
    await reloaded.load();
    expect(reloaded.versions(sc.id)).toHaveLength(2);
    expect(reloaded.getVersion(sc.id, 1)?.spec).toEqual({ steps: 1 });
  });
});

describe('SandboxExecutionStore', () => {
  it('creates queued, gates transitions, stamps times, and appends a timeline', () => {
    const s = new SandboxExecutionStore(tmp('ex'), NOW);
    const e = s.create({ workspaceId: 'w1', scenarioId: 's1', scenarioVersion: 1, trigger: 'manual', priority: 'high' });
    expect(e.status).toBe('queued');
    expect(s.timelineFor(e.id)).toHaveLength(1); // 'queued' entry

    expect(s.transition(e.id, 'passed')).toBeNull(); // illegal from queued
    const running = s.transition(e.id, 'running');
    expect(running?.startedAt).not.toBeNull();
    const passed = s.transition(e.id, 'passed');
    expect(passed?.finishedAt).not.toBeNull();
    expect(passed?.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.transition(e.id, 'failed')).toBeNull(); // terminal — no re-open
  });

  it('paginates + filters run history', () => {
    const s = new SandboxExecutionStore(tmp('ex2'), NOW);
    for (let i = 0; i < 5; i += 1) s.create({ workspaceId: 'w1', scenarioId: i % 2 ? 'sA' : 'sB', scenarioVersion: 1, trigger: 'manual', priority: 'normal' });
    const page1 = s.history({ limit: 2 });
    expect(page1.executions).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).toBe('2');
    const page2 = s.history({ limit: 2, cursor: page1.nextCursor });
    expect(page2.executions).toHaveLength(2);
    expect(s.history({ scenarioId: 'sA' }).total).toBe(2);
  });
});

describe('SandboxArtifactStore (one store, typed facets)', () => {
  it('adds artifacts, exposes facets, and round-trips results + reports', () => {
    const s = new SandboxArtifactStore(tmp('ar'), NOW);
    s.add({ executionId: 'e1', workspaceId: 'w1', kind: 'screenshot', name: 's.png', storageRef: 'blob://s' });
    s.add({ executionId: 'e1', workspaceId: 'w1', kind: 'log', name: 'run.log', inline: 'hello world' });
    expect(s.screenshots('e1')).toHaveLength(1);
    expect(s.logs('e1')[0].sizeBytes).toBe('hello world'.length);
    expect(s.list('e1')).toHaveLength(2);

    const result: RunResult = { id: 'res1', executionId: 'e1', outcome: 'pass', summary: 'ok', assertions: { total: 1, passed: 1, failed: 0 }, metrics: { durationMs: 5 }, createdAt: 'x' };
    s.addResult('w1', result);
    expect(s.getResult('e1')).toEqual(result);
    expect(s.get('res1')?.kind).toBe('result'); // id pinned

    const report: SandboxReport = { id: 'rep1', executionId: 'e1', scenarioId: 's1', workspaceId: 'w1', title: 'T', status: 'passed', summary: 'ok', sections: [], generatedAt: 'x' };
    s.addReport(report);
    expect(s.getReport('e1')).toEqual(report);
  });
});

describe('SandboxDatasetStore', () => {
  it('creates, lists by workspace, and deletes', () => {
    const s = new SandboxDatasetStore(tmp('ds'), NOW);
    const d = s.create({ workspaceId: 'w1', name: 'users', rows: 100, schema: ['id', 'email'] });
    s.create({ workspaceId: 'w2', name: 'other' });
    expect(s.list('w1')).toHaveLength(1);
    expect(s.list()).toHaveLength(2);
    expect(s.delete(d.id)).toBe(true);
    expect(s.list('w1')).toHaveLength(0);
  });
});
