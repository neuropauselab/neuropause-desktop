import { describe, expect, it } from 'vitest';
import type { UnifiedEntity } from '@neuropause/shared';
import { projectGraph } from './projector';

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

describe('projectGraph', () => {
  it('maps UDM kinds to node types and derives people + role edges', () => {
    const entities = [
      entity({ id: 'proj1', kind: 'project', title: 'Apollo' }),
      entity({ id: 'task1', kind: 'task', title: 'Build API', containerId: 'proj1', author: 'dev' }),
      entity({ id: 'doc1', kind: 'document', title: 'Spec', author: 'writer' }),
    ];
    const { nodes, edges } = projectGraph({
      entities,
      connectors: [{ id: 'github', name: 'GitHub' }],
      applications: [{ slug: 'notes', name: 'Notes' }],
      now: NOW,
    });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('proj1')?.type).toBe('project');
    expect(byId.get('task1')?.type).toBe('task');
    expect(byId.get('doc1')?.type).toBe('document');
    expect(byId.get('connector:github')?.type).toBe('connector');
    expect(byId.get('app:notes')?.type).toBe('application');
    expect(byId.get('person:github:dev')?.type).toBe('person');
    expect(byId.get('person:github:writer')?.type).toBe('person');

    const edgeIds = new Set(edges.map((e) => e.id));
    expect(edgeIds.has('task1|belongs_to|proj1')).toBe(true);
    expect(edgeIds.has('task1|assigned_to|person:github:dev')).toBe(true); // task author → assigned_to
    expect(edgeIds.has('doc1|created_by|person:github:writer')).toBe(true); // doc author → created_by

    // edges carry provenance back to the UDM record
    const belongs = edges.find((e) => e.id === 'task1|belongs_to|proj1');
    expect(belongs?.evidence).toEqual({ kind: 'task', id: 'task1' });
  });

  it('treats a calendar event with attendees as a meeting and links participants', () => {
    const entities = [
      entity({ id: 'evt1', kind: 'calendar_event', title: 'Standup', author: 'organizer', metadata: { attendees: 3 } }),
      entity({ id: 'evt2', kind: 'calendar_event', title: 'Focus block', metadata: { attendees: 0 } }),
    ];
    const { nodes, edges } = projectGraph({ entities, connectors: [], applications: [], now: NOW });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('evt1')?.type).toBe('meeting');
    expect(byId.get('evt2')?.type).toBe('calendar_event');

    const edgeIds = new Set(edges.map((e) => e.id));
    expect(edgeIds.has('person:github:organizer|participated_in|evt1')).toBe(true);
  });

  it('links message authors as participants in their conversation', () => {
    const entities = [
      entity({ id: 'conv1', kind: 'conversation', title: 'general' }),
      entity({ id: 'msg1', kind: 'message', title: 'hello', containerId: 'conv1', author: 'U123' }),
    ];
    const { edges } = projectGraph({ entities, connectors: [], applications: [], now: NOW });

    const edgeIds = new Set(edges.map((e) => e.id));
    expect(edgeIds.has('msg1|belongs_to|conv1')).toBe(true);
    expect(edgeIds.has('msg1|created_by|person:github:u123')).toBe(true);
    expect(edgeIds.has('person:github:u123|participated_in|conv1')).toBe(true);
  });

  it('honors a metadata assignee as an assigned_to edge', () => {
    const entities = [entity({ id: 'task9', kind: 'task', title: 'Triage', metadata: { assignee: 'maintainer' } })];
    const { edges } = projectGraph({ entities, connectors: [], applications: [], now: NOW });
    expect(new Set(edges.map((e) => e.id)).has('task9|assigned_to|person:github:maintainer')).toBe(true);
  });
});
