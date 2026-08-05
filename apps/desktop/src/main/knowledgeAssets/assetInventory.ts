/**
 * Phase 6 Stage 7 — the Knowledge Asset Inventory (7.1/7.2 + enhancement #1).
 *
 * Classifies records the platform ALREADY holds into knowledge-asset envelopes:
 * owner + review owner (resolved through the real org chart), authority tier +
 * precedence rank, derived lifecycle (null = "no marker" — honest), freshness,
 * versioning, access scope, business criticality (deterministic, reasons
 * recorded), retention (describes actual store behavior), and a provenance
 * chain (created → reviewed → approved → referenced → superseded → archived)
 * where every stage is backed by a real record or absent.
 *
 * NOTHING here is stored, invented, or mutated:
 *   - a class with zero backing records reports a documentation GAP,
 *   - a failing source read isolates into `unavailable` (other classes still classify),
 *   - classification confidence + the matched signals are declared per asset,
 *   - unowned assets stay unowned (a finding, never a guessed name).
 * Pure module: all reads are injected snapshots.
 */
import type {
  ApprovalChain,
  ComplianceRule,
  ExecutiveDecision,
  KnowledgeAsset,
  KnowledgeAssetClass,
  KnowledgeAssetClassId,
  KnowledgeCriticality,
  KnowledgeFreshness,
  KnowledgeInventory,
  KnowledgeLifecycleState,
  KnowledgeProvenanceEvent,
  KnowledgeUnavailable,
  MemoryItem,
  OrgUnit,
  OrgUser,
  StandardDomain,
  UnifiedEntity,
} from '@neuropause/shared';
import {
  ASSET_CLASS_BY_ID,
  ASSET_CLASS_REGISTRY,
  DOC_SUBKIND_MARKERS,
  DOMAIN_KEYWORDS,
  bumpCriticality,
  rankOf,
} from './assetRegistry';

/* ── injected snapshot shapes (narrow; null = source unavailable) ─────────── */

export interface PromptRef {
  id: string;
  version: number;
  label: string;
}

export type JobLite = {
  id: string;
  skillId: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  finishedAt: string | null;
  /** P8.2 workflow-run correlation id (approval-join substrate for the matrix). */
  correlationId: string | null;
};

export type ConnectorLite = {
  id: string;
  name: string;
  provider: string;
  description: string;
  docsUrl: string;
  version: string;
  configured: boolean;
  accounts: { id: string }[];
  lastSyncAt: string | null;
};

export interface OrgLite {
  org: { id: string; name: string } | null;
  units: Pick<OrgUnit, 'id' | 'name' | 'leadUserId'>[];
  users: Pick<OrgUser, 'id' | 'name' | 'unitId'>[];
}

export interface DerivedLite {
  id: string;
  title: string;
  generatedAt: string | null;
  note: string;
}

/** recordId → records that reference it (real referrers only). */
export type ReferenceIndex = Map<string, { id: string; at: string | null }[]>;

export interface InventoryInput {
  nowMs: number;
  decisions: ExecutiveDecision[] | null;
  chains: ApprovalChain[] | null;
  rules: ComplianceRule[] | null;
  prompts: PromptRef[] | null;
  documents: UnifiedEntity[] | null;
  memories: MemoryItem[] | null;
  connectors: ConnectorLite[] | null;
  org: OrgLite | null;
  jobs: JobLite[] | null;
  derived: DerivedLite[] | null;
  references: ReferenceIndex | null;
  /** Per-source read failures collected by the caller (system → reason). */
  failures: Record<string, string>;
}

/* ── small pure helpers ───────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'our', 'are', 'was', 'has',
  'have', 'not', 'all', 'any', 'its', 'per', 'into', 'over', 'under', 'about', 'new',
]);

export function topicTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

export function topicOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const t of a) if (setB.has(t)) inter += 1;
  return inter / (a.length + b.length - inter);
}

/** Allocation-free Jaccard against a prebuilt token set (the pairwise-scan hot path). */
export function overlapWithSet(a: readonly string[], bSet: ReadonlySet<string>, bSize: number): number {
  if (a.length === 0 || bSize === 0) return 0;
  let inter = 0;
  for (const t of a) if (bSet.has(t)) inter += 1;
  return inter / (a.length + bSize - inter);
}

