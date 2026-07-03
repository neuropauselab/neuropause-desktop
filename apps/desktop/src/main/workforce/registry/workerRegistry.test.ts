import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Worker } from '@neuropause/shared';
import { WorkerRegistry } from './workerRegistry';
import type { WorkerDefinition } from '../sdk';

const NOW = '2026-02-10T00:00:00.000Z';

const opened: WorkerRegistry[] = [];
const paths: string[] = [];

function tempPath(): string {
  const p = join(tmpdir(), `nps-registry-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

async function newRegistry(path: string): Promise<WorkerRegistry> {
  const r = new WorkerRegistry(path);
  opened.push(r);
  await r.load();
  return r;
}

function def(id: string, name: string, version = '1.0.0'): WorkerDefinition {
  const worker: Worker = {
    identity: { id, name, role: 'operations', version, developer: 'neuropause' },
    goals: [],
    skills: [{ id: 'echo', title: 'Echo', description: 'echo', sideEffects: false, requires: ['read:entities'] }],
    permissions: [{ scope: 'read:entities', granted: true }],
    memoryScope: 'self',
    policyIds: [],
    trustScore: 0.5,
    lifecycle: 'registered',
    health: { state: 'unknown', lastCheckAt: null, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: NOW,
    updatedAt: NOW,
    builtIn: true,
    metadata: {},
  };
  return { worker, skills: new Map() };
}

afterEach(async () => {
  await Promise.all(opened.map((r) => r.flush()));
  opened.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('WorkerRegistry', () => {
  it('registers a worker and lists it as a summary', async () => {
    const r = await newRegistry(tempPath());
    r.register(def('worker:a', 'Alpha'), NOW);
    expect(r.has('worker:a')).toBe(true);
    const sums = r.summaries();
    expect(sums).toHaveLength(1);
    expect(sums[0].name).toBe('Alpha');
    expect(sums[0].trustScore).toBe(0.5);
  });

  it('evolves trust and health deterministically from job outcomes', async () => {
    const r = await newRegistry(tempPath());
    r.register(def('worker:a', 'Alpha'), NOW);

    let w = r.recordOutcome('worker:a', true, NOW)!;
    expect(w.trustScore).toBe(0.52);
    expect(w.health.jobsRun).toBe(1);
    expect(w.health.successRate).toBe(1);
    expect(w.health.state).toBe('healthy');

    w = r.recordOutcome('worker:a', false, NOW)!;
    expect(w.trustScore).toBe(0.47);
    expect(w.health.successRate).toBe(0.5);
    expect(w.health.state).toBe('degraded');

    w = r.recordOutcome('worker:a', false, NOW)!;
    expect(w.health.jobsRun).toBe(3);
    expect(w.health.successRate).toBeCloseTo(0.333, 2);
    expect(w.health.state).toBe('unhealthy');
  });

  it('preserves trust, health, and createdAt when re-registering a new version', async () => {
    const r = await newRegistry(tempPath());
    r.register(def('worker:a', 'Alpha'), NOW);
    r.recordOutcome('worker:a', true, NOW);
    const updated = r.register(def('worker:a', 'Alpha', '2.0.0'), '2026-02-11T00:00:00.000Z');
    expect(updated.identity.version).toBe('2.0.0');
    expect(updated.trustScore).toBe(0.52);
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe('2026-02-11T00:00:00.000Z');
  });

  it('persists workers across reloads', async () => {
    const path = tempPath();
    const r1 = await newRegistry(path);
    r1.register(def('worker:a', 'Alpha'), NOW);
    r1.recordOutcome('worker:a', true, NOW);
    await r1.flush();

    const r2 = await newRegistry(path);
    const w = r2.get('worker:a');
    expect(w).not.toBeNull();
    expect(w!.trustScore).toBe(0.52);
    expect(w!.health.jobsRun).toBe(1);
  });

  it('updates lifecycle', async () => {
    const r = await newRegistry(tempPath());
    r.register(def('worker:a', 'Alpha'), NOW);
    const w = r.setLifecycle('worker:a', 'idle', NOW);
    expect(w!.lifecycle).toBe('idle');
  });
});
