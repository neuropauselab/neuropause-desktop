/**
 * Phase 6 Stage 7 — the Knowledge Asset Class Registry (foundational artifact #1
 * as typed data; doc-locked to docs/desktop/knowledge/KNOWLEDGE-ASSETS.md by test,
 * the Stage 6 signal-registry precedent).
 *
 * Every class describes records an EXISTING store already holds; the registry
 * itself stores nothing and fabricates nothing. `capability-standard` is a
 * DECLARED main-process boundary: the renderer capability registry is not
 * importable from the main process, so the class is documented (and reported as
 * a boundary gap) rather than pretending to read it.
 */
import type {
  AuthorityRank,
  AuthorityRankKey,
  KnowledgeAssetClass,
  KnowledgeAssetClassId,
  KnowledgeCriticality,
  StandardDomain,
} from '@neuropause/shared';
import { AUTHORITY_PRECEDENCE, KNOWLEDGE_ASSET_CLASS_IDS, STANDARD_DOMAINS } from '@neuropause/shared';

/* ── the registry ─────────────────────────────────────────────────────────── */

export const ASSET_CLASS_REGISTRY: readonly KnowledgeAssetClass[] = [
  {
    id: 'executive-decision',
    label: 'Executive decisions',
    description:
      'First-class executive decisions with an 8-state governed lifecycle, evidence, reasoning, owner, and append-only history.',
    backing: 'enterprise/decisionStore (persisted JSON, cap 500)',
    authorityTier: 'governed',
    authorityRank: 'governed-decision',
    criticalityBase: 'high',
    retention: {
      kind: 'store-capped',
      detail: 'Persisted indefinitely up to 500 decisions; oldest archived drop first at the cap.',
      source: 'enterprise/decisionStore MAX_DECISIONS',
    },
    staleAfterDays: 180,
    accessScope: 'operations:manage (writes) · snapshot reads',
    dependencies: ['executive recommendations', 'org metrics'],
    consumers: ['Decision UI', 'Hub', 'meeting prep', 'decision lineage'],
    standardDomains: ['engineering', 'deployment', 'security', 'operations', 'data-handling'],
    mainReadable: true,
  },
  {
    id: 'governance-policy',
    label: 'Governance policies (approval chains)',
    description: 'Role-ordered approval chains that gate workforce/enterprise actions.',
    backing: 'enterprise/governance approval chains (persisted)',
    authorityTier: 'org-defined',
    authorityRank: 'governance-policy',
    criticalityBase: 'critical',
    retention: {
      kind: 'governed',
      detail: 'Persisted until changed under governance:manage; every change is audit-recorded (hash-chained).',
      source: 'enterprise/governance store + audit trail',
    },
    staleAfterDays: 365,
    accessScope: 'governance:manage',
    dependencies: ['org roles'],
    consumers: ['workforce approvals', 'compliance', 'knowledge governance view'],
    standardDomains: ['operations', 'compliance'],
    mainReadable: true,
  },
  {
    id: 'compliance-rule',
    label: 'Compliance rules',
    description: 'Deterministic compliance checks evaluated over the live org/runtime.',
    backing: 'enterprise/governance compliance rules (persisted)',
    authorityTier: 'org-defined',
    authorityRank: 'governance-policy',
    criticalityBase: 'critical',
    retention: {
      kind: 'governed',
      detail: 'Persisted until changed under governance:manage; audit-recorded.',
      source: 'enterprise/governance store + audit trail',
    },
    staleAfterDays: 365,
    accessScope: 'governance:manage',
    dependencies: ['org structure'],
    consumers: ['compliance report', 'knowledge governance view'],
    standardDomains: ['compliance', 'security'],
    mainReadable: true,
  },
  {
    id: 'ai-prompt',
    label: 'AI prompt standards',
    description: 'The versioned prompt registry — every AI narration pins an exact prompt id + version.',
    backing: 'ai/promptManager DEFAULT_PROMPTS (code-shipped, versioned)',
    authorityTier: 'versioned-library',
    authorityRank: 'versioned-prompt',
    criticalityBase: 'medium',
    retention: {
      kind: 'version-permanent',
      detail: 'Every version is retained so audited calls reproduce exactly; revisions add versions, never overwrite.',
      source: 'ai/promptManager version history',
    },
    staleAfterDays: null,
    accessScope: 'in-process (audited per call)',
    dependencies: ['AI engine'],
    consumers: ['every AI narration', 'AI audit records'],
    standardDomains: ['ai-usage'],
    mainReadable: true,
  },
  {
    id: 'governed-document',
    label: 'Policy / SOP / ADR / playbook / spec documents',
    description:
      'Connector-synced documents CLASSIFIED into governed-document subkinds by real markers (title/label keywords) with declared confidence.',
    backing: 'UDM document/file entities (unifiedStore)',
    authorityTier: 'provider-authoritative',
    authorityRank: 'provider-document',
    criticalityBase: 'medium',
    retention: {
      kind: 'provider-managed',
      detail: 'The provider owns the record; the UDM mirrors it while the connector stays synced.',
      source: 'connector sync (UDM syncState)',
    },
    staleAfterDays: 180,
    accessScope: 'intelligence:read (UnifiedQuery)',
    dependencies: ['connector sync'],
    consumers: ['search', 'briefings', 'assistant retrieval', 'standards'],
    standardDomains: [
      'engineering',
      'deployment',
      'security',
      'data-handling',
      'ai-usage',
      'communication',
      'operations',
      'compliance',
    ],
    mainReadable: true,
  },
  {
    id: 'explicit-memory',
    label: 'Explicit knowledge memories',
    description: 'Deliberately-remembered organizational knowledge (decisions, docs, notes, context).',
    backing: 'memoryStore explicit items',
    authorityTier: 'authored',
    authorityRank: 'explicit-memory',
    criticalityBase: 'medium',
    retention: {
      kind: 'governed',
      detail: 'Retained until governed forget/update; org-scoped items carry append-only sync versions.',
      source: 'memory store + memory audit log',
    },
    staleAfterDays: 365,
    accessScope: 'memory:* scopes (governed writes)',
    dependencies: ['UDM evidence refs'],
    consumers: ['recall', 'assistant', 'meeting prep', 'knowledge links'],
    standardDomains: ['engineering', 'operations', 'communication'],
    mainReadable: true,
  },
  {
    id: 'workflow-definition',
    label: 'Workflow definitions (observed)',
    description:
      'No persisted workflow-definition library exists (honest gap): specs live per run. Observed runs are derived into per-skill definition assets.',
    backing: 'workforce jobs (per-run specs; runs persisted via jobs/events)',
    authorityTier: 'derived',
    authorityRank: 'derived-knowledge',
    criticalityBase: 'low',
    retention: {
      kind: 'store-capped',
      detail: 'Derived from the retained job history; no definition survives independently of its runs.',
      source: 'workforce job store',
    },
    staleAfterDays: 90,
    accessScope: 'workforce:*',
    dependencies: ['workers', 'approvals'],
    consumers: ['orchestrator', 'decision lineage (implementation joins)'],
    standardDomains: ['operations'],
    mainReadable: true,
  },
  {
    id: 'connector-doc',
    label: 'Connector integration docs',
    description: 'Per-connector manifest knowledge: description, docs URL, capabilities, scopes, lifecycle.',
    backing: 'connector manifests (ConnectorDto)',
    authorityTier: 'provider-authoritative',
    authorityRank: 'provider-document',
    criticalityBase: 'medium',
    retention: {
      kind: 'version-permanent',
      detail: 'Manifest knowledge ships with the app at a manifest version; connected-account state is runtime.',
      source: 'connector manifest version',
    },
    staleAfterDays: null,
    accessScope: 'connectors:read',
    dependencies: [],
    consumers: ['connections UI', '"why do we use this connector" answers'],
    standardDomains: ['operations'],
    mainReadable: true,
  },
  {
    id: 'org-structure',
    label: 'Organization structure',
    description: 'The operative org chart: units, roles, users, leads — the ownership-resolution source.',
    backing: 'enterprise/org orgStore (persisted)',
    authorityTier: 'org-defined',
    authorityRank: 'organization-standard',
    criticalityBase: 'high',
    retention: {
      kind: 'governed',
      detail: 'Persisted until changed under org:manage.',
      source: 'enterprise/org store',
    },
    staleAfterDays: 365,
    accessScope: 'org:manage (writes)',
    dependencies: [],
    consumers: ['ownership resolution', 'executive snapshot', 'coverage map'],
    standardDomains: ['communication', 'operations'],
    mainReadable: true,
  },
  {
    id: 'capability-standard',
    label: 'Capability standard (renderer registry)',
    description:
      'The canonical capability registry is renderer-side data locked by its own tests; the main process cannot import it. Declared boundary — reported as such, never fabricated.',
    backing: 'renderer/src/capability/capabilityRegistry.ts (NOT readable from main)',
    authorityTier: 'versioned-library',
    authorityRank: 'organization-standard',
    criticalityBase: 'medium',
    retention: {
      kind: 'version-permanent',
      detail: 'Commit-versioned code; every change reviewed with the app.',
      source: 'source control',
    },
    staleAfterDays: null,
    accessScope: 'renderer public',
    dependencies: [],
    consumers: ['Settings inventory', 'honesty locks'],
    standardDomains: [],
    mainReadable: false,
  },
  {
    id: 'derived-intelligence',
    label: 'Computed intelligence',
    description: 'Stateless computed reports (insight report, knowledge fabric overview) — always current, never stored.',
    backing: 'insight + knowledgeFabric generators (stateless)',
    authorityTier: 'derived',
    authorityRank: 'derived-knowledge',
    criticalityBase: 'low',
    retention: {
      kind: 'indefinite',
      detail: 'Nothing is retained — every read recomputes from live stores (3 s TTL cache only).',
      source: 'computed per read',
    },
    staleAfterDays: null,
    accessScope: 'intelligence:read / knowledge:read',
    dependencies: ['operational signals'],
    consumers: ['dashboards', 'assistant'],
    standardDomains: [],
    mainReadable: true,
  },
] as const;

