/**
 * Phase 6 Stage 8 — the Platform tab's pure view-model: kind/severity maps are
 * total, header stats project the dashboard without invention, plan projection
 * makes Principle C gates and the Principle D envelope visible, and the honesty
 * strips (disclosures + deduped unavailable) always surface.
 */
import { describe, expect, it } from 'vitest';
import type {
  AutomationCapabilityKind,
  AutomationCatalog,
  AutomationMonitorReport,
  AutomationPlan,
  AutomationPlatformDashboard,
  AutomationPoliciesView,
} from '@neuropause/shared';
import {
  apHeaderStats,
  capabilityKindIcon,
  capabilityKindLabel,
  catalogRows,
  chainRows,
  disclosureLines,
  findingRows,
  isPlan,
  kindCountRows,
  planView,
  playbookRows,
  policyDefaultRows,
  severityTone,
  unavailableLines,
} from './apPlatformModel';

const KINDS: AutomationCapabilityKind[] = [
  'automation-rule',
  'playbook',
  'workflow-run',
  'delivery-source',
  'scheduled-validation',
  'autoops-plans',
  'assistant-capability',
];

function dashboard(over: Partial<AutomationPlatformDashboard> = {}): AutomationPlatformDashboard {
  return {
    generatedAt: '2026-07-15T09:00:00.000Z',
    catalog: { entries: 12, byKind: [{ kind: 'automation-rule', count: 5 }, { kind: 'playbook', count: 4 }] },
    playbooks: { count: 4, categories: [{ category: 'operations', count: 2 }] },
    schedules: { rules: 3, parseable: 2, unparseable: 1, nextDue: '2026-07-15T09:00:00.000Z' },
    monitor: { findings: 2, critical: 0, high: 1, top: [] },
    policies: { defaults: 3, autoAllowedTriggers: [], governedTriggers: 1 },
    disclosures: ['d1'],
    unavailable: [],
    ...over,
  };
}

function catalog(): AutomationCatalog {
  return {
    generatedAt: '2026-07-15T09:00:00.000Z',
    entries: [
      {
        id: 'rule:r1',
        kind: 'automation-rule',
        name: 'R1',
        owner: null,
        authority: 'org-defined',
        executionPath: 'runner',
        approval: 'gated',
        rollback: ['none'],
        confidence: 1,
        persistence: 'store',
        recovery: 'records',
        observability: 'monitor',
        dependencies: [],
        consumers: [],
        status: 'active',
        schedule: { label: 'someday', parsed: null, issue: 'outside subset', nextDue: null },
      },
      {
        id: 'rule:r2',
        kind: 'automation-rule',
        name: 'R2',
        owner: null,
        authority: 'org-defined',
        executionPath: 'runner',
        approval: 'gated',
        rollback: ['none'],
        confidence: 1,
        persistence: 'store',
        recovery: 'records',
        observability: 'monitor',
        dependencies: [],
        consumers: [],
        status: 'active',
        schedule: { label: 'daily 9am', parsed: { kind: 'daily', atMinutes: 540 }, issue: null, nextDue: '2026-07-16T09:00:00.000Z' },
      },
    ],
    totals: { byKind: [{ kind: 'automation-rule', count: 2 }], entries: 2 },
    disclosures: ['in-memory run map'],
    unavailable: [{ system: 'sandbox', reason: 'offline' }],
  };
}

describe('total maps', () => {
  it('labels and icons cover all seven capability kinds', () => {
    for (const k of KINDS) {
      expect(capabilityKindLabel(k).length).toBeGreaterThan(0);
      expect(capabilityKindIcon(k).length).toBeGreaterThan(0);
    }
  });
  it('severity tones: critical/high red, medium orange, low gray', () => {
    expect(severityTone('critical')).toBe('red');
    expect(severityTone('high')).toBe('red');
    expect(severityTone('medium')).toBe('orange');
    expect(severityTone('low')).toBe('gray');
  });
});

describe('header stats', () => {
  it('projects the five dashboard chips with honest tones', () => {
    const stats = apHeaderStats(dashboard());
    expect(stats.map((s) => s.label)).toEqual(['Catalog entries', 'Playbooks', 'Schedule rules', 'Monitor findings', 'Auto-executable triggers']);
    expect(stats[2].tone).toBe('orange'); // an unparseable schedule flags the chip
    expect(stats[3].tone).toBe('orange'); // high findings
    expect(stats[4].hint).toContain('everything requires human approval');
  });
  it('the default-deny posture reads green/critical honestly', () => {
    const clean = apHeaderStats(dashboard({ monitor: { findings: 0, critical: 0, high: 0, top: [] }, schedules: { rules: 0, parseable: 0, unparseable: 0, nextDue: null } }));
    expect(clean[3].tone).toBe('green');
    const bad = apHeaderStats(dashboard({ monitor: { findings: 3, critical: 1, high: 0, top: [] } }));
    expect(bad[3].tone).toBe('red');
  });
});

