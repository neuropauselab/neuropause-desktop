/**
 * Phase 6 Stage 10 — the Strategy Registry (typed, versioned data; doc-locked
 * to docs/desktop/strategy/STRATEGY-PLATFORM.md by test — the S6/S7/S8/S9
 * precedent).
 *
 * EVERY reference here names something REAL in the repository:
 *   - unit names        → the 13 seeded org units,
 *   - KPI keys          → the six executive KPI producers,
 *   - SLA target ids    → the Stage 9 SLA registry,
 *   - readiness dims    → the Stage 9 seven dimensions,
 *   - service ids       → the Stage 9 service registry,
 *   - playbook ids      → the Stage 8 playbook registry,
 *   - finding kinds     → the Stage 8 monitor vocabulary,
 *   - insight domains   → the Stage 6 eight-domain vocabulary,
 *   - mined processes   → the process-mining ProcessType union,
 *   - decision categories → the executive decision vocabulary.
 * `strategyRegistryIssues()` locks referential integrity; the doc lock keeps
 * code and documentation in sync. The registries store nothing and fabricate
 * nothing — they are data.
 */
import type {
  BusinessCapabilityKey,
  CapabilityDef,
  CompanyObjectiveDef,
  DecisionCategoryCapabilityRef,
  DepartmentObjectiveDef,
  InitiativeDef,
  KpiCapabilityRef,
  StrategicRiskDef,
  ThemeDef,
} from '@neuropause/shared';
import { BUSINESS_CAPABILITIES, INSIGHT_HEALTH_DOMAINS } from '@neuropause/shared';

/* ── vocabularies this registry may reference (the REAL ones) ─────────────── */

export const REAL_UNIT_NAMES: readonly string[] = [
  'Product & Engineering', 'Engineering', 'Platform Team', 'AI Team', 'Design',
  'Business', 'Sales', 'Marketing', 'Finance', 'Legal', 'Operations', 'IT', 'Support',
] as const;
export const REAL_KPI_KEYS: readonly string[] = [
  'org-health', 'engineering-health', 'ai-adoption', 'connector-health', 'license-status', 'active-members',
] as const;
export const REAL_SLA_IDS: readonly string[] = [
  'exec-success-rate', 'exec-avg-runtime', 'jobs-queue-depth', 'approval-age',
  'automation-failure-ratio', 'connector-healthy-ratio', 'ai-engine-ready',
  'assistant-response-latency', 'notification-latency',
] as const;
export const REAL_READINESS_DIMENSIONS: readonly string[] = [
  'deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance',
] as const;
export const REAL_S9_SERVICE_IDS: readonly string[] = [
  'execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet',
  'ai-runtime', 'assistant-experience', 'notification-delivery',
] as const;
export const REAL_PLAYBOOK_IDS: readonly string[] = [
  'daily-ops-review', 'incident-first-response', 'weekly-maintenance-review', 'quarterly-ops-report',
] as const;
export const REAL_AP_FINDING_KINDS: readonly string[] = [
  'stuck-execution', 'failed-run', 'awaiting-approval', 'error-rule', 'schedule-unparseable', 'schedule-never-fired',
] as const;
export const REAL_MINED_TYPES: readonly string[] = ['order_to_cash', 'procure_to_pay', 'make_to_complete'] as const;
export const REAL_DECISION_CATEGORIES: readonly string[] = [
  'engineering', 'organization', 'governance', 'operations', 'growth', 'other',
] as const;

/* ── the Enterprise Capability Map (the approved enhancement) ─────────────── */

