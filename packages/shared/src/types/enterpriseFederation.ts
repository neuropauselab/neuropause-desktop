/**
 * Enterprise Federation Platform — shared types (Phase 6 Stage 11).
 *
 * Stage 11 is the enterprise-layer JOIN over the EXISTING federation substrate
 * (the P9-S2 runtime: peers/invitations/trust/shares + the signed exchange +
 * cross-org governance) and the Stage 7–10 platforms. Every view here is a
 * COMPOSITION of records those systems already hold:
 *
 *   - partners × trust × shares × artifacts × LOCAL records (S7 assets, S8
 *     playbooks, S9 services, S10 initiatives/capabilities),
 *   - trust EVIDENCE computed from recorded signals and shown BESIDE the
 *     declared trust level — computed never replaces declared; divergence is
 *     reported, never resolved,
 *   - executive federation dashboard + sectioned federation report.
 *
 * STRUCTURAL HONESTY (inherited from the audit): everything "cross-org" in
 * this repository is a record in a local, persisted store — there is no wire
 * protocol and no live inter-company connectivity, and these types model
 * RECORDS, not networking. The platform records no structural link between an
 * exchange artifact and the local record behind it; name equality is surfaced
 * as exactly that (a stated heuristic), never as a verified linkage.
 *
 * Types + small pure vocabularies only. No engine, store, scheduler, or
 * executor lives here — or anywhere else in Stage 11.
 */
import type { ExchangeKind, ExchangeScope, SharedResourceKind, TrustLevel, VerificationStatus } from './federation';
import type { BusinessCapabilityKey } from './strategyPlatform';
import type { InitiativeState, ObjectiveHealthState } from './strategyPlatform';
import type { OperationsRecommendation } from './operationsPlatform';

/* ── shared fragments ─────────────────────────────────────────────────────── */

export interface EfedUnavailable {
  system: string;
  reason: string;
}

export interface EfedGap {
  kind: 'mapping' | 'ownership' | 'evidence' | 'exposure' | 'linkage';
  subject: string;
  detail: string;
}

/* ── the trust-evidence vocabulary (D-4; every signal is a RECORDED fact) ─── */

export type TrustSignalKind =
  | 'accepted-invitation'
  | 'attested-relationship'
  | 'signed-artifacts'
  | 'reciprocal-sharing'
  | 'audit-history'
  | 'policy-coverage'
  | 'delegated-approval-configured';

export const TRUST_SIGNAL_KINDS: readonly TrustSignalKind[] = [
  'accepted-invitation',
  'attested-relationship',
  'signed-artifacts',
  'reciprocal-sharing',
  'audit-history',
  'policy-coverage',
  'delegated-approval-configured',
] as const;

/** Registry data: the signals a DECLARED trust level is expected to rest on. */
export interface TrustExpectationDef {
  level: TrustLevel;
  expectedSignals: TrustSignalKind[];
}

/** One recorded evidence signal for one partner: live / not live / unreadable. */
export interface TrustSignalReading {
  kind: TrustSignalKind;
  /** true = the recorded evidence exists · false = it does not · null = source unreadable. */
  live: boolean | null;
  detail: string;
}

export type TrustAssessment = 'consistent' | 'declared-above-evidence' | 'evidence-above-declared' | 'unknown';

export interface EfedPartnerTrust {
  peerOrg: string;
  peerOrgName: string;
  /** The DECLARED level from the existing TrustRelationship / FederatedOrg — authoritative. */
  declaredLevel: TrustLevel;
  declaredDetail: string;
  /** The recorded evidence, signal by signal. */
  signals: TrustSignalReading[];
  /** What the registry expects the declared level to rest on. */
  expectedForDeclared: TrustSignalKind[];
  /** Computed BESIDE declared — never replacing it. */
  assessment: TrustAssessment;
  divergenceDetail: string;
}

export interface EfedTrustReport {
  generatedAt: string;
  partners: EfedPartnerTrust[];
  totals: { consistent: number; declaredAboveEvidence: number; evidenceAboveDeclared: number; unknown: number };
  disclosure: string;
  unavailable: EfedUnavailable[];
}

