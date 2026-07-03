import { describe, expect, it } from 'vitest';
import { WORKER_ROLES } from '@neuropause/shared';
import type { UnifiedEntity } from '@neuropause/shared';
import { builtInWorkers } from './index';
import type { SkillContext, SkillResult, WorkforceData } from '../sdk';

const NOW = '2026-02-12T00:00:00.000Z';
const defs = builtInWorkers();
const byId = new Map(defs.map((d) => [d.worker.identity.id, d]));

function entity(over: Partial<UnifiedEntity>): UnifiedEntity {
  return {
    id: 'e',
    kind: 'task',
    title: 't',
    status: null,
    connectorId: 'github',
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
    ...over,
  } as UnifiedEntity;
}

function run(workerId: string, skillId: string, data: Partial<WorkforceData>): SkillResult {
  const def = byId.get(workerId)!;
  const skill = def.skills.get(skillId)!;
  const ctx: SkillContext = {
    worker: def.worker,
    now: NOW,
    data: { now: NOW, entities: [], events: [], memories: [], neighbors: () => [], ...data },
    log: () => undefined,
  };
  return skill.run(ctx, {});
}

describe('built-in workers', () => {
  it('builds nine valid workers, one per role', () => {
    expect(defs).toHaveLength(9);
    expect(defs.map((d) => d.worker.identity.role).sort()).toEqual([...WORKER_ROLES].sort());
    for (const d of defs) {
      expect(d.worker.builtIn).toBe(true);
      expect(d.worker.identity.id.startsWith('worker:')).toBe(true);
      expect(d.skills.size).toBeGreaterThan(0);
    }
  });

  it('returns honest empty results when nothing is connected', () => {
    const r = run('worker:research', 'scan', {});
    expect(r.grounded).toBe(false);
    expect(r.proposals).toHaveLength(0);
  });

  it('research digest proposes a governed draft grounded in documents', () => {
    const docs = [
      entity({ id: 'd1', kind: 'document', title: 'Spec' }),
      entity({ id: 'd2', kind: 'document', title: 'Plan' }),
    ];
    const r = run('worker:research', 'digest', { entities: docs });
    expect(r.grounded).toBe(true);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].sideEffects).toBe(true);
    expect(r.proposals[0].permissions).toContain('propose:draft');
    expect(r.proposals[0].evidence.length).toBeGreaterThan(0);
  });

  it('operations note proposes a governed memory write for open tasks', () => {
    const open = entity({ id: 't1', kind: 'task', title: 'Do it', status: 'open' });
    const r = run('worker:operations', 'note', { entities: [open] });
    expect(r.grounded).toBe(true);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].permissions).toContain('write:memory');
  });

  it('sales follow-up proposes a governed outbound message', () => {
    const convo = entity({ id: 'c1', kind: 'conversation', title: 'Lead chat' });
    const r = run('worker:sales', 'follow-up', { entities: [convo] });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].permissions).toContain('propose:message');
  });

  it('founder ask returns a non-empty summary', () => {
    const r = run('worker:founder', 'ask', { entities: [entity({ id: 'p1', kind: 'project', title: 'Apollo' })] });
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);
  });
});
