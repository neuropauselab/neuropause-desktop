/**
 * Phase 6 Stage 11 — partners + the organization exchange, COMPOSED.
 *
 * Partners: the P9-S2 peer records × trust assessments × shared resources ×
 * artifacts × the DECLARED partner-exposure map. Exchange: every artifact
 * joined to the LOCAL records its kind could carry. STRUCTURAL HONESTY: the
 * platform records NO link between an artifact and a local record; name
 * equality is surfaced as `name-match` (a stated heuristic), everything else
 * as `no-structural-link`, and kinds with no local registry as
 * `not-applicable` — nothing is inferred. Pure; reads injected.
 */
import type {
  EfedArtifactView,
  EfedExchangeKindView,
  EfedExchangeReport,
  EfedGap,
  EfedPartnersReport,
  EfedPartnerView,
  EfedTrustReport,
  EfedUnavailable,
} from '@neuropause/shared';
import { EXCHANGE_KIND_MAP, EXPOSURE_BY_KIND } from './federationRegistry';

export const EXCHANGE_DISCLOSURE =
  'The exchange composes recorded artifacts and REAL local records of each mapped kind. The platform records no structural link between an artifact and the local record behind it: name equality is reported as a stated heuristic (name-match), never as verified linkage, and artifact kinds without a local registry are declared not-applicable.';

export interface PartnerRecords {
  home: { id: string; name: string; regionId: string } | null;
  peers:
    | {
        id: string;
        name: string;
        role: string;
        status: string;
        regionId: string;
        trustLevel: string;
        joinedAt: string;
        sharedOut: number;
        sharedIn: number;
      }[]
    | null;
  invitations: { direction: string; status: string }[] | null;
  shares: { kind: string; name: string; peerOrg: string; peerOrgName: string; direction: string; access: string }[] | null;
  summary:
    | { orgs: number; peers: number; activePeers: number; pendingInvites: number; trustedPeers: number; sharedOut: number; sharedIn: number }
    | null;
  artifacts: { publisherOrg: string }[] | null;
}

export interface PartnersInput {
  nowIso: string;
  records: PartnerRecords;
  trust: EfedTrustReport;
  failures: Record<string, string>;
}

export function buildPartnersReport(input: PartnersInput): EfedPartnersReport {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EfedGap[] = [];
  const r = input.records;

  const partners: EfedPartnerView[] = (r.peers ?? []).map((p) => {
    const shares = (r.shares ?? []).filter((s) => s.peerOrg === p.id);
    const kinds = [...new Set(shares.map((s) => s.kind))];
    const exposed = [...new Set(kinds.flatMap((k) => EXPOSURE_BY_KIND.get(k)?.serviceIds ?? []))];
    const trust = input.trust.partners.find((t) => t.peerOrg === p.id);
    if (!trust) gaps.push({ kind: 'evidence', subject: p.id, detail: 'no trust view computed for this peer' });
    return {
      peerOrg: p.id,
      peerOrgName: p.name,
      role: p.role,
      status: p.status,
      regionId: p.regionId,
      declaredTrust: p.trustLevel as EfedPartnerView['declaredTrust'],
      joinedAt: p.joinedAt,
      sharesOut: shares.filter((s) => s.direction === 'outbound').length,
      sharesIn: shares.filter((s) => s.direction === 'inbound').length,
      sharedResources: shares.map((s) => ({ kind: s.kind as EfedPartnerView['sharedResources'][number]['kind'], name: s.name, direction: s.direction, access: s.access })),
      artifactsPublished: (r.artifacts ?? []).filter((a) => a.publisherOrg === p.id).length,
      trustAssessment: trust?.assessment ?? 'unknown',
      exposedServiceIds: exposed,
    };
  });

  return {
    generatedAt: input.nowIso,
    home: r.home,
    partners,
    summary: r.summary,
    invitations: {
      pendingInbound: (r.invitations ?? []).filter((i) => i.direction === 'inbound' && i.status === 'pending').length,
      pendingOutbound: (r.invitations ?? []).filter((i) => i.direction === 'outbound' && i.status === 'pending').length,
    },
    gaps,
    unavailable,
  };
}

/* ── the exchange composition ─────────────────────────────────────────────── */

export interface LocalRecords {
  /** REAL Stage 8 playbooks. */
  playbooks: { id: string; name: string; version: number }[] | null;
  /** REAL Stage 7 assets (id + title + topics). */
  knowledgeAssets: { id: string; title: string; topics: string[] }[] | null;
  /** REAL federation governance policies (local, from globalGovStore). */
  governancePolicies: { id: string; name: string }[] | null;
  /** REAL configured connectors. */
  connectors: { id: string; name: string }[] | null;
  /** REAL AI workers. */
  workers: { id: string; name: string }[] | null;
}