export const CAPABILITY_REGISTRY: readonly CapabilityDef[] = [
  { key: 'sales', label: 'Sales', owningUnitName: 'Sales',
    evidence: [{ kind: 'mined-process', ref: 'order_to_cash' }, { kind: 'insight-domain', ref: 'departments' }],
    knowledgeTopics: ['sales', 'sop'] },
  { key: 'marketing', label: 'Marketing', owningUnitName: 'Marketing',
    evidence: [{ kind: 'insight-domain', ref: 'departments' }],
    knowledgeTopics: ['marketing'] },
  { key: 'customer-success', label: 'Customer Success', owningUnitName: 'Support',
    evidence: [{ kind: 's9-service', ref: 'notification-delivery' }, { kind: 'insight-domain', ref: 'departments' }],
    knowledgeTopics: ['support', 'sop'] },
  { key: 'finance', label: 'Finance', owningUnitName: 'Finance',
    evidence: [{ kind: 'mined-process', ref: 'procure_to_pay' }, { kind: 'insight-domain', ref: 'departments' }],
    knowledgeTopics: ['finance', 'reporting'] },
  { key: 'procurement', label: 'Procurement', owningUnitName: 'Finance',
    evidence: [{ kind: 'mined-process', ref: 'procure_to_pay' }],
    knowledgeTopics: ['procurement'] },
  { key: 'engineering', label: 'Engineering', owningUnitName: 'Engineering',
    evidence: [{ kind: 'kpi', ref: 'engineering-health' }, { kind: 'insight-domain', ref: 'projects' }, { kind: 's9-service', ref: 'execution-runtime' }],
    knowledgeTopics: ['engineering', 'adr', 'deployment'] },
  { key: 'manufacturing', label: 'Manufacturing', owningUnitName: 'Operations',
    evidence: [{ kind: 'mined-process', ref: 'make_to_complete' }],
    knowledgeTopics: ['manufacturing'] },
  { key: 'compliance', label: 'Compliance', owningUnitName: 'Legal',
    evidence: [{ kind: 'compliance-checks', ref: 'governance' }, { kind: 'readiness-dimension', ref: 'organization' }],
    knowledgeTopics: ['policy', 'standard'] },
  { key: 'risk', label: 'Risk', owningUnitName: 'Legal',
    evidence: [{ kind: 'insight-domain', ref: 'organization' }, { kind: 'readiness-dimension', ref: 'governance' }],
    knowledgeTopics: ['risk', 'policy'] },
  { key: 'security', label: 'Security', owningUnitName: 'IT',
    evidence: [{ kind: 'compliance-checks', ref: 'governance' }, { kind: 's9-service', ref: 'connector-fleet' }],
    knowledgeTopics: ['security', 'policy'] },
  { key: 'operations', label: 'Operations', owningUnitName: 'Operations',
    evidence: [{ kind: 's9-service', ref: 'workforce-jobs' }, { kind: 'readiness-dimension', ref: 'workforce' }, { kind: 'insight-domain', ref: 'workflows' }],
    knowledgeTopics: ['operations', 'sop'] },
  { key: 'support', label: 'Support', owningUnitName: 'Support',
    evidence: [{ kind: 'insight-domain', ref: 'connectors' }, { kind: 's9-service', ref: 'connector-fleet' }],
    knowledgeTopics: ['support', 'sop'] },
] as const;

export const CAPABILITY_BY_KEY: ReadonlyMap<string, CapabilityDef> = new Map(CAPABILITY_REGISTRY.map((c) => [c.key, c]));

/** Executive KPI → capability mapping (real keys only). */
export const KPI_CAPABILITY_REGISTRY: readonly KpiCapabilityRef[] = [
  { key: 'org-health', capabilityKey: 'operations' },
  { key: 'engineering-health', capabilityKey: 'engineering' },
  { key: 'ai-adoption', capabilityKey: 'engineering' },
  { key: 'connector-health', capabilityKey: 'support' },
  { key: 'license-status', capabilityKey: 'compliance' },
  { key: 'active-members', capabilityKey: 'operations' },
] as const;

/** Decision category → capabilities (the executive-decision vocabulary). */
export const DECISION_CATEGORY_CAPABILITIES: readonly DecisionCategoryCapabilityRef[] = [
  { category: 'engineering', capabilityKeys: ['engineering'] },
  { category: 'organization', capabilityKeys: ['operations'] },
  { category: 'governance', capabilityKeys: ['compliance', 'risk'] },
  { category: 'operations', capabilityKeys: ['operations'] },
  { category: 'growth', capabilityKeys: ['sales', 'marketing'] },
  { category: 'other', capabilityKeys: ['operations'] },
] as const;

/* ── themes ───────────────────────────────────────────────────────────────── */

export const THEME_REGISTRY: readonly ThemeDef[] = [
  {
    id: 'reliable-autonomous-operations',
    label: 'Reliable autonomous operations',
    description: 'The platform runs the business reliably: executions succeed, queues drain, incidents close.',
    capabilityKeys: ['operations', 'engineering', 'support'],
  },
  {
    id: 'governed-ai-adoption',
    label: 'Governed AI adoption',
    description: 'AI capability grows only inside governance: approvals gate side effects, compliance stays green.',
    capabilityKeys: ['engineering', 'compliance', 'risk', 'security'],
  },
  {
    id: 'connected-enterprise',
    label: 'Connected enterprise',
    description: 'The business systems the company depends on stay integrated and healthy.',
    capabilityKeys: ['sales', 'finance', 'customer-success', 'support'],
  },
] as const;

