/**
 * Phase 6 Stage 11 — evidence-based trust composition (D-4).
 *
 * Every signal is a RECORDED fact from the existing federation stores: an
 * accepted invitation, an attested TrustRelationship record, ed25519-signed
 * artifact versions from the peer, reciprocal sharing counts, federation audit
 * entries naming the peer, enabled sharing policies, a configured delegated
 * approval. The DECLARED trust level is authoritative and is never changed
 * here; the computed assessment sits BESIDE it: `consistent`,
 * `declared-above-evidence` (declared level expects signals that are not
 * recorded), `evidence-above-declared` (recorded signals satisfy a higher
 * level's expectations), or `unknown` (sources unreadable). Divergence is
 * reported, never resolved. Pure; reads injected.
 */
import type {
  EfedPartnerTrust,
  EfedTrustReport,
  EfedUnavailable,
  TrustAssessment,
  TrustSignalKind,
  TrustSignalReading,
} from '@neuropause/shared';
import { TRUST_EXPECTATION_BY_LEVEL, TRUST_EXPECTATIONS } from './federationRegistry';

export const TRUST_DISCLOSURE =
  'Trust evidence is composed only from records the federation stores already hold (invitations, trust relationships, signed artifact versions, share counts, audit entries, policies). The declared trust level remains authoritative; the computed assessment never replaces it — divergence is reported for review through the existing fed:* surfaces.';

export interface TrustSignals {
  peers:
    | {
        id: string;
        name: string;
        trustLevel: string;
        status: string;
        sharedOut: number;
        sharedIn: number;
      }[]
    | null;
  trusts:
    | { peerOrg: string; peerOrgName: string; trustLevel: string; delegatedApproval: boolean; canShareWorkers: boolean; canShareData: boolean }[]
    | null;
  invitations: { toOrg: string; fromOrg: string; status: string }[] | null;
  artifacts: { publisherOrg: string; signaturesEd25519: boolean }[] | null;
  audit: { peerOrg: string | null }[] | null;
  policies: { action: string; enabled: boolean }[] | null;
}

export interface TrustInput {
  nowIso: string;
  signals: TrustSignals;
  failures: Record<string, string>;
}

const LEVEL_ORDER = ['none', 'basic', 'verified', 'full'];

function readSignal(kind: TrustSignalKind, peerId: string, s: TrustSignals): TrustSignalReading {
  switch (kind) {
    case 'accepted-invitation': {
      if (s.invitations === null) return { kind, live: null, detail: 'invitation records unreadable' };
      const hit = s.invitations.some((i) => (i.toOrg === peerId || i.fromOrg === peerId) && i.status === 'accepted');
      return { kind, live: hit, detail: hit ? 'an accepted invitation is recorded' : 'no accepted invitation recorded' };
    }
    case 'attested-relationship': {
      if (s.trusts === null) return { kind, live: null, detail: 'trust relationships unreadable' };
      const hit = s.trusts.some((t) => t.peerOrg === peerId);
      return { kind, live: hit, detail: hit ? 'a TrustRelationship record exists' : 'no TrustRelationship record' };
    }
    case 'signed-artifacts': {
      if (s.artifacts === null) return { kind, live: null, detail: 'exchange artifacts unreadable' };
      const published = s.artifacts.filter((a) => a.publisherOrg === peerId);
      if (published.length === 0) return { kind, live: false, detail: 'the peer has published no artifacts' };
      const allSigned = published.every((a) => a.signaturesEd25519);
      return { kind, live: allSigned, detail: `${published.length} artifact(s) published, ${allSigned ? 'all versions ed25519-signed' : 'unsigned versions present'}` };
    }
    case 'reciprocal-sharing': {
      if (s.peers === null) return { kind, live: null, detail: 'peer records unreadable' };
      const p = s.peers.find((x) => x.id === peerId);
      if (!p) return { kind, live: false, detail: 'peer record missing' };
      const hit = p.sharedOut > 0 && p.sharedIn > 0;
      return { kind, live: hit, detail: `${p.sharedOut} shared out · ${p.sharedIn} shared in${hit ? ' (reciprocal)' : ''}` };
    }
    case 'audit-history': {
      if (s.audit === null) return { kind, live: null, detail: 'federation audit unreadable' };
      const hits = s.audit.filter((a) => a.peerOrg === peerId).length;
      return { kind, live: hits > 0, detail: `${hits} audit entr${hits === 1 ? 'y' : 'ies'} name this peer` };
    }
    case 'policy-coverage': {
      if (s.policies === null) return { kind, live: null, detail: 'federation policies unreadable' };
      const enabled = s.policies.filter((p) => p.enabled).length;
      return { kind, live: enabled > 0, detail: `${enabled} enabled sharing polic${enabled === 1 ? 'y' : 'ies'} govern cross-org actions` };
    }
    case 'delegated-approval-configured': {
      if (s.trusts === null) return { kind, live: null, detail: 'trust relationships unreadable' };
      const t = s.trusts.find((x) => x.peerOrg === peerId);
      if (!t) return { kind, live: false, detail: 'no TrustRelationship record' };
      return { kind, live: t.delegatedApproval, detail: t.delegatedApproval ? 'delegated approval configured' : 'no delegated approval' };
    }
  }
}

