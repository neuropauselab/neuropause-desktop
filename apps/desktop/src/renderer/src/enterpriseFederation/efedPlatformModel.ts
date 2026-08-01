/**
 * Phase 6 Stage 11 — the Enterprise tab's pure view-model (no DOM, no React,
 * no I/O; tested). Projects the read-only `efed:*` surfaces — partners, trust
 * evidence, the organization exchange, the shared layers, and the dashboard —
 * into presentation rows. Everything renders what the main-process composition
 * computed; declared-vs-computed trust, heuristic name-matches, gaps, and
 * unavailable reasons always ride along — nothing is invented here either.
 */
import type {
  EfedDashboard,
  EfedExchangeReport,
  EfedPartnersReport,
  EfedSharingReport,
  EfedTrustReport,
  TrustAssessment,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7–10 pattern — accepted by StatusBadge/Pill). */
export type EfedTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── tone maps (total; tested) ────────────────────────────────────────────── */

export function assessmentTone(a: TrustAssessment): EfedTone {
  switch (a) {
    case 'consistent':
      return 'green';
    case 'evidence-above-declared':
      return 'blue';
    case 'declared-above-evidence':
      return 'orange';
    case 'unknown':
      return 'gray';
  }
}

export function trustLevelTone(level: string): EfedTone {
  switch (level) {
    case 'full':
      return 'green';
    case 'verified':
      return 'blue';
    case 'basic':
      return 'orange';
    default:
      return 'gray';
  }
}

