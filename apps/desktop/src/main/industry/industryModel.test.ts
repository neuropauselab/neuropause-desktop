/**
 * P13 — Industry Solution Platform model tests. Pure projections over a composed platform snapshot:
 * suite resolution + readiness bands, real-id integrity, compliance rollup, marketplace collections,
 * live KPIs, and the overview bundle.
 */
import { describe, expect, it } from 'vitest';
import { INDUSTRY_IDS, type IndustrySuiteDefinition } from '@neuropause/shared';
import {
  INDUSTRY_SUITES,
  buildCollections,
  buildComplianceReport,
  buildIndustryKpis,
  buildIndustryOverview,
  buildReadinessReport,
  buildSuites,
  resolveSuite,
  type IndustryPlatformState,
} from './industryModel';

/* The REAL, stable platform ids a suite is allowed to reference (from repository recon). */
const REAL_WORKERS = new Set([
  'worker:founder', 'worker:research', 'worker:engineering', 'worker:marketing', 'worker:sales',
  'worker:finance', 'worker:legal', 'worker:operations', 'worker:support',
  'worker:exec-ceo', 'worker:exec-coo', 'worker:exec-cto', 'worker:exec-cfo', 'worker:exec-cio',
  'worker:exec-ciso', 'worker:exec-cdo', 'worker:exec-cco',
  'worker:infra-cloud', 'worker:infra-platform', 'worker:infra-devops', 'worker:infra-k8s',
  'worker:infra-database', 'worker:infra-network', 'worker:infra-security', 'worker:infra-sre',
  'worker:hr', 'worker:procurement',
]);
const REAL_CONNECTORS = new Set([
  'chatgpt', 'claude', 'gemini', 'perplexity', 'cursor', 'github', 'notion', 'slack', 'canva',
  'figma', 'atlassian', 'linear', 'zapier', 'google-workspace', 'microsoft-entra', 'salesforce',
  'hubspot', 'servicenow', 'sap', 'oracle', 'dynamics365', 'workday',
]);
const REAL_RULES = new Set(['rule-side-effects', 'rule-audit', 'rule-chain', 'rule-worker-health', 'rule-orphans', 'rule-leads']);
const REAL_POLICIES = new Set(['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust']);
const REAL_SLUGS = new Set(['research-analyst-worker', 'github-connector', 'inbox-to-notion-automation', 'soc2-governance-pack', 'markdown-export-plugin']);

/** A fully-wired deployment: every referenced entity present AND active. */
function fullState(): IndustryPlatformState {
  return {
    workerIds: [...REAL_WORKERS],
    supportedConnectorIds: [...REAL_CONNECTORS],
    connectedConnectorIds: [...REAL_CONNECTORS],
    complianceRules: [...REAL_RULES].map((id) => ({ id, enabled: true })),
    policyIds: [...REAL_POLICIES],
    publishedSlugs: [...REAL_SLUGS],
  };
}

/** A fresh deployment: platform ships everything, but NO connectors are connected yet. */
function freshState(): IndustryPlatformState {
  return { ...fullState(), connectedConnectorIds: [] };
}

/** An empty deployment: nothing present, nothing active. */
function emptyState(): IndustryPlatformState {
  return {
    workerIds: [],
    supportedConnectorIds: [],
    connectedConnectorIds: [],
    complianceRules: [],
    policyIds: [],
    publishedSlugs: [],
  };
}

function synthDef(over: Partial<IndustrySuiteDefinition> = {}): IndustrySuiteDefinition {
  return {
    id: 'erp',
    name: 'Synthetic',
    sector: 'Test',
    summary: '',
    systems: [],
    workerIds: ['worker:finance'],
    connectorIds: ['sap'],
    complianceRuleIds: [],
    policyIds: [],
    marketplaceSlugs: [],
    frameworks: [],
    kpis: [],
    dashboards: [],
    automations: [],
    playbooks: [],
    reports: [],
    knowledgePacks: [],
    templates: [],
    ...over,
  };
}