export function freshnessFor(
  updatedAt: string | null,
  staleAfterDays: number | null,
  nowMs: number,
): KnowledgeFreshness {
  if (staleAfterDays == null) return 'fresh'; // staleness not time-meaningful for this class
  if (!updatedAt) return 'unknown';
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 'unknown';
  const ageDays = (nowMs - ts) / 86_400_000;
  if (ageDays >= staleAfterDays) return 'stale';
  if (ageDays >= staleAfterDays / 2) return 'aging';
  return 'fresh';
}

function scanDomains(text: string): StandardDomain[] {
  const t = text.toLowerCase();
  const out: StandardDomain[] = [];
  for (const { domain, keywords } of DOMAIN_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) out.push(domain);
  }
  return out;
}

function docSubkind(text: string): { subkind: string; keyword: string } | null {
  const t = text.toLowerCase();
  for (const { subkind, keywords } of DOC_SUBKIND_MARKERS) {
    const hit = keywords.find((k) => t.includes(k));
    if (hit) return { subkind, keyword: hit };
  }
  return null;
}

function assetId(classId: KnowledgeAssetClassId, recordId: string): string {
  return `ka:${classId}:${recordId}`;
}

interface EnvelopeSeed {
  classId: KnowledgeAssetClassId;
  recordId: string;
  sourceSystem: string;
  title: string;
  subkind: string | null;
  owner: string | null;
  ownerResolution: string;
  lifecycle: KnowledgeLifecycleState | null;
  lifecycleBasis: string;
  lifecycleEvidence: string[];
  createdAt: string | null;
  updatedAt: string | null;
  version: string | null;
  classificationConfidence: number;
  classificationSignals: string[];
  topics: string[];
  entityRefs: string[];
  evidence: string[];
  domains: StandardDomain[];
  provenance: KnowledgeProvenanceEvent[];
  /** Per-asset authority refinement (approved documents outrank provider documents). */
  approvedDocument?: boolean;
}

/** Resolve the review owner through the real org chart: the owner's unit lead
 *  (when resolvable and distinct), else the owner themselves. Never guessed. */
function resolveReviewOwner(
  owner: string | null,
  org: OrgLite | null,
): { reviewOwner: string | null; path: string } {
  if (!owner) return { reviewOwner: null, path: 'no owner recorded on the backing record' };
  if (!org || org.users.length === 0) {
    return { reviewOwner: owner, path: 'owner (org chart unavailable for lead resolution)' };
  }
  const norm = owner.trim().toLowerCase();
  const user = org.users.find((u) => u.name.trim().toLowerCase() === norm);
  if (!user || !user.unitId) {
    return { reviewOwner: owner, path: 'owner (no org-chart unit match for lead resolution)' };
  }
  const unit = org.units.find((u) => u.id === user.unitId);
  if (!unit || !unit.leadUserId) {
    return { reviewOwner: owner, path: `owner (unit ${unit ? unit.name : user.unitId} has no lead)` };
  }
  const lead = org.users.find((u) => u.id === unit.leadUserId);
  if (!lead || lead.name.trim().toLowerCase() === norm) {
    return { reviewOwner: owner, path: `owner (owner leads ${unit.name})` };
  }
  return { reviewOwner: lead.name, path: `unit lead of ${unit.name} (owner's unit in the org chart)` };
}

