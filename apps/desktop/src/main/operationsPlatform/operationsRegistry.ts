/**
 * Phase 6 Stage 9 — the Operations Registry (typed, versioned data; doc-locked
 * to docs/desktop/operations/OPERATIONS-PLATFORM.md by test — the Stage 6
 * signal-map / Stage 7 asset-registry / Stage 8 playbook-registry precedent).
 *
 * DOMAINS reuse the Stage 6 eight-domain vocabulary verbatim (no second domain
 * model). Ownership maps each domain to a REAL seeded org-unit NAME — resolved
 * live against the org store; a unit without a lead (the seed default) is an
 * HONEST ownership gap, never an invented owner.
 *
 * SERVICES each name the REAL aggregate that measures them (`signal`); the two
 * `none-measured` services exercise the DECLARED-unmeasurable SLA path (D-3):
 * the platform records no per-request latency anywhere, and Stage 9 does not
 * pretend otherwise.
 *
 * The registries store nothing and fabricate nothing — they are data.
 */
import type { ObjectiveDef, OperationalDomainDef, ProcessDef, ServiceDef, SlaTargetDef } from '@neuropause/shared';
import { INSIGHT_HEALTH_DOMAINS } from '@neuropause/shared';

/* ── domains (the Stage 6 vocabulary × real seeded unit names) ────────────── */

export const DOMAIN_REGISTRY: readonly OperationalDomainDef[] = [
  { key: 'organization', label: 'Organization', owningUnitName: 'Operations' },
  { key: 'departments', label: 'Departments', owningUnitName: 'Business' },
  { key: 'projects', label: 'Projects', owningUnitName: 'Product & Engineering' },
  { key: 'workflows', label: 'Workflows', owningUnitName: 'Operations' },
  { key: 'automations', label: 'Automations', owningUnitName: 'IT' },
  { key: 'ai', label: 'AI Runtime', owningUnitName: 'AI Team' },
  { key: 'connectors', label: 'Connectors', owningUnitName: 'IT' },
  { key: 'approvals', label: 'Approvals', owningUnitName: 'Operations' },
] as const;

export const DOMAIN_BY_KEY: ReadonlyMap<string, OperationalDomainDef> = new Map(
  DOMAIN_REGISTRY.map((d) => [d.key, d]),
);

/* ── services (every row names its REAL measuring aggregate) ──────────────── */

export const SERVICE_REGISTRY: readonly ServiceDef[] = [
  {
    id: 'execution-runtime',
    name: 'Execution runtime',
    description: 'The ExecuteEngine pipeline every governed action runs through.',
    domain: 'workflows',
    signal: 'execution-stats',
    slaTargetIds: ['exec-success-rate', 'exec-avg-runtime'],
    kpiKeys: ['engineering-health'],
    dependsOn: ['ExecuteEngine', 'execution store', 'runtime supervisor'],
  },
  {
    id: 'workforce-jobs',
    name: 'AI workforce jobs',
    description: 'Worker job execution: queue, approvals, orchestrated workflows.',
    domain: 'workflows',
    signal: 'workforce',
    slaTargetIds: ['jobs-queue-depth', 'approval-age'],
    kpiKeys: ['ai-adoption'],
    dependsOn: ['job store', 'worker registry', 'orchestrator', 'approval engine'],
  },
  {
    id: 'automation-rules',
    name: 'Automation rules',
    description: 'The Automation Builder rule engine and its run records.',
    domain: 'automations',
    signal: 'automation-monitor',
    slaTargetIds: ['automation-failure-ratio'],
    kpiKeys: [],
    dependsOn: ['automation store', 'automation runner', 'Stage 8 schedule tick'],
  },
  {
    id: 'connector-fleet',
    name: 'Connector fleet',
    description: 'Enterprise connectors: configuration, sync health, accounts.',
    domain: 'connectors',
    signal: 'connectors',
    slaTargetIds: ['connector-healthy-ratio'],
    kpiKeys: ['connector-health'],
    dependsOn: ['connector service', 'sync runtime', 'connector supervisor'],
  },
  {
    id: 'ai-runtime',
    name: 'AI runtime',
    description: 'The AI engine manager and provider routing.',
    domain: 'ai',
    signal: 'ai-engine',
    slaTargetIds: ['ai-engine-ready'],
    kpiKeys: ['ai-adoption'],
    dependsOn: ['engine manager', 'provider router', 'prompt registry'],
  },
  {
    id: 'assistant-experience',
    name: 'Assistant experience',
    description: 'The Workspace Assistant conversational surface.',
    domain: 'ai',
    signal: 'none-measured',
    slaTargetIds: ['assistant-response-latency'],
    kpiKeys: [],
    dependsOn: ['assistant service', 'context builder', 'AI engine'],
  },
  {
    id: 'notification-delivery',
    name: 'Notification delivery',
    description: 'Governed intelligence delivery: sources, gates, inbox.',
    domain: 'organization',
    signal: 'none-measured',
    slaTargetIds: ['notification-latency'],
    kpiKeys: [],
    dependsOn: ['delivery engine', 'notification inbox', 'preference store'],
  },
] as const;

