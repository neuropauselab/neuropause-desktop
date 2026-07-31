/**
 * Phase 6 Stage 5 (D-10) — main-side productivity benchmarks with REAL executed
 * timings, printed for the validation record and asserted against the 5.12
 * budgets: brief generation ≤500 ms at 5k entities; a task operation (parse +
 * durable inbox-pattern write) ≤100 ms; recommendation generation measured.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UnifiedEntity } from '@neuropause/shared';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { generateRecommendations } from '../recommendations/recommendationEngine';
import { InboxStore } from '../notifications/inboxStore';
import { parseTaskCommand } from './assistantModel';

const NOW = '2026-07-31T14:00:00.000Z';

function entity(i: number): UnifiedEntity {
  const kinds = ['task', 'message', 'calendar_event', 'document', 'project'] as const;
  const kind = kinds[i % kinds.length]!;
  const hour = String(6 + (i % 12)).padStart(2, '0');
  return {
    id: `e${i}`,
    kind,
    connectorId: 'm365',
    accountId: 'a',
    sourceId: `s${i}`,
    createdAt: `2026-07-31T${hour}:00:00.000Z`,
    updatedAt: `2026-07-31T${hour}:00:00.000Z`,
    syncState: 'active',
    syncedAt: NOW,
    metadata: {},
    title: `Entity ${i}`,
    url: null,
    parentId: null,
    containerId: i % 5 === 4 ? null : `e${i - (i % 5)}`,
    body: null,
    status: kind === 'message' ? (i % 3 === 0 ? 'unread' : 'read') : i % 4 === 0 ? 'completed' : 'open',
    author: `Person ${i % 40}`,
    timestamp: `2026-07-31T${hour}:00:00.000Z`,
    endTimestamp: null,
    labels: [],
  } as UnifiedEntity;
}

describe('stage 5 productivity benchmarks (real timings)', () => {
  it('generates the afternoon brief over 5k entities within the 500 ms budget', () => {
    const entities = Array.from({ length: 5000 }, (_, i) => entity(i));
    const started = performance.now();
    const brief = generateBriefing('afternoon', { entities, events: [], now: NOW });
    const ms = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(`brief.generate    ${ms.toFixed(1)} ms / 5k entities → ${brief.sections.length} section(s), grounded=${brief.grounded}`);
    expect(brief.grounded).toBe(true);
    expect(ms).toBeLessThan(500);
  });

  it('parses + durably records a task operation within the 100 ms budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-bench5-'));
    try {
      const store = new InboxStore(join(dir, 'ops.json'));
      const started = performance.now();
      const cmd = parseTaskCommand('add a task to send the Q3 deck tomorrow, urgent', NOW)!;
      await store.add({
        id: 'bench-task-op',
        title: cmd.title as string,
        body: 'durable write',
        priority: 'high',
        sourceKey: 'system',
        deepLink: null,
        at: NOW,
        read: false,
      });
      const ms = performance.now() - started;
      // eslint-disable-next-line no-console
      console.log(`task.op           ${ms.toFixed(1)} ms (deterministic parse + atomic durable write)`);
      expect(cmd.action).toBe('create');
      expect(ms).toBeLessThan(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates recommendations (incl. the 5 new rules) over 5k entities — measured', () => {
    const entities = Array.from({ length: 5000 }, (_, i) => entity(i));
    const started = performance.now();
    const recs = generateRecommendations({
      entities,
      events: [],
      now: NOW,
      pendingApprovals: Array.from({ length: 20 }, (_, i) => ({
        jobId: `j${i}`,
        title: `Proposal ${i}`,
        workerName: 'Worker',
        createdAt: NOW,
      })),
      connectors: [{ id: 'slack', problem: 'health degraded' }],
      executionHistory: Array.from({ length: 100 }, (_, i) => ({
        kind: 'automation',
        targetId: `r${i % 10}`,
        label: `Rule ${i % 10}`,
        startedAt: NOW,
        state: 'completed',
      })),
      conversations: Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        title: `Conv ${i}`,
        updatedAt: NOW,
        waitingSteps: i % 3 === 0 ? 2 : 0,
      })),
    });
    const ms = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(`recommendations   ${ms.toFixed(1)} ms / 5k entities → ${recs.length} recommendation(s)`);
    expect(recs.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000); // generous ceiling; real figure printed above
  });
});