function finishAsset(
  seed: EnvelopeSeed,
  cls: KnowledgeAssetClass,
  input: InventoryInput,
): KnowledgeAsset {
  const id = assetId(seed.classId, seed.recordId);
  const refs = input.references?.get(seed.recordId) ?? [];
  const referencedBy = refs.length;

  /* enhancement #1 — provenance: referenced stage from the real reference index */
  const provenance = [...seed.provenance];
  if (referencedBy > 0) {
    const withTs = refs.filter((r) => r.at).map((r) => r.at as string);
    provenance.push({
      stage: 'referenced',
      at: withTs.length > 0 ? withTs.sort().slice(-1)[0] : null,
      evidence: refs.slice(0, 8).map((r) => r.id),
      note: `referenced by ${referencedBy} record(s)`,
    });
  }

  /* enhancement #1 — deterministic criticality with recorded reasons */
  let criticality: KnowledgeCriticality = cls.criticalityBase;
  const criticalityReasons = [`class base: ${cls.criticalityBase}`];
  if (referencedBy >= 3) {
    criticality = bumpCriticality(criticality);
    criticalityReasons.push(`referenced by ${referencedBy} records (≥3) → +1`);
  }
  if ((cls.authorityTier === 'governed' || cls.authorityTier === 'org-defined') && seed.lifecycle === 'approved') {
    criticality = bumpCriticality(criticality);
    criticalityReasons.push(`${cls.authorityTier} + approved lifecycle → +1`);
  }

  const rankKey = seed.approvedDocument ? 'approved-document' : cls.authorityRank;
  const { reviewOwner, path } = resolveReviewOwner(seed.owner, input.org);

  return {
    id,
    classId: seed.classId,
    recordId: seed.recordId,
    sourceSystem: seed.sourceSystem,
    title: seed.title,
    subkind: seed.subkind,
    owner: seed.owner,
    reviewOwner,
    ownerResolution: seed.owner ? `${seed.ownerResolution}; review owner: ${path}` : seed.ownerResolution,
    criticality,
    criticalityReasons,
    retention: cls.retention,
    provenance,
    authorityTier: cls.authorityTier,
    authorityRankKey: rankKey,
    authorityRank: rankOf(rankKey),
    lifecycle: seed.lifecycle,
    lifecycleBasis: seed.lifecycleBasis,
    lifecycleEvidence: seed.lifecycleEvidence,
    freshness: freshnessFor(seed.updatedAt, cls.staleAfterDays, input.nowMs),
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    version: seed.version,
    accessScope: cls.accessScope,
    classificationConfidence: seed.classificationConfidence,
    classificationSignals: seed.classificationSignals,
    topics: seed.topics,
    entityRefs: seed.entityRefs,
    evidence: seed.evidence,
    domains: seed.domains,
    referencedBy,
  };
}

/* ── per-class classifiers (each isolated; real markers only) ─────────────── */

const DECISION_LIFECYCLE: Record<string, KnowledgeLifecycleState> = {
  draft: 'draft',
  suggested: 'review',
  accepted: 'approved',
  in_progress: 'approved',
  blocked: 'approved',
  completed: 'approved',
  rejected: 'deprecated',
  archived: 'archived',
};

function decisionSeeds(decisions: ExecutiveDecision[]): EnvelopeSeed[] {
  return decisions.map((d) => {
    const provenance: KnowledgeProvenanceEvent[] = [
      { stage: 'created', at: d.createdAt, evidence: [d.id], note: d.fromRecommendationId ? `from recommendation ${d.fromRecommendationId}` : 'created in the decision store' },
    ];
    const history = d.history ?? [];
    const reviewEv = history.find((h) => h.newState === 'suggested');
    if (reviewEv) {
      provenance.push({ stage: 'reviewed', at: reviewEv.at, evidence: [`decision:${d.id}:history:suggested@${reviewEv.at}`], note: `entered review by ${reviewEv.actor}` });
    }
    const approveEv = history.find((h) => h.newState === 'accepted');
    if (approveEv) {
      provenance.push({ stage: 'approved', at: approveEv.at, evidence: [`decision:${d.id}:history:accepted@${approveEv.at}`], note: `accepted by ${approveEv.actor}` });
    }
    if (d.archivedAt) {
      provenance.push({ stage: 'archived', at: d.archivedAt, evidence: [d.id], note: 'archived in the decision store' });
    }
    const lifecycle = DECISION_LIFECYCLE[d.status] ?? null;
    return {
      classId: 'executive-decision' as const,
      recordId: d.id,
      sourceSystem: 'decision-store',
      title: d.title,
      subkind: d.category,
      owner: d.owner || null,
      ownerResolution: d.owner ? 'decision.owner field' : 'decision has no owner recorded',
      lifecycle,
      lifecycleBasis: `decision status '${d.status}' maps to '${lifecycle ?? 'unclassified'}' (governed 8-state store)`,
      lifecycleEvidence: [d.id],
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      version: `${history.length} history event(s)`,
      classificationConfidence: 1,
      classificationSignals: ['record lives in the executive decision store'],
      topics: topicTokens(`${d.title} ${d.relatedMetrics?.join(' ') ?? ''}`),
      entityRefs: [],
      evidence: [d.id, ...d.evidence.slice(0, 6)],
      domains: scanDomains(`${d.title} ${d.description}`),
      provenance,
    };
  });
}

