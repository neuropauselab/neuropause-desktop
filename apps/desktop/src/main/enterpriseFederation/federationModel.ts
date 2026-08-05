/**
 * Phase 6 Stage 11 — the federation model: the ten assistant question
 * resolvers (SEVEN-WAY disjoint from the Stage 5/6/7/8/9/10 matchers, both
 * directions test-locked — including the two narrow Stage 10 exclusions this
 * stage adds: bare-`initiatives` questions qualified `joint/federated/partner/
 * shared`, and `board brief` questions qualified `federation`, both route
 * here) and the ten read-only answers riding the existing 'intelligence'
 * structured-report kind. Answers cite the computed views verbatim;
 * recommending never executes. Pure.
 */
import type {
  AssistantStructuredReport,
  EfedBoardReport,
  EfedDashboard,
  EfedExchangeReport,
  EfedPartnersReport,
  EfedQuestionKey,
  EfedSharingReport,
  EfedTrustReport,
} from '@neuropause/shared';

/* ── the ten resolvers ────────────────────────────────────────────────────── */

export function resolveFederationQuestion(text: string): EfedQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\bfederation (report|brief|board)\b/.test(t) || /\bboard (brief|report|pack)\b.*\bfederation\b/.test(t) || /\bfederation\b.*\bboard (brief|report|pack)\b/.test(t))
    return 'federation-report';
  if (/\b(joint|federated|partner|shared) initiatives?\b/.test(t)) return 'joint-initiatives';
  if (/\b(partner|federation|organization) trust\b/.test(t) || /\btrust (levels?|evidence|posture|divergence)\b/.test(t) || /\bwhich partners? (do|can) we trust\b/.test(t))
    return 'partner-trust';
  if (/\bshared knowledge\b/.test(t) || /\bknowledge packages?\b/.test(t) || /\bknowledge sharing\b/.test(t) || /\bknowledge (do|can) we share\b/.test(t))
    return 'shared-knowledge';
  if (/\bshared automations?\b/.test(t) || /\b(workflow|playbook) templates?\b/.test(t) || /\bwhich playbooks? (can|could) (we )?share\b/.test(t))
    return 'shared-automation';
  if (/\bpartner[- ]facing\b/.test(t) || /\b(partner|federation) exposure\b/.test(t) || /\bexpos(e|ing|ed) to (our )?partners?\b/.test(t))
    return 'partner-exposure';
  if (/\bfederation governance\b/.test(t) || /\bcross.?org (policies|governance|approvals?)\b/.test(t) || /\bdelegated approvals?\b/.test(t))
    return 'federation-governance';
  if (/\b(intelligence )?network (posture|status|health)\b/.test(t) || /\bfederation network\b/.test(t)) return 'federation-network';
  if (/\b(organization |federation )?exchange (catalog|artifacts?|summary|status)\b/.test(t) || /\bwhat('s| is) (in |on )?the exchange\b/.test(t))
    return 'exchange-catalog';
  if (/\bfederation (status|overview|state)\b/.test(t) || /\bhow (is|are) (our |the )?federation\b/.test(t) || /\b(our|the) (federation )?partners?\b.*\b(status|overview)\b/.test(t))
    return 'federation-status';
  return null;
}

/* ── the answer context + answers ─────────────────────────────────────────── */

export interface FederationQuestionContext {
  partners: EfedPartnersReport;
  trust: EfedTrustReport;
  exchange: EfedExchangeReport;
  sharing: EfedSharingReport;
  dashboard: EfedDashboard;
  board: EfedBoardReport;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

export function answerFederationQuestion(key: EfedQuestionKey, ctx: FederationQuestionContext): AssistantStructuredReport {
  switch (key) {
    case 'federation-status': {
      const d = ctx.dashboard;
      return report('Enterprise federation status (records, not live connectivity)', [
        {
          title: 'Answer',
          lines: [
            `Partners: ${d.partners.total} recorded (${d.partners.active} active · ${d.partners.trusted} trusted · ${d.partners.pendingInvites} invitation(s) pending).`,
            `Trust: ${d.trust.consistent} consistent · ${d.trust.declaredAboveEvidence} declared-above-evidence · ${d.trust.evidenceAboveDeclared} evidence-above-declared · ${d.trust.unknown} unknown.`,
            `Exchange: ${d.exchange.artifacts} artifact(s), ${d.exchange.verified} verified, ${d.exchange.signed} fully signed, ${d.exchange.installs} install(s).`,
            `Sharing: ${d.sharing.sharedOut} out · ${d.sharing.sharedIn} in · ${d.sharing.jointInitiatives} joint initiative(s) · ${d.sharing.exposedServices} exposed service(s).`,
          ],
        },
        { title: 'Uncertainty', lines: [...d.unavailable.map((u) => `${u.system}: ${u.reason}`), d.disclosures[0]] },
      ]);
    }
    case 'partner-trust': {
      return report('Partner trust — declared beside computed evidence (declared is authoritative)', [
        {
          title: 'Answer',
          lines:
            ctx.trust.partners.length === 0
              ? ['No partner relationships are recorded.']
              : ctx.trust.partners.map((p) => `${p.peerOrgName}: declared ${p.declaredLevel} — ${p.assessment.toUpperCase()} — ${p.divergenceDetail}`),
        },
        {
          title: 'Evidence',
          lines: ctx.trust.partners.flatMap((p) => p.signals.filter((s) => s.live === true).slice(0, 3).map((s) => `${p.peerOrg} ← ${s.kind}: ${s.detail}`)).slice(0, 9),
        },
        { title: 'Uncertainty', lines: [ctx.trust.disclosure] },
      ]);
    }
    case 'exchange-catalog': {
      const e = ctx.exchange;
      return report('Organization exchange catalog', [
        {
          title: 'Answer',
          lines: e.kinds.map(
            (k) =>
              `${k.kind}: ${k.artifacts.length} artifact(s) · ${k.localCandidates.length} local ${k.localRecordKind === 'none' ? '(no local registry — declared)' : `${k.localRecordKind} candidate(s)`}`,
          ),
        },
        {
          title: 'Evidence',
          lines: e.kinds.flatMap((k) => k.artifacts.slice(0, 2).map((a) => `${a.name} [${a.kind}] by ${a.publisherOrgName} — ${a.verification}, ${a.link.state}`)).slice(0, 8),
        },
        { title: 'Uncertainty', lines: [e.disclosure] },
      ]);
    }
    case 'shared-knowledge': {
      const k = ctx.sharing.knowledge;
      return report('Shared knowledge (Stage 7 composition)', [
        {
          title: 'Answer',
          lines: [
            `${k.packagesPublished} knowledge package(s) on the exchange · ${k.knowledgeShares.length} knowledge-class share(s) · ${k.backingCandidates.length} local asset(s) topic-matched as backing candidates.`,
            ...k.knowledgeShares.slice(0, 4).map((s) => `${s.name} — ${s.direction} with ${s.peerOrgName} (${s.access})`),
          ],
        },
        { title: 'Evidence', lines: k.backingCandidates.slice(0, 6).map((c) => `${c.title} (topic: ${c.matchedTopic})`) },
        { title: 'Uncertainty', lines: k.gaps.map((g) => `${g.subject}: ${g.detail}`) },
      ]);
    }
    case 'shared-automation': {
      const a = ctx.sharing.automation;
      return report('Shared automation (Stage 8 composition)', [
        {
          title: 'Answer',
          lines: [
            `${a.templatesPublished} workflow template(s) on the exchange · ${a.playbookCandidates.length} REAL playbook(s) as shareable candidates.`,
            ...a.playbookCandidates.map((p) => `${p.name} v${p.version}${p.nameMatchedArtifact ? ` — name-matches "${p.nameMatchedArtifact}" (heuristic)` : ''}`),
          ],
        },
        {
          title: 'Uncertainty',
          lines: [
            a.monitorFindings
              ? `Automation monitor: ${a.monitorFindings.criticalOrHigh} critical/high of ${a.monitorFindings.total} finding(s) — platform-wide; no per-share attribution exists.`
              : 'Automation monitor unreadable this pass.',
            ...a.gaps.map((g) => `${g.subject}: ${g.detail}`),
          ],
        },
      ]);
    }
    case 'partner-exposure': {
      const o = ctx.sharing.operations;
      return report('Partner-facing operational exposure (declared map × live states)', [
        {
          title: 'Answer',
          lines:
            o.partners.length === 0
              ? ['No recorded share maps to a partner-facing service.']
              : o.partners.map(
                  (p) => `${p.peerOrgName}: ${p.shareKinds.join(', ')} → ${p.services.map((s) => `${s.serviceId} (${s.state}${s.slaStatus ? `, SLA ${s.slaStatus}` : ''})`).join(' · ')}`,
                ),
        },
        {
          title: 'Context',
          lines: [
            o.readiness ? `Readiness: ${o.readiness.ready} ready · ${o.readiness.degraded} degraded · ${o.readiness.notReady} not-ready · ${o.readiness.unknown} unknown.` : 'Readiness unreadable.',
            `Capacity pressure: ${o.capacityPressure ?? 'unknown'}.`,
          ],
        },
        { title: 'Uncertainty', lines: [o.disclosure] },
      ]);
    }
    case 'joint-initiatives': {
      const s = ctx.sharing.strategy;
      return report('Joint initiatives (Stage 10 × recorded partner shares)', [
        {
          title: 'Answer',
          lines:
            s.jointInitiatives.length === 0
              ? ['No recorded partner share intersects any initiative capability — stated honestly, not padded.']
              : s.jointInitiatives.map(
                  (j) => `${j.label} (${j.state}): ${j.partnerShares.map((p) => `${p.peerOrgName} · ${p.kind} "${p.name}" ${p.direction}`).join('; ')}`,
                ),
        },
        {
          title: 'Capability federation',
          lines: s.capabilities
            .filter((c) => c.sharesIn + c.sharesOut + c.artifacts > 0)
            .map((c) => `${c.label}: ${c.sharesOut} out / ${c.sharesIn} in · ${c.artifacts} artifact(s) · ${c.initiatives} initiative(s) (condition ${c.condition})`),
        },
        { title: 'Uncertainty', lines: s.gaps.map((g) => `${g.subject}: ${g.detail}`) },
      ]);
    }
    case 'federation-governance': {
      const g = ctx.dashboard.governance;
      return report('Federation governance (the existing cross-org governance, composed)', [
        {
          title: 'Answer',
          lines: g
            ? [`${g.activePolicies}/${g.policies} policies enabled · ${g.pendingApprovals} delegated approval(s) pending · ${g.auditEntries} audit entr(ies).`]
            : ['Federation governance was unreadable this pass — declared, not defaulted.'],
        },
        { title: 'Uncertainty', lines: ['Policy changes and approval decisions run only through the existing fed:gov.* surfaces.'] },
      ]);
    }
    case 'federation-network': {
      const n = ctx.dashboard.network;
      return report('Intelligence network posture (P18, composed as one input)', [
        {
          title: 'Answer',
          lines: n
            ? [`${n.shareableIntelligence} shareable intelligence item(s) · ${n.publishedInsights} published insight(s) · health band ${n.healthBand}.`]
            : ['The P18 intelligence network was unreadable this pass.'],
        },
        { title: 'Uncertainty', lines: ['P18 already sanitizes everything it projects — no raw enterprise records leave the tenant; Stage 11 composes that projection unchanged.'] },
      ]);
    }
    case 'federation-report': {
      return report(ctx.board.title, ctx.board.sections);
    }
    default:
      return report('Federation question', [{ title: 'Answer', lines: ['Unrecognized federation question key.'] }]);
  }
}
