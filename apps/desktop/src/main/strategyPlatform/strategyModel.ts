/**
 * Phase 6 Stage 10 — the strategy model: the eleven assistant question
 * resolvers (SIX-WAY disjoint from the Stage 5/6/7/8/9 matchers, both
 * directions test-locked) and the eleven read-only answers, riding the
 * existing 'intelligence' structured-report kind. Answers cite the computed
 * views verbatim; recommending never executes. Pure.
 */
import type {
  AssistantStructuredReport,
  BoardReport,
  BusinessValueReport,
  CapabilityMapView,
  ObjectivesReport,
  PlanningReport,
  PortfolioReport,
  StrategyDashboard,
  StrategyHealthView,
  StrategyQuestionKey,
} from '@neuropause/shared';

/* ── the eleven resolvers ─────────────────────────────────────────────────── */

export function resolveStrategyQuestion(text: string): StrategyQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\bboard (brief|report|pack)\b/.test(t)) return 'board-brief';
  if (/\b(business )?capabilit(y|ies)\b/.test(t)) return 'capability-analysis';
  if (/\bstrategic risks?\b/.test(t) || /\bboard attention\b/.test(t)) return 'strategic-risks';
  if (/\bbusiness value\b/.test(t) || /\bwhich decisions (produced|delivered|created)\b/.test(t)) return 'business-value';
  if (/\binvestments? (priorit|focus)/.test(t) || /\bwhich investments\b/.test(t) || /\bprioriti[sz]e (our )?investments?\b/.test(t))
    return 'investment-priorities';
  // "operational objectives" belongs to the Stage 9 ops-planning resolver —
  // excluded here to keep the six-way resolver disjointness airtight.
  if ((/\bobjectives?\b/.test(t) || /\bokrs?\b/.test(t)) && !/\boperational objectives?\b/.test(t)) return 'objectives-at-risk';
  if (/\binitiatives?\b/.test(t)) return 'initiative-portfolio';
  if (/\broadmap\b/.test(t)) return 'roadmap-outlook';
  if (/\b(executive|leadership) focus\b/.test(t) || /\bfocus (on )?(this|next) quarter\b/.test(t) || /\bwhat should (the )?(executive team|leadership) focus\b/.test(t))
    return 'executive-focus';
  if (/\b(department|unit|organi[sz]ational?) alignment\b/.test(t) || /\bwhich (departments?|units?) (are )?misaligned\b/.test(t))
    return 'alignment';
  if (/\bstrateg(y|ic) (status|overview|state)\b/.test(t) || /\bstate of (our |the )?(enterprise )?strategy\b/.test(t))
    return 'strategy-status';
  return null;
}

/* ── the answer context + answers ─────────────────────────────────────────── */

