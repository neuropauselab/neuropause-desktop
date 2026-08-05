/**
 * Phase 6 Stage 11 — the executive federation dashboard + the federation board
 * report. Both are COMPOSITIONS of the already-computed views (partners, trust,
 * exchange, sharing) plus the composed governance/network/P10 slices. Every
 * recommendation is the Stage 9 Principle-C type built through the SAME
 * throwing guard, and every suggested action points at an EXISTING governed
 * fed:* surface — nothing executes from here. Pure.
 */
import type {
  EfedBoardReport,
  EfedDashboard,
  EfedExchangeReport,
  EfedPartnersReport,
  EfedSharingReport,
  EfedTrustReport,
  EfedUnavailable,
  OperationsRecommendation,
} from '@neuropause/shared';
import { mkRecommendation } from '../operationsPlatform/operationsModel';
import { EXCHANGE_DISCLOSURE } from './partnerExchange';
import { EXPOSURE_DISCLOSURE } from './sharedOperations';
import { TRUST_DISCLOSURE } from './trustModel';

export const RECORDS_DISCLOSURE =
  'Everything cross-organization in this platform is a record in the local federation stores — there is no live inter-company connectivity, and these views compose records, never networking.';

export const EFED_DISCLOSURES: readonly string[] = [RECORDS_DISCLOSURE, TRUST_DISCLOSURE, EXCHANGE_DISCLOSURE, EXPOSURE_DISCLOSURE] as const;

export interface EfedDashboardInputs {
  nowIso: string;
  partners: EfedPartnersReport;
  trust: EfedTrustReport;
  exchange: EfedExchangeReport;
  sharing: EfedSharingReport;
  governance: { policies: number; activePolicies: number; pendingApprovals: number; auditEntries: number } | null;
  network: { shareableIntelligence: number; publishedInsights: number; healthBand: string } | null;
  kpis: { key: string; label: string; display: string; band: string | null }[];
}

