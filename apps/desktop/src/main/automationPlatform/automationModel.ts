/**
 * Phase 6 Stage 8 — the automation model: the six assistant questions (D-8),
 * plan explainability composition (Principle D — structurally complete or the
 * composition throws in tests), the policies view, and the dashboard.
 *
 * Matchers are DISJOINT from the Stage 5 productivity, Stage 6 insight, and
 * Stage 7 knowledge resolvers — and deliberately avoid the existing
 * operational phrasings ("launch the onboarding automation" stays with the
 * Stage 4/5 flow; only PLAYBOOK phrasing routes execution questions here, and
 * the answer is a gated-flow pointer, never an execution). Pure.
 */
import type {
  ApprovalChain,
  AutomationCatalog,
  AutomationExplainability,
  AutomationMonitorReport,
  AutomationPlan,
  AutomationPlatformDashboard,
  AutomationPoliciesView,
  AutomationQuestionKey,
  AssistantStructuredReport,
  PlaybookCategory,
  PlaybookDefinition,
  PolicyDefaults,
} from '@neuropause/shared';
import { explainabilityIssues } from '@neuropause/shared';
import { rollbackSummary } from './rollbackPlanner';
import type { CompiledPlaybook } from './playbookComposer';

/* ── question resolution ──────────────────────────────────────────────────── */

export function resolveAutomationQuestion(text: string): AutomationQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\b(build|create|draft|design)\b.*\b(an?|a new|me an?)?\s*(automation|playbook)\b/.test(t) && !/\blaunch|run|execute|start\b/.test(t))
    return 'build-automation';
  if (/\bexplain\b.*\b(automation|playbook)\b/.test(t) || /\bhow does\b.*\bplaybook\b.*\bwork\b/.test(t))
    return 'explain-automation';
  if (/\b(simulate|dry.?run)\b.*\b(automation|playbook)\b/.test(t)) return 'simulate-automation';
  if (/\b(run|execute|start|launch)\b.*\bplaybook\b/.test(t)) return 'execute-automation';
  if (/\b(monitor|status|health)\b.*\bautomations?\b/.test(t) || /\bautomations? (status|health|monitor)\b/.test(t))
    return 'monitor-automation';
  if (/\bdebug\b.*\b(automation|playbook)\b/.test(t) || /\bwhy did (the |my )?(automation|playbook)( run)? fail\b/.test(t))
    return 'debug-automation';
  return null;
}

/* ── Principle D composition (structurally complete or it throws in tests) ── */

export function composeExplainability(
  playbook: PlaybookDefinition,
  compiled: CompiledPlaybook,
  plan: Pick<AutomationPlan, 'policy'>,
  knowledgeMatched: number,
): AutomationExplainability {
  const confidence = Math.max(
    0.1,
    Math.round((1 - compiled.issues.length * 0.2) * (knowledgeMatched > 0 ? 1 : 0.9) * 100) / 100,
  );
  const e: AutomationExplainability = {
    why: playbook.why,
    evidence: [
      `playbook:${playbook.id}@v${playbook.version}`,
      ...playbook.steps.map((s) => `step:${s.id}`),
      ...playbook.knowledgeRefs.map((r) => `knowledge:${r}`),
    ],
    triggeringConditions: playbook.triggeringConditions,
    expectedOutcome: playbook.expectedOutcome,
    rollback: rollbackSummary(plan.policy.rollback),
    confidence: Math.min(1, confidence),
    affectedSystems: playbook.affectedSystems,
  };
  const issues = explainabilityIssues(e);
  if (issues.length > 0) {
    // Principle D is structural: an incomplete envelope is a defect, not a warning.
    throw new Error(`explainability incomplete: ${issues.join('; ')}`);
  }
  return e;
}

/* ── policies view + dashboard ────────────────────────────────────────────── */

export function composePoliciesView(
  defaults: readonly PolicyDefaults[],
  autoAllowedTriggers: readonly string[],
  chains: readonly ApprovalChain[],
  nowIso: string,
): AutomationPoliciesView {
  return {
    generatedAt: nowIso,
    defaults: [...defaults],
    autoAllowedTriggers: [...autoAllowedTriggers],
    chains: chains
      .filter((c) => c.enabled)
      .map((c) => ({ trigger: c.appliesTo, chainName: c.name, steps: c.steps.length })),
    note:
      autoAllowedTriggers.length === 0
        ? 'No global-governance autonomous allows exist — nothing is auto-executable (the correct default).'
        : `Autonomous allows derive from global governance policies; approval chains always win over an allow.`,
  };
}

export interface DashboardInputs {
  catalog: AutomationCatalog;
  monitor: AutomationMonitorReport;
  playbooks: readonly PlaybookDefinition[];
  policies: AutomationPoliciesView;
  nowIso: string;
}