/* ── company + department objectives ──────────────────────────────────────── */

export const COMPANY_OBJECTIVE_REGISTRY: readonly CompanyObjectiveDef[] = [
  {
    id: 'co-reliable-execution',
    label: 'Reliable governed execution',
    description: 'Every governed action completes reliably inside its agreed operating levels.',
    themeId: 'reliable-autonomous-operations',
    owningUnitName: 'Operations',
    horizon: 'current-quarter',
    measures: [
      { kind: 'sla', ref: 'exec-success-rate', good: 'met' },
      { kind: 'sla', ref: 'exec-avg-runtime', good: 'met' },
      { kind: 'insight-domain', ref: 'workflows', good: 'healthy-band' },
    ],
    capabilityKeys: ['operations', 'engineering'],
  },
  {
    id: 'co-healthy-organization',
    label: 'A healthy, aligned organization',
    description: 'Org health stays in band and every unit carries accountable leadership.',
    themeId: 'reliable-autonomous-operations',
    owningUnitName: 'Business',
    horizon: 'annual',
    measures: [
      { kind: 'kpi', ref: 'org-health', good: 'healthy-band' },
      { kind: 'insight-domain', ref: 'organization', good: 'healthy-band' },
    ],
    capabilityKeys: ['operations', 'risk'],
  },
  {
    id: 'co-governed-ai',
    label: 'Governed AI adoption',
    description: 'AI usage expands with approvals, compliance, and a ready engine — never around them.',
    themeId: 'governed-ai-adoption',
    owningUnitName: 'AI Team',
    horizon: 'current-quarter',
    measures: [
      { kind: 'kpi', ref: 'ai-adoption', good: 'healthy-band' },
      { kind: 'sla', ref: 'ai-engine-ready', good: 'met' },
      { kind: 'insight-domain', ref: 'approvals', good: 'healthy-band' },
    ],
    capabilityKeys: ['engineering', 'compliance', 'security'],
  },
  {
    id: 'co-dependable-integrations',
    label: 'Dependable business integrations',
    description: 'The connector fleet the business runs on stays configured and healthy.',
    themeId: 'connected-enterprise',
    owningUnitName: 'IT',
    horizon: 'current-quarter',
    measures: [
      { kind: 'kpi', ref: 'connector-health', good: 'healthy-band' },
      { kind: 'sla', ref: 'connector-healthy-ratio', good: 'met' },
      { kind: 'insight-domain', ref: 'connectors', good: 'healthy-band' },
    ],
    capabilityKeys: ['support', 'security'],
  },
  {
    id: 'co-trustworthy-automation',
    label: 'Trustworthy automation at scale',
    description: 'Automation grows while its failure ratio stays inside the agreed band.',
    themeId: 'governed-ai-adoption',
    owningUnitName: 'IT',
    horizon: 'next-quarter',
    measures: [
      { kind: 'sla', ref: 'automation-failure-ratio', good: 'met' },
      { kind: 'insight-domain', ref: 'automations', good: 'healthy-band' },
    ],
    capabilityKeys: ['operations', 'engineering'],
  },
] as const;