export interface ExchangeInput {
  nowIso: string;
  artifacts:
    | {
        id: string;
        kind: string;
        name: string;
        publisherOrg: string;
        publisherOrgName: string;
        scope: string;
        verification: string;
        installs: number;
        signaturesEd25519: boolean;
      }[]
    | null;
  locals: LocalRecords;
  failures: Record<string, string>;
}

function candidatesFor(kind: string, locals: LocalRecords): { id: string; label: string; detail: string }[] | null {
  switch (kind) {
    case 'workflow_template':
      return locals.playbooks?.map((p) => ({ id: p.id, label: p.name, detail: `playbook v${p.version}` })) ?? null;
    case 'knowledge_package':
      return locals.knowledgeAssets?.map((a) => ({ id: a.id, label: a.title, detail: `topics: ${a.topics.join(', ') || '—'}` })) ?? null;
    case 'governance_policy':
      return locals.governancePolicies?.map((g) => ({ id: g.id, label: g.name, detail: 'federation governance policy' })) ?? null;
    case 'connector_pack':
      return locals.connectors?.map((c) => ({ id: c.id, label: c.name, detail: 'configured connector' })) ?? null;
    case 'ai_worker':
      return locals.workers?.map((w) => ({ id: w.id, label: w.name, detail: 'AI worker' })) ?? null;
    default:
      return []; // dashboard_template — no local registry exists (declared in the map)
  }
}

export function buildExchangeReport(input: ExchangeInput): EfedExchangeReport {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));

  const kinds: EfedExchangeKindView[] = EXCHANGE_KIND_MAP.map((def) => {
    const gaps: EfedGap[] = [];
    const rawCandidates = candidatesFor(def.kind, input.locals);
    const localCandidates = rawCandidates ?? [];
    if (rawCandidates === null) gaps.push({ kind: 'mapping', subject: def.kind, detail: 'the local record source was unreadable this pass' });
    if (def.localRecordKind === 'none') {
      gaps.push({ kind: 'mapping', subject: def.kind, detail: 'no local registry exists for this artifact kind (declared, not invented)' });
    }
    const artifacts: EfedArtifactView[] = (input.artifacts ?? [])
      .filter((a) => a.kind === def.kind)
      .map((a) => {
        const nameMatches = localCandidates.filter((c) => c.label.trim().toLowerCase() === a.name.trim().toLowerCase()).map((c) => c.id);
        const state: EfedArtifactView['link']['state'] =
          def.localRecordKind === 'none' ? 'not-applicable' : nameMatches.length > 0 ? 'name-match' : 'no-structural-link';
        return {
          artifactId: a.id,
          name: a.name,
          kind: a.kind as EfedArtifactView['kind'],
          publisherOrg: a.publisherOrg,
          publisherOrgName: a.publisherOrgName,
          scope: a.scope as EfedArtifactView['scope'],
          verification: a.verification as EfedArtifactView['verification'],
          installs: a.installs,
          signaturesValid: input.artifacts === null ? null : a.signaturesEd25519,
          link: {
            state,
            detail:
              state === 'not-applicable'
                ? 'no local registry for this kind — linkage not applicable'
                : state === 'name-match'
                  ? `name equality with ${nameMatches.length} local record(s) — a stated heuristic, NOT a recorded link`
                  : 'the platform records no artifact↔local-record link',
            nameMatches,
          },
        };
      });
    return { kind: def.kind, localRecordKind: def.localRecordKind, capabilityKeys: [...def.capabilityKeys], localCandidates, artifacts, gaps };
  });

  const all = kinds.flatMap((k) => k.artifacts);
  return {
    generatedAt: input.nowIso,
    kinds,
    totals: {
      artifacts: all.length,
      verified: all.filter((a) => a.verification === 'verified' || a.verification === 'official').length,
      signed: all.filter((a) => a.signaturesValid === true).length,
      nameMatched: all.filter((a) => a.link.state === 'name-match').length,
      withoutStructuralLink: all.filter((a) => a.link.state === 'no-structural-link').length,
      localCandidates: kinds.reduce((n, k) => n + k.localCandidates.length, 0),
    },
    disclosure: EXCHANGE_DISCLOSURE,
    unavailable,
  };
}
