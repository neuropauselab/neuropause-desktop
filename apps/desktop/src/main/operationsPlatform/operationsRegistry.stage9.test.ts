/**
 * Phase 6 Stage 9 — registry integrity + the doc lock (the Stage 6/7/8
 * precedent): the operations registries are structurally valid, reuse the
 * Stage 6 domain vocabulary exactly, name only REAL signals/KPI keys/mined
 * process types, and are locked to
 * docs/desktop/operations/OPERATIONS-PLATFORM.md so code and doc cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSIGHT_HEALTH_DOMAINS, OPERATIONS_QUESTION_KEYS } from '@neuropause/shared';
import {
  DOMAIN_REGISTRY,
  OBJECTIVE_REGISTRY,
  PROCESS_REGISTRY,
  SERVICE_REGISTRY,
  SLA_BY_ID,
  SLA_REGISTRY,
  operationsRegistryIssues,
} from './operationsRegistry';

// The six REAL executive KPI keys (executiveCenter buildKpis) — registry kpiKeys must be a subset.
const REAL_KPI_KEYS = ['org-health', 'engineering-health', 'ai-adoption', 'connector-health', 'license-status', 'active-members'];
// The REAL mined process types (the process-mining ProcessType union).
const REAL_PROCESS_TYPES = ['order_to_cash', 'procure_to_pay', 'make_to_complete'];

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(operationsRegistryIssues()).toEqual([]);
  });

  it('domains reuse the Stage 6 eight-domain vocabulary exactly (no second model)', () => {
    expect(DOMAIN_REGISTRY.map((d) => d.key).sort()).toEqual([...INSIGHT_HEALTH_DOMAINS].sort());
    expect(DOMAIN_REGISTRY).toHaveLength(8);
  });

  it('every domain maps to a REAL seeded org-unit name', () => {
    const SEEDED = ['Product & Engineering', 'Engineering', 'Platform Team', 'AI Team', 'Design', 'Business', 'Sales', 'Marketing', 'Finance', 'Legal', 'Operations', 'IT', 'Support'];
    for (const d of DOMAIN_REGISTRY) expect(SEEDED, d.key).toContain(d.owningUnitName);
  });

  it('ships 7 services, 9 SLA targets, 4 objectives, 4 processes', () => {
    expect(SERVICE_REGISTRY).toHaveLength(7);
    expect(SLA_REGISTRY).toHaveLength(9);
    expect(OBJECTIVE_REGISTRY).toHaveLength(4);
    expect(PROCESS_REGISTRY).toHaveLength(4);
  });

  it('every service kpiKey is a REAL executive KPI key', () => {
    for (const s of SERVICE_REGISTRY) for (const k of s.kpiKeys) expect(REAL_KPI_KEYS, s.id).toContain(k);
    for (const o of OBJECTIVE_REGISTRY) for (const k of o.kpiKeys) expect(REAL_KPI_KEYS, o.id).toContain(k);
  });

  it('exactly the two none-measured services carry declared-unmeasurable targets (measuredBy null)', () => {
    const noneMeasured = SERVICE_REGISTRY.filter((s) => s.signal === 'none-measured').map((s) => s.id);
    expect(noneMeasured.sort()).toEqual(['assistant-experience', 'notification-delivery']);
    const nullTargets = SLA_REGISTRY.filter((t) => t.measuredBy === null);
    expect(nullTargets.map((t) => t.serviceId).sort()).toEqual(['assistant-experience', 'notification-delivery']);
    // And every measured target names its aggregate.
    for (const t of SLA_REGISTRY) {
      if (t.measuredBy !== null) expect(t.measuredBy.length, t.id).toBeGreaterThan(0);
    }
  });

  it('mined process types are REAL ProcessType values; the not-mined gap is explicit', () => {
    for (const p of PROCESS_REGISTRY) {
      if (p.minedType !== null) expect(REAL_PROCESS_TYPES, p.id).toContain(p.minedType);
    }
    expect(PROCESS_REGISTRY.filter((p) => p.minedType === null).map((p) => p.id)).toEqual(['employee-onboarding']);
  });

  it('every service SLA ref resolves and every objective SLA ref resolves', () => {
    for (const s of SERVICE_REGISTRY) for (const t of s.slaTargetIds) expect(SLA_BY_ID.has(t), `${s.id}:${t}`).toBe(true);
    for (const o of OBJECTIVE_REGISTRY) for (const t of o.slaTargetIds) expect(SLA_BY_ID.has(t), `${o.id}:${t}`).toBe(true);
  });
});

describe('registry ↔ doc lock (docs/desktop/operations/OPERATIONS-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/operations/OPERATIONS-PLATFORM.md'), 'utf8');

  it('documents every domain, service, SLA target, objective, and process id', () => {
    for (const d of DOMAIN_REGISTRY) expect(doc).toContain(`\`${d.key}\``);
    for (const s of SERVICE_REGISTRY) expect(doc).toContain(`\`${s.id}\``);
    for (const t of SLA_REGISTRY) expect(doc).toContain(`\`${t.id}\``);
    for (const o of OBJECTIVE_REGISTRY) expect(doc).toContain(`\`${o.id}\``);
    for (const p of PROCESS_REGISTRY) expect(doc).toContain(`\`${p.id}\``);
  });

  it('documents the six eops:* channels, the ten question keys, and the watch source', () => {
    for (const ch of ['eops:catalog', 'eops:health', 'eops:readiness', 'eops:incidents', 'eops:continuity', 'eops:dashboard']) {
      expect(doc).toContain(`\`${ch}\``);
    }
    for (const key of OPERATIONS_QUESTION_KEYS) expect(doc).toContain(`\`${key}\``);
    expect(doc).toContain('operations-watch');
  });

  it('documents the invariants: existing spine, no ticket store, declared unmeasurable, honest zero/unknown', () => {
    expect(doc).toContain('Assistant → Approval → ExecuteEngine → Workforce → Connector Executors');
    expect(doc).toContain('Zero mutation channels');
    expect(doc).toContain('`transient: true`');
    expect(doc).toContain('declared unmeasurable');
    expect(doc).toContain('Unknown stays unknown');
    expect(doc).toContain('Honest zero');
    expect(doc).toContain('autonomousops:read');
  });

  it('documents the five performance budgets', () => {
    expect(doc).toContain('service catalog ≤ 100 ms');
    expect(doc).toContain('operational health compose ≤ 100 ms');
    expect(doc).toContain('readiness ≤ 100 ms');
    expect(doc).toContain('continuity ≤ 50 ms');
    expect(doc).toContain('dashboard composition ≤ 500 ms');
  });
});