/* ── registry maps (typed data referencing REAL vocabularies only) ────────── */

export type LocalRecordKind = 'playbook' | 'knowledge-asset' | 'governance-policy' | 'connector' | 'ai-worker' | 'none';

/** Which LOCAL record kind an exchange-artifact kind could carry, and which
 *  business capabilities it evidences. `none` is an honest declaration. */
export interface ExchangeKindMapDef {
  kind: ExchangeKind;
  localRecordKind: LocalRecordKind;
  capabilityKeys: BusinessCapabilityKey[];
  /** Stage 7 topic tokens for the knowledge join (empty when not applicable). */
  topics: string[];
}

export interface ShareKindCapabilityDef {
  kind: SharedResourceKind;
  capabilityKeys: BusinessCapabilityKey[];
}

/** The four REAL seeded federation-governance policy actions. */
export interface SharingPolicyRef {
  action: string;
  label: string;
}

/** Which Stage 9 services carry partner-facing exposure for a share kind. */
export interface PartnerExposureDef {
  kind: SharedResourceKind;
  serviceIds: string[];
}

/* ── computed: partners ───────────────────────────────────────────────────── */

export interface EfedPartnerView {
  peerOrg: string;
  peerOrgName: string;
  role: string;
  status: string;
  regionId: string;
  declaredTrust: TrustLevel;
  joinedAt: string;
  sharesOut: number;
  sharesIn: number;
  sharedResources: { kind: SharedResourceKind; name: string; direction: string; access: string }[];
  artifactsPublished: number;
  trustAssessment: TrustAssessment;
  /** Stage 9 service ids exposed to this partner via its share kinds (declared map). */
  exposedServiceIds: string[];
}

export interface EfedPartnersReport {
  generatedAt: string;
  home: { id: string; name: string; regionId: string } | null;
  partners: EfedPartnerView[];
  summary: { orgs: number; peers: number; activePeers: number; pendingInvites: number; trustedPeers: number; sharedOut: number; sharedIn: number } | null;
  invitations: { pendingInbound: number; pendingOutbound: number };
  gaps: EfedGap[];
  unavailable: EfedUnavailable[];
}

/* ── computed: the exchange (artifact × local records) ────────────────────── */

export type ArtifactLinkState = 'name-match' | 'no-structural-link' | 'not-applicable';

export interface EfedArtifactView {
  artifactId: string;
  name: string;
  kind: ExchangeKind;
  publisherOrg: string;
  publisherOrgName: string;
  scope: ExchangeScope;
  verification: VerificationStatus;
  installs: number;
  /** Every version's signature is the recorded ed25519 form, or null = unreadable. */
  signaturesValid: boolean | null;
  /** The honest local linkage: the platform records NO structural link. */
  link: { state: ArtifactLinkState; detail: string; nameMatches: string[] };
}

export interface EfedExchangeKindView {
  kind: ExchangeKind;
  localRecordKind: LocalRecordKind;
  capabilityKeys: BusinessCapabilityKey[];
  /** REAL local records of the mapped kind (shareable candidates). */
  localCandidates: { id: string; label: string; detail: string }[];
  artifacts: EfedArtifactView[];
  gaps: EfedGap[];
}

export interface EfedExchangeReport {
  generatedAt: string;
  kinds: EfedExchangeKindView[];
  totals: { artifacts: number; verified: number; signed: number; nameMatched: number; withoutStructuralLink: number; localCandidates: number };
  disclosure: string;
  unavailable: EfedUnavailable[];
}

/* ── computed: the four shared layers (S7 / S8 / S9 / S10 compositions) ───── */

export interface EfedSharedKnowledge {
  packagesPublished: number;
  knowledgeShares: { name: string; peerOrgName: string; direction: string; access: string }[];
  /** S7 assets whose topics match the registry's knowledge_package topics. */
  backingCandidates: { id: string; title: string; matchedTopic: string }[];
  gaps: EfedGap[];
  unavailable: EfedUnavailable[];
}

