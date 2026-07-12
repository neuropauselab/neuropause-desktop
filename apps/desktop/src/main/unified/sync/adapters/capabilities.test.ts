/**
 * P5 — Increment 1: capability/schema discovery. `describeAdapter` projects an adapter into the
 * streams + entity kinds it syncs (pure), and `describeAdapters` reports it for every registered adapter.
 */
import { describe, expect, it } from 'vitest';
import { describeAdapter, type ConnectorAdapter } from '../adapterSdk';
import { registerAdapter, describeAdapters } from '../registry';

const noop = () => Promise.resolve({ entities: [], cursor: null, hasMore: false });

const sample: ConnectorAdapter = {
  connectorId: 'sample',
  resources: [
    { id: 'r1', label: 'Ones', kind: 'task', pull: noop },
    { id: 'r2', label: 'Twos', kind: 'task', pull: noop },
    { id: 'r3', label: 'Threes', kind: 'project', pull: noop },
  ],
};

describe('describeAdapter', () => {
  it('projects an adapter into its resource + kind capability report', () => {
    const cap = describeAdapter(sample);
    expect(cap.connectorId).toBe('sample');
    expect(cap.resources).toEqual([
      { id: 'r1', label: 'Ones', kind: 'task' },
      { id: 'r2', label: 'Twos', kind: 'task' },
      { id: 'r3', label: 'Threes', kind: 'project' },
    ]);
    expect(cap.kinds).toEqual(['task', 'project']); // deduped, first-seen order
  });
});

describe('describeAdapters', () => {
  it('reports every registered adapter', () => {
    registerAdapter(sample);
    const found = describeAdapters().find((c) => c.connectorId === 'sample');
    expect(found?.resources.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(found?.kinds).toEqual(['task', 'project']);
  });
});