export interface StrategyQuestionContext {
  objectives: ObjectivesReport;
  portfolio: PortfolioReport;
  value: BusinessValueReport;
  planning: PlanningReport;
  capabilities: CapabilityMapView;
  health: StrategyHealthView;
  dashboard: StrategyDashboard;
  board: BoardReport;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

export function answerStrategyQuestion(key: StrategyQuestionKey, ctx: StrategyQuestionContext): AssistantStructuredReport {
  switch (key) {
    case 'strategy-status': {
      const d = ctx.dashboard;
      return report('Enterprise strategy status', [
        {
          title: 'Answer',
          lines: [
            `Objectives: ${d.objectives.onTrack} on-track · ${d.objectives.atRisk} at-risk · ${d.objectives.offTrack} off-track · ${d.objectives.unknown} unknown (${d.objectives.company} company + ${d.objectives.departments} department).`,
            `Portfolio: ${d.portfolio.advancing} advancing · ${d.portfolio.blocked} blocked · ${d.portfolio.stalled} stalled · ${d.portfolio.done} done.`,
            `Value: ${d.value.delivered} delivered · ${d.value.partial} partial · ${d.value.notYetObserved} not yet observed · ${d.value.unmeasurable} unmeasurable.`,
            `Risks substantiated: ${d.risks.substantiated}/${d.risks.substantiated + d.risks.unsubstantiated} · Executive focus items: ${d.planning.focusItems}.`,
          ],
        },
        { title: 'Themes', lines: ctx.health.themes.map((t) => `${t.label}: ${t.state} — ${t.detail}`) },
        { title: 'Uncertainty', lines: d.unavailable.map((u) => `${u.system}: ${u.reason}`) },
      ]);
    }
    case 'objectives-at-risk': {
      const risky = [...ctx.objectives.company, ...ctx.objectives.departments].filter(
        (o) => o.health === 'at-risk' || o.health === 'off-track',
      );
      return report('Objectives at risk', [
        {
          title: 'Answer',
          lines:
            risky.length === 0
              ? ['No objective is at risk by its own live measures.']
              : risky.map((o) => `${o.label} (${o.kind}, ${o.unitName}): ${o.health.toUpperCase()} — ${o.healthDetail}`),
        },
        { title: 'Evidence', lines: risky.flatMap((o) => o.measures.filter((m) => m.state === 'bad').map((m) => `${o.id} ← ${m.ref}: ${m.detail}`)).slice(0, 8) },
        { title: 'Uncertainty', lines: [...ctx.objectives.company, ...ctx.objectives.departments].filter((o) => o.health === 'unknown').map((o) => `${o.label}: unknown — ${o.healthDetail}`) },
      ]);
    }
    case 'initiative-portfolio': {
      return report('Initiative portfolio', [
        {
          title: 'Answer',
          lines: ctx.portfolio.initiatives.map(
            (i) => `${i.label}: ${i.state.toUpperCase()} — ${i.stateDetail}${i.owner ? ` · owner ${i.owner.unitName}` : ' · ownership gap'}`,
          ),
        },
        { title: 'Blockers', lines: ctx.portfolio.initiatives.filter((i) => i.blockers.length > 0).flatMap((i) => i.blockers.map((b) => `${i.id}: ${b.reason}`)).slice(0, 6) },
        { title: 'Evidence', lines: ctx.portfolio.initiatives.slice(0, 4).flatMap((i) => i.sources.slice(0, 2).map((s) => `${i.id} ← ${s.kind}:${s.ref} (${s.summary})`)) },
      ]);
    }
    case 'business-value': {
      const v = ctx.value;
      return report('Business value from governed decisions (computed, never estimated)', [
        {
          title: 'Answer',
          lines:
            v.decisions.length === 0
              ? ['No governed decisions recorded yet — there is no value history to compute.']
              : v.decisions.slice(0, 8).map((d) => `${d.title} [${d.category}]: ${d.verdict.toUpperCase()} — ${d.verdictDetail}`),
        },
        { title: 'Evidence', lines: v.decisions.slice(0, 6).flatMap((d) => d.evidence.slice(0, 2)) },
        { title: 'Uncertainty', lines: [v.disclosure] },
      ]);
    }
    case 'alignment': {
      const misaligned = ctx.health.alignment.filter((a) => !a.aligned);
      return report('Organizational alignment', [
        {
          title: 'Answer',
          lines:
            misaligned.length === 0
              ? ['Every unit carries at least one department objective bound to a company objective.']
              : misaligned.map((a) => `${a.unitName}: ${a.detail}`),
        },
        { title: 'Aligned units', lines: ctx.health.alignment.filter((a) => a.aligned).map((a) => `${a.unitName} → ${a.companyObjectiveIds.join(', ')}`) },
      ]);
    }
    case 'executive-focus': {
      const current = ctx.planning.horizons.find((h) => h.horizon === 'current-quarter');
      return report(`Executive focus — ${current?.label ?? 'current quarter'}`, [
        {
          title: 'Answer',
          lines:
            current && current.focus.length > 0
              ? current.focus.map((f) => `${f.priority.toUpperCase()} · ${f.title} → ${f.suggestedAction}`)
              : ['No focus items this quarter by the composed signals.'],
        },
        { title: 'Evidence', lines: (current?.focus ?? []).slice(0, 5).flatMap((f) => f.evidence.slice(0, 2)) },
        { title: 'Uncertainty', lines: ['Focus items are recommendations only — nothing executes from this surface.'] },
      ]);
    }
    case 'strategic-risks': {
      const risks = ctx.health.risks;
      const live = risks.filter((r) => r.substantiated);
      return report('Strategic risks', [
        {
          title: 'Answer',
          lines:
            live.length === 0
              ? [`No strategic risk is currently substantiated by live signals (${risks.length} registered, all quiet — stated honestly, not escalated).`]
              : live.map((r) => `${r.label}: ${r.detail}`),
        },
        { title: 'Registered but quiet', lines: risks.filter((r) => !r.substantiated).map((r) => r.label) },
        { title: 'Evidence', lines: live.flatMap((r) => r.evidence.filter((e) => e.live).map((e) => `${r.id} ← ${e.kind}:${e.ref}`)).slice(0, 8) },
      ]);
    }
    case 'roadmap-outlook': {
      return report('Roadmap outlook (relative horizons; milestone conditions, never invented dates)', [
        {
          title: 'Answer',
          lines: ctx.planning.horizons.map((h) => `${h.label}: ${h.summary}`),
        },
        {
          title: 'Milestone conditions',
          lines: ctx.portfolio.initiatives
            .flatMap((i) => i.milestones.map((m) => `${i.id}/${m.id}: ${m.satisfied === null ? 'not evaluable' : m.satisfied ? 'satisfied' : 'unmet'} — ${m.detail}`))
            .slice(0, 10),
        },
        { title: 'Uncertainty', lines: ['The platform records no committed dates; the roadmap tracks observable conditions, not schedule slippage.'] },
      ]);
    }
    case 'investment-priorities': {
      const c = ctx.capabilities;
      return report('Investment priorities (attention counts — the platform records no costs)', [
        {
          title: 'Answer',
          lines: [
            ...c.investmentFocus.map((f, i) => `${i + 1}. ${f.key} — attention ${f.attention} (initiatives + governed decisions)`),
            c.unsupported.length > 0 ? `Zero-initiative capabilities (candidates for attention): ${c.unsupported.join(', ')}.` : 'Every capability has initiative support.',
          ],
        },
        { title: 'Evidence', lines: c.capabilities.slice(0, 6).map((x) => `${x.key}: ${x.initiatives.total} initiative(s), ${x.decisionAttention} attention`) },
        { title: 'Uncertainty', lines: [c.disclosure] },
      ]);
    }
    case 'board-brief': {
      return report(ctx.board.title, ctx.board.sections);
    }
    case 'capability-analysis': {
      const c = ctx.capabilities;
      return report('Enterprise capability map', [
        {
          title: 'Answer',
          lines: [
            c.weakest ? `Weakest: ${c.weakest.detail}` : 'No capability is judged weak by its readable evidence.',
            c.highestOperationalRisk ? `Highest operational risk: ${c.highestOperationalRisk.key} — ${c.highestOperationalRisk.detail}` : 'No capability carries live operational-risk signals right now.',
            c.unsupported.length > 0 ? `Unsupported by initiatives: ${c.unsupported.join(', ')}.` : 'Every capability has initiative support.',
            c.lackingStandards.length > 0 ? `Lacking matched standards: ${c.lackingStandards.join(', ')}.` : 'Every capability matched at least one knowledge standard.',
          ],
        },
        {
          title: 'Capabilities',
          lines: c.capabilities.map((x) => `${x.label}: ${x.condition} (coverage ${(x.evidenceCoverage * 100).toFixed(0)}%) · ${x.objectives.total} objective(s) · ${x.initiatives.total} initiative(s)${x.gaps.length > 0 ? ` · gaps: ${x.gaps.join('; ')}` : ''}`),
        },
        { title: 'Uncertainty', lines: [c.disclosure] },
      ]);
    }
    default:
      return report('Strategy question', [{ title: 'Answer', lines: ['Unrecognized strategy question key.'] }]);
  }
}
