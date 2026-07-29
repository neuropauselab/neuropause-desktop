import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { WorkspaceGovernance } from './governance';
import { KnowledgeGraph } from './knowledge';
import { CollaborationHub } from './collaboration';

function setup(): { governance: WorkspaceGovernance; knowledge: KnowledgeGraph; collab: CollaborationHub } {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new WorkspaceGovernance(runtime, clock);
  return {
    governance,
    knowledge: new KnowledgeGraph(clock, governance),
    collab: new CollaborationHub(clock, governance),
  };
}

describe('KnowledgeGraph — nodes, versions, edges, memory, search', () => {
  it('versions a document on every edit and preserves history', async () => {
    const { knowledge } = setup();
    const doc = await knowledge.add({ type: 'document', title: 'Spec', body: 'v1', tags: ['design'] });
    await knowledge.update(doc.id, { body: 'v2' });
    await knowledge.update(doc.id, { title: 'Spec (final)', body: 'v3' });
    expect(knowledge.get(doc.id)?.version).toBe(3);
    expect(knowledge.versions(doc.id).map((v) => v.body)).toEqual(['v1', 'v2', 'v3']);
  });

  it('links nodes and walks neighbors', async () => {
    const { knowledge } = setup();
    const a = await knowledge.add({ type: 'document', title: 'Design' });
    const b = await knowledge.add({ type: 'note', title: 'Followup' });
    await knowledge.link(a.id, b.id, 'references');
    expect(knowledge.neighbors(a.id).map((n) => n.id)).toEqual([b.id]);
    expect(knowledge.edgesOf(b.id)).toHaveLength(1);
  });

  it('scopes memory and recalls the latest value', async () => {
    const { knowledge } = setup();
    await knowledge.remember('workspace', 'goal', 'ship v1', { workspaceId: 'ws_1' });
    await knowledge.remember('workspace', 'goal', 'ship v2', { workspaceId: 'ws_1' });
    expect(knowledge.recall('workspace', 'goal')?.body).toBe('ship v2');
    expect(knowledge.recall('organization', 'goal')).toBeUndefined();
  });

  it('search (mock semantic interface) ranks by keyword overlap', async () => {
    const { knowledge } = setup();
    await knowledge.add({ type: 'document', title: 'Kubernetes runbook', body: 'scaling pods and nodes' });
    await knowledge.add({ type: 'document', title: 'Cooking notes', body: 'pasta recipes' });
    const results = knowledge.search('scaling kubernetes pods');
    expect(results[0]?.node.title).toBe('Kubernetes runbook');
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});

describe('CollaborationHub — threads, presence, shared sessions, activity feed', () => {
  it('threads carry comments and route mentions via notify', async () => {
    const { collab, governance } = setup();
    const thread = await collab.startThread('ws_1', 'Launch plan');
    await collab.post(thread.id, 'prin_a', 'thoughts @bob?', ['prin_bob']);
    expect(collab.threadComments(thread.id)).toHaveLength(1);
    expect(governance.history().flatMap((r) => r.notify ?? [])).toContain('prin_bob');
  });

  it('tracks presence and shared context per workspace', async () => {
    const { collab } = setup();
    await collab.setPresence('prin_a', 'ws_1', 'online');
    await collab.shareContext('ws_1', 'focus', 'Q3 launch', 'prin_a');
    expect(collab.presenceIn('ws_1')).toHaveLength(1);
    expect(collab.getContext('ws_1', 'focus')).toBe('Q3 launch');
  });

  it('runs shared AI sessions with human + AI participants and projects an activity feed', async () => {
    const { collab } = setup();
    const session = await collab.startSharedSession('ws_1', 'incident', ['prin_human', 'aiemp_1']);
    await collab.joinSession(session.id, 'prin_observer');
    expect(collab.session(session.id)?.participants).toContain('prin_observer');
    const feed = collab.activityFeed('ws_1');
    expect(feed.some((r) => r.action === 'session.start')).toBe(true);
    expect(feed.some((r) => r.action === 'session.join')).toBe(true);
  });
});