export const SERVICE_BY_ID: ReadonlyMap<string, ServiceDef> = new Map(SERVICE_REGISTRY.map((s) => [s.id, s]));

/* ── SLA targets (measured ONLY by existing aggregates; null = declared) ──── */

export const SLA_REGISTRY: readonly SlaTargetDef[] = [
  {
    id: 'exec-success-rate',
    serviceId: 'execution-runtime',
    label: 'Execution success rate',
    metric: 'success-rate',
    comparator: 'gte',
    target: 0.9,
    unit: 'ratio',
    measuredBy: 'executeEngine.stats().successRate',
    windowLabel: 'engine history window',
  },
  {
    id: 'exec-avg-runtime',
    serviceId: 'execution-runtime',
    label: 'Average execution runtime',
    metric: 'avg-runtime-ms',
    comparator: 'lte',
    target: 60_000,
    unit: 'ms',
    measuredBy: 'executeEngine.stats().averageRuntimeMs',
    windowLabel: 'engine history window',
  },
  {
    id: 'jobs-queue-depth',
    serviceId: 'workforce-jobs',
    label: 'Job queue depth',
    metric: 'queue-depth',
    comparator: 'lte',
    target: 25,
    unit: 'jobs',
    measuredBy: "jobStore.page({status:'queued'}).total",
    windowLabel: 'point in time',
  },
  {
    id: 'approval-age',
    serviceId: 'workforce-jobs',
    label: 'Oldest parked approval',
    metric: 'approval-age-hours',
    comparator: 'lte',
    target: 24,
    unit: 'hours',
    measuredBy: "jobStore.page({status:'awaiting_approval'}) oldest createdAt",
    windowLabel: 'point in time',
  },
  {
    id: 'automation-failure-ratio',
    serviceId: 'automation-rules',
    label: 'Automation failure ratio',
    metric: 'failure-ratio',
    comparator: 'lte',
    target: 0.2,
    unit: 'ratio',
    measuredBy: 'automation monitor failed/(completed+failed)',
    windowLabel: 'recorded runs',
  },
  {
    id: 'connector-healthy-ratio',
    serviceId: 'connector-fleet',
    label: 'Configured connectors healthy',
    metric: 'healthy-ratio',
    comparator: 'gte',
    target: 0.8,
    unit: 'ratio',
    measuredBy: 'connectorService.list() health over configured',
    windowLabel: 'point in time',
  },
  {
    id: 'ai-engine-ready',
    serviceId: 'ai-runtime',
    label: 'AI engine ready',
    metric: 'engine-ready',
    comparator: 'gte',
    target: 1,
    unit: 'boolean',
    measuredBy: 'engineManager.state',
    windowLabel: 'point in time',
  },
  {
    id: 'assistant-response-latency',
    serviceId: 'assistant-experience',
    label: 'Assistant response latency p95',
    metric: 'response-latency-ms',
    comparator: 'lte',
    target: 5_000,
    unit: 'ms',
    // DECLARED unmeasurable: no per-request latency aggregate exists anywhere.
    measuredBy: null,
    windowLabel: 'n/a',
  },
  {
    id: 'notification-latency',
    serviceId: 'notification-delivery',
    label: 'Delivery latency',
    metric: 'response-latency-ms',
    comparator: 'lte',
    target: 60_000,
    unit: 'ms',
    // DECLARED unmeasurable: delivery outcomes are not timestamped end-to-end.
    measuredBy: null,
    windowLabel: 'n/a',
  },
] as const;

export const SLA_BY_ID: ReadonlyMap<string, SlaTargetDef> = new Map(SLA_REGISTRY.map((t) => [t.id, t]));

/* ── objectives (KPIs/SLAs bound to owners + review cadence) ──────────────── */

