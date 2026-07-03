import { describe, expect, it } from 'vitest';
import type { UnifiedEntity } from '@neuropause/shared';
import { projectMemory } from './memoryProjector';

const NOW = '2026-01-01T00:00:00.000Z';

function entity(partial: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: partial.id,
    kind: partial.kind as never,
    connectorId: partial.connectorId ?? 'github',
    accountId: partial.accountId ?? 'acct1',
    sourceId: partial.sourceId ?? partial.id,
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'active',
    syncedAt: NOW,
    metadata: partial.metadata ?? {},
    title: partial.title ?? partial.id,
    url: partial.url ?? null,
    parentId: partial.parentId ?? null,
    containerId: partial.containerId ?? null,
    body: partial.body ?? null,
    status: partial.status ?? null,
    author: partial.author ?? null,
    timestamp: partial.timestamp ?? null,
    endTimestamp: partial.endTimestamp ?? null,
    labels: partial.labels ?? [],
  } as UnifiedEntity;
}

describe('projectMemory', () => {
  it('memorializes memory-worthy kinds with evidence and refs', () => {
    const items = projectMemory(
      [
        entity({
          id: 'doc1',
          kind: 'document',
          title: 'Investor Deck',
          body: 'Series A narrative and financials',
          author: 'writer',
          containerId: 'proj1',
        }),
        entity({ id: 'task1', kind: 'task', title: 'Ship API', status: 'open' }),
        entity({ id: 'conv1', kind: 'conversation', title: 'general' }),
        entity({ id: 'proj1', kind: 'project', title: 'Apollo' }),
      ],
      NOW,
    );

    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get('mem:doc1')?.kind).toBe('document');
    expect(byId.get('mem:task1')?.kind).toBe('task');
    expect(byId.get('mem:conv1')?.kind).toBe('conversation');
    expect(byId.get('mem:proj1')?.kind).toBe('context'); // a project is org context

    const doc = byId.get('mem:doc1');
    expect(doc?.origin).toBe('projected');
    expect(doc?.evidence).toEqual({ kind: 'document', id: 'doc1' });
    expect(doc?.entityRefs).toContain('doc1');
    expect(doc?.entityRefs).toContain('proj1'); // container
    expect(doc?.entityRefs).toContain('person:github:writer'); // author
    expect(doc?.content).toContain('Investor Deck');
    expect(doc?.content).toContain('Series A narrative');
  });

  it('treats a calendar event with attendees as a meeting, and skips solo blocks', () => {
    const items = projectMemory(
      [
        entity({ id: 'evt1', kind: 'calendar_event', title: 'Board Meeting', metadata: { attendees: 5 } }),
        entity({ id: 'evt2', kind: 'calendar_event', title: 'Focus block', metadata: { attendees: 0 } }),
      ],
      NOW,
    );
    const ids = new Set(items.map((i) => i.id));
    expect(ids.has('mem:evt1')).toBe(true);
    expect(items.find((i) => i.id === 'mem:evt1')?.kind).toBe('meeting');
    expect(ids.has('mem:evt2')).toBe(false);
  });

  it('does not memorialize granular or non-memory kinds', () => {
    const items = projectMemory(
      [
        entity({ id: 'msg1', kind: 'message', title: 'hi' }),
        entity({ id: 'note1', kind: 'notification', title: 'ping' }),
        entity({ id: 'c1', kind: 'contact', title: 'Jane' }),
      ],
      NOW,
    );
    expect(items.length).toBe(0);
  });
});