export const ASSET_CLASS_BY_ID: ReadonlyMap<KnowledgeAssetClassId, KnowledgeAssetClass> = new Map(
  ASSET_CLASS_REGISTRY.map((c) => [c.id, c]),
);

export const AUTHORITY_RANK_BY_KEY: ReadonlyMap<AuthorityRankKey, AuthorityRank> = new Map(
  AUTHORITY_PRECEDENCE.map((r) => [r.key, r]),
);

/** Numeric rank for a key (lower = higher authority). Unknown keys rank last (defensive). */
export function rankOf(key: AuthorityRankKey): number {
  return AUTHORITY_RANK_BY_KEY.get(key)?.rank ?? AUTHORITY_PRECEDENCE.length + 1;
}

const CRITICALITY_ORDER: readonly KnowledgeCriticality[] = ['low', 'medium', 'high', 'critical'];

/** One deterministic criticality bump (low→medium→high→critical, capped). */
export function bumpCriticality(c: KnowledgeCriticality): KnowledgeCriticality {
  const i = CRITICALITY_ORDER.indexOf(c);
  return CRITICALITY_ORDER[Math.min(i + 1, CRITICALITY_ORDER.length - 1)];
}

/* ── domain keyword map (classification input — real markers only) ────────── */

/** Deterministic keyword → standard-domain mapping used by the document/decision
 *  classifiers. Matching a keyword is a DECLARED classification signal. */
