/**
 * Phase 6 Stage 5 (D-7) — the five additive recommendation rules. Each fires
 * only on its real condition, stays silent when its aux input is absent, and
 * carries the 5.11 explainability fields (suggestedAction / affectedSystems /
 * confidence) alongside rationale + evidence.
 */
import { describe, expect, it } from 'vitest';
import type { UnifiedEntity } from '@neuropause/shared';
import { generateRecommendations, type RecommendationInput } from './recommendationEngine';

const NOW = '2026-07-31T09:00:00.000Z';

function baseInput(over: Partial<RecommendationInput> = {}): RecommendationInput {
  return { entities: [], events: [], now: NOW, ...over };
}

function message(id: string, over: Partial<UnifiedEntity> = {}): UnifiedEntity {
  return {
    id,
    kind: 'message',
    connectorId: 'm365',
    accountId: 'a',
    sourceId: id,
    createdAt: '2026-07-25T09:00:00.000Z',
    updatedAt: '2026-07-25T09:00:00.000Z',
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: `Message ${id}`,
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: 'unread',
    author: 'Sam',
    timestamp: '2026-07-25T09:00:00.000Z',
    endTimestamp: null,
    labels: [],
    ...over,
  } as UnifiedEntity;
}

describe('open_approval', () => {
  it('fires per pending approval with age-scaled priority', () => {
    const recs = generateRecommendations(
      baseInput({
        pendingApprovals: [
          { jobId: 'j1', title: 'Send invoice chase', workerName: 'Finance Bot', createdAt: '2026-07-27T09:00:00.000Z' },
          { jobId: 'j2', title: 'New today', workerName: 'Ops Bot', createdAt: NOW },
        ],
      }),
    );
    const aged = recs.find((r) => r.id === 'rec:open_approval:j1')!;
    expect(aged.kind).toBe('open_approval');
    expect(aged.priority).toBe('high'); // 4 days old
    expect(aged.rationale).toContain('Finance Bot');
    expect(aged.suggestedAction).toContain('Approval Center');
    expect(aged.affectedSystems).toEqual(['workforce', 'approvals']);
    expect(aged.confidence).toBe(1);
    expect(recs.find((r) => r.id === 'rec:open_approval:j2')!.priority).toBe('normal');
  });

  it('is silent without the aux input', () => {
    expect(generateRecommendations(baseInput()).filter((r) => r.kind === 'open_approval')).toEqual([]);
  });
});

describe('connector_issue', () => {
  it('fires only for connectors with a problem', () => {
    const recs = generateRecommendations(
      baseInput({
        connectors: [
          { id: 'slack', problem: 'health degraded (status error)' },
          { id: 'gmail', problem: null },
        ],
      }),
    );
    const issues = recs.filter((r) => r.kind === 'connector_issue');
    expect(issues.length).toBe(1);
    expect(issues[0]!.connectorId).toBe('slack');
    expect(issues[0]!.rationale).toBe('health degraded (status error)');
    expect(issues[0]!.suggestedAction).toContain('Connections');
  });
});

describe('automation_opportunity', () => {
  const run = (targetId: string, startedAt: string): NonNullable<RecommendationInput['executionHistory']>[number] => ({
    kind: 'automation',
    targetId,
    label: 'Weekly digest',
    startedAt,
    state: 'completed',
  });

  it('fires at ≥3 manual completed runs of the same rule within 7 days', () => {
    const recs = generateRecommendations(
      baseInput({
        executionHistory: [
          run('r1', '2026-07-29T09:00:00.000Z'),
          run('r1', '2026-07-30T09:00:00.000Z'),
          run('r1', '2026-07-31T08:00:00.000Z'),
          run('r2', '2026-07-30T09:00:00.000Z'), // only once
          run('r1', '2026-07-01T09:00:00.000Z'), // outside the window
        ],
      }),
    );
    const opps = recs.filter((r) => r.kind === 'automation_opportunity');
    expect(opps.length).toBe(1);
    expect(opps[0]!.id).toBe('rec:automation_opportunity:r1');
    expect(opps[0]!.rationale).toContain('3 times');
    expect(opps[0]!.affectedSystems).toContain('automation');
  });

  it('stays silent below the threshold', () => {
    const recs = generateRecommendations(
      baseInput({ executionHistory: [run('r1', '2026-07-30T09:00:00.000Z'), run('r1', '2026-07-31T08:00:00.000Z')] }),
    );
    expect(recs.filter((r) => r.kind === 'automation_opportunity')).toEqual([]);
  });
});

describe('followup_conversation', () => {
  it('fires only for conversations with waiting plan steps', () => {
    const recs = generateRecommendations(
      baseInput({
        conversations: [
          { id: 'c1', title: 'Chase the invoice', updatedAt: '2026-07-29T09:00:00.000Z', waitingSteps: 2 },
          { id: 'c2', title: 'Nothing pending', updatedAt: NOW, waitingSteps: 0 },
        ],
      }),
    );
    const follow = recs.filter((r) => r.kind === 'followup_conversation');
    expect(follow.length).toBe(1);
    expect(follow[0]!.rationale).toContain('2 plan step(s)');
    expect(follow[0]!.priority).toBe('high'); // idle 2 days
    expect(follow[0]!.suggestedAction).toContain('Assistant');
  });
});

describe('unanswered_email', () => {
  it('fires for unread messages older than 2 days, not fresh ones', () => {
    const recs = generateRecommendations(
      baseInput({
        entities: [
          message('old'), // 6 days unread
          message('fresh', { timestamp: NOW, createdAt: NOW, updatedAt: NOW }),
          message('read', { status: 'read' }),
        ],
      }),
    );
    const mails = recs.filter((r) => r.kind === 'unanswered_email');
    expect(mails.length).toBe(1);
    expect(mails[0]!.id).toBe('rec:unanswered_email:old');
    expect(mails[0]!.rationale).toContain('from Sam');
    expect(mails[0]!.suggestedAction).toContain('draft a reply');
  });
});

describe('kind filtering still applies to the new kinds', () => {
  it('honors query.kinds', () => {
    const recs = generateRecommendations(
      baseInput({ connectors: [{ id: 'slack', problem: 'down' }], entities: [message('old')] }),
      { kinds: ['connector_issue'] },
    );
    expect(recs.every((r) => r.kind === 'connector_issue')).toBe(true);
    expect(recs.length).toBe(1);
  });
});