function chainSeeds(chains: ApprovalChain[], orgName: string | null): EnvelopeSeed[] {
  return chains.map((c) => ({
    classId: 'governance-policy' as const,
    recordId: c.id,
    sourceSystem: 'governance-store',
    title: c.name,
    subkind: 'approval-chain',
    owner: orgName,
    ownerResolution: orgName ? 'org-defined record; owned by the organization' : 'org-defined record; organization unavailable',
    lifecycle: c.enabled ? ('approved' as const) : ('deprecated' as const),
    lifecycleBasis: c.enabled ? 'enabled approval chain (operative governance)' : 'disabled approval chain',
    lifecycleEvidence: [c.id],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    version: c.updatedAt,
    classificationConfidence: 1,
    classificationSignals: ['record lives in the governance approval-chain store'],
    topics: topicTokens(`${c.name} ${c.description}`),
    entityRefs: [],
    evidence: [c.id],
    domains: ['operations', 'compliance'],
    provenance: [
      { stage: 'created', at: c.createdAt, evidence: [c.id], note: 'created in the governance store' },
      ...(c.enabled
        ? [{ stage: 'approved' as const, at: c.updatedAt, evidence: [c.id], note: 'enabled (operative); changes are audit-recorded' }]
        : []),
    ],
  }));
}

function ruleSeeds(rules: ComplianceRule[], orgName: string | null): EnvelopeSeed[] {
  return rules.map((r) => ({
    classId: 'compliance-rule' as const,
    recordId: r.id,
    sourceSystem: 'governance-store',
    title: r.name,
    subkind: r.check,
    owner: orgName,
    ownerResolution: orgName ? 'org-defined record; owned by the organization' : 'org-defined record; organization unavailable',
    lifecycle: r.enabled ? ('approved' as const) : ('deprecated' as const),
    lifecycleBasis: r.enabled ? 'enabled compliance rule (operative governance)' : 'disabled compliance rule',
    lifecycleEvidence: [r.id],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: r.updatedAt,
    classificationConfidence: 1,
    classificationSignals: ['record lives in the governance compliance-rule store'],
    topics: topicTokens(`${r.name} ${r.description} ${r.category}`),
    entityRefs: [],
    evidence: [r.id],
    domains: ['compliance', 'security'],
    provenance: [
      { stage: 'created', at: r.createdAt, evidence: [r.id], note: 'created in the governance store' },
      ...(r.enabled
        ? [{ stage: 'approved' as const, at: r.updatedAt, evidence: [r.id], note: 'enabled (operative); changes are audit-recorded' }]
        : []),
    ],
  }));
}

function promptSeeds(prompts: PromptRef[]): EnvelopeSeed[] {
  return prompts.map((p) => ({
    classId: 'ai-prompt' as const,
    recordId: p.id,
    sourceSystem: 'prompt-registry',
    title: p.label,
    subkind: null,
    owner: 'platform (code-shipped)',
    ownerResolution: 'versioned prompt library ships with the application',
    lifecycle: 'approved' as const,
    lifecycleBasis: 'code-shipped versioned registry; version pinning is the approval mechanism',
    lifecycleEvidence: [`prompt:${p.id}@v${p.version}`],
    createdAt: null,
    updatedAt: null,
    version: `v${p.version}`,
    classificationConfidence: 1,
    classificationSignals: ['record lives in the versioned prompt registry'],
    topics: topicTokens(`${p.label} ${p.id.replace(/[._]/g, ' ')}`),
    entityRefs: [],
    evidence: [`prompt:${p.id}@v${p.version}`],
    domains: ['ai-usage'],
    provenance: [
      {
        stage: 'created',
        at: null,
        evidence: [`prompt:${p.id}@v1`],
        note: 'registry seed; the store records versions, not timestamps',
      },
      ...(p.version > 1
        ? [{ stage: 'reviewed' as const, at: null, evidence: [`prompt:${p.id}@v${p.version}`], note: `revised to v${p.version} (each revision is a reviewed code change)` }]
        : []),
    ],
  }));
}