describe('INDUSTRY_SUITES — real-id integrity', () => {
  it('registers the 12 verticals with unique ids matching INDUSTRY_IDS', () => {
    expect(INDUSTRY_SUITES).toHaveLength(12);
    const ids = INDUSTRY_SUITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(12);
    expect([...ids].sort()).toEqual([...INDUSTRY_IDS].sort());
  });

  it('references ONLY real, stable platform ids (no fabricated worker/connector/rule/policy/slug)', () => {
    for (const s of INDUSTRY_SUITES) {
      for (const id of s.workerIds) expect(REAL_WORKERS.has(id), `${s.id} worker ${id}`).toBe(true);
      for (const id of s.connectorIds) expect(REAL_CONNECTORS.has(id), `${s.id} connector ${id}`).toBe(true);
      for (const id of s.complianceRuleIds) expect(REAL_RULES.has(id), `${s.id} rule ${id}`).toBe(true);
      for (const id of s.policyIds) expect(REAL_POLICIES.has(id), `${s.id} policy ${id}`).toBe(true);
      for (const slug of s.marketplaceSlugs) expect(REAL_SLUGS.has(slug), `${s.id} slug ${slug}`).toBe(true);
      // Every pack ships the full set of catalog capabilities the spec requires.
      expect(s.workerIds.length).toBeGreaterThan(0);
      expect(s.connectorIds.length).toBeGreaterThan(0);
      expect(s.frameworks.length).toBeGreaterThan(0);
      expect(s.kpis.length).toBeGreaterThan(0);
      expect(s.marketplaceSlugs.length).toBeGreaterThan(0);
    }
  });

  it('every referenced id resolves as present against a full platform (coverage === 1)', () => {
    for (const s of buildSuites(fullState())) {
      expect(s.readiness.coverage, s.id).toBe(1);
    }
  });
});

describe('resolveSuite — readiness bands (connector-driven activation)', () => {
  it('ready when all of the suite connectors are connected', () => {
    const s = resolveSuite(synthDef(), { ...emptyState(), workerIds: ['worker:finance'], supportedConnectorIds: ['sap'], connectedConnectorIds: ['sap'] });
    expect(s.readiness.activation).toBe(1);
    expect(s.status).toBe('ready');
  });

  it('partial when only some of the suite connectors are connected', () => {
    const s = resolveSuite(synthDef({ connectorIds: ['sap', 'oracle'] }), {
      ...emptyState(),
      workerIds: ['worker:finance'],
      supportedConnectorIds: ['sap', 'oracle'],
      connectedConnectorIds: ['sap'],
    });
    expect(s.readiness.coverage).toBe(1); // worker + both connectors shipped by the platform
    expect(s.readiness.activation).toBe(0.5); // 1 of 2 connectors connected
    expect(s.status).toBe('partial');
  });

  it('planned when the platform ships it but NO connectors are connected (honest zero-config)', () => {
    // Worker present, both connectors shipped, but nothing connected. Always-on defaults must NOT
    // lift this to "ready" — activation is connector-driven, so it stays planned.
    const s = resolveSuite(synthDef(), { ...emptyState(), workerIds: ['worker:finance'], supportedConnectorIds: ['sap'], connectedConnectorIds: [] });
    expect(s.readiness.coverage).toBe(1); // shipped
    expect(s.readiness.activation).toBe(0); // not wired
    expect(s.status).toBe('planned');
  });

  it('planned when nothing is present or active', () => {
    const s = resolveSuite(synthDef(), emptyState());
    expect(s.readiness.coverage).toBe(0);
    expect(s.readiness.activation).toBe(0);
    expect(s.status).toBe('planned');
  });

  it('distinguishes connector supported (coverage) from connected (activation)', () => {
    const s = resolveSuite(synthDef({ workerIds: [], marketplaceSlugs: [] }), { ...emptyState(), supportedConnectorIds: ['sap'], connectedConnectorIds: [] });
    expect(s.readiness.connectors).toEqual({ referenced: 1, supported: 1, connected: 0 });
  });
});