export const OBJECTIVE_REGISTRY: readonly ObjectiveDef[] = [
  {
    id: 'reliable-execution',
    label: 'Reliable governed execution',
    domain: 'workflows',
    kpiKeys: ['engineering-health'],
    slaTargetIds: ['exec-success-rate', 'exec-avg-runtime', 'jobs-queue-depth', 'approval-age'],
    reviewCadence: 'weekly',
  },
  {
    id: 'dependable-integrations',
    label: 'Dependable integrations',
    domain: 'connectors',
    kpiKeys: ['connector-health'],
    slaTargetIds: ['connector-healthy-ratio'],
    reviewCadence: 'weekly',
  },
  {
    id: 'trustworthy-automation',
    label: 'Trustworthy automation',
    domain: 'automations',
    kpiKeys: [],
    slaTargetIds: ['automation-failure-ratio'],
    reviewCadence: 'monthly',
  },
  {
    id: 'organizational-health',
    label: 'Organizational health',
    domain: 'organization',
    kpiKeys: ['org-health', 'active-members'],
    slaTargetIds: [],
    reviewCadence: 'quarterly',
  },
] as const;

/* ── processes (registry names joined to the MINED reality) ───────────────── */

export const PROCESS_REGISTRY: readonly ProcessDef[] = [
  // The three REAL mined process types (the process-mining ProcessType union).
  { id: 'order-to-cash', name: 'Order to cash', minedType: 'order_to_cash', domain: 'departments' },
  { id: 'procure-to-pay', name: 'Procure to pay', minedType: 'procure_to_pay', domain: 'departments' },
  { id: 'make-to-complete', name: 'Make to complete', minedType: 'make_to_complete', domain: 'departments' },
  // An HONEST registry gap exemplar: named by the org, not mined anywhere.
  { id: 'employee-onboarding', name: 'Employee onboarding', minedType: null, domain: 'organization' },
] as const;

/* ── integrity (mirrors the Stage 6/7/8 registry locks) ───────────────────── */

export function operationsRegistryIssues(): string[] {
  const issues: string[] = [];
  const domainKeys = new Set<string>(DOMAIN_REGISTRY.map((d) => d.key));
  if (DOMAIN_REGISTRY.length !== INSIGHT_HEALTH_DOMAINS.length) {
    issues.push('domain registry must cover the Stage 6 vocabulary exactly');
  }
  for (const key of INSIGHT_HEALTH_DOMAINS) if (!domainKeys.has(key)) issues.push(`missing domain: ${key}`);
  for (const d of DOMAIN_REGISTRY) if (d.owningUnitName.trim().length === 0) issues.push(`${d.key}: empty owningUnitName`);

  const serviceIds = new Set<string>();
  for (const s of SERVICE_REGISTRY) {
    if (serviceIds.has(s.id)) issues.push(`duplicate service id: ${s.id}`);
    serviceIds.add(s.id);
    if (!domainKeys.has(s.domain)) issues.push(`${s.id}: unknown domain ${s.domain}`);
    for (const t of s.slaTargetIds) if (!SLA_BY_ID.has(t)) issues.push(`${s.id}: unknown SLA target ${t}`);
  }
  const targetIds = new Set<string>();
  for (const t of SLA_REGISTRY) {
    if (targetIds.has(t.id)) issues.push(`duplicate SLA target id: ${t.id}`);
    targetIds.add(t.id);
    if (!SERVICE_BY_ID.has(t.serviceId)) issues.push(`${t.id}: unknown service ${t.serviceId}`);
    if (!(t.target > 0)) issues.push(`${t.id}: target must be positive`);
    const svc = SERVICE_BY_ID.get(t.serviceId);
    if (svc && svc.signal === 'none-measured' && t.measuredBy !== null) {
      issues.push(`${t.id}: a none-measured service cannot claim a measuring aggregate`);
    }
    if (t.measuredBy !== null && t.measuredBy.trim().length === 0) issues.push(`${t.id}: empty measuredBy`);
  }
  for (const o of OBJECTIVE_REGISTRY) {
    if (!domainKeys.has(o.domain)) issues.push(`${o.id}: unknown domain`);
    for (const t of o.slaTargetIds) if (!SLA_BY_ID.has(t)) issues.push(`${o.id}: unknown SLA target ${t}`);
  }
  const processIds = new Set<string>();
  for (const p of PROCESS_REGISTRY) {
    if (processIds.has(p.id)) issues.push(`duplicate process id: ${p.id}`);
    processIds.add(p.id);
    if (!domainKeys.has(p.domain)) issues.push(`${p.id}: unknown domain`);
  }
  return issues;
}