/** Documents classify ONLY on real markers; unmatched documents are not knowledge assets. */
function documentSeeds(documents: UnifiedEntity[]): EnvelopeSeed[] {
  const seeds: EnvelopeSeed[] = [];
  for (const e of documents) {
    if (e.kind !== 'document' && e.kind !== 'file') continue;
    const labelText = e.labels.join(' ');
    const titleHit = docSubkind(e.title);
    const labelHit = docSubkind(labelText);
    const bodyHit = e.body ? docSubkind(e.body.slice(0, 400)) : null;
    const hit = titleHit ?? labelHit ?? bodyHit;
    if (!hit) continue;
    const signals: string[] = [];
    let confidence = 0;
    if (titleHit) {
      signals.push(`title contains '${titleHit.keyword}'`);
      confidence = 0.75;
    }
    if (labelHit) {
      signals.push(`label contains '${labelHit.keyword}'`);
      confidence = titleHit ? 0.95 : 0.85;
    }
    if (!titleHit && !labelHit && bodyHit) {
      signals.push(`body head contains '${bodyHit.keyword}'`);
      confidence = 0.55;
    }
    const lower = `${e.title} ${labelText}`.toLowerCase();
    let lifecycle: KnowledgeLifecycleState | null = null;
    let basis = 'no lifecycle marker on the synced document (provider does not record one)';
    const lifecycleEvidence: string[] = [e.id];
    if (/\bdraft\b/.test(lower)) {
      lifecycle = 'draft';
      basis = "explicit 'draft' marker in the title/labels";
    } else if (/\b(in review|under review)\b/.test(lower)) {
      lifecycle = 'review';
      basis = "explicit 'review' marker in the title/labels";
    } else if (/\bdeprecated\b/.test(lower)) {
      lifecycle = 'deprecated';
      basis = "explicit 'deprecated' marker in the title/labels";
    } else if (/\barchived?\b/.test(lower)) {
      lifecycle = 'archived';
      basis = "explicit 'archived' marker in the title/labels";
    } else if (/\bapproved\b/.test(lower)) {
      lifecycle = 'approved';
      basis = "explicit 'approved' marker in the title/labels";
    }
    const provenance: KnowledgeProvenanceEvent[] = [
      { stage: 'created', at: e.createdAt, evidence: [e.id], note: `synced from ${e.connectorId}` },
    ];
    if (lifecycle === 'review') {
      provenance.push({ stage: 'reviewed', at: null, evidence: [e.id], note: 'review marker present; the provider does not record when it was applied' });
    }
    if (lifecycle === 'approved') {
      provenance.push({ stage: 'approved', at: null, evidence: [e.id], note: 'approval marker present; the provider does not record when it was applied' });
    }
    if (lifecycle === 'archived') {
      provenance.push({ stage: 'archived', at: null, evidence: [e.id], note: 'archive marker present; the provider does not record when it was applied' });
    }
    seeds.push({
      classId: 'governed-document',
      recordId: e.id,
      sourceSystem: e.connectorId,
      title: e.title,
      subkind: hit.subkind,
      owner: e.author,
      ownerResolution: e.author ? 'document author (provider record)' : 'document has no author recorded (finding)',
      lifecycle,
      lifecycleBasis: basis,
      lifecycleEvidence,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      version: e.updatedAt,
      classificationConfidence: confidence,
      classificationSignals: signals,
      topics: topicTokens(`${e.title} ${labelText}`),
      entityRefs: [e.id],
      evidence: [e.id],
      domains: scanDomains(`${e.title} ${labelText} ${hit.subkind}`),
      provenance,
      approvedDocument: lifecycle === 'approved',
    });
  }
  return seeds;
}

const MEMORY_KNOWLEDGE_KINDS = new Set(['decision', 'document', 'note', 'context']);

function memorySeeds(memories: MemoryItem[]): EnvelopeSeed[] {
  const seeds: EnvelopeSeed[] = [];
  for (const m of memories) {
    if (m.origin !== 'explicit' || !MEMORY_KNOWLEDGE_KINDS.has(m.kind)) continue;
    const metaOwner = typeof m.metadata['owner'] === 'string' ? (m.metadata['owner'] as string) : null;
    const tags = m.tags.map((t) => t.toLowerCase());
    let lifecycle: KnowledgeLifecycleState | null = null;
    let basis = 'authored memory; no governance lifecycle recorded';
    if (tags.includes('deprecated')) {
      lifecycle = 'deprecated';
      basis = "explicit 'deprecated' tag";
    } else if (tags.includes('archived')) {
      lifecycle = 'archived';
      basis = "explicit 'archived' tag";
    } else if (tags.includes('draft')) {
      lifecycle = 'draft';
      basis = "explicit 'draft' tag";
    }
    seeds.push({
      classId: 'explicit-memory',
      recordId: m.id,
      sourceSystem: 'memory-store',
      title: m.title,
      subkind: m.kind,
      owner: metaOwner,
      ownerResolution: metaOwner ? 'memory metadata.owner' : 'explicit memory carries no owner metadata (finding)',
      lifecycle,
      lifecycleBasis: basis,
      lifecycleEvidence: [m.id],
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      version: m.sync ? 'org-sync versioned' : null,
      classificationConfidence: 1,
      classificationSignals: [`explicit memory of kind '${m.kind}'`],
      topics: topicTokens(`${m.title} ${m.tags.join(' ')}`),
      entityRefs: [...m.entityRefs],
      evidence: [m.id, ...(m.evidence ? [m.evidence.id] : [])],
      domains: scanDomains(`${m.title} ${m.tags.join(' ')} ${m.content.slice(0, 200)}`),
      provenance: [{ stage: 'created', at: m.createdAt, evidence: [m.id], note: `authored via ${m.source}` }],
    });
  }
  return seeds;
}