export interface EfedSharedAutomation {
  templatesPublished: number;
  /** The REAL Stage 8 playbooks as shareable template candidates. */
  playbookCandidates: { id: string; name: string; version: number; nameMatchedArtifact: string | null }[];
  /** Platform-wide monitor findings (no per-share attribution exists — disclosed). */
  monitorFindings: { total: number; criticalOrHigh: number } | null;
  gaps: EfedGap[];
  unavailable: EfedUnavailable[];
}

export interface EfedPartnerExposure {
  peerOrg: string;
  peerOrgName: string;
  shareKinds: SharedResourceKind[];
  services: { serviceId: string; state: string; slaStatus: string | null }[];
}

export interface EfedSharedOperations {
  /** Per-partner operational exposure via the DECLARED share-kind → service map. */
  partners: EfedPartnerExposure[];
  readiness: { ready: number; degraded: number; notReady: number; unknown: number } | null;
  capacityPressure: string | null;
  disclosure: string;
  gaps: EfedGap[];
  unavailable: EfedUnavailable[];
}

export interface EfedJointInitiative {
  initiativeId: string;
  label: string;
  state: InitiativeState;
  capabilityKeys: BusinessCapabilityKey[];
  /** Partner shares whose kinds map into the initiative's capabilities. */
  partnerShares: { peerOrgName: string; kind: SharedResourceKind; name: string; direction: string }[];
}

export interface EfedCapabilityFederation {
  key: BusinessCapabilityKey;
  label: string;
  condition: ObjectiveHealthState;
  shareKinds: SharedResourceKind[];
  exchangeKinds: ExchangeKind[];
  artifacts: number;
  sharesOut: number;
  sharesIn: number;
  initiatives: number;
}

export interface EfedSharedStrategy {
  jointInitiatives: EfedJointInitiative[];
  capabilities: EfedCapabilityFederation[];
  gaps: EfedGap[];
  unavailable: EfedUnavailable[];
}

export interface EfedSharingReport {
  generatedAt: string;
  knowledge: EfedSharedKnowledge;
  automation: EfedSharedAutomation;
  operations: EfedSharedOperations;
  strategy: EfedSharedStrategy;
  unavailable: EfedUnavailable[];
}

/* ── computed: dashboard + board report ───────────────────────────────────── */

export interface EfedDashboard {
  generatedAt: string;
  partners: { total: number; active: number; trusted: number; pendingInvites: number };
  trust: { consistent: number; declaredAboveEvidence: number; evidenceAboveDeclared: number; unknown: number };
  exchange: { artifacts: number; verified: number; signed: number; installs: number };
  sharing: { sharedOut: number; sharedIn: number; jointInitiatives: number; exposedServices: number };
  governance: { policies: number; activePolicies: number; pendingApprovals: number; auditEntries: number } | null;
  /** P18 composed as ONE input (sanitized network posture), or null. */
  network: { shareableIntelligence: number; publishedInsights: number; healthBand: string } | null;
  kpis: { key: string; label: string; display: string; band: string | null }[];
  recommendations: OperationsRecommendation[];
  disclosures: string[];
  unavailable: EfedUnavailable[];
}

export interface EfedBoardReport {
  generatedAt: string;
  title: string;
  sections: { title: string; lines: string[] }[];
}

/* ── assistant questions (D-8) ────────────────────────────────────────────── */

export type EfedQuestionKey =
  | 'federation-status'
  | 'partner-trust'
  | 'exchange-catalog'
  | 'shared-knowledge'
  | 'shared-automation'
  | 'partner-exposure'
  | 'joint-initiatives'
  | 'federation-governance'
  | 'federation-network'
  | 'federation-report';

export const EFED_QUESTION_KEYS: readonly EfedQuestionKey[] = [
  'federation-status',
  'partner-trust',
  'exchange-catalog',
  'shared-knowledge',
  'shared-automation',
  'partner-exposure',
  'joint-initiatives',
  'federation-governance',
  'federation-network',
  'federation-report',
] as const;