describe('buildComplianceReport', () => {
  it('rolls frameworks up over the real rules the referencing suites carry', () => {
    const r = buildComplianceReport(fullState());
    expect(r.totalFrameworks).toBeGreaterThan(0);
    expect(r.frameworks.every((f) => f.total > 0)).toBe(true);
    expect(r.frameworks.every((f) => f.enabled === f.total)).toBe(true); // all rules enabled
    expect(r.frameworks.every((f) => f.status === 'ready')).toBe(true);
    expect(r.rulesReferenced).toBe(6); // all 6 enterprise rules referenced across the suites
    expect(r.rulesEnabled).toBe(6);
    // SOC 2 is referenced by multiple industries.
    const soc2 = r.frameworks.find((f) => f.id === 'soc2');
    expect(soc2).toBeDefined();
    expect(soc2!.industries.length).toBeGreaterThan(1);
  });

  it('reflects a disabled rule in framework + platform coverage', () => {
    const state = fullState();
    state.complianceRules = state.complianceRules.map((r) => (r.id === 'rule-audit' ? { ...r, enabled: false } : r));
    const r = buildComplianceReport(state);
    expect(r.rulesEnabled).toBe(5); // rule-audit now disabled
    // Every framework references rule-audit (all suites carry it), so all drop below full.
    expect(r.frameworks.some((f) => f.enabled < f.total)).toBe(true);
  });
});

describe('buildCollections', () => {
  it('resolves each suite’s marketplace slugs and counts what is published', () => {
    const full = buildCollections(fullState());
    expect(full).toHaveLength(12);
    expect(full.every((c) => c.available === c.total)).toBe(true);
    const empty = buildCollections(emptyState());
    expect(empty.every((c) => c.available === 0)).toBe(true);
  });
});

describe('buildIndustryKpis', () => {
  it('emits live ExecutiveKpis; ready reflects status and connectors reflect activation', () => {
    const full = buildIndustryKpis(fullState());
    const byKey = new Map(full.map((k) => [k.key, k]));
    expect(byKey.get('industry.platform.suites')!.display).toBe('12 suites');
    expect(byKey.get('industry.platform.ready')!.value).toBe(100); // all ready when fully wired
    expect(byKey.get('industry.platform.coverage')!.value).toBe(100);
    expect(byKey.get('industry.connectors.connected')!.value).toBe(100);

    const fresh = buildIndustryKpis(freshState());
    const freshByKey = new Map(fresh.map((k) => [k.key, k]));
    expect(freshByKey.get('industry.connectors.connected')!.value).toBe(0); // nothing connected
    expect(freshByKey.get('industry.platform.coverage')!.value).toBe(100); // still fully shipped
  });
});

describe('buildReadinessReport', () => {
  it('buckets suites by status and averages activation', () => {
    const full = buildReadinessReport(fullState());
    expect(full.ready).toBe(12);
    expect(full.partial).toBe(0);
    expect(full.planned).toBe(0);
    expect(full.averageActivation).toBe(1);

    const empty = buildReadinessReport(emptyState());
    expect(empty.planned).toBe(12);
    expect(empty.averageActivation).toBe(0);
  });

  it('HONESTY: no suite is ready on a fresh install with zero connectors connected', () => {
    // Fresh = platform ships everything (workers registered, compliance seeded-enabled, listings
    // published) but the operator has connected NO external systems. Readiness must reflect that.
    const fresh = buildReadinessReport(freshState());
    expect(fresh.ready).toBe(0);
    expect(fresh.planned).toBe(12);
    expect(fresh.averageActivation).toBe(0);
    for (const s of buildSuites(freshState())) {
      expect(s.readiness.coverage, s.id).toBe(1); // the platform ships every capability…
      expect(s.readiness.activation, s.id).toBe(0); // …but nothing is wired up yet
      expect(s.status, s.id).toBe('planned');
    }
  });
});

describe('buildIndustryOverview', () => {
  it('bundles summary, suites, collections, compliance and KPIs', () => {
    const o = buildIndustryOverview(fullState());
    expect(o.summary.totalSuites).toBe(12);
    expect(o.summary.ready).toBe(12);
    expect(o.suites).toHaveLength(12);
    expect(o.collections).toHaveLength(12);
    expect(o.compliance.totalFrameworks).toBeGreaterThan(0);
    expect(o.kpis).toHaveLength(5);
    expect(o.summary.marketplaceCollections).toBe(12);
  });

  it('never throws and reports all-planned on an empty deployment', () => {
    expect(() => buildIndustryOverview(emptyState())).not.toThrow();
    const o = buildIndustryOverview(emptyState());
    expect(o.summary.planned).toBe(12);
    expect(o.suites.every((s) => s.readiness.activation === 0)).toBe(true);
    expect(o.summary.workersAvailable).toBe(0);
    expect(o.summary.connectorsConnected).toBe(0);
  });
});