function connectorSeeds(connectors: ConnectorLite[]): EnvelopeSeed[] {
  return connectors
    .filter((c) => c.configured || c.accounts.length > 0)
    .map((c) => ({
      classId: 'connector-doc' as const,
      recordId: c.id,
      sourceSystem: 'connector-manifest',
      title: `${c.name} integration`,
      subkind: c.provider,
      owner: c.provider,
      ownerResolution: 'connector manifest provider',
      lifecycle: null,
      lifecycleBasis: 'manifest knowledge; connector lifecycle tracks adapter availability, not document governance',
      lifecycleEvidence: [c.id],
      createdAt: null,
      updatedAt: c.lastSyncAt,
      version: c.version,
      classificationConfidence: 1,
      classificationSignals: ['configured/connected connector manifest'],
      topics: topicTokens(`${c.name} ${c.description}`),
      entityRefs: [],
      evidence: [c.id, ...(c.docsUrl ? [c.docsUrl] : [])],
      domains: ['operations'],
      provenance: [
        { stage: 'created', at: null, evidence: [c.id], note: `manifest v${c.version} ships with the app` },
      ],
    }));
}

function orgSeeds(org: OrgLite): EnvelopeSeed[] {
  if (!org.org) return [];
  const leads = org.units.filter((u) => u.leadUserId).length;
  return [
    {
      classId: 'org-structure',
      recordId: org.org.id,
      sourceSystem: 'org-store',
      title: `Organization structure: ${org.org.name}`,
      subkind: null,
      owner: org.org.name,
      ownerResolution: 'org-defined record; owned by the organization',
      lifecycle: 'approved',
      lifecycleBasis: 'operative organization configuration (org:manage governed)',
      lifecycleEvidence: [org.org.id],
      createdAt: null,
      updatedAt: null,
      version: `${org.units.length} unit(s) · ${org.users.length} member(s)`,
      classificationConfidence: 1,
      classificationSignals: ['record lives in the organization store'],
      topics: topicTokens(org.units.map((u) => u.name).join(' ')),
      entityRefs: [],
      evidence: [org.org.id],
      domains: ['communication', 'operations'],
      provenance: [
        {
          stage: 'created',
          at: null,
          evidence: [org.org.id],
          note: `org chart with ${org.units.length} unit(s), ${leads} led`,
        },
      ],
    },
  ];
}

