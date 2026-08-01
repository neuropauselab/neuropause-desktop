/**
 * Phase 6 Stage 13 — the twin platform model: the ten assistant question
 * resolvers (NINE-WAY disjoint from the Stage 5/6/7/8/9/10/11/12 matchers, both
 * directions test-locked) and the ten read-only answers riding the existing
 * 'intelligence' structured-report kind.
 *
 * Four real overlaps were found against the eight existing resolver sets while
 * this was written. Each is routed around HERE — no earlier stage is weakened,
 * narrowed, or reordered:
 *
 *   1. Stage 6 owns `/\bhow (healthy )?is (the |our )?enterprise( health)?\b/`,
 *      which also matches "how is the enterprise twin". The status matcher below
 *      therefore accepts "how is the (digital) twin" and never allows
 *      `enterprise` in front of `twin` in that one phrasing.
 *   2. Stage 12 owns `/\bdata coverage\b/`. A bare `coverage map` matcher would
 *      double-claim "data coverage map", so that phrase is explicitly excluded.
 *   3. Stage 8 owns `/\b(simulate|dry.?run)\b.*\b(automation|playbook)\b/`. The
 *      simulation matcher is guarded by `!/\b(automation|playbook)\b/`.
 *   4. Stage 9 owns `/\bdisaster recovery\b/`. The recovery-policy matcher is
 *      guarded by `!/\bdisaster\b/`.
 *   5. Stage 10 owns `/\b(business )?capabilit(y|ies)\b/`. Not writing a
 *      `capability` matcher here did not prevent the collision — `simulation
 *      capability` matches this file's `simulat…` alternative as well — so the
 *      simulation matcher is additionally guarded by `!/\bcapabilit(y|ies)\b/`.
 *
 * Three further words are avoided outright because an earlier stage claims them
 * bare and claiming them here would be a silent theft: `trend(s)` (Stage 12),
 * `capabilit(y|ies)` (Stage 10), and `task(s)` (Stage 5). Avoiding a word means
 * guarding the branch against it, not merely omitting it from this file's own
 * alternatives — see overlap 5, which is exactly the failure of the weaker
 * reading. The vocabulary this port does claim — twin, drift, supervisor,
 * simulate, runtime, what-if — was verified unclaimed across all eight matchers.
 *
 * Answers cite the composed views verbatim; recommending never executes. Pure.
 */
import type {
  AssistantStructuredReport,
  EtwinCoverageMap,
  EtwinDashboard,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinQuestionKey,
  EtwinReport,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
} from '@neuropause/shared';

/* ── the ten resolvers (most specific first) ──────────────────────────────── */