export const DEPARTMENT_OBJECTIVE_REGISTRY: readonly DepartmentObjectiveDef[] = [
  {
    id: 'do-eng-delivery',
    label: 'Engineering delivery health',
    unitName: 'Engineering',
    companyObjectiveId: 'co-reliable-execution',
    measures: [
      { kind: 'kpi', ref: 'engineering-health', good: 'healthy-band' },
      { kind: 'insight-domain', ref: 'projects', good: 'healthy-band' },
    ],
    capabilityKeys: ['engineering'],
  },
  {
    id: 'do-ops-flow',
    label: 'Operational flow',
    unitName: 'Operations',
    companyObjectiveId: 'co-reliable-execution',
    measures: [
      { kind: 'sla', ref: 'jobs-queue-depth', good: 'met' },
      { kind: 'sla', ref: 'approval-age', good: 'met' },
    ],
    capabilityKeys: ['operations'],
  },
  {
    id: 'do-ai-runtime',
    label: 'AI runtime readiness',
    unitName: 'AI Team',
    companyObjectiveId: 'co-governed-ai',
    measures: [{ kind: 'sla', ref: 'ai-engine-ready', good: 'met' }],
    capabilityKeys: ['engineering'],
  },
  {
    id: 'do-it-fleet',
    label: 'Integration fleet health',
    unitName: 'IT',
    companyObjectiveId: 'co-dependable-integrations',
    measures: [{ kind: 'sla', ref: 'connector-healthy-ratio', good: 'met' }],
    capabilityKeys: ['support', 'security'],
  },
  {
    id: 'do-legal-compliance',
    label: 'Compliance posture',
    unitName: 'Legal',
    companyObjectiveId: 'co-healthy-organization',
    measures: [{ kind: 'insight-domain', ref: 'organization', good: 'healthy-band' }],
    capabilityKeys: ['compliance', 'risk'],
  },
  {
    id: 'do-support-signals',
    label: 'Customer-facing signal health',
    unitName: 'Support',
    companyObjectiveId: 'co-dependable-integrations',
    measures: [{ kind: 'insight-domain', ref: 'connectors', good: 'healthy-band' }],
    capabilityKeys: ['customer-success', 'support'],
  },
] as const;

/* ── initiatives (compose EXISTING records; milestones are conditions) ────── */

export const INITIATIVE_REGISTRY: readonly InitiativeDef[] = [
  {
    id: 'init-operational-cadence',
    label: 'Operational review cadence',
    description: 'Institutionalize the daily/weekly operational reviews through the shipped playbooks.',
    companyObjectiveId: 'co-reliable-execution',
    capabilityKeys: ['operations'],
    sources: [
      { kind: 'playbook', ref: 'daily-ops-review' },
      { kind: 'playbook', ref: 'weekly-maintenance-review' },
      { kind: 's9-service', ref: 'workforce-jobs' },
    ],
    milestones: [
      { id: 'm-queue', label: 'Job queue inside its SLA', predicate: { kind: 'sla-met', targetId: 'jobs-queue-depth' } },
      { id: 'm-approvals', label: 'No approval older than a day', predicate: { kind: 'sla-met', targetId: 'approval-age' } },
    ],
    dependsOn: [],
  },
  {
    id: 'init-incident-response',
    label: 'Governed incident response',
    description: 'Every critical incident gets the first-response playbook and closes through verification.',
    companyObjectiveId: 'co-reliable-execution',
    capabilityKeys: ['operations', 'support'],
    sources: [
      { kind: 'playbook', ref: 'incident-first-response' },
      { kind: 's9-service', ref: 'execution-runtime' },
    ],
    milestones: [
      { id: 'm-exec-sla', label: 'Execution success inside its SLA', predicate: { kind: 'sla-met', targetId: 'exec-success-rate' } },
      { id: 'm-monitor', label: 'No stuck executions on the monitor', predicate: { kind: 'monitor-clear', findingKind: 'stuck-execution' } },
    ],
    dependsOn: ['init-operational-cadence'],
  },
  {
    id: 'init-ai-enablement',
    label: 'Governed AI enablement',
    description: 'Bring the AI runtime to ready and keep adoption growing inside approvals.',
    companyObjectiveId: 'co-governed-ai',
    capabilityKeys: ['engineering', 'security'],
    sources: [
      { kind: 's9-service', ref: 'ai-runtime' },
      { kind: 'decision-category', ref: 'engineering' },
    ],
    milestones: [
      { id: 'm-engine', label: 'AI engine ready', predicate: { kind: 'sla-met', targetId: 'ai-engine-ready' } },
      { id: 'm-ai-ready', label: 'AI readiness dimension ready', predicate: { kind: 'readiness-ready', dimension: 'ai' } },
    ],
    dependsOn: [],
  },
  {
    id: 'init-integration-reliability',
    label: 'Integration reliability program',
    description: 'Configured connectors stay healthy; the fleet is the business backbone.',
    companyObjectiveId: 'co-dependable-integrations',
    capabilityKeys: ['support', 'security'],
    sources: [
      { kind: 's9-service', ref: 'connector-fleet' },
      { kind: 'decision-category', ref: 'operations' },
    ],
    milestones: [
      { id: 'm-fleet', label: 'Fleet health inside its SLA', predicate: { kind: 'sla-met', targetId: 'connector-healthy-ratio' } },
      { id: 'm-conn-ready', label: 'Connector readiness ready', predicate: { kind: 'readiness-ready', dimension: 'connectors' } },
    ],
    dependsOn: [],
  },
  {
    id: 'init-automation-trust',
    label: 'Automation trust program',
    description: 'Scale rules and playbooks while failure ratio stays in band and schedules stay parseable.',
    companyObjectiveId: 'co-trustworthy-automation',
    capabilityKeys: ['operations', 'engineering'],
    sources: [
      { kind: 's9-service', ref: 'automation-rules' },
      { kind: 'playbook', ref: 'quarterly-ops-report' },
    ],
    milestones: [
      { id: 'm-fail-ratio', label: 'Automation failure ratio inside its SLA', predicate: { kind: 'sla-met', targetId: 'automation-failure-ratio' } },
      { id: 'm-schedules', label: 'No unparseable schedules', predicate: { kind: 'monitor-clear', findingKind: 'schedule-unparseable' } },
    ],
    dependsOn: [],
  },
  {
    id: 'init-project-delivery',
    label: 'Project delivery visibility',
    description: 'Every active project entity is visible, healthy, and moving.',
    companyObjectiveId: 'co-healthy-organization',
    capabilityKeys: ['engineering', 'operations'],
    sources: [
      { kind: 'project-entities', ref: 'project' },
      { kind: 'mined-process', ref: 'order_to_cash' },
    ],
    milestones: [
      { id: 'm-projects', label: 'Projects domain in band', predicate: { kind: 'kpi-healthy', key: 'engineering-health' } },
      { id: 'm-growth-decisions', label: 'At least one executed growth decision', predicate: { kind: 'decisions-executed', category: 'growth', atLeast: 1 } },
    ],
    dependsOn: [],
  },
] as const;

