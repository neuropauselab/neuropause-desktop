/**
 * Phase 6 Stage 11 — the Federation Registry (typed, versioned data; doc-locked
 * to docs/desktop/federation/FEDERATION-PLATFORM.md by test — the S6–S10
 * precedent).
 *
 * EVERY reference names something REAL in the repository:
 *   - share kinds       → the P9-S2 SharedResourceKind union (5),
 *   - exchange kinds    → the P9-S2 ExchangeKind union (6),
 *   - trust levels      → the P9-S2 TrustLevel union (4),
 *   - policy actions    → the four seeded globalGovStore policy actions,
 *   - service ids       → the Stage 9 service registry,
 *   - capabilities      → the twelve Stage 10 business capabilities,
 *   - topics            → the Stage 7 knowledge topic tokens already in use.
 * `federationRegistryIssues()` locks referential integrity; the doc lock keeps
 * code and documentation in sync. The registries store nothing and fabricate
 * nothing — they are data. In particular: `localRecordKind: 'none'` is an
 * HONEST declaration that no local registry exists for that artifact kind.
 */
import type {
  ExchangeKindMapDef,
  PartnerExposureDef,
  ShareKindCapabilityDef,
  SharingPolicyRef,
  TrustExpectationDef,
} from '@neuropause/shared';
import { BUSINESS_CAPABILITIES, EXCHANGE_KINDS, TRUST_SIGNAL_KINDS } from '@neuropause/shared';

/* ── the REAL vocabularies this registry may reference ────────────────────── */

export const REAL_SHARE_KINDS: readonly string[] = ['project', 'workspace', 'ai_worker', 'governance_policy', 'connector'] as const;
export const REAL_TRUST_LEVELS: readonly string[] = ['none', 'basic', 'verified', 'full'] as const;
/** The four actions seeded into the EXISTING federation governance store. */
export const REAL_POLICY_ACTIONS: readonly string[] = ['cross_org_run', 'share_data', 'publish_public', 'import_policy'] as const;
export const REAL_S9_SERVICE_IDS: readonly string[] = [
  'execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet',
  'ai-runtime', 'assistant-experience', 'notification-delivery',
] as const;

/* ── exchange-kind → local-record map (D-3; `none` stays honest) ──────────── */

export const EXCHANGE_KIND_MAP: readonly ExchangeKindMapDef[] = [
  { kind: 'ai_worker', localRecordKind: 'ai-worker', capabilityKeys: ['operations', 'engineering'], topics: [] },
  { kind: 'connector_pack', localRecordKind: 'connector', capabilityKeys: ['support', 'engineering'], topics: [] },
  { kind: 'governance_policy', localRecordKind: 'governance-policy', capabilityKeys: ['compliance', 'risk'], topics: ['policy'] },
  { kind: 'workflow_template', localRecordKind: 'playbook', capabilityKeys: ['operations', 'engineering'], topics: ['sop', 'operations'] },
  { kind: 'knowledge_package', localRecordKind: 'knowledge-asset', capabilityKeys: ['engineering', 'compliance'], topics: ['sop', 'policy', 'standard'] },
  // No local dashboard registry exists in the repository — declared, not invented.
  { kind: 'dashboard_template', localRecordKind: 'none', capabilityKeys: ['operations'], topics: [] },
] as const;

export const EXCHANGE_KIND_BY_KEY: ReadonlyMap<string, ExchangeKindMapDef> = new Map(EXCHANGE_KIND_MAP.map((d) => [d.kind, d]));

/* ── share-kind → capability map (the Stage 10 backbone, threaded through) ── */

export const SHARE_KIND_CAPABILITIES: readonly ShareKindCapabilityDef[] = [
  { kind: 'project', capabilityKeys: ['operations', 'engineering'] },
  { kind: 'workspace', capabilityKeys: ['operations'] },
  { kind: 'ai_worker', capabilityKeys: ['operations', 'engineering'] },
  { kind: 'governance_policy', capabilityKeys: ['compliance', 'risk'] },
  { kind: 'connector', capabilityKeys: ['support', 'engineering'] },
] as const;

/* ── trust expectations (D-4: what a DECLARED level is expected to rest on) ─ */

export const TRUST_EXPECTATIONS: readonly TrustExpectationDef[] = [
  { level: 'none', expectedSignals: [] },
  { level: 'basic', expectedSignals: ['accepted-invitation'] },
  { level: 'verified', expectedSignals: ['accepted-invitation', 'attested-relationship', 'signed-artifacts'] },
  {
    level: 'full',
    expectedSignals: ['accepted-invitation', 'attested-relationship', 'signed-artifacts', 'policy-coverage', 'reciprocal-sharing'],
  },
] as const;

export const TRUST_EXPECTATION_BY_LEVEL: ReadonlyMap<string, TrustExpectationDef> = new Map(
  TRUST_EXPECTATIONS.map((t) => [t.level, t]),
);

/* ── the four REAL sharing-policy references ──────────────────────────────── */

export const SHARING_POLICY_REFS: readonly SharingPolicyRef[] = [
  { action: 'cross_org_run', label: 'Federated worker execution requires delegated approval' },
  { action: 'share_data', label: 'Partner data exchange requires approval' },
  { action: 'publish_public', label: 'Public artifact publishing' },
  { action: 'import_policy', label: 'Policy import from trusted peers' },
] as const;