export function resolveTwinQuestion(text: string): EtwinQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;

  if (/\btwin (report|brief(ing)?|pack)\b/.test(t) || /\btwin platform (report|summary)\b/.test(t))
    return 'twin-report';

  if (
    /\bnot modell?ed\b/.test(t) ||
    /\bwhat (is|are)n'?t modell?ed\b/.test(t) ||
    /\b(gaps?|blind spots?) in (the |our )?(enterprise )?(twin|model|coverage)\b/.test(t) ||
    /\bwhat('s| is) missing from (the |our )?(enterprise )?twin\b/.test(t)
  )
    return 'what-is-not-modelled';

  // OVERLAP 2 — Stage 12 owns `data coverage`; that phrasing stays entirely its.
  if (
    /\b(state|twin|model) coverage\b/.test(t) ||
    (/\bcoverage map\b/.test(t) && !/\bdata coverage\b/.test(t)) ||
    /\bwhat does (the |our )?twin model\b/.test(t) ||
    /\bwhich (enterprise )?state (kinds?|is|are)\b/.test(t)
  )
    return 'state-coverage';

  // OVERLAP 3 — Stage 8 owns simulating an automation or a playbook. The
  // `what-if` form additionally requires twin/scenario/model context, because a
  // bare `what if` would otherwise swallow Stage 10 investment questions.
  //
  // OVERLAP 5 — Stage 10 owns `/\b(business )?capabilit(y|ies)\b/`, which fires
  // on the word wherever it appears. Declining to WRITE a `capability` matcher
  // here was not enough: `simulation capability` contains `simulat…` too, so
  // both resolvers claimed it. Avoiding the word has to be enforced against the
  // whole input, not just against this file's own vocabulary, so the branch is
  // guarded the same way OVERLAP 3 is. Stage 10 is untouched and keeps the
  // phrase; Stage 13 stays silent on it.
  if (
    (/\bsimulat(e|es|ion|ions)\b/.test(t) ||
      (/\bwhat.?if\b/.test(t) && /\b(scenarios?|twin|model(l?ing)?)\b/.test(t))) &&
    !/\b(automation|playbook)\b/.test(t) &&
    !/\bcapabilit(y|ies)\b/.test(t)
  )
    return 'simulation-capability';

  // Never a bare `trend` matcher — Stage 12 owns that outright.
  if (
    /\btwin history\b/.test(t) ||
    /\brecorded (history|days?|decisions?|series)\b/.test(t) ||
    /\bhistory of (the |our )?(enterprise |digital )?twin\b/.test(t)
  )
    return 'twin-history';

  if (
    /\bdrift\b/.test(t) ||
    /\btwin (focus|attention|risks?)\b/.test(t) ||
    /\bwhere (is|are) (the |our )?twin (wrong|stale|incomplete|blind)\b/.test(t)
  )
    return 'twin-drift';

  // OVERLAP 4 — Stage 9 owns `disaster recovery`; plain recovery policy is free.
  if (
    /\bruntime twin\b/.test(t) ||
    /\bsupervisor\b/.test(t) ||
    /\bwhich subsystems?\b.*\brecover/.test(t) ||
    /\bsubsystem recovery\b/.test(t) ||
    (/\brecovery polic(y|ies)\b/.test(t) && !/\bdisaster\b/.test(t))
  )
    return 'runtime-twin';

  if (
    /\bexecution twin\b/.test(t) ||
    /\bexecut(e|ion) engine\b/.test(t) ||
    /\bexecution (sessions?|kinds?|history|stats|statistics|status)\b/.test(t) ||
    /\b(active|failed|running) sessions?\b/.test(t)
  )
    return 'execution-twin';

  if (
    /\bplatform twins?\b/.test(t) ||
    /\btwins? (of|for) (the |our )?platforms?\b/.test(t) ||
    /\bwhich platforms?\b/.test(t)
  )
    return 'platform-twins';

  // OVERLAP 1 — "how is the enterprise …" belongs to Stage 6. This matcher never
  // allows `enterprise` in front of `twin` in the `how is` / `state of` forms.
  if (
    /\b(enterprise |digital )?twin (status|overview|state|summary|health)\b/.test(t) ||
    /\bhow is (the |our )?(digital )?twin\b/.test(t) ||
    /\bstate of (the |our )?(digital )?twin\b/.test(t) ||
    /\btwin platform\b/.test(t)
  )
    return 'twin-status';

  return null;
}

/* ── the answer context + answers ─────────────────────────────────────────── */