export const DOMAIN_KEYWORDS: readonly { domain: StandardDomain; keywords: readonly string[] }[] = [
  { domain: 'engineering', keywords: ['engineering', 'architecture', 'adr', 'code review', 'technical design', 'api design'] },
  { domain: 'deployment', keywords: ['deployment', 'deploy', 'release', 'rollout', 'rollback', 'ci/cd'] },
  { domain: 'security', keywords: ['security', 'access control', 'authentication', 'encryption', 'vulnerability', 'incident response'] },
  { domain: 'data-handling', keywords: ['data handling', 'data retention', 'privacy', 'gdpr', 'pii', 'data classification', 'backup'] },
  { domain: 'ai-usage', keywords: ['ai usage', 'ai policy', 'prompt', 'model usage', 'llm', 'ai governance'] },
  { domain: 'communication', keywords: ['communication', 'meeting', 'escalation', 'on-call', 'oncall', 'announcement'] },
  { domain: 'operations', keywords: ['operations', 'runbook', 'sop', 'procedure', 'workflow', 'process', 'playbook'] },
  { domain: 'compliance', keywords: ['compliance', 'audit', 'regulatory', 'legal', 'certification', 'iso', 'soc 2'] },
] as const;

/** Document subkind markers (title/label keywords → subkind). Order matters: first match wins. */
export const DOC_SUBKIND_MARKERS: readonly { subkind: string; keywords: readonly string[] }[] = [
  { subkind: 'adr', keywords: ['adr', 'architecture decision', 'design decision', 'rfc'] },
  { subkind: 'sop', keywords: ['sop', 'standard operating procedure', 'runbook', 'procedure'] },
  { subkind: 'policy', keywords: ['policy', 'policies'] },
  { subkind: 'playbook', keywords: ['playbook'] },
  { subkind: 'standard', keywords: ['standard', 'guideline', 'convention'] },
  { subkind: 'spec', keywords: ['spec', 'specification', 'design doc', 'prd'] },
] as const;

/* ── integrity (mirrors the Stage 6 signal-registry lock) ─────────────────── */

export function registryIntegrityIssues(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const c of ASSET_CLASS_REGISTRY) {
    if (seen.has(c.id)) issues.push(`duplicate class id: ${c.id}`);
    seen.add(c.id);
    if (!AUTHORITY_RANK_BY_KEY.has(c.authorityRank)) issues.push(`${c.id}: unknown authority rank ${c.authorityRank}`);
    if (c.label.trim().length === 0) issues.push(`${c.id}: empty label`);
    if (c.backing.trim().length === 0) issues.push(`${c.id}: empty backing`);
    if (c.retention.detail.trim().length === 0) issues.push(`${c.id}: empty retention detail`);
    for (const d of c.standardDomains) {
      if (!STANDARD_DOMAINS.includes(d)) issues.push(`${c.id}: unknown standard domain ${d}`);
    }
  }
  for (const id of KNOWLEDGE_ASSET_CLASS_IDS) {
    if (!seen.has(id)) issues.push(`class id declared in shared types but missing from registry: ${id}`);
  }
  if (AUTHORITY_PRECEDENCE.length !== 8) issues.push('authority precedence must have exactly 8 ranks');
  for (let i = 0; i < AUTHORITY_PRECEDENCE.length; i += 1) {
    if (AUTHORITY_PRECEDENCE[i].rank !== i + 1) issues.push(`authority rank ${i + 1} out of order`);
  }
  return issues;
}