/* ── strategic risks (substantiated ONLY by live signals) ─────────────────── */

export const RISK_REGISTRY: readonly StrategicRiskDef[] = [
  {
    id: 'risk-execution-degradation',
    label: 'Execution reliability degrades',
    description: 'The governed execution spine drops below its agreed levels.',
    capabilityKeys: ['operations', 'engineering'],
    evidencedBy: [
      { kind: 'sla-target', ref: 'exec-success-rate' },
      { kind: 'ap-finding-kind', ref: 'stuck-execution' },
    ],
  },
  {
    id: 'risk-integration-outage',
    label: 'Integration backbone outage',
    description: 'The connector fleet degrades below business dependence levels.',
    capabilityKeys: ['support', 'sales', 'customer-success'],
    evidencedBy: [
      { kind: 'sla-target', ref: 'connector-healthy-ratio' },
      { kind: 'incident-domain', ref: 'connectors' },
    ],
  },
  {
    id: 'risk-ungoverned-ai',
    label: 'AI adoption outpaces governance',
    description: 'AI usage grows while approvals or compliance regress.',
    capabilityKeys: ['compliance', 'risk', 'security'],
    evidencedBy: [
      { kind: 'readiness-dimension', ref: 'governance' },
      { kind: 'incident-domain', ref: 'approvals' },
    ],
  },
  {
    id: 'risk-automation-sprawl',
    label: 'Automation sprawl',
    description: 'Rules multiply faster than their failure ratio and schedules stay controlled.',
    capabilityKeys: ['operations'],
    evidencedBy: [
      { kind: 'sla-target', ref: 'automation-failure-ratio' },
      { kind: 'ap-finding-kind', ref: 'error-rule' },
    ],
  },
  {
    id: 'risk-leadership-vacuum',
    label: 'Ownership vacuum',
    description: 'Units without leads leave objectives and incidents unowned.',
    capabilityKeys: ['operations', 'risk'],
    evidencedBy: [{ kind: 'readiness-dimension', ref: 'organization' }],
  },
] as const;

/* ── integrity (mirrors the S6–S9 registry locks) ─────────────────────────── */