describe('catalog + playbook rows', () => {
  it('catalog rows surface the schedule issue vs the next due', () => {
    const rows = catalogRows(catalog());
    expect(rows[0].scheduleText).toContain('outside subset');
    expect(rows[0].scheduleTone).toBe('orange');
    expect(rows[1].scheduleText).toContain('next due 2026-07-16');
    expect(rows[1].scheduleTone).toBe('gray');
  });
  it('kind counts label the totals', () => {
    expect(kindCountRows(catalog())).toEqual([{ kind: 'automation-rule', label: 'Automation rule', count: 2 }]);
  });
  it('playbook rows count worker + side-effecting steps', () => {
    const rows = playbookRows([
      {
        id: 'p1',
        version: 2,
        name: 'P1',
        description: '',
        category: 'operations',
        steps: [
          { id: 'a', kind: 'worker', label: 'A', workerId: 'w', skillId: 's', dependsOn: [], sideEffects: false, affectedSystems: [] },
          { id: 'b', kind: 'worker', label: 'B', workerId: 'w', skillId: 's', dependsOn: [], sideEffects: true, affectedSystems: ['x'] },
          { id: 'g', kind: 'approval', label: 'G', approvalPrompt: 'ok?', dependsOn: [], sideEffects: false, affectedSystems: [] },
        ],
        why: 'w',
        triggeringConditions: ['t'],
        expectedOutcome: 'o',
        affectedSystems: ['x'],
        approvalTrigger: 'workforce_side_effect',
        knowledgeRefs: [],
        policyDefaultsId: 'standard-ops',
      },
    ]);
    expect(rows[0].versionText).toBe('v2');
    expect(rows[0].stepsText).toBe('3 step(s) · 2 worker · 1 side-effecting');
    expect(rows[0].sideEffectSteps).toBe(1);
  });
});

describe('plan projection (Principle C + D visible)', () => {
  const plan: AutomationPlan = {
    playbookId: 'p1',
    version: 1,
    name: 'P1',
    workflow: {
      id: 'pb:p1@v1',
      name: 'P1',
      description: '',
      steps: [
        { id: 'read', kind: 'worker', workerId: 'w', skillId: 's', input: {}, dependsOn: [], retry: 0, timeoutMs: 1000 },
        { id: 'write:approval', kind: 'approval', dependsOn: ['read'], approvalPrompt: 'Approve: write?' },
        { id: 'write', kind: 'worker', workerId: 'w', skillId: 's', input: {}, dependsOn: ['write:approval'], retry: 0, timeoutMs: 1000 },
      ],
    },
    issues: [{ stepId: 'write', message: 'sample issue' }],
    explainability: { why: 'why', evidence: ['e1'], triggeringConditions: ['t1'], expectedOutcome: 'out', rollback: 'rb', confidence: 0.9, affectedSystems: ['memory'] },
    policy: {
      playbookId: 'p1',
      approvalTrigger: 'workforce_side_effect',
      requiredApprovals: [{ trigger: 'workforce_side_effect', governed: true, chainName: 'Ops', steps: 2 }],
      autoExecutable: false,
      allowedConnectors: null,
      executionWindow: { days: [1, 2], startMinutes: 480, endMinutes: 1080 },
      windowOpenNow: false,
      retry: { maxAttempts: 2, backoffMs: 60_000 },
      escalation: { afterMs: 3_600_000, note: 'escalate' },
      rollback: { available: true, kinds: ['workflow-replay', 'none'], steps: [{ stepId: 'write', label: 'Write', kind: 'none', detail: 'no undo' }], note: 'n' },
      basis: ['chains govern'],
    },
    approvals: { trigger: 'workforce_side_effect', governed: true, chainName: 'Ops', steps: [{ order: 1, name: 'Lead', roleId: 'r1', roleName: 'Team Lead' }], autoExecutable: false, note: 'governed' },
    simulation: { scenario: { kind: 'enterprise', category: 'automation', metadata: { title: 't' }, tags: [], preconditions: [], variables: {}, dataset: null, steps: [], assertions: [], expected: [], artifacts: [], cleanup: [], metrics: [], dependsOn: [], defaultChannel: 'automation', retry: { maxAttempts: 1 }, approval: { required: false }, timeoutMs: 1000 }, scenarioKey: 'ap-sim:p1@v1', lastRun: null, note: 'sandbox note' },
    knowledge: [{ ref: 'sop', matched: false }],
  };

  it('isPlan discriminates the not-found shape', () => {
    expect(isPlan(plan)).toBe(true);
    expect(isPlan({ playbookId: 'x', found: false })).toBe(false);
  });

  it('marks INSERTED gates, lists the seven explainability lines, and states the honest rollback + knowledge miss', () => {
    const v = planView(plan);
    expect(v.insertedGates).toBe(1);
    const gate = v.workflowStepRows.find((r) => r.id === 'write:approval')!;
    expect(gate.isInsertedGate).toBe(true);
    expect(gate.kindLabel).toBe('Approval checkpoint');
    expect(v.explainabilityLines.map((l) => l.label)).toEqual(['Why', 'Evidence', 'Triggers when', 'Expected outcome', 'Rollback', 'Confidence', 'Affected systems']);
    expect(v.explainabilityLines[5].text).toBe('90%');
    expect(v.policyLines[0]).toContain('human approval required');
    expect(v.policyLines[2]).toContain('CLOSED now');
    expect(v.approvalLines[0]).toContain('Team Lead');
    expect(v.rollbackLines[0]).toContain('no undo');
    expect(v.simulationNote).toContain('No sandbox run recorded');
    expect(v.knowledgeLines[0]).toContain('honest miss');
    expect(v.issueLines).toEqual(['write: sample issue']);
  });
});

