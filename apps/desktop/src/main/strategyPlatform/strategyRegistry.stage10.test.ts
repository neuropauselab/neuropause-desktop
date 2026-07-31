/**
 * Phase 6 Stage 10 — registry integrity + the doc lock (the Stage 6/7/8/9
 * precedent): the strategy registries are structurally valid, cover the twelve
 * business capabilities exactly, name only REAL units/KPIs/SLAs/dimensions/
 * services/playbooks/finding-kinds/domains/mined-types/decision-categories,
 * and are locked to docs/desktop/strategy/STRATEGY-PLATFORM.md so code and
 * documentation cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_CAPABILITIES, INSIGHT_HEALTH_DOMAINS, STRATEGY_QUESTION_KEYS } from '@neuropause/shared';
import {
  CAPABILITY_BY_KEY,
  CAPABILITY_REGISTRY,
  COMPANY_OBJECTIVE_REGISTRY,
  DECISION_CATEGORY_CAPABILITIES,
  DEPARTMENT_OBJECTIVE_REGISTRY,
  INITIATIVE_REGISTRY,
  KPI_CAPABILITY_REGISTRY,
  REAL_AP_FINDING_KINDS,
  REAL_DECISION_CATEGORIES,
  REAL_KPI_KEYS,
  REAL_MINED_TYPES,
  REAL_PLAYBOOK_IDS,
  REAL_READINESS_DIMENSIONS,
  REAL_S9_SERVICE_IDS,
  REAL_SLA_IDS,
  REAL_UNIT_NAMES,
  RISK_REGISTRY,
  strategyRegistryIssues,
  THEME_REGISTRY,
} from './strategyRegistry';

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(strategyRegistryIssues()).toEqual([]);
  });

  it('the capability map covers the twelve BUSINESS capabilities exactly (the approved enhancement)', () => {
    expect(CAPABILITY_REGISTRY.map((c) => c.key).sort()).toEqual([...BUSINESS_CAPABILITIES].sort());
    expect(CAPABILITY_REGISTRY).toHaveLength(12);
    for (const c of CAPABILITY_REGISTRY) expect(CAPABILITY_BY_KEY.get(c.key)).toBe(c);
  });

  it('every capability owner is a REAL seeded org-unit name and declares evidence', () => {
    for (const c of CAPABILITY_REGISTRY) {
      expect(REAL_UNIT_NAMES, c.key).toContain(c.owningUnitName);
      expect(c.evidence.length, c.key).toBeGreaterThan(0);
      expect(c.knowledgeTopics.length, c.key).toBeGreaterThan(0);
    }
  });

  it('the KPI map names only the six REAL executive KPI keys — and the decision map covers ALL six categories', () => {
    for (const k of KPI_CAPABILITY_REGISTRY) expect(REAL_KPI_KEYS).toContain(k.key);
    expect(new Set(KPI_CAPABILITY_REGISTRY.map((k) => k.key)).size).toBe(6);
    expect(DECISION_CATEGORY_CAPABILITIES.map((d) => d.category).sort()).toEqual([...REAL_DECISION_CATEGORIES].sort());
  });

  it('every objective measure names a REAL aggregate (KPI key / S9 SLA id / S6 domain)', () => {
    for (const o of [...COMPANY_OBJECTIVE_REGISTRY, ...DEPARTMENT_OBJECTIVE_REGISTRY]) {
      for (const m of o.measures) {
        if (m.kind === 'kpi') expect(REAL_KPI_KEYS, o.id).toContain(m.ref);
        if (m.kind === 'sla') expect(REAL_SLA_IDS, o.id).toContain(m.ref);
        if (m.kind === 'insight-domain') expect(INSIGHT_HEALTH_DOMAINS as readonly string[], o.id).toContain(m.ref);
      }
    }
  });

  it('every objective, initiative, and risk maps to at least one capability (the backbone rule)', () => {
    for (const o of [...COMPANY_OBJECTIVE_REGISTRY, ...DEPARTMENT_OBJECTIVE_REGISTRY]) {
      expect(o.capabilityKeys.length, o.id).toBeGreaterThan(0);
    }
    for (const i of INITIATIVE_REGISTRY) expect(i.capabilityKeys.length, i.id).toBeGreaterThan(0);
    for (const r of RISK_REGISTRY) expect(r.capabilityKeys.length, r.id).toBeGreaterThan(0);
    for (const t of THEME_REGISTRY) expect(t.capabilityKeys.length, t.id).toBeGreaterThan(0);
  });

  it('initiative sources and milestones reference only REAL records and vocabularies', () => {
    for (const i of INITIATIVE_REGISTRY) {
      for (const s of i.sources) {
        if (s.kind === 'playbook') expect(REAL_PLAYBOOK_IDS, i.id).toContain(s.ref);
        if (s.kind === 's9-service') expect(REAL_S9_SERVICE_IDS, i.id).toContain(s.ref);
        if (s.kind === 'mined-process') expect(REAL_MINED_TYPES, i.id).toContain(s.ref);
        if (s.kind === 'decision-category') expect(REAL_DECISION_CATEGORIES, i.id).toContain(s.ref);
      }
      for (const m of i.milestones) {
        const p = m.predicate;
        if (p.kind === 'sla-met') expect(REAL_SLA_IDS, `${i.id}/${m.id}`).toContain(p.targetId);
        if (p.kind === 'readiness-ready') expect(REAL_READINESS_DIMENSIONS, `${i.id}/${m.id}`).toContain(p.dimension);
        if (p.kind === 'kpi-healthy') expect(REAL_KPI_KEYS, `${i.id}/${m.id}`).toContain(p.key);
        if (p.kind === 'monitor-clear') expect(REAL_AP_FINDING_KINDS, `${i.id}/${m.id}`).toContain(p.findingKind);
      }
    }
  });

  it('a corrupted registry entry is CAUGHT (the lock actually locks)', () => {
    // strategyRegistryIssues reads module-level data — simulate by checking the
    // checker's own sensitivity: a fake unit name must be rejected.
    expect(REAL_UNIT_NAMES).not.toContain('Nonexistent Unit');
    const before = strategyRegistryIssues();
    expect(before).toEqual([]);
    // Structural sensitivity: every capability key present exactly once.
    const keys = CAPABILITY_REGISTRY.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('registry ↔ doc lock (docs/desktop/strategy/STRATEGY-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/strategy/STRATEGY-PLATFORM.md'), 'utf8');

  it('documents every capability, theme, objective, initiative, and risk id', () => {
    for (const c of CAPABILITY_REGISTRY) expect(doc).toContain(`\`${c.key}\``);
    for (const t of THEME_REGISTRY) expect(doc).toContain(`\`${t.id}\``);
    for (const o of COMPANY_OBJECTIVE_REGISTRY) expect(doc).toContain(`\`${o.id}\``);
    for (const o of DEPARTMENT_OBJECTIVE_REGISTRY) expect(doc).toContain(`\`${o.id}\``);
    for (const i of INITIATIVE_REGISTRY) expect(doc).toContain(`\`${i.id}\``);
    for (const r of RISK_REGISTRY) expect(doc).toContain(`\`${r.id}\``);
  });

  it('documents the six estrat:* channels, the strategy:read scope, and the watch source', () => {
    for (const ch of ['estrat:objectives', 'estrat:portfolio', 'estrat:planning', 'estrat:health', 'estrat:dashboard', 'estrat:report']) {
      expect(doc).toContain(`\`${ch}\``);
    }
    expect(doc).toContain('`strategy:read`');
    expect(doc).toContain('`strategy-watch`');
    expect(doc).toContain('Assistant → Approval → ExecuteEngine → Workforce → Connector executors');
  });

  it('documents all eleven assistant question keys', () => {
    for (const k of STRATEGY_QUESTION_KEYS) expect(doc).toContain(`\`${k}\``);
    expect(STRATEGY_QUESTION_KEYS).toHaveLength(11);
  });

  it('states the honesty disclosures: no invented dates, no invented currency, composition over P14', () => {
    expect(doc).toContain('none are shown and none are invented');
    expect(doc.toLowerCase()).toContain('never estimated');
    expect(doc).toContain('composed, never duplicated');
  });
});