export function strategyRegistryIssues(): string[] {
  const issues: string[] = [];
  const capKeys = new Set<string>(CAPABILITY_REGISTRY.map((c) => c.key));
  if (CAPABILITY_REGISTRY.length !== BUSINESS_CAPABILITIES.length) issues.push('capability registry must cover the twelve business capabilities');
  for (const k of BUSINESS_CAPABILITIES) if (!capKeys.has(k)) issues.push(`missing capability: ${k}`);

  const checkUnit = (owner: string, where: string): void => {
    if (!REAL_UNIT_NAMES.includes(owner)) issues.push(`${where}: unknown unit "${owner}"`);
  };
  const checkCaps = (keys: readonly BusinessCapabilityKey[], where: string): void => {
    if (keys.length === 0) issues.push(`${where}: no capability mapping`);
    for (const k of keys) if (!capKeys.has(k)) issues.push(`${where}: unknown capability ${k}`);
  };
  const checkMeasure = (m: { kind: string; ref: string }, where: string): void => {
    if (m.kind === 'kpi' && !REAL_KPI_KEYS.includes(m.ref)) issues.push(`${where}: unknown KPI ${m.ref}`);
    if (m.kind === 'sla' && !REAL_SLA_IDS.includes(m.ref)) issues.push(`${where}: unknown SLA ${m.ref}`);
    if (m.kind === 'insight-domain' && !INSIGHT_HEALTH_DOMAINS.includes(m.ref as (typeof INSIGHT_HEALTH_DOMAINS)[number]))
      issues.push(`${where}: unknown insight domain ${m.ref}`);
  };

  for (const c of CAPABILITY_REGISTRY) {
    checkUnit(c.owningUnitName, `capability ${c.key}`);
    if (c.evidence.length === 0) issues.push(`capability ${c.key}: no evidence signals declared`);
    for (const e of c.evidence) {
      if (e.kind === 'kpi' && !REAL_KPI_KEYS.includes(e.ref)) issues.push(`capability ${c.key}: unknown KPI ${e.ref}`);
      if (e.kind === 's9-service' && !REAL_S9_SERVICE_IDS.includes(e.ref)) issues.push(`capability ${c.key}: unknown service ${e.ref}`);
      if (e.kind === 'readiness-dimension' && !REAL_READINESS_DIMENSIONS.includes(e.ref)) issues.push(`capability ${c.key}: unknown dimension ${e.ref}`);
      if (e.kind === 'mined-process' && !REAL_MINED_TYPES.includes(e.ref)) issues.push(`capability ${c.key}: unknown mined type ${e.ref}`);
      if (e.kind === 'insight-domain' && !INSIGHT_HEALTH_DOMAINS.includes(e.ref as (typeof INSIGHT_HEALTH_DOMAINS)[number]))
        issues.push(`capability ${c.key}: unknown insight domain ${e.ref}`);
    }
  }
  for (const k of KPI_CAPABILITY_REGISTRY) {
    if (!REAL_KPI_KEYS.includes(k.key)) issues.push(`kpi map: unknown KPI ${k.key}`);
    if (!capKeys.has(k.capabilityKey)) issues.push(`kpi map ${k.key}: unknown capability`);
  }
  const catSeen = new Set<string>();
  for (const d of DECISION_CATEGORY_CAPABILITIES) {
    if (!REAL_DECISION_CATEGORIES.includes(d.category)) issues.push(`decision map: unknown category ${d.category}`);
    if (catSeen.has(d.category)) issues.push(`decision map: duplicate category ${d.category}`);
    catSeen.add(d.category);
    checkCaps(d.capabilityKeys, `decision map ${d.category}`);
  }
  for (const cat of REAL_DECISION_CATEGORIES) if (!catSeen.has(cat)) issues.push(`decision map: category ${cat} unmapped`);

  const themeIds = new Set<string>();
  for (const t of THEME_REGISTRY) {
    if (themeIds.has(t.id)) issues.push(`duplicate theme ${t.id}`);
    themeIds.add(t.id);
    checkCaps(t.capabilityKeys, `theme ${t.id}`);
  }

  const coIds = new Set<string>();
  for (const o of COMPANY_OBJECTIVE_REGISTRY) {
    if (coIds.has(o.id)) issues.push(`duplicate company objective ${o.id}`);
    coIds.add(o.id);
    if (!themeIds.has(o.themeId)) issues.push(`${o.id}: unknown theme ${o.themeId}`);
    checkUnit(o.owningUnitName, o.id);
    checkCaps(o.capabilityKeys, o.id);
    if (o.measures.length === 0) issues.push(`${o.id}: no measures`);
    for (const m of o.measures) checkMeasure(m, o.id);
  }
  const doIds = new Set<string>();
  for (const o of DEPARTMENT_OBJECTIVE_REGISTRY) {
    if (doIds.has(o.id)) issues.push(`duplicate department objective ${o.id}`);
    doIds.add(o.id);
    checkUnit(o.unitName, o.id);
    if (!coIds.has(o.companyObjectiveId)) issues.push(`${o.id}: unknown company objective`);
    checkCaps(o.capabilityKeys, o.id);
    for (const m of o.measures) checkMeasure(m, o.id);
  }

  const initIds = new Set<string>();
  for (const i of INITIATIVE_REGISTRY) {
    if (initIds.has(i.id)) issues.push(`duplicate initiative ${i.id}`);
    initIds.add(i.id);
    if (!coIds.has(i.companyObjectiveId)) issues.push(`${i.id}: unknown company objective`);
    checkCaps(i.capabilityKeys, i.id);
    if (i.sources.length === 0) issues.push(`${i.id}: no sources`);
    for (const s of i.sources) {
      if (s.kind === 'playbook' && !REAL_PLAYBOOK_IDS.includes(s.ref)) issues.push(`${i.id}: unknown playbook ${s.ref}`);
      if (s.kind === 's9-service' && !REAL_S9_SERVICE_IDS.includes(s.ref)) issues.push(`${i.id}: unknown service ${s.ref}`);
      if (s.kind === 'decision-category' && !REAL_DECISION_CATEGORIES.includes(s.ref)) issues.push(`${i.id}: unknown category ${s.ref}`);
      if (s.kind === 'mined-process' && !REAL_MINED_TYPES.includes(s.ref)) issues.push(`${i.id}: unknown mined type ${s.ref}`);
      if (s.kind === 'project-entities' && s.ref !== 'project') issues.push(`${i.id}: project source ref must be 'project'`);
    }
    if (i.milestones.length === 0) issues.push(`${i.id}: no milestones`);
    for (const m of i.milestones) {
      const p = m.predicate;
      if (p.kind === 'sla-met' && !REAL_SLA_IDS.includes(p.targetId)) issues.push(`${i.id}/${m.id}: unknown SLA ${p.targetId}`);
      if (p.kind === 'readiness-ready' && !REAL_READINESS_DIMENSIONS.includes(p.dimension)) issues.push(`${i.id}/${m.id}: unknown dimension`);
      if (p.kind === 'kpi-healthy' && !REAL_KPI_KEYS.includes(p.key)) issues.push(`${i.id}/${m.id}: unknown KPI`);
      if (p.kind === 'monitor-clear' && !REAL_AP_FINDING_KINDS.includes(p.findingKind)) issues.push(`${i.id}/${m.id}: unknown finding kind`);
      if (p.kind === 'decisions-executed' && !REAL_DECISION_CATEGORIES.includes(p.category)) issues.push(`${i.id}/${m.id}: unknown category`);
    }
    for (const dep of i.dependsOn) {
      if (!INITIATIVE_REGISTRY.some((x) => x.id === dep)) issues.push(`${i.id}: dangling dependsOn ${dep}`);
    }
  }

  const riskIds = new Set<string>();
  for (const r of RISK_REGISTRY) {
    if (riskIds.has(r.id)) issues.push(`duplicate risk ${r.id}`);
    riskIds.add(r.id);
    checkCaps(r.capabilityKeys, `risk ${r.id}`);
    if (r.evidencedBy.length === 0) issues.push(`risk ${r.id}: no evidencing signals`);
    for (const e of r.evidencedBy) {
      if (e.kind === 'sla-target' && !REAL_SLA_IDS.includes(e.ref)) issues.push(`risk ${r.id}: unknown SLA ${e.ref}`);
      if (e.kind === 'readiness-dimension' && !REAL_READINESS_DIMENSIONS.includes(e.ref)) issues.push(`risk ${r.id}: unknown dimension`);
      if (e.kind === 'ap-finding-kind' && !REAL_AP_FINDING_KINDS.includes(e.ref)) issues.push(`risk ${r.id}: unknown finding kind`);
      if (e.kind === 'incident-domain' && !INSIGHT_HEALTH_DOMAINS.includes(e.ref as (typeof INSIGHT_HEALTH_DOMAINS)[number]))
        issues.push(`risk ${r.id}: unknown domain`);
    }
  }
  return issues;
}