/** Observed workflow definitions: one derived asset per distinct skill with runs. */
function workflowSeeds(jobs: JobLite[]): EnvelopeSeed[] {
  const bySkill = new Map<string, JobLite[]>();
  for (const j of jobs) {
    const list = bySkill.get(j.skillId) ?? [];
    list.push(j);
    bySkill.set(j.skillId, list);
  }
  const seeds: EnvelopeSeed[] = [];
  for (const [skillId, runs] of bySkill) {
    const sorted = [...runs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    seeds.push({
      classId: 'workflow-definition',
      recordId: `wf:${skillId}`,
      sourceSystem: 'workforce-jobs',
      title: `Workflow (observed): ${skillId}`,
      subkind: skillId,
      owner: latest.requestedBy || null,
      ownerResolution: latest.requestedBy
        ? 'most recent run requester (no persisted definition owner exists)'
        : 'no requester recorded',
      lifecycle: null,
      lifecycleBasis: 'no persisted workflow-definition library exists — specs live per run (honest gap)',
      lifecycleEvidence: sorted.slice(-3).map((r) => r.id),
      createdAt: sorted[0].createdAt,
      updatedAt: latest.finishedAt ?? latest.createdAt,
      version: `${runs.length} observed run(s)`,
      classificationConfidence: 0.7,
      classificationSignals: [`derived from ${runs.length} real workflow run(s) of skill '${skillId}'`],
      topics: topicTokens(skillId.replace(/[._-]/g, ' ')),
      entityRefs: [],
      evidence: sorted.slice(-5).map((r) => r.id),
      domains: ['operations'],
      provenance: [
        { stage: 'created', at: sorted[0].createdAt, evidence: [sorted[0].id], note: 'first observed run' },
      ],
    });
  }
  return seeds;
}

function derivedSeeds(derived: DerivedLite[]): EnvelopeSeed[] {
  return derived.map((d) => ({
    classId: 'derived-intelligence' as const,
    recordId: d.id,
    sourceSystem: 'computed',
    title: d.title,
    subkind: null,
    owner: null,
    ownerResolution: 'computed report; the system derives it, no one owns it',
    lifecycle: null,
    lifecycleBasis: 'computed per read; lifecycle does not apply',
    lifecycleEvidence: [],
    createdAt: null,
    updatedAt: d.generatedAt,
    version: null,
    classificationConfidence: 1,
    classificationSignals: ['stateless computed report'],
    topics: topicTokens(d.title),
    entityRefs: [],
    evidence: d.generatedAt ? [`${d.id}@${d.generatedAt}`] : [d.id],
    domains: [],
    provenance: [],
  }));
}

/* ── supersession (derived from real newer same-class/subkind assets) ─────── */

function applySupersession(assets: KnowledgeAsset[]): void {
  // Supersession requires: same class, same subkind, a SHARED standard domain
  // (or both domain-less), a strictly newer timestamp, and topic overlap ≥ 0.6.
  // Domain bucketing keeps the scan near-linear at volume; a domain-crossing
  // record can never supersede (a security SOP does not retire a deployment SOP).
  const groups = new Map<string, KnowledgeAsset[]>();
  for (const a of assets) {
    if (a.classId !== 'governed-document' && a.classId !== 'explicit-memory') continue;
    const domains = a.domains.length > 0 ? a.domains : ['none'];
    for (const d of domains) {
      const key = `${a.classId}|${a.subkind ?? ''}|${d}`;
      const list = groups.get(key) ?? [];
      list.push(a);
      groups.set(key, list);
    }
  }
  // Prebuilt token sets keep the scan allocation-free at volume.
  const topicSets = new Map<string, Set<string>>();
  for (const a of assets) {
    if (a.classId === 'governed-document' || a.classId === 'explicit-memory') topicSets.set(a.id, new Set(a.topics));
  }
  for (const list of groups.values()) {
    for (const older of list) {
      if (older.lifecycle !== null && older.lifecycle !== 'approved') continue;
      if (!older.updatedAt) continue;
      for (const newer of list) {
        if (newer.id === older.id || !newer.updatedAt) continue;
        if (newer.updatedAt <= older.updatedAt) continue;
        if (newer.lifecycle === 'archived' || newer.lifecycle === 'deprecated' || newer.lifecycle === 'draft') continue;
        const newerSet = topicSets.get(newer.id) as Set<string>;
        if (overlapWithSet(older.topics, newerSet, newer.topics.length) < 0.6) continue;
        older.lifecycle = 'superseded';
        older.lifecycleBasis = `superseded by newer ${newer.classId} '${newer.title}' (same subkind, topic overlap ≥ 0.6)`;
        older.lifecycleEvidence = [...older.lifecycleEvidence, newer.recordId];
        older.provenance = [
          ...older.provenance,
          {
            stage: 'superseded',
            at: newer.updatedAt,
            evidence: [newer.recordId],
            note: `newer '${newer.title}' covers the same topic`,
          },
        ];
        break;
      }
    }
  }
}

/* ── the inventory ────────────────────────────────────────────────────────── */

export function buildInventory(input: InventoryInput): KnowledgeInventory {
  const unavailable: KnowledgeUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  const orgName = input.org?.org?.name ?? null;

  const assets: KnowledgeAsset[] = [];
  const push = (seeds: EnvelopeSeed[]): void => {
    for (const s of seeds) {
      const cls = ASSET_CLASS_BY_ID.get(s.classId);
      if (!cls) continue;
      assets.push(finishAsset(s, cls, input));
    }
  };

  if (input.decisions) push(decisionSeeds(input.decisions));
  if (input.chains) push(chainSeeds(input.chains, orgName));
  if (input.rules) push(ruleSeeds(input.rules, orgName));
  if (input.prompts) push(promptSeeds(input.prompts));
  if (input.documents) push(documentSeeds(input.documents));
  if (input.memories) push(memorySeeds(input.memories));
  if (input.connectors) push(connectorSeeds(input.connectors));
  if (input.org) push(orgSeeds(input.org));
  if (input.jobs) push(workflowSeeds(input.jobs));
  if (input.derived) push(derivedSeeds(input.derived));

  applySupersession(assets);

  const byClassCount = new Map<KnowledgeAssetClassId, number>();
  for (const a of assets) byClassCount.set(a.classId, (byClassCount.get(a.classId) ?? 0) + 1);

  const byClass = ASSET_CLASS_REGISTRY.filter((c) => (byClassCount.get(c.id) ?? 0) > 0).map((c) => ({
    classId: c.id,
    label: c.label,
    count: byClassCount.get(c.id) ?? 0,
    authorityTier: c.authorityTier,
    note: c.id === 'workflow-definition' ? 'derived from observed runs — no persisted definition library exists' : null,
  }));

  const failedSystems = new Set(Object.keys(input.failures));
  const gaps = ASSET_CLASS_REGISTRY.filter((c) => (byClassCount.get(c.id) ?? 0) === 0).map((c) => ({
    classId: c.id,
    label: c.label,
    reason: !c.mainReadable
      ? 'declared boundary: the backing registry is renderer-side data the main process cannot read'
      : failedSystems.has(sourceSystemFor(c.id))
        ? `source read failed: ${input.failures[sourceSystemFor(c.id)]}`
        : 'no backing records exist — a documentation gap, not a fabricated asset',
  }));

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    assets,
    byClass,
    gaps,
    totals: {
      assets: assets.length,
      classesWithRecords: byClass.length,
      withOwner: assets.filter((a) => a.owner !== null).length,
      withLifecycle: assets.filter((a) => a.lifecycle !== null).length,
      stale: assets.filter((a) => a.freshness === 'stale').length,
    },
    unavailable,
  };
}