export function composeAutomationDashboard(inp: DashboardInputs): AutomationPlatformDashboard {
  const scheduleEntries = inp.catalog.entries.filter((e) => e.schedule !== null);
  const parseable = scheduleEntries.filter((e) => e.schedule?.parsed).length;
  const nextDues = scheduleEntries
    .map((e) => e.schedule?.nextDue)
    .filter((x): x is string => Boolean(x))
    .sort();
  const catMap = new Map<PlaybookCategory, number>();
  for (const p of inp.playbooks) catMap.set(p.category, (catMap.get(p.category) ?? 0) + 1);
  return {
    generatedAt: inp.nowIso,
    catalog: { entries: inp.catalog.totals.entries, byKind: inp.catalog.totals.byKind },
    playbooks: {
      count: inp.playbooks.length,
      categories: [...catMap.entries()].map(([category, count]) => ({ category, count })),
    },
    schedules: {
      rules: scheduleEntries.length,
      parseable,
      unparseable: scheduleEntries.length - parseable,
      nextDue: nextDues.length > 0 ? nextDues[0] : null,
    },
    monitor: {
      findings: inp.monitor.totals.findings,
      critical: inp.monitor.findings.filter((f) => f.severity === 'critical').length,
      high: inp.monitor.findings.filter((f) => f.severity === 'high').length,
      top: inp.monitor.findings.slice(0, 5),
    },
    policies: {
      defaults: inp.policies.defaults.length,
      autoAllowedTriggers: inp.policies.autoAllowedTriggers,
      governedTriggers: new Set(inp.policies.chains.map((c) => c.trigger)).size,
    },
    disclosures: inp.catalog.disclosures,
    unavailable: [...inp.catalog.unavailable, ...inp.monitor.unavailable].filter(
      (u, i, arr) => arr.findIndex((x) => x.system === u.system) === i,
    ),
  };
}

/* ── the six answers (all read-only; 'intelligence' report kind per D-8) ──── */

export interface AutomationQuestionContext {
  catalog: AutomationCatalog;
  monitor: AutomationMonitorReport;
  playbooks: readonly PlaybookDefinition[];
  planFor: (playbookId: string) => AutomationPlan | null;
  policies: AutomationPoliciesView;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

function matchPlaybook(text: string, playbooks: readonly PlaybookDefinition[]): PlaybookDefinition | null {
  const t = text.toLowerCase();
  return (
    playbooks.find((p) => t.includes(p.id)) ??
    playbooks.find((p) => p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => t.includes(w))) ??
    null
  );
}

function principleDSections(plan: AutomationPlan): Section[] {
  const e = plan.explainability;
  return [
    { title: 'Why', lines: [e.why] },
    { title: 'Evidence', lines: e.evidence.slice(0, 10) },
    { title: 'Triggering conditions', lines: e.triggeringConditions },
    { title: 'Expected outcome', lines: [e.expectedOutcome] },
    {
      title: 'Rollback',
      lines: [e.rollback, ...plan.policy.rollback.steps.filter((s) => s.kind === 'none').slice(0, 3).map((s) => `${s.label}: ${s.detail}`)],
    },
    { title: 'Confidence', lines: [`${Math.round(e.confidence * 100)}%`] },
    { title: 'Affected systems', lines: [e.affectedSystems.join(', ')] },
  ];
}