/* ── partner-facing exposure (D-6-adjacent: exposure is a DECLARED map) ───── */

export const PARTNER_EXPOSURE: readonly PartnerExposureDef[] = [
  { kind: 'connector', serviceIds: ['connector-fleet'] },
  { kind: 'ai_worker', serviceIds: ['workforce-jobs', 'execution-runtime'] },
  { kind: 'project', serviceIds: ['assistant-experience'] },
  { kind: 'workspace', serviceIds: ['notification-delivery'] },
  { kind: 'governance_policy', serviceIds: [] },
] as const;

export const EXPOSURE_BY_KIND: ReadonlyMap<string, PartnerExposureDef> = new Map(PARTNER_EXPOSURE.map((p) => [p.kind, p]));

/* ── integrity (mirrors the S6–S10 registry locks) ────────────────────────── */

export function federationRegistryIssues(): string[] {
  const issues: string[] = [];
  const caps = new Set<string>(BUSINESS_CAPABILITIES);

  const kindSeen = new Set<string>();
  for (const d of EXCHANGE_KIND_MAP) {
    if (!EXCHANGE_KINDS.includes(d.kind)) issues.push(`exchange map: unknown kind ${d.kind}`);
    if (kindSeen.has(d.kind)) issues.push(`exchange map: duplicate kind ${d.kind}`);
    kindSeen.add(d.kind);
    if (d.capabilityKeys.length === 0) issues.push(`exchange map ${d.kind}: no capability mapping`);
    for (const c of d.capabilityKeys) if (!caps.has(c)) issues.push(`exchange map ${d.kind}: unknown capability ${c}`);
  }
  for (const k of EXCHANGE_KINDS) if (!kindSeen.has(k)) issues.push(`exchange map: kind ${k} unmapped`);

  const shareSeen = new Set<string>();
  for (const s of SHARE_KIND_CAPABILITIES) {
    if (!REAL_SHARE_KINDS.includes(s.kind)) issues.push(`share map: unknown kind ${s.kind}`);
    if (shareSeen.has(s.kind)) issues.push(`share map: duplicate kind ${s.kind}`);
    shareSeen.add(s.kind);
    if (s.capabilityKeys.length === 0) issues.push(`share map ${s.kind}: no capability mapping`);
    for (const c of s.capabilityKeys) if (!caps.has(c)) issues.push(`share map ${s.kind}: unknown capability ${c}`);
  }
  for (const k of REAL_SHARE_KINDS) if (!shareSeen.has(k)) issues.push(`share map: kind ${k} unmapped`);

  const lvlSeen = new Set<string>();
  for (const t of TRUST_EXPECTATIONS) {
    if (!REAL_TRUST_LEVELS.includes(t.level)) issues.push(`trust expectations: unknown level ${t.level}`);
    if (lvlSeen.has(t.level)) issues.push(`trust expectations: duplicate level ${t.level}`);
    lvlSeen.add(t.level);
    for (const s of t.expectedSignals) {
      if (!TRUST_SIGNAL_KINDS.includes(s)) issues.push(`trust expectations ${t.level}: unknown signal ${s}`);
    }
  }
  for (const l of REAL_TRUST_LEVELS) if (!lvlSeen.has(l)) issues.push(`trust expectations: level ${l} missing`);
  // Expectations must be monotone: a higher level never expects FEWER signals.
  const order = ['none', 'basic', 'verified', 'full'];
  for (let i = 1; i < order.length; i += 1) {
    const lo = TRUST_EXPECTATION_BY_LEVEL.get(order[i - 1]);
    const hi = TRUST_EXPECTATION_BY_LEVEL.get(order[i]);
    if (lo && hi && hi.expectedSignals.length < lo.expectedSignals.length) {
      issues.push(`trust expectations: ${order[i]} expects fewer signals than ${order[i - 1]}`);
    }
  }

  const actSeen = new Set<string>();
  for (const p of SHARING_POLICY_REFS) {
    if (!REAL_POLICY_ACTIONS.includes(p.action)) issues.push(`policy refs: unknown action ${p.action}`);
    if (actSeen.has(p.action)) issues.push(`policy refs: duplicate action ${p.action}`);
    actSeen.add(p.action);
  }
  for (const a of REAL_POLICY_ACTIONS) if (!actSeen.has(a)) issues.push(`policy refs: action ${a} unmapped`);

  const expSeen = new Set<string>();
  for (const e of PARTNER_EXPOSURE) {
    if (!REAL_SHARE_KINDS.includes(e.kind)) issues.push(`exposure map: unknown kind ${e.kind}`);
    if (expSeen.has(e.kind)) issues.push(`exposure map: duplicate kind ${e.kind}`);
    expSeen.add(e.kind);
    for (const svc of e.serviceIds) if (!REAL_S9_SERVICE_IDS.includes(svc)) issues.push(`exposure map ${e.kind}: unknown service ${svc}`);
  }
  for (const k of REAL_SHARE_KINDS) if (!expSeen.has(k)) issues.push(`exposure map: kind ${k} unmapped`);

  return issues;
}
