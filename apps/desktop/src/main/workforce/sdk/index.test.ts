import { describe, expect, it } from 'vitest';
import type { Worker, WorkerSkill } from '@neuropause/shared';
import {
  defineWorker,
  emptyResult,
  scopeData,
  validateWorker,
  type SkillImpl,
  type WorkforceData,
} from './index';

const NOW = '2026-02-10T00:00:00.000Z';

function skillDecl(over: Partial<WorkerSkill> = {}): WorkerSkill {
  return { id: 'echo', title: 'Echo', description: 'echo', sideEffects: false, requires: ['read:entities'], ...over };
}

function impl(id = 'echo'): SkillImpl {
  return { id, run: () => ({ summary: 'ok', evidence: [], grounded: true, proposals: [] }) };
}

function worker(over: Partial<Worker> = {}): Worker {
  return {
    identity: { id: 'worker:test', name: 'Test', role: 'operations', version: '1.0.0', developer: 'neuropause' },
    goals: ['be useful'],
    skills: [skillDecl()],
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
    ...over,
  };
}

describe('worker SDK', () => {
  it('accepts a well-formed worker', () => {
    const v = validateWorker(worker(), [impl()]);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rejects a skill that declares a scope the worker is not granted', () => {
    const w = worker({ skills: [skillDecl({ requires: ['read:entities', 'write:memory'] })] });
    const v = validateWorker(w, [impl()]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('write:memory');
  });

  it('rejects a bad id, bad version, and a declaration/implementation mismatch', () => {
    expect(validateWorker(worker({ identity: { ...worker().identity, id: 'founder' } }), [impl()]).ok).toBe(false);
    expect(validateWorker(worker({ identity: { ...worker().identity, version: '1.0' } }), [impl()]).ok).toBe(false);
    const mismatch = validateWorker(worker(), [impl('other')]);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.join(' ')).toContain('not implemented');
  });

  it('defineWorker builds a skill map and throws on an invalid worker', () => {
    const def = defineWorker(worker(), [impl()]);
    expect(def.skills.has('echo')).toBe(true);
    expect(() => defineWorker(worker({ identity: { ...worker().identity, version: 'bad' } }), [impl()])).toThrow(
      /Invalid worker/,
    );
  });

  it('scopeData enforces least privilege', () => {
    const full: WorkforceData = {
      now: NOW,
      entities: [{ id: 'e1' } as never],
      events: [{ id: 'ev1' } as never],
      memories: [{ id: 'm1' } as never],
      neighbors: () => [{ id: 'n1', type: 'x', label: 'x', rel: 'r', direction: 'out' }],
    };
    const w = worker({
      permissions: [
        { scope: 'read:entities', granted: true },
        { scope: 'read:memory', granted: true },
        { scope: 'read:timeline', granted: false },
      ],
    });
    const scoped = scopeData(full, w);
    expect(scoped.entities).toHaveLength(1);
    expect(scoped.memories).toHaveLength(1);
    expect(scoped.events).toHaveLength(0);
    expect(scoped.neighbors('e1')).toHaveLength(0);
  });

  it('emptyResult is ungrounded with no proposals', () => {
    const r = emptyResult('nothing to do');
    expect(r.grounded).toBe(false);
    expect(r.proposals).toHaveLength(0);
    expect(r.summary).toBe('nothing to do');
  });
});