export function linkTone(state: 'name-match' | 'no-structural-link' | 'not-applicable'): EfedTone {
  switch (state) {
    case 'name-match':
      return 'blue';
    case 'no-structural-link':
      return 'orange';
    case 'not-applicable':
      return 'gray';
  }
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface EfedStat {
  label: string;
  value: string;
  hint: string;
  tone: EfedTone;
  icon: IconName;
}

export function efedHeaderStats(d: EfedDashboard): EfedStat[] {
  return [
    {
      label: 'Partners',
      value: `${d.partners.active}/${d.partners.total}`,
      hint: `${d.partners.trusted} trusted · ${d.partners.pendingInvites} invitation(s) pending (records, not live connectivity)`,
      tone: d.partners.total === 0 ? 'gray' : d.partners.pendingInvites > 0 ? 'orange' : 'green',
      icon: 'globe',
    },
    {
      label: 'Trust',
      value: `${d.trust.consistent} consistent`,
      hint: `${d.trust.declaredAboveEvidence} declared-above-evidence · ${d.trust.evidenceAboveDeclared} evidence-above-declared · ${d.trust.unknown} unknown`,
      tone: d.trust.declaredAboveEvidence > 0 ? 'orange' : d.trust.unknown > 0 ? 'gray' : 'green',
      icon: 'shield',
    },
    {
      label: 'Exchange',
      value: `${d.exchange.signed}/${d.exchange.artifacts} signed`,
      hint: `${d.exchange.verified} verified · ${d.exchange.installs} install(s)`,
      tone: d.exchange.artifacts === 0 ? 'gray' : d.exchange.signed < d.exchange.artifacts ? 'orange' : 'green',
      icon: 'lock',
    },
    {
      label: 'Sharing',
      value: `${d.sharing.sharedOut} out / ${d.sharing.sharedIn} in`,
      hint: `${d.sharing.jointInitiatives} joint initiative(s) · ${d.sharing.exposedServices} exposed service(s)`,
      tone: d.sharing.sharedOut + d.sharing.sharedIn > 0 ? 'green' : 'gray',
      icon: 'grid',
    },
    {
      label: 'Governance',
      value: d.governance ? `${d.governance.activePolicies}/${d.governance.policies}` : 'n/a',
      hint: d.governance
        ? `${d.governance.pendingApprovals} delegated approval(s) pending · ${d.governance.auditEntries} audit entr(ies)`
        : 'federation governance unreadable this pass',
      tone: !d.governance ? 'gray' : d.governance.pendingApprovals > 0 ? 'orange' : 'green',
      icon: 'clipboard',
    },
    {
      label: 'Network',
      value: d.network ? d.network.healthBand : 'n/a',
      hint: d.network
        ? `${d.network.shareableIntelligence} shareable item(s) · ${d.network.publishedInsights} published insight(s) (P18, sanitized)`
        : 'P18 network unreadable this pass',
      tone: !d.network ? 'gray' : d.network.healthBand === 'healthy' ? 'green' : 'orange',
      icon: 'pulse',
    },
  ];
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export interface PartnerRow {
  peerOrg: string;
  name: string;
  statusText: string;
  declaredTrust: string;
  trustTone: EfedTone;
  assessment: TrustAssessment;
  assessmentTone: EfedTone;
  sharesText: string;
  exposureText: string | null;
}

export function partnerRows(r: EfedPartnersReport): PartnerRow[] {
  return r.partners.map((p) => ({
    peerOrg: p.peerOrg,
    name: p.peerOrgName,
    statusText: `${p.role} · ${p.status} · ${p.regionId}`,
    declaredTrust: p.declaredTrust,
    trustTone: trustLevelTone(p.declaredTrust),
    assessment: p.trustAssessment,
    assessmentTone: assessmentTone(p.trustAssessment),
    sharesText: `${p.sharesOut} out / ${p.sharesIn} in · ${p.artifactsPublished} artifact(s) published`,
    exposureText: p.exposedServiceIds.length > 0 ? p.exposedServiceIds.join(', ') : null,
  }));
}

export interface TrustRow {
  peerOrg: string;
  name: string;
  declared: string;
  declaredTone: EfedTone;
  assessment: TrustAssessment;
  tone: EfedTone;
  divergence: string;
  liveSignalsText: string;
  missingSignalsText: string | null;
}

export function trustRows(r: EfedTrustReport): TrustRow[] {
  return r.partners.map((p) => {
    const live = p.signals.filter((s) => s.live === true).map((s) => s.kind);
    const missing = p.expectedForDeclared.filter((k) => !live.includes(k));
    return {
      peerOrg: p.peerOrg,
      name: p.peerOrgName,
      declared: p.declaredLevel,
      declaredTone: trustLevelTone(p.declaredLevel),
      assessment: p.assessment,
      tone: assessmentTone(p.assessment),
      divergence: p.divergenceDetail,
      liveSignalsText: live.length > 0 ? live.join(', ') : 'no live signals recorded',
      missingSignalsText: missing.length > 0 ? `expected but absent: ${missing.join(', ')}` : null,
    };
  });
}

export interface ExchangeRow {
  artifactId: string;
  name: string;
  kind: string;
  publisher: string;
  verificationText: string;
  signedTone: EfedTone;
  linkState: 'name-match' | 'no-structural-link' | 'not-applicable';
  linkTone: EfedTone;
  linkDetail: string;
}

export function exchangeRows(r: EfedExchangeReport): ExchangeRow[] {
  return r.kinds.flatMap((k) =>
    k.artifacts.map((a) => ({
      artifactId: a.artifactId,
      name: a.name,
      kind: a.kind,
      publisher: a.publisherOrgName,
      verificationText: `${a.verification} · ${a.scope} · ${a.installs} install(s)`,
      signedTone: (a.signaturesValid === true ? 'green' : a.signaturesValid === false ? 'red' : 'gray') as EfedTone,
      linkState: a.link.state,
      linkTone: linkTone(a.link.state),
      linkDetail: a.link.detail,
    })),
  );
}

export interface SharingRow {
  layer: 'knowledge' | 'automation' | 'operations' | 'strategy';
  headline: string;
  detail: string;
  gapText: string | null;
}

export function sharingRows(s: EfedSharingReport): SharingRow[] {
  return [
    {
      layer: 'knowledge',
      headline: `${s.knowledge.packagesPublished} package(s) · ${s.knowledge.knowledgeShares.length} share(s)`,
      detail: `${s.knowledge.backingCandidates.length} local asset(s) topic-matched as backing candidates`,
      gapText: s.knowledge.gaps.length > 0 ? s.knowledge.gaps.map((g) => g.detail).join('; ') : null,
    },
    {
      layer: 'automation',
      headline: `${s.automation.templatesPublished} template(s) · ${s.automation.playbookCandidates.length} shareable playbook(s)`,
      detail: s.automation.monitorFindings
        ? `monitor: ${s.automation.monitorFindings.criticalOrHigh} critical/high of ${s.automation.monitorFindings.total} (platform-wide; no per-share attribution)`
        : 'automation monitor unreadable',
      gapText: s.automation.gaps.length > 0 ? s.automation.gaps.map((g) => g.detail).join('; ') : null,
    },
    {
      layer: 'operations',
      headline: `${s.operations.partners.length} partner(s) with declared service exposure`,
      detail: `capacity ${s.operations.capacityPressure ?? 'unknown'}${s.operations.readiness ? ` · readiness ${s.operations.readiness.ready} ready / ${s.operations.readiness.notReady} not-ready` : ''}`,
      gapText: s.operations.gaps.length > 0 ? s.operations.gaps.map((g) => g.detail).join('; ') : null,
    },
    {
      layer: 'strategy',
      headline: `${s.strategy.jointInitiatives.length} joint initiative(s)`,
      detail: `${s.strategy.capabilities.filter((c) => c.sharesIn + c.sharesOut + c.artifacts > 0).length} capabilit(ies) touched by recorded shares/artifacts`,
      gapText: s.strategy.gaps.length > 0 ? s.strategy.gaps.map((g) => g.detail).join('; ') : null,
    },
  ];
}

export interface EfedRecommendationRow {
  id: string;
  title: string;
  priority: string;
  tone: EfedTone;
  detail: string;
  suggestedAction: string;
  principleC: string;
}

export function efedRecommendationRows(d: EfedDashboard): EfedRecommendationRow[] {
  return d.recommendations.map((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    tone: r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'orange' : r.priority === 'medium' ? 'blue' : 'gray',
    detail: r.detail,
    suggestedAction: r.suggestedAction,
    principleC: `Impact: ${r.operationalImpact} Outcome: ${r.expectedBusinessOutcome} Rollback: ${r.rollbackImplications} (confidence ${(r.confidence * 100).toFixed(0)}%, ${r.evidence.length} evidence ref(s))`,
  }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

export function unavailableLines(parts: { unavailable: { system: string; reason: string }[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