export function composeFederationRecommendations(inp: EfedDashboardInputs): OperationsRecommendation[] {
  const recs: OperationsRecommendation[] = [];

  for (const p of inp.trust.partners.filter((x) => x.assessment === 'declared-above-evidence')) {
    recs.push(
      mkRecommendation({
        id: `efedrec:trust:${p.peerOrg}`,
        title: `Trust declared above recorded evidence: ${p.peerOrgName}`,
        detail: p.divergenceDetail,
        priority: 'high',
        suggestedAction: 'Review the relationship on the existing Federation trust surface (fed:runtime.trust / fed:runtime.setTrust) — declared trust remains authoritative.',
        evidence: [p.peerOrg, ...p.signals.filter((s) => s.live === false).map((s) => s.kind)],
        reasoning: 'The registry expectations for the declared level are not all backed by recorded signals.',
        confidence: 0.8,
        affectedSystems: ['federation'],
        operationalImpact: `Sharing with ${p.peerOrgName} rests on a declared level whose expected evidence is not recorded.`,
        expectedBusinessOutcome: 'Either the evidence is recorded (invitation, attestation, signatures) or the declared level is revisited — divergence closes.',
        rollbackImplications: 'Recommendation only; any trust change runs through the existing governed fed:* mutation and is reversible there.',
      }),
    );
  }

  const unsigned = inp.exchange.totals.artifacts - inp.exchange.totals.signed;
  if (inp.exchange.totals.artifacts > 0 && unsigned > 0) {
    recs.push(
      mkRecommendation({
        id: 'efedrec:exchange:unsigned',
        title: `${unsigned} exchange artifact(s) without fully signed versions`,
        detail: `${inp.exchange.totals.signed}/${inp.exchange.totals.artifacts} artifacts carry ed25519 signatures on every version.`,
        priority: 'high',
        suggestedAction: 'Verify or re-publish the affected artifacts through the existing exchange surfaces (fed:exchange.verifyVersion / fed:exchange.publishVersion).',
        evidence: ['exchange-artifacts'],
        reasoning: 'Signature completeness is read from the recorded artifact versions.',
        confidence: 0.85,
        affectedSystems: ['federation'],
        operationalImpact: 'Unsigned artifact versions weaken the provenance the exchange is built on.',
        expectedBusinessOutcome: 'Every distributed artifact version carries verifiable provenance.',
        rollbackImplications: 'Recommendation only; publishing and verification stay on the existing governed exchange spine.',
      }),
    );
  }

  if (inp.governance && inp.governance.pendingApprovals > 0) {
    recs.push(
      mkRecommendation({
        id: 'efedrec:governance:pending-approvals',
        title: `${inp.governance.pendingApprovals} delegated approval(s) awaiting resolution`,
        detail: 'Cross-org actions are parked on the existing federation governance queue.',
        priority: 'high',
        suggestedAction: 'Decide the parked items on the existing surface (fed:gov.approvals / fed:gov.resolveApproval).',
        evidence: ['federation-governance'],
        reasoning: 'The pending count is read from the existing globalGovStore approvals.',
        confidence: 0.9,
        affectedSystems: ['federation', 'governance'],
        operationalImpact: 'Partner-initiated actions wait on unresolved approvals.',
        expectedBusinessOutcome: 'The federation queue drains through the existing approval flow.',
        rollbackImplications: 'Approval decisions reverse through the same existing governed surface.',
      }),
    );
  }

  for (const p of inp.sharing.operations.partners) {
    const sick = p.services.filter((s) => s.state === 'failed' || s.state === 'degraded');
    if (sick.length === 0) continue;
    recs.push(
      mkRecommendation({
        id: `efedrec:exposure:${p.peerOrg}`,
        title: `Partner-facing services unhealthy for ${p.peerOrgName}`,
        detail: sick.map((s) => `${s.serviceId}: ${s.state}`).join('; '),
        priority: 'high',
        suggestedAction: 'Recover the services on the existing Operations surfaces; the exposure map only reports the declared join.',
        evidence: [p.peerOrg, ...sick.map((s) => s.serviceId)],
        reasoning: 'Live Stage 9 service states joined through the DECLARED share-kind → service exposure map.',
        confidence: 0.8,
        affectedSystems: ['operations', 'federation'],
        operationalImpact: `Shares with ${p.peerOrgName} depend on services currently ${sick.map((s) => s.state).join('/')}.`,
        expectedBusinessOutcome: 'Partner-facing services return to operational.',
        rollbackImplications: 'Recommendation only; recovery runs through the existing governed operations spine.',
      }),
    );
  }

  if (inp.partners.invitations.pendingInbound + inp.partners.invitations.pendingOutbound > 0) {
    recs.push(
      mkRecommendation({
        id: 'efedrec:partners:pending-invitations',
        title: `${inp.partners.invitations.pendingInbound + inp.partners.invitations.pendingOutbound} federation invitation(s) pending`,
        detail: `${inp.partners.invitations.pendingInbound} inbound · ${inp.partners.invitations.pendingOutbound} outbound.`,
        priority: 'medium',
        suggestedAction: 'Respond on the existing surface (fed:runtime.invitations / fed:runtime.respondInvite).',
        evidence: ['federation-invitations'],
        reasoning: 'Pending counts are read from the recorded invitations.',
        confidence: 0.85,
        affectedSystems: ['federation'],
        operationalImpact: 'Prospective partners wait on unanswered invitations.',
        expectedBusinessOutcome: 'The invitation queue clears through the existing governed flow.',
        rollbackImplications: 'Invitation responses are governed by the existing fed:* surface.',
      }),
    );
  }

  return recs;
}

