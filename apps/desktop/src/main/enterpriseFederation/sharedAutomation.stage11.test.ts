/**
 * Phase 6 Stage 11 — shared automation (S8 composition): the REAL playbooks as
 * shareable candidates, template artifacts counted from records, monitor
 * counts platform-wide WITH the no-attribution honesty.
 */
import { describe, expect, it } from 'vitest';
import { buildSharedAutomation } from './sharedAutomation';

describe('buildSharedAutomation', () => {
  it('joins playbooks to template artifacts by stated name heuristic; counts monitor findings', () => {
    const v = buildSharedAutomation({
      artifacts: [
        { kind: 'workflow_template', name: 'Daily Ops Review' },
        { kind: 'workflow_template', name: 'Something Foreign' },
        { kind: 'ai_worker', name: 'Not a template' },
      ],
      playbooks: [
        { id: 'daily-ops-review', name: 'Daily Ops Review', version: 2 },
        { id: 'incident-first-response', name: 'Incident First Response', version: 1 },
      ],
      apFindings: [
        { severity: 'critical' },
        { severity: 'low' },
      ],
      failures: {},
    });
    expect(v.templatesPublished).toBe(2);
    expect(v.playbookCandidates.find((p) => p.id === 'daily-ops-review')!.nameMatchedArtifact).toBe('Daily Ops Review');
    expect(v.playbookCandidates.find((p) => p.id === 'incident-first-response')!.nameMatchedArtifact).toBeNull();
    expect(v.monitorFindings).toEqual({ total: 2, criticalOrHigh: 1 });
  });

  it('an empty exchange is a declared linkage gap; an unreadable monitor stays null', () => {
    const v = buildSharedAutomation({
      artifacts: [],
      playbooks: [{ id: 'p', name: 'P', version: 1 }],
      apFindings: null,
      failures: {},
    });
    expect(v.gaps.some((g) => g.detail.includes('no workflow_template artifact'))).toBe(true);
    expect(v.monitorFindings).toBeNull();
  });

  it('an unreadable playbook registry is a gap + unavailable, never a silent empty list', () => {
    const v = buildSharedAutomation({ artifacts: [], playbooks: null, apFindings: [], failures: { 'automation-playbooks': 'unreadable' } });
    expect(v.playbookCandidates).toEqual([]);
    expect(v.gaps.some((g) => g.subject === 'playbooks')).toBe(true);
    expect(v.unavailable).toContainEqual({ system: 'automation-playbooks', reason: 'unreadable' });
  });
});