describe('monitor + policies rows and honesty strips', () => {
  it('finding rows carry severity tones and evidence counts', () => {
    const m: AutomationMonitorReport = {
      generatedAt: 'x',
      findings: [{ id: 'f1', kind: 'failed-run', severity: 'high', title: 'T', detail: 'D', evidence: ['a', 'b'], affectedSystems: ['automation'], suggestedAction: 'Fix', confidence: 1 }],
      totals: { byKind: [{ kind: 'failed-run', count: 1 }], findings: 1 },
      unavailable: [],
    };
    const rows = findingRows(m);
    expect(rows[0].tone).toBe('red');
    expect(rows[0].evidenceCount).toBe(2);
  });

  it('policy default rows + chain rows project windows/retry/override honestly', () => {
    const v: AutomationPoliciesView = {
      generatedAt: 'x',
      defaults: [
        { id: 'std', label: 'Standard', allowedConnectors: null, executionWindow: { days: [1, 2], startMinutes: 480, endMinutes: 1080 }, retry: { maxAttempts: 2, backoffMs: 60_000 }, escalation: { afterMs: 86_400_000, note: 'n' }, requiresApprovalOverride: false },
        { id: 'crit', label: 'Critical', allowedConnectors: null, executionWindow: null, retry: { maxAttempts: 3, backoffMs: 30_000 }, escalation: { afterMs: 3_600_000, note: 'n' }, requiresApprovalOverride: true },
      ],
      autoAllowedTriggers: [],
      chains: [{ trigger: 'workforce_side_effect', chainName: 'Ops', steps: 2 }],
      note: 'note',
    };
    const rows = policyDefaultRows(v);
    expect(rows[0].windowText).toContain('480–1080');
    expect(rows[0].overrideText).toBeNull();
    expect(rows[1].windowText).toBe('no execution window');
    expect(rows[1].overrideText).toContain('always requires human approval');
    expect(chainRows(v)).toEqual([{ trigger: 'workforce_side_effect', text: 'Ops (2 step(s))' }]);
  });

  it('disclosures fall back catalog → dashboard; unavailable lines dedupe across parts', () => {
    expect(disclosureLines(catalog(), null)).toEqual(['in-memory run map']);
    expect(disclosureLines(null, dashboard())).toEqual(['d1']);
    expect(disclosureLines(null, null)).toEqual([]);
    const lines = unavailableLines([
      { unavailable: [{ system: 'sandbox', reason: 'offline' }] },
      { unavailable: [{ system: 'sandbox', reason: 'offline' }, { system: 'org', reason: 'no roles' }] },
    ]);
    expect(lines).toEqual(['sandbox: offline', 'org: no roles']);
  });
});