export function composeFederationDashboard(inp: EfedDashboardInputs): EfedDashboard {
  const recommendations = composeFederationRecommendations(inp);
  const unavailable: EfedUnavailable[] = [
    ...inp.partners.unavailable,
    ...inp.trust.unavailable,
    ...inp.exchange.unavailable,
    ...inp.sharing.unavailable,
  ].filter((u, i, arr) => arr.findIndex((x) => x.system === u.system) === i);

  return {
    generatedAt: inp.nowIso,
    partners: {
      total: inp.partners.partners.length,
      active: inp.partners.partners.filter((p) => p.status === 'active').length,
      trusted: inp.partners.summary?.trustedPeers ?? inp.partners.partners.filter((p) => p.declaredTrust !== 'none').length,
      pendingInvites: inp.partners.invitations.pendingInbound + inp.partners.invitations.pendingOutbound,
    },
    trust: { ...inp.trust.totals },
    exchange: {
      artifacts: inp.exchange.totals.artifacts,
      verified: inp.exchange.totals.verified,
      signed: inp.exchange.totals.signed,
      installs: 0 + inp.exchange.kinds.reduce((n, k) => n + k.artifacts.reduce((m, a) => m + a.installs, 0), 0),
    },
    sharing: {
      sharedOut: inp.partners.summary?.sharedOut ?? inp.partners.partners.reduce((n, p) => n + p.sharesOut, 0),
      sharedIn: inp.partners.summary?.sharedIn ?? inp.partners.partners.reduce((n, p) => n + p.sharesIn, 0),
      jointInitiatives: inp.sharing.strategy.jointInitiatives.length,
      exposedServices: [...new Set(inp.sharing.operations.partners.flatMap((p) => p.services.map((s) => s.serviceId)))].length,
    },
    governance: inp.governance,
    network: inp.network,
    kpis: inp.kpis,
    recommendations,
    disclosures: [...EFED_DISCLOSURES],
    unavailable,
  };
}

export function composeFederationBoardReport(inp: EfedDashboardInputs): EfedBoardReport {
  const d = composeFederationDashboard(inp);
  return {
    generatedAt: inp.nowIso,
    title: 'Enterprise federation — board brief',
    sections: [
      {
        title: 'Partners',
        lines: [
          `${d.partners.total} partner org(s): ${d.partners.active} active · ${d.partners.trusted} trusted · ${d.partners.pendingInvites} invitation(s) pending.`,
          ...inp.partners.partners.map(
            (p) => `${p.peerOrgName}: declared trust ${p.declaredTrust} (${p.trustAssessment}) · ${p.sharesOut} out / ${p.sharesIn} in · ${p.artifactsPublished} artifact(s) published.`,
          ),
        ],
      },
      {
        title: 'Trust (declared beside computed — declared is authoritative)',
        lines:
          inp.trust.partners.length === 0
            ? ['No partner relationships recorded.']
            : inp.trust.partners.map((p) => `${p.peerOrgName}: declared ${p.declaredLevel} — ${p.assessment}: ${p.divergenceDetail}`),
      },
      {
        title: 'Organization exchange',
        lines: [
          `${d.exchange.artifacts} artifact(s): ${d.exchange.verified} verified · ${d.exchange.signed} fully signed · ${inp.exchange.totals.nameMatched} name-matched to local records (heuristic) · ${inp.exchange.totals.withoutStructuralLink} without structural link.`,
          inp.exchange.disclosure,
        ],
      },
      {
        title: 'Shared enterprise layers',
        lines: [
          `Knowledge: ${inp.sharing.knowledge.packagesPublished} package(s) · ${inp.sharing.knowledge.backingCandidates.length} topic-matched local asset(s).`,
          `Automation: ${inp.sharing.automation.templatesPublished} template(s) · ${inp.sharing.automation.playbookCandidates.length} shareable playbook(s).`,
          `Operations: ${inp.sharing.operations.partners.length} partner(s) with declared service exposure · capacity ${inp.sharing.operations.capacityPressure ?? 'unknown'}.`,
          `Strategy: ${d.sharing.jointInitiatives} joint initiative(s) by recorded share↔capability intersection.`,
        ],
      },
      {
        title: 'Federation governance',
        lines: d.governance
          ? [
              `${d.governance.activePolicies}/${d.governance.policies} policies enabled · ${d.governance.pendingApprovals} delegated approval(s) pending · ${d.governance.auditEntries} audit entr(ies).`,
            ]
          : ['Federation governance was unreadable this pass — declared, not defaulted.'],
      },
      {
        title: 'Executive focus (recommendations only — nothing executes from here)',
        lines:
          d.recommendations.length === 0
            ? ['No focus items by the composed records.']
            : d.recommendations.map((r) => `${r.priority.toUpperCase()} · ${r.title} → ${r.suggestedAction}`),
      },
    ],
  };
}