/** The highest level whose EVERY expected signal is recorded live (evidence-supported). */
export function evidenceSupportedLevel(signals: TrustSignalReading[]): string | null {
  const live = new Set(signals.filter((x) => x.live === true).map((x) => x.kind));
  const anyUnknown = signals.some((x) => x.live === null);
  let best: string | null = anyUnknown ? null : 'none';
  for (const exp of TRUST_EXPECTATIONS) {
    if (exp.expectedSignals.length === 0) continue;
    if (exp.expectedSignals.every((k) => live.has(k))) {
      if (best === null || LEVEL_ORDER.indexOf(exp.level) > LEVEL_ORDER.indexOf(best)) best = exp.level;
    }
  }
  return best;
}

export function assessTrust(declared: string, signals: TrustSignalReading[]): { assessment: TrustAssessment; detail: string } {
  const expected = TRUST_EXPECTATION_BY_LEVEL.get(declared)?.expectedSignals ?? [];
  const relevant = signals.filter((x) => expected.includes(x.kind));
  if (relevant.some((x) => x.live === null) || signals.every((x) => x.live === null)) {
    return { assessment: 'unknown', detail: 'one or more evidencing sources were unreadable — the assessment stays unknown, never guessed' };
  }
  const missing = expected.filter((k) => !signals.some((x) => x.kind === k && x.live === true));
  if (missing.length > 0) {
    return {
      assessment: 'declared-above-evidence',
      detail: `declared '${declared}' expects recorded signals that are absent: ${missing.join(', ')} — declared remains authoritative; review via the existing fed:* surfaces`,
    };
  }
  const supported = evidenceSupportedLevel(signals);
  if (supported !== null && LEVEL_ORDER.indexOf(supported) > LEVEL_ORDER.indexOf(declared)) {
    return {
      assessment: 'evidence-above-declared',
      detail: `recorded evidence satisfies the expectations of '${supported}' while the declared level is '${declared}' — declared remains authoritative`,
    };
  }
  return { assessment: 'consistent', detail: `every signal expected for '${declared}' is recorded` };
}

export function buildTrustReport(input: TrustInput): EfedTrustReport {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const peers = input.signals.peers ?? [];

  const partners: EfedPartnerTrust[] = peers.map((p) => {
    const declared = input.signals.trusts?.find((t) => t.peerOrg === p.id) ?? null;
    const declaredLevel = (declared?.trustLevel ?? p.trustLevel) as EfedPartnerTrust['declaredLevel'];
    const signals = (
      [
        'accepted-invitation',
        'attested-relationship',
        'signed-artifacts',
        'reciprocal-sharing',
        'audit-history',
        'policy-coverage',
        'delegated-approval-configured',
      ] as TrustSignalKind[]
    ).map((k) => readSignal(k, p.id, input.signals));
    const a = assessTrust(declaredLevel, signals);
    return {
      peerOrg: p.id,
      peerOrgName: p.name,
      declaredLevel,
      declaredDetail: declared
        ? `TrustRelationship: ${declared.trustLevel}${declared.delegatedApproval ? ' · delegated approval' : ''}${declared.canShareWorkers ? ' · workers shareable' : ''}${declared.canShareData ? ' · data shareable' : ''}`
        : `no TrustRelationship record — declared level read from the peer record (${p.trustLevel})`,
      signals,
      expectedForDeclared: [...(TRUST_EXPECTATION_BY_LEVEL.get(declaredLevel)?.expectedSignals ?? [])],
      assessment: a.assessment,
      divergenceDetail: a.detail,
    };
  });

  return {
    generatedAt: input.nowIso,
    partners,
    totals: {
      consistent: partners.filter((x) => x.assessment === 'consistent').length,
      declaredAboveEvidence: partners.filter((x) => x.assessment === 'declared-above-evidence').length,
      evidenceAboveDeclared: partners.filter((x) => x.assessment === 'evidence-above-declared').length,
      unknown: partners.filter((x) => x.assessment === 'unknown').length,
    },
    disclosure: TRUST_DISCLOSURE,
    unavailable,
  };
}
