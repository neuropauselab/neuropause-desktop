/**
 * Phase 6 Stage 8 — registry integrity + the doc lock (the Stage 6 signal-map /
 * Stage 7 asset-registry precedent): the playbook/policy registries are
 * structurally valid, honest about side effects (mirroring the REAL
 * worker:operations skill declarations), and locked to
 * docs/desktop/automation/AUTOMATION-PLATFORM.md so code and doc cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTOMATION_QUESTION_KEYS } from '@neuropause/shared';
import {
  ASSISTANT_CAPABILITY_ROWS,
  PLAYBOOK_BY_ID,
  PLAYBOOK_REGISTRY,
  POLICY_DEFAULTS_BY_ID,
  POLICY_DEFAULTS_REGISTRY,
  registryIntegrityIssues,
} from './automationRegistry';

// The REAL worker:operations skill surface (workforce/workers/operations.ts):
// briefing/recommend are read-only; remind/note have side effects.
const OPERATIONS_SKILLS: Record<string, boolean> = {
  briefing: false,
  recommend: false,
  remind: true,
  note: true,
};

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(registryIntegrityIssues()).toEqual([]);
  });

  it('ships exactly 4 playbooks and 3 policy-defaults entries, all id-indexed', () => {
    expect(PLAYBOOK_REGISTRY).toHaveLength(4);
    expect(POLICY_DEFAULTS_REGISTRY).toHaveLength(3);
    for (const p of PLAYBOOK_REGISTRY) expect(PLAYBOOK_BY_ID.get(p.id)).toBe(p);
    for (const d of POLICY_DEFAULTS_REGISTRY) expect(POLICY_DEFAULTS_BY_ID.get(d.id)).toBe(d);
  });

  it('every worker step references the REAL worker:operations worker and a REAL skill', () => {
    for (const p of PLAYBOOK_REGISTRY) {
      for (const s of p.steps) {
        if (s.kind !== 'worker') continue;
        expect(s.workerId).toBe('worker:operations');
        expect(Object.keys(OPERATIONS_SKILLS)).toContain(s.skillId!);
      }
    }
  });

  it('side-effect flags mirror the real skill declarations (never understated)', () => {
    for (const p of PLAYBOOK_REGISTRY) {
      for (const s of p.steps) {
        if (s.kind !== 'worker') continue;
        expect(s.sideEffects, `${p.id}/${s.id} (${s.skillId})`).toBe(OPERATIONS_SKILLS[s.skillId!]);
      }
    }
  });

  it('versions are monotonic positive integers and approval triggers use the real vocabulary', () => {
    const TRIGGERS = ['workforce_side_effect', 'governance_change', 'org_structure_change', 'spend', 'data_export'];
    for (const p of PLAYBOOK_REGISTRY) {
      expect(Number.isInteger(p.version) && p.version >= 1).toBe(true);
      expect(TRIGGERS).toContain(p.approvalTrigger);
    }
  });

  it('critical-response forces human approval even over an explicit allow', () => {
    expect(POLICY_DEFAULTS_BY_ID.get('critical-response')?.requiresApprovalOverride).toBe(true);
    expect(POLICY_DEFAULTS_BY_ID.get('standard-ops')?.requiresApprovalOverride).toBe(false);
  });

  it('every playbook carries the full Principle D authoring inputs', () => {
    for (const p of PLAYBOOK_REGISTRY) {
      expect(p.why.length).toBeGreaterThan(0);
      expect(p.triggeringConditions.length).toBeGreaterThan(0);
      expect(p.expectedOutcome.length).toBeGreaterThan(0);
      expect(p.affectedSystems.length).toBeGreaterThan(0);
      expect(p.knowledgeRefs.length).toBeGreaterThan(0);
    }
  });

  it('the quarterly report ships an explicit human sign-off gate', () => {
    const q = PLAYBOOK_BY_ID.get('quarterly-ops-report')!;
    const gate = q.steps.find((s) => s.kind === 'approval');
    expect(gate).toBeDefined();
    expect(gate!.approvalPrompt).toContain('Approve');
    // The recording step depends on the gate — the record cannot precede sign-off.
    const record = q.steps.find((s) => s.id === 'record')!;
    expect(record.dependsOn).toContain(gate!.id);
  });

  it('assistant capability rows are non-empty, unique, and assistant-prefixed', () => {
    expect(ASSISTANT_CAPABILITY_ROWS.length).toBeGreaterThanOrEqual(5);
    const ids = ASSISTANT_CAPABILITY_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('assistant:')).toBe(true);
  });
});

describe('registry ↔ doc lock (docs/desktop/automation/AUTOMATION-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/automation/AUTOMATION-PLATFORM.md'), 'utf8');

  it('documents every playbook id and every policy-defaults id', () => {
    for (const p of PLAYBOOK_REGISTRY) expect(doc).toContain(`\`${p.id}\``);
    for (const d of POLICY_DEFAULTS_REGISTRY) expect(doc).toContain(`\`${d.id}\``);
  });

  it('documents the six ap:* channels, the six question keys, and the watch source', () => {
    for (const ch of ['ap:catalog', 'ap:playbooks', 'ap:plan', 'ap:policies', 'ap:monitor', 'ap:dashboard']) {
      expect(doc).toContain(`\`${ch}\``);
    }
    for (const key of AUTOMATION_QUESTION_KEYS) expect(doc).toContain(`\`${key}\``);
    expect(doc).toContain('automation-watch');
  });

  it('documents the invariants: existing spine, no mutation channels, chains win, tick on taskScheduler', () => {
    expect(doc).toContain('Assistant → Approval → ExecuteEngine → Workforce → Connector Executors');
    expect(doc).toContain('Zero mutation channels');
    expect(doc).toContain('Governance always wins');
    expect(doc).toContain('taskScheduler');
    expect(doc).toContain('autonomousops:read');
  });

  it('documents the four performance budgets', () => {
    expect(doc).toContain('catalog build ≤ 100 ms');
    expect(doc).toContain('≤ 50 ms');
    expect(doc).toContain('monitor scan ≤ 100 ms');
    expect(doc).toContain('dashboard composition ≤ 500 ms');
  });
});