export interface TwinQuestionContext {
  runtime: EtwinRuntimeTwin;
  platforms: EtwinPlatformTwins;
  coverage: EtwinCoverageMap;
  simulation: EtwinSimulationInventory;
  history: EtwinHistoryView;
  dashboard: EtwinDashboard;
  report: EtwinReport;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

export function answerTwinQuestion(key: EtwinQuestionKey, ctx: TwinQuestionContext): AssistantStructuredReport {
  switch (key) {
    case 'twin-status': {
      const d = ctx.dashboard;
      return report('Enterprise digital twin platform status (composed, never recomputed)', [
        {
          title: 'Answer',
          lines: [
            d.twin === null
              ? 'The P15 enterprise twin was unreadable this pass — no health is assumed.'
              : `Enterprise twin (P15): ${d.twin.domainCount} domain(s) · ${d.twin.totalEntities} entity(ies) · overall health ${d.twin.overallHealth} (${d.twin.healthBand}) · ${d.twin.criticalImpactNodes} critical impact node(s) · ${d.twin.openDecisions} open decision(s).`,
            d.runtime.available
              ? `Runtime & execution: ${d.runtime.activeSessions} active session(s) across ${d.runtime.registeredKinds} registered kind(s)` +
                (d.runtime.failed === null ? ' · execution statistics unreadable.' : ` · ${d.runtime.failed} failed.`) +
                (d.runtime.recovering === null ? ' Supervisor unreadable.' : ` ${d.runtime.recovering} subsystem(s) recovering.`)
              : 'Runtime & execution: neither the Execute Engine nor the Runtime Supervisor was readable this pass.',
            `Platform twins: ${d.platforms.total} platform(s) — ${d.platforms.steady} steady · ${d.platforms.attention} needing attention · ${d.platforms.unknown} unreadable.`,
            `State coverage: ${d.coverage.total} state kind(s) — ${d.coverage.modelledByTwin} by the twin · ${d.coverage.modelledElsewhere} elsewhere · ${d.coverage.notModelled} not modelled.`,
            `Simulation: ${d.simulation.registered} registered capabilit(ies) · ${d.simulation.liveInstances} live instance(s). Stage 13 invokes none of them.`,
            `Recorded history: ${d.history.improving} improving · ${d.history.stable} stable · ${d.history.regressing} regressing · ${d.history.unavailable} without a recorded series.`,
          ],
        },
        {
          title: 'Uncertainty',
          lines: [...d.unavailable.map((u) => `${u.system}: ${u.reason}`), d.disclosures[0]],
        },
      ]);
    }
    case 'runtime-twin': {
      const s = ctx.runtime.supervisor;
      return report('The runtime twin (Runtime Supervisor, composed verbatim)', [
        {
          title: 'Answer',
          lines: s.available
            ? [
                s.status === null
                  ? 'The supervisor reported no readable status this pass.'
                  : `${s.status.recovering.length} subsystem(s) recovering now · ${s.status.recoveryCount} recorded recovery(ies) · ${s.status.recentFailures} recent failure(s).`,
                ...s.rows.map(
                  (r) =>
                    `${r.subsystem}: policy ${r.policy} · ${r.recovering ? 'RECOVERING' : 'idle'} · ${r.recoveries} recovery(ies), ${r.failures} failed${r.lastAt === null ? ' · none recorded' : ` · last ${r.lastAt}`}`,
                ),
                `${s.historyCount} recovery record(s) in the current process.`,
              ]
            : ['The Runtime Supervisor was not readable this pass — no policy or recovery state is assumed.'],
        },
        {
          title: 'Surfaces composed',
          lines: ctx.runtime.surfaces.map((x) => `${x.label} (${x.kind}) — ${x.module}`),
        },
        {
          title: 'Uncertainty',
          lines: [...ctx.runtime.unavailable.map((u) => `${u.system}: ${u.reason}`), ctx.runtime.disclosure],
        },
      ]);
    }
    case 'execution-twin': {
      const e = ctx.runtime.execution;
      return report('The execution twin (Execute Engine, composed verbatim)', [
        {
          title: 'Answer',
          lines: e.available
            ? [
                `${e.activeCount} active session(s) · ${e.historyCount} in recorded history · ${e.registeredKinds.length} registered kind(s).`,
                e.stats === null
                  ? 'The engine reported no readable statistics this pass.'
                  : `Engine statistics: ${e.stats.completed} completed · ${e.stats.failed} failed · ${e.stats.cancelled} cancelled · ${e.stats.queued} queued${e.stats.successRate === null ? ' · success rate not computed by the engine' : ` · success rate ${e.stats.successRate}`}.`,
                ...e.kinds.map((k) => `${k.kind}: ${k.active} active · ${k.historical} historical · ${k.failed} failed`),
              ]
            : ['The Execute Engine was not readable this pass — no session or kind state is assumed.'],
        },
        {
          title: 'Active now',
          lines: e.active.map((r) => `${r.kind} · ${r.label} — ${r.state} (started ${r.startedAt})`),
        },
        {
          title: 'Most recent',
          lines: e.recent.map(
            (r) => `${r.kind} · ${r.label} — ${r.state}${r.durationMs === null ? '' : ` in ${r.durationMs}ms`}`,
          ),
        },
        {
          title: 'Uncertainty',
          lines: [...ctx.runtime.unavailable.map((u) => `${u.system}: ${u.reason}`), ctx.runtime.disclosure],
        },
      ]);
    }
    case 'platform-twins': {
      const p = ctx.platforms;
      return report('The platform twins (Stage 6–12) and P15’s own domains', [
        {
          title: 'Answer',
          lines: [
            `${p.totals.platforms} platform(s): ${p.totals.steady} steady · ${p.totals.attention} needing attention · ${p.totals.unknown} unreadable.`,
            ...p.platforms.map((x) => `${x.label} (${x.stage}): ${x.state.toUpperCase()} — ${x.summary}`),
          ],
        },
        {
          title: 'P15 domains (composed verbatim — never recomputed)',
          lines:
            p.domainTotals === null
              ? ['The P15 domain projection was unreadable this pass.']
              : [
                  `${p.domainTotals.domains} domain(s) · ${p.domainTotals.entities} entity(ies) · ${p.domainTotals.healthy} healthy · ${p.domainTotals.degraded} degraded.`,
                  ...p.domains.map((d) => `${d.label}: ${d.entities} entity(ies), band ${d.band}`),
                ],
        },
        {
          title: 'Metrics as each platform published them',
          lines: p.platforms.flatMap((x) => x.metrics.map((m) => `${x.label} · ${m.label}: ${m.value}`)),
        },
        {
          title: 'Uncertainty',
          lines: [...p.unavailable.map((u) => `${u.system}: ${u.reason}`), p.disclosure],
        },
      ]);
    }
    case 'state-coverage': {
      const c = ctx.coverage;
      return report('Enterprise state coverage — what is modelled, and by whom', [
        {
          title: 'Answer',
          lines: [
            `${c.totals.total} state kind(s): ${c.totals.modelledByTwin} modelled by the P15 twin · ${c.totals.modelledElsewhere} modelled elsewhere · ${c.totals.notModelled} not modelled anywhere.`,
          ],
        },
        {
          title: 'Modelled by the twin',
          lines: c.rows
            .filter((r) => r.status === 'modelled-by-twin')
            .map((r) => `${r.label} — ${r.owner}${r.live === null ? '' : ` (${r.live})`}`),
        },
        {
          title: 'Modelled elsewhere (named owner, outside the twin)',
          lines: c.rows
            .filter((r) => r.status === 'modelled-elsewhere')
            .map((r) => `${r.label} — ${r.owner}${r.live === null ? '' : ` (${r.live})`}`),
        },
        {
          title: 'Not modelled',
          lines: c.rows.filter((r) => r.status === 'not-modelled').map((r) => `${r.label} — ${r.owner}`),
        },
        {
          title: 'Uncertainty',
          lines: [...c.unavailable.map((u) => `${u.system}: ${u.reason}`), c.disclosure],
        },
      ]);
    }
    case 'what-is-not-modelled': {
      const c = ctx.coverage;
      const gaps = c.rows.filter((r) => r.status === 'not-modelled');
      return report('What the enterprise twin does NOT model', [
        {
          title: 'Answer',
          lines:
            gaps.length === 0
              ? ['Every registered state kind has a named owner — no gap is recorded.']
              : gaps.map((r) => `${r.label}: ${r.owner}`),
        },
        { title: 'Evidence for each gap', lines: gaps.map((r) => `${r.label} — ${r.evidence}`) },
        {
          title: 'Modelled, but not by the twin',
          lines: c.rows
            .filter((r) => r.status === 'modelled-elsewhere')
            .map((r) => `${r.label}: owned by ${r.owner} — the twin composes no reading of it.`),
        },
        {
          title: 'Uncertainty',
          lines: [...c.unavailable.map((u) => `${u.system}: ${u.reason}`), c.disclosure],
        },
      ]);
    }
    case 'simulation-capability': {
      const s = ctx.simulation;
      return report('What the platform can — and cannot — simulate', [
        {
          title: 'Answer',
          lines: s.entries.map((e) => `${e.label} (${e.kind}): CAN — ${e.canSimulate} CANNOT — ${e.cannotSimulate}`),
        },
        {
          title: 'Observable now',
          lines: s.entries.filter((e) => e.live !== null).map((e) => `${e.label}: ${e.live!.detail}`),
        },
        {
          title: 'Not observable this pass',
          lines: s.entries.filter((e) => e.live === null).map((e) => `${e.label}: no instance count is observable — null is not zero.`),
        },
        {
          title: 'Uncertainty',
          lines: [
            `Stage 13 invoked ${s.entries.filter((e) => e.invoked).length} of ${s.totals.registered} registered capabilit(ies) — it has no simulation call site at all.`,
            ...s.unavailable.map((u) => `${u.system}: ${u.reason}`),
            s.disclosure,
          ],
        },
      ]);
    }
    case 'twin-history': {
      const h = ctx.history;
      return report('The twin’s recorded history (Stage 12’s deltas, composed verbatim)', [
        {
          title: 'Answer',
          lines: [
            `${h.totals.improving} improving · ${h.totals.stable} stable · ${h.totals.regressing} regressing · ${h.totals.unavailable} without a recorded series.`,
            h.recordedDays === null
              ? 'The health history store was unreadable this pass.'
              : `${h.recordedDays} recorded day(s) of health history.`,
            h.recordedDecisions === null
              ? 'The decision store was unreadable this pass.'
              : `${h.recordedDecisions} recorded decision(s).`,
          ],
        },
        { title: 'Recorded series', lines: h.rows.map((r) => `${r.label}: ${r.direction.toUpperCase()} — ${r.detail}`) },
        { title: 'Not trendable (declared, never inferred)', lines: h.untrendable.map((u) => `${u.label}: ${u.reason}`) },
        {
          title: 'Uncertainty',
          lines: [...h.unavailable.map((u) => `${u.system}: ${u.reason}`), h.disclosure],
        },
      ]);
    }
    case 'twin-drift': {
      const d = ctx.dashboard;
      const unknown = ctx.platforms.platforms.filter((p) => p.state === 'unknown');
      return report('Twin drift — where the model may not reflect reality', [
        {
          title: 'Answer',
          lines:
            d.unavailable.length === 0 && unknown.length === 0 && ctx.coverage.notModelled.length === 0
              ? ['Every composed input was readable this pass and every registered state kind has a named owner.']
              : [
                  `${d.unavailable.length} input(s) unreadable · ${unknown.length} platform(s) unknown · ${ctx.coverage.notModelled.length} state kind(s) not modelled anywhere.`,
                ],
        },
        { title: 'Unreadable inputs (no value was assumed)', lines: d.unavailable.map((u) => `${u.system}: ${u.reason}`) },
        { title: 'Platforms with no readable state', lines: unknown.map((p) => `${p.label} (${p.stage}): ${p.summary}`) },
        { title: 'State the twin cannot see', lines: ctx.coverage.notModelled },
        {
          title: 'Time the twin cannot see',
          lines: ctx.history.untrendable.map((u) => `${u.label}: ${u.reason}`),
        },
        {
          title: 'Twin focus (recommendations only — nothing executes from here)',
          lines: d.recommendations.map((r) => `${r.priority.toUpperCase()} · ${r.title} → ${r.suggestedAction}`),
        },
        {
          title: 'Uncertainty',
          lines: [
            'Drift here means the composition’s own blind spots — readability, ownership and recordability. It is not a computed divergence metric, and no reconciliation against an external source of truth is performed.',
            ctx.coverage.disclosure,
          ],
        },
      ]);
    }
    case 'twin-report': {
      return report(ctx.report.title, ctx.report.sections);
    }
    default:
      return report('Twin platform question', [
        { title: 'Answer', lines: ['Unrecognized twin platform question key.'] },
      ]);
  }
}