/** Which failure key covers a class (for honest gap reasons). */
function sourceSystemFor(classId: KnowledgeAssetClassId): string {
  switch (classId) {
    case 'executive-decision':
      return 'decisions';
    case 'governance-policy':
    case 'compliance-rule':
      return 'governance';
    case 'ai-prompt':
      return 'prompts';
    case 'governed-document':
      return 'documents';
    case 'explicit-memory':
      return 'memories';
    case 'connector-doc':
      return 'connectors';
    case 'org-structure':
      return 'organization';
    case 'workflow-definition':
      return 'workflows';
    case 'derived-intelligence':
      return 'derived';
    case 'capability-standard':
      return 'capability-registry';
    default:
      return 'unknown';
  }
}

/* ── the reference index (built from REAL referrers; used for provenance +
 *    criticality + broken-reference checks) ─────────────────────────────── */

export interface ReferenceFeeds {
  decisions: Pick<ExecutiveDecision, 'id' | 'evidence' | 'updatedAt'>[] | null;
  memories: Pick<MemoryItem, 'id' | 'entityRefs' | 'evidence' | 'updatedAt'>[] | null;
  /** Graph 'references' edges as {from,to,at} node/source ids. */
  referenceEdges: { fromSourceId: string | null; toSourceId: string | null; at: string | null }[] | null;
}

export function buildReferenceIndex(feeds: ReferenceFeeds): ReferenceIndex {
  const index: ReferenceIndex = new Map();
  const add = (target: string, referrer: string, at: string | null): void => {
    if (!target || target === referrer) return;
    const list = index.get(target) ?? [];
    if (list.some((r) => r.id === referrer)) return;
    list.push({ id: referrer, at });
    index.set(target, list);
  };
  for (const d of feeds.decisions ?? []) {
    for (const ev of d.evidence) add(ev, d.id, d.updatedAt);
  }
  for (const m of feeds.memories ?? []) {
    for (const ref of m.entityRefs) add(ref, m.id, m.updatedAt);
    if (m.evidence) add(m.evidence.id, m.id, m.updatedAt);
  }
  for (const e of feeds.referenceEdges ?? []) {
    if (e.fromSourceId && e.toSourceId) add(e.toSourceId, e.fromSourceId, e.at);
  }
  return index;
}
