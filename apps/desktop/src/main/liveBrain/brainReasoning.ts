/**
 * L6 · Live Brain — SLICE 3 · REASONING (deterministic).
 *
 * `reason(state, context, previous?)` → a `BrainReasoning` answering, from the S1 state +
 * the S2 provenanced context: what is happening · why · what changed · what is missing ·
 * known · unknown · could · should-not. Every answer CITES the facts it derives from, so
 * reasoning traces to evidence exactly as the state and the observer do.
 *
 * THE BOUNDARY BEFORE S4 (hard stop): S3 REASONS; it does NOT PROPOSE. It emits analysis —
 * no OBSERVATION→…→VERIFICATION-PLAN proposal object, no REQUIRED AUTHORITY, no action target
 * for execution. The `could` answers merely POINT at where a proposal would be formed (S4);
 * they carry no authority and name no executable action. Pinned by a "no-proposal" test.
 *
 * §2#13 + D-14: reasoning holds ZERO execution/grant authority (zero-runtime-import, pinned)
 * and is a DETERMINISTIC derivation — no model feeds it. "Live Brain" is not "live LLM."
 */
import type { LiveBrainState } from './liveBrainState';
import type { BrainContext, ProvenancedFact } from './brainContext';

/** One reasoned statement, citing the fact fields it derives from (never empty). */
export interface ReasonedStatement {
  readonly statement: string;
  readonly cites: readonly string[];
}

/** "What changed" is UNKNOWN unless a prior context is supplied — never assumed stable. */
export interface ChangeReport {
  readonly determinable: boolean;
  readonly note: string;
  readonly changes: readonly ReasonedStatement[];
}

export interface BrainReasoning {
  readonly whatIsHappening: readonly ReasonedStatement[];
  readonly why: readonly ReasonedStatement[];
  readonly whatChanged: ChangeReport;
  readonly whatIsMissing: readonly ReasonedStatement[];
  readonly known: readonly ReasonedStatement[];
  readonly unknown: readonly ReasonedStatement[];
  readonly could: readonly ReasonedStatement[];
  readonly shouldNot: readonly ReasonedStatement[];
}

const say = (statement: string, cites: readonly string[]): ReasonedStatement => ({ statement, cites });

function isMissing(f: ProvenancedFact): boolean {
  return (
    f.certainty === 'UNAVAILABLE' ||
    f.value === 'NEED' ||
    f.value.includes('not governed') ||
    f.value.includes('unresolved')
  );
}

function changeReport(current: BrainContext, previous?: BrainContext): ChangeReport {
  if (previous === undefined) {
    return { determinable: false, note: 'no prior context — change is UNKNOWN, not assumed stable', changes: [] };
  }
  // Subject-identity guard: a field-level diff is only a TEMPORAL change if both contexts describe
  // the SAME subject. A prior from a different tenant/scope would mislabel cross-subject differences
  // as change — so refuse it honestly (UNKNOWN), mirroring the no-prior path.
  if (previous.tenantId !== current.tenantId || previous.scopeResolved !== current.scopeResolved) {
    return {
      determinable: false,
      note: 'prior context describes a different subject (tenant/scope) — change is UNKNOWN, not a temporal delta',
      changes: [],
    };
  }
  const prev = new Map(previous.facts.map((f) => [f.field, f]));
  const cur = new Map(current.facts.map((f) => [f.field, f]));
  const changes: ReasonedStatement[] = [];
  for (const [field, f] of cur) {
    const p = prev.get(field);
    if (p === undefined) changes.push(say(`appeared: ${field} = ${f.value}`, [field]));
    else if (p.value !== f.value) changes.push(say(`value changed: ${field} ${p.value} → ${f.value}`, [field]));
    else if (p.certainty !== f.certainty) changes.push(say(`certainty changed: ${field} ${p.certainty} → ${f.certainty}`, [field]));
  }
  for (const [field] of prev) if (!cur.has(field)) changes.push(say(`disappeared: ${field}`, [field]));
  return { determinable: true, note: changes.length === 0 ? 'no change' : `${changes.length} change(s)`, changes };
}

export function reason(state: LiveBrainState, context: BrainContext, previous?: BrainContext): BrainReasoning {
  const facts = context.facts;

  // known / unknown — atomic facts, each cited to its own field.
  const known = facts
    .filter((f) => f.certainty === 'KNOWN' || f.certainty === 'VERIFIED')
    .map((f) => say(`${f.field} = ${f.value}${f.certainty === 'VERIFIED' ? ' (independently verified)' : ''}`, [f.field]));
  const unknown = facts.filter((f) => f.certainty === 'UNKNOWN').map((f) => say(`${f.field} is undetermined`, [f.field]));

  // what is missing — gaps, NEEDs, UNAVAILABLE, each cited.
  const whatIsMissing = facts.filter(isMissing).map((f) => say(`${f.field}: ${f.value}`, [f.field]));

  // what is happening — the resolved (non-UNAVAILABLE) S1 sections, cited to the section name.
  const whatIsHappening = Object.entries(state.sections)
    .filter(([, s]) => s.certainty !== 'UNAVAILABLE')
    .map(([name, s]) => say(`${name}: ${s.summary}`, [`section:${name}`]));

  // why — conflicts explained (never resolved), citing both claim sources; + scope resolution.
  const why: ReasonedStatement[] = state.conflicts.map((c) =>
    say(
      `${c.about} is CONFLICTING because ${c.claims.map((cl) => `${cl.source} says ${cl.says}`).join(' while ')}`,
      c.claims.map((cl) => cl.source),
    ),
  );
  if (!state.scopeResolved) why.push(say('ambient substrates are UNAVAILABLE because no tenant scope resolved', ['section:workspace', 'section:capabilities']));

  // could — POINTERS to where S4 would propose (routable, non-conflicted capabilities). NOT proposals.
  // A disputed SCOPE taints the whole capability view → no routable pointer is trustworthy. Otherwise
  // exclude only the EXACT capability ids that are in conflict (exact id, not a substring match).
  const scopeDisputed = state.conflicts.some((c) => c.about === 'tenant scope resolution');
  const conflictedCapIds = new Set(
    state.conflicts.map((c) => c.about.match(/^capability "(.+?)"/)?.[1]).filter((id): id is string => id !== undefined),
  );
  const could = scopeDisputed
    ? []
    : facts
        .filter((f) => f.field.startsWith('capability.') && f.value.startsWith('routable'))
        .filter((f) => !conflictedCapIds.has(f.field.slice('capability.'.length)))
        .map((f) => say(`${f.field} is routable — an action here COULD be proposed at S4 (analysis only, not a proposal)`, [f.field]));

  // should-not — prohibitions from governance-boundary honesty + conflicts + uncertainty.
  const shouldNot: ReasonedStatement[] = [];
  for (const f of facts.filter((x) => x.value.includes('not governed'))) {
    shouldNot.push(say(`${f.field} must NOT be routed or acted on — not governed`, [f.field]));
  }
  for (const c of state.conflicts) {
    shouldNot.push(say(`${c.about} must NOT be treated as settled until reconciled (conflict is surfaced, not resolved)`, c.claims.map((cl) => cl.source)));
  }
  if (unknown.length > 0) {
    shouldNot.push(say('undetermined facts must NOT be treated as okay (UNKNOWN is never "probably fine")', unknown.map((u) => u.cites[0])));
  }

  return {
    whatIsHappening,
    why,
    whatChanged: changeReport(context, previous),
    whatIsMissing,
    known,
    unknown,
    could,
    shouldNot,
  };
}