export function answerAutomationQuestion(
  key: AutomationQuestionKey,
  text: string,
  ctx: AutomationQuestionContext,
): AssistantStructuredReport {
  switch (key) {
    case 'build-automation': {
      const t = text.toLowerCase();
      const wantsPlaybook = /\bplaybook\b/.test(t);
      const trigger = /\b(daily|every|weekly|hourly|schedule)\b/.test(t)
        ? "schedule (e.g. 'daily 9am' — the deterministic subset)"
        : /\b(email|message|slack|file)\b/.test(t)
          ? 'connector-event'
          : 'manual';
      const action = /\bsummar/.test(t) ? 'ai-summarize' : /\bnotify|alert\b/.test(t) ? 'notify' : /\bremember|save\b/.test(t) ? 'save-memory' : 'notify';
      return report('Draft automation (nothing was created)', [
        {
          title: 'Answer',
          lines: wantsPlaybook
            ? [
                'Playbooks are code-shipped, versioned definitions compiled to the existing workflow runtime — new playbooks land as reviewed registry revisions, not ad-hoc records.',
                `Closest existing playbooks: ${ctx.playbooks.map((p) => p.name).join(' · ') || 'none'}.`,
              ]
            : [
                `Draft rule preview — trigger: ${trigger}; conditions: none; action: ${action}.`,
                'Saving flows through the EXISTING automations:save as an approval-gated assistant plan step — this answer created nothing.',
              ],
        },
        { title: 'Evidence', lines: [`catalog: ${ctx.catalog.totals.entries} automation-capable entries`, ...ctx.playbooks.slice(0, 3).map((p) => `playbook:${p.id}@v${p.version}`)] },
        { title: 'Uncertainty', lines: ['The draft is a deterministic keyword parse of your request — review every field before saving.'] },
      ]);
    }
    case 'explain-automation': {
      const pb = matchPlaybook(text, ctx.playbooks);
      if (!pb) {
        const named = ctx.catalog.entries.filter((e) => e.kind === 'automation-rule').slice(0, 5);
        return report('Explain automation', [
          { title: 'Answer', lines: ['No playbook matched that name. Existing automation rules are listed below; name one (or a playbook) to explain it.'] },
          { title: 'Evidence', lines: named.map((e) => `${e.name} [${e.id}] — ${e.status}`) },
        ]);
      }
      const plan = ctx.planFor(pb.id);
      if (!plan) return report('Explain automation', [{ title: 'Answer', lines: [`Playbook ${pb.id} failed to compile a plan — see the monitor.`] }]);
      return report(`Playbook: ${pb.name}`, [
        { title: 'Answer', lines: [pb.description, `Compiled to ${plan.workflow.steps.length} workflow step(s) for the EXISTING orchestrator; approvals: ${plan.approvals.governed ? plan.approvals.chainName : plan.approvals.autoExecutable ? 'auto-allowed by explicit policy' : 'human approval (default)'}.`] },
        ...principleDSections(plan),
      ]);
    }
    case 'simulate-automation': {
      const pb = matchPlaybook(text, ctx.playbooks) ?? ctx.playbooks[0] ?? null;
      if (!pb) return report('Simulate automation', [{ title: 'Answer', lines: ['No playbooks exist to simulate.'] }]);
      const plan = ctx.planFor(pb.id);
      if (!plan) return report('Simulate automation', [{ title: 'Answer', lines: [`Playbook ${pb.id} failed to compile.`] }]);
      const sim = plan.simulation;
      return report(`Simulation plan: ${pb.name}`, [
        {
          title: 'Answer',
          lines: [
            `Compiled sandbox scenario "${sim.scenarioKey}" with ${sim.scenario.steps.length} step(s) on the automation channel — zero production side effects.`,
            sim.lastRun
              ? `Last sandbox run: ${sim.lastRun.status} at ${sim.lastRun.startedAt} [${sim.lastRun.id}].`
              : 'Never run in the sandbox yet.',
            'Running it goes through the EXISTING sandbox surface (sandbox:manage) — this answer executed nothing.',
          ],
        },
        { title: 'Evidence', lines: [sim.scenarioKey, `playbook:${pb.id}@v${pb.version}`] },
        { title: 'Uncertainty', lines: [sim.note] },
      ]);
    }
    case 'execute-automation': {
      const pb = matchPlaybook(text, ctx.playbooks);
      if (!pb) return report('Run a playbook', [{ title: 'Answer', lines: ['No playbook matched that name.', `Available: ${ctx.playbooks.map((p) => p.name).join(' · ') || 'none'}.`] }]);
      const plan = ctx.planFor(pb.id);
      if (!plan) return report('Run a playbook', [{ title: 'Answer', lines: [`Playbook ${pb.id} failed to compile.`] }]);
      return report(`Run playbook: ${pb.name}`, [
        {
          title: 'Answer',
          lines: [
            `Execution is NOT started from here. The compiled workflow (${plan.workflow.steps.length} steps, ${plan.workflow.steps.filter((s) => s.kind === 'approval').length} human checkpoint(s)) runs through the EXISTING flow: workflow start → orchestrator → parked approvals → ExecuteEngine.`,
            plan.policy.windowOpenNow ? 'Execution window: open now.' : 'Execution window: CLOSED now (policy defaults).',
          ],
        },
        { title: 'Approvals', lines: [plan.approvals.note, ...plan.approvals.steps.map((s) => `${s.order}. ${s.name}${s.roleName ? ` (${s.roleName})` : ''}`)] },
        ...principleDSections(plan),
      ]);
    }
    case 'monitor-automation': {
      const m = ctx.monitor;
      return report('Automation status', [
        {
          title: 'Answer',
          lines:
            m.totals.findings === 0
              ? ['No automation findings: nothing stuck, failing, aging at approval, or unparseable.']
              : m.findings.slice(0, 6).map((f) => `${f.severity.toUpperCase()} · ${f.title} — ${f.detail}`),
        },
        { title: 'Evidence', lines: m.findings.slice(0, 6).flatMap((f) => f.evidence.slice(0, 2)) },
        { title: 'Affected systems', lines: [[...new Set(m.findings.flatMap((f) => f.affectedSystems))].join(', ') || 'none'] },
      ]);
    }
    case 'debug-automation': {
      const failed = ctx.monitor.findings.filter((f) => f.kind === 'failed-run' || f.kind === 'error-rule' || f.kind === 'schedule-unparseable');
      return report('Debug automation', [
        {
          title: 'Answer',
          lines:
            failed.length === 0
              ? ['No failing automations in the window — nothing to debug.']
              : failed.slice(0, 5).map((f) => `${f.title}: ${f.detail} → ${f.suggestedAction}`),
        },
        { title: 'Evidence', lines: failed.slice(0, 5).flatMap((f) => f.evidence.slice(0, 2)) },
        { title: 'Uncertainty', lines: ['Findings cover the last 24 h of run records plus current rule states.'] },
      ]);
    }
    default:
      return report('Automation question', [{ title: 'Answer', lines: ['Unrecognized automation question key.'] }]);
  }
}
